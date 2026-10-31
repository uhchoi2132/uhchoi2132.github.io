import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog, getRecordClaims, RESEARCH_MAX_DATE } from './research';
import { graphAt, knowledgeRecordsAt } from './knowledge';
import { matchedAlias, ontologyDefinitions } from './knowledge-ontology';

const readable = (value: string | undefined) => !value || value === 'manual_report' || value === 'primary_read';

test('the dense graph covers every eligible source and every usable extracted claim, including merged claims', () => {
  const graph = graphAt(RESEARCH_MAX_DATE);
  const records = knowledgeRecordsAt(RESEARCH_MAX_DATE);
  const expectedClaims = records.flatMap(source => getRecordClaims(source).filter(claim => readable(claim.verification)));
  assert.equal(records.length, 76, '2 background and 3 blocked documents stay outside the attributed graph');
  assert.equal(expectedClaims.length, 78);
  assert.ok(graph.nodes.length >= 250);
  assert.ok(graph.relations.length >= 500);
  assert.deepEqual(graph.nodes.filter(node => node.layer === 'sources').map(node => node.id).sort(), records.map(record => `source:${record.id}`).sort());
  assert.deepEqual(graph.nodes.filter(node => node.layer === 'claims').map(node => node.id).sort(), expectedClaims.map(claim => claim.id).sort());
  assert.equal(new Set(graph.nodes.map(node => node.id)).size, graph.nodes.length);
  for (const record of records) for (const claim of getRecordClaims(record).filter(claim => readable(claim.verification))) {
    const documented = graph.relations.find(edge => edge.id === `documented:${claim.id}`);
    assert.ok(documented);
    assert.equal(documented.type, 'documented_by');
    assert.equal(documented.from, claim.id);
    assert.equal(documented.to, `source:${record.id}`);
    assert.equal(documented.evidence_text, claim.text);
    assert.deepEqual(documented.source_ids, [record.id]);
  }
  assert.equal(graph.relations.find(edge => edge.id === 'documented:claim:sds-012')?.to, 'source:media-001');
  assert.equal(graph.relations.find(edge => edge.id === 'documented:claim:tech-014')?.to, 'source:sds-002');
  for (const id of ['mi-013', 'mi-019', 'mi-020', 'mi-022', 'se-019']) assert.ok(!graph.nodes.some(node => node.id === `source:${id}`));
});

test('keyword links retain literal matching text and cannot manufacture causal dependencies', () => {
  const graph = graphAt(RESEARCH_MAX_DATE);
  const definitions = new Map(ontologyDefinitions.map(item => [item.id, item]));
  assert.equal(definitions.size, ontologyDefinitions.length, 'ontology IDs are unique');
  for (const relation of graph.relations.filter(edge => edge.matched_alias)) {
    const definition = definitions.get(relation.to)!;
    assert.ok(definition, relation.id);
    assert.ok(definition.aliases.includes(relation.matched_alias!), relation.id);
    assert.ok(matchedAlias(relation.evidence_text!, [relation.matched_alias!]), relation.id);
    assert.ok(['mentions', 'about'].includes(relation.type));
    assert.equal(relation.inferred, false);
    assert.equal(relation.provenance, 'source_attributed');
    if (relation.type === 'about') {
      const source = catalog.records.find(record => relation.source_ids.includes(record.id))!;
      const claim = getRecordClaims(source).find(claim => claim.id === relation.from)!;
      assert.equal(relation.evidence_text, claim.text);
    }
  }
  assert.ok(!graph.relations.some(edge => edge.type === 'depends_on'));
  // Listed partners are mentions; they are not assigned membership or PoC ownership automatically.
  assert.ok(graph.relations.some(edge => edge.from === 'source:sds-014' && edge.to === 'genesis-ai' && edge.type === 'mentions'));
  assert.ok(!graph.relations.some(edge => edge.from === 'team-rex' && edge.to === 'genesis-ai'));
  assert.ok(!graph.relations.some(edge => edge.from === 'semco' && edge.to === 'walden'));
});

test('short Latin aliases and Korean generic terms avoid known false positives', () => {
  assert.equal(matchedAlias('MESplus includes interfaces', ['MES']), undefined);
  assert.equal(matchedAlias('SCARCS invented token', ['RCS']), undefined);
  assert.equal(matchedAlias('삼성SDI는 검증한다', ['삼성SDI']), '삼성SDI');
  assert.equal(matchedAlias('NVIDIA Isaac Sim·Cosmos 활용', ['Isaac Sim']), 'Isaac Sim');
  assert.equal(matchedAlias('DAM-VLA 연구', ['VLA']), 'VLA');
  const safety = ontologyDefinitions.find(item => item.id === 'robot-safety')!;
  assert.equal(matchedAlias('자동차 안전부품 자재 공급', safety.aliases), undefined);
  assert.notEqual(matchedAlias('장애물 기반 안전 제약', safety.aliases), undefined);
});

test('all undated reports are current observations, including IR scripts, with strict event filters honored', () => {
  const undated = catalog.records.filter(source => source.scope === 'undated' && readable(source.verification));
  assert.equal(undated.length, 14);
  for (const mode of ['known', 'retro'] as const) {
    const historyIds = new Set(graphAt('2026-10-29', mode).nodes.map(node => node.id));
    for (const source of undated) assert.ok(!historyIds.has(`source:${source.id}`), source.id);
    const currentIds = new Set(graphAt(RESEARCH_MAX_DATE, mode).nodes.map(node => node.id));
    for (const source of undated) assert.ok(currentIds.has(`source:${source.id}`), source.id);
    const eventIds = new Set(graphAt(RESEARCH_MAX_DATE, mode, { eventAsOf: RESEARCH_MAX_DATE }).nodes.map(node => node.id));
    for (const source of undated) assert.ok(!eventIds.has(`source:${source.id}`), source.id);
  }
  const ir = catalog.records.find(source => source.id === 'sds-007')!;
  const original = ir.accessed_at;
  try {
    ir.accessed_at = '2026-10-31';
    assert.ok(!graphAt(RESEARCH_MAX_DATE).nodes.some(node => node.id === 'source:sds-007'));
  } finally { ir.accessed_at = original; }
});

test('announced future events have source and claim nodes from publication, without occurrence promotion', () => {
  for (const [id, date] of [['mi-011', '2025-11-10'], ['mi-015', '2026-03-09'], ['tech-012', '2026-06-04']]) {
    const graph = graphAt(date);
    const source = graph.nodes.find(node => node.id === `source:${id}`)!;
    assert.ok(source, `${id} known ${date}`);
    assert.ok(source.scheduled_event_date! > date);
    assert.ok(graph.nodes.some(node => node.id === `claim:${id}`));
    assert.equal(graph.relations.find(edge => edge.id === `documented:claim:${id}`)?.status, 'planned');
    assert.ok(!graphAt(date, 'known', { eventAsOf: date }).nodes.some(node => node.id === source.id));
  }
});

test('canonical layout is deterministic across date, mode and filtering, with distinct evidence layers', () => {
  const latest = graphAt(RESEARCH_MAX_DATE);
  const past = graphAt('2026-09-01');
  const byId = new Map(latest.nodes.map(node => [node.id, node]));
  for (const node of past.nodes) {
    assert.deepEqual(node.position, byId.get(node.id)?.position, node.id);
    assert.ok(node.cluster && Array.isArray(node.aliases));
  }
  for (const node of latest.nodes) {
    assert.equal(node.position.length, 3);
    assert.ok(node.position.every(Number.isFinite));
    if (node.layer === 'sources') assert.equal(node.kind, 'source');
    if (node.layer === 'claims') assert.equal(node.kind, 'claim');
  }
  assert.ok(new Set(latest.nodes.map(node => node.cluster)).size >= 5);
  assert.ok(new Set(latest.nodes.map(node => node.ontology_type)).size >= 14);
  for (const [source, claim] of [['source:media-001', 'claim:sds-012'], ['source:sds-002', 'claim:tech-014']]) assert.notDeepEqual(byId.get(source)?.position, byId.get(claim)?.position);
});

test('shared origin links and hypothesis mappings are explicit analyst interpretation', () => {
  const graph = graphAt(RESEARCH_MAX_DATE);
  const lineage = graph.relations.filter(edge => edge.type === 'shares_source_group');
  assert.ok(lineage.length >= 10);
  for (const edge of lineage) {
    assert.equal(edge.inferred, true);
    assert.equal(edge.provenance, 'analyst_mapping');
    const sources = edge.source_ids.map(id => catalog.records.find(source => source.id === id)!);
    assert.equal(new Set(sources.map(source => source.origin_key)).size, 1);
    assert.match(edge.rationale, /독립/);
  }
  for (const id of ['platform', 'vertical', 'distributed']) {
    assert.ok(graph.relations.some(edge => edge.to === id && edge.type === 'contradicts' && edge.inferred));
    assert.ok(graph.nodes.some(node => node.id === `question:${id}`));
  }
});

test('new curated business relationships use preserved exact claims and distinguish plans from operation', () => {
  const graph = graphAt(RESEARCH_MAX_DATE);
  const byId = new Map(graph.relations.map(edge => [edge.id, edge]));
  for (const id of ['orchestrator-intelligence', 'orchestrator-fleet']) {
    assert.deepEqual(byId.get(id)?.claim_ids, ['claim:sds-012']);
    assert.deepEqual(byId.get(id)?.source_ids, ['media-001']);
    assert.equal(byId.get(id)?.status, 'planned');
  }
  for (const id of ['miracom-greencos-mes', 'sdi-solid-state-showcase', 'semco-humanoid-camera', 'megafactory-omniverse']) assert.equal(byId.get(id)?.status, 'planned', id);
  assert.equal(byId.get('walden-sds-poc')?.status, 'undated_current');
  assert.ok(!graphAt('2026-10-29').relations.some(edge => edge.id === 'walden-sds-poc'));
  assert.ok(graph.nodes.some(node => node.id === 'greencos-gimpo3' && node.ontology_type === 'Factory'));
  for (const edge of graph.relations.filter(edge => edge.evidence_basis === 'extracted_claim')) {
    const actualClaims = edge.source_ids.flatMap(id => getRecordClaims(catalog.records.find(source => source.id === id)!));
    assert.ok(actualClaims.some(claim => claim.text === edge.evidence_text), edge.id);
  }
});

test('historical entity labels never import product capabilities from future or undated descriptions', () => {
  const historical = graphAt('2026-01-15', 'known');
  const mesplus = historical.nodes.find(node => node.id === 'mesplus');
  assert.ok(mesplus, 'the January Nexphere article already mentions MESplus');
  assert.ok(mesplus.source_ids.includes('mi-021'));
  assert.ok(!mesplus.source_ids.includes('mi-005'));
  assert.doesNotMatch([mesplus.title, mesplus.subtitle, mesplus.description].join(' '), /Open API|공통 로봇 API/i);
  assert.ok(!historical.nodes.some(node => node.id === 'open-api'));
  const current = graphAt(RESEARCH_MAX_DATE);
  assert.equal(current.nodes.find(node => node.id === 'mesplus')?.description, mesplus.description, 'identity text is time-neutral');
  const api = current.relations.find(edge => edge.id === 'mesplus-open-api');
  assert.ok(api, 'the actual capability remains on its currently eligible source-attributed relation');
  assert.deepEqual(api.source_ids, ['mi-005']);
  assert.match(api.evidence_text!, /Open API/);
});

test('every static entity description is identity-only and dated facts stay on eligible evidence', () => {
  for (const definition of ontologyDefinitions) {
    assert.equal(definition.description, `${definition.title} · ${definition.ontology_type} 식별 항목입니다. 기능·역할·계약·계획은 선택한 날짜의 연결 주장과 출처에서 확인합니다.`, definition.id);
  }
  assert.equal(ontologyDefinitions.find(item => item.id === 'ai-factory-2030')?.title, 'AI 자율공장');
  assert.equal(ontologyDefinitions.find(item => item.id === 'sds')?.subtitle, '삼성SDS');
  assert.doesNotMatch(ontologyDefinitions.find(item => item.id === 'walden')!.description, /투자/);
  assert.doesNotMatch(ontologyDefinitions.find(item => item.id === 'kai')!.description, /KF-21|납품|계약의 상대방/);
});
