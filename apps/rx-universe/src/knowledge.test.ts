import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog, getRecordClaims, RESEARCH_MAX_DATE } from './research';
import { graphAt, hypothesisAssessments, knowledgeRecordsAt } from './knowledge';
import { graphView } from './graph-view';

test('every graph relation resolves to an eligible source and its actual extracted claim', () => {
  const graph = graphAt(RESEARCH_MAX_DATE);
  const sources = new Map(knowledgeRecordsAt(RESEARCH_MAX_DATE).map(source => [source.id, source]));
  const nodes = new Set(graph.nodes.map(node => node.id));
  assert.ok(graph.relations.length >= 20);
  assert.equal(new Set(graph.relations.map(edge => edge.id)).size, graph.relations.length);
  for (const edge of graph.relations) {
    assert.ok(nodes.has(edge.from) && nodes.has(edge.to), edge.id);
    assert.ok(edge.source_ids.length > 0 && edge.claim_ids.length > 0, edge.id);
    for (const id of edge.source_ids) assert.ok(sources.has(id), `${edge.id}: ${id}`);
    const sourceClaimIds = new Set(edge.source_ids.flatMap(id => getRecordClaims(sources.get(id)!).map(claim => claim.id)));
    for (const id of edge.claim_ids) assert.ok(sourceClaimIds.has(id), `${edge.id}: ${id}`);
    assert.equal(edge.inferred, edge.provenance === 'analyst_mapping');
    assert.ok(edge.rationale.length > 15);
  }
  for (const node of graph.nodes) {
    assert.ok(node.source_ids.length && node.claim_ids.length, node.id);
    assert.ok(graph.relations.some(edge => edge.from === node.id || edge.to === node.id));
  }
});

test('manual reading reports preserve attribution while blocked sources and unreviewed claims cannot create edges', () => {
  const source = catalog.records.find(record => record.id === 'se-001')!;
  const originalVerification = source.verification;
  const originalClaims = source.claims;
  try {
    source.verification = 'manual_report';
    source.claims = getRecordClaims(source).map(claim => ({ ...claim, verification: 'manual_report' }));
    const attributed = graphAt(RESEARCH_MAX_DATE).relations.find(relation => relation.id === 'se-nvidia');
    assert.ok(attributed);
    assert.equal(attributed.provenance, 'source_attributed');
    assert.equal(attributed.status, 'reported');
    assert.equal('verified' in attributed, false);
    assert.equal(knowledgeRecordsAt(RESEARCH_MAX_DATE).find(record => record.id === source.id)?.verification, 'manual_report');
    for (const unavailable of ['search_only', 'access_blocked'] as const) {
      source.verification = unavailable;
      assert.ok(!graphAt(RESEARCH_MAX_DATE).relations.some(relation => relation.id === 'se-nvidia'), `${unavailable} source`);
      source.verification = 'manual_report';
      source.claims = source.claims.map(claim => ({ ...claim, verification: unavailable }));
      assert.ok(!graphAt(RESEARCH_MAX_DATE).relations.some(relation => relation.id === 'se-nvidia'), `${unavailable} claim`);
      source.claims = source.claims.map(claim => ({ ...claim, verification: 'manual_report' }));
    }
  } finally {
    source.verification = originalVerification;
    source.claims = originalClaims;
  }
});

test('renderer and export projection shares alias search and removes edges to filtered nodes', () => {
  for (const date of ['2026-09-01', RESEARCH_MAX_DATE]) {
    const graph = graphAt(date);
    assert.deepEqual(graphView(graph), graph);
    const companies = graphView(graph, 'company');
    assert.ok(companies.nodes.length > 0);
    assert.ok(companies.nodes.every(node => node.kind === 'company' || node.kind === 'organization'));
    const ids = new Set(companies.nodes.map(node => node.id));
    assert.ok(companies.relations.length > 0);
    assert.ok(companies.relations.every(relation => ids.has(relation.from) && ids.has(relation.to)));
    const descriptionMatch = graphView(graph, 'all', '한국항공우주산업');
    assert.deepEqual(descriptionMatch.nodes.map(node => node.id), ['kai']);
    assert.deepEqual(descriptionMatch.relations, []);
    assert.deepEqual(graphView(graph, 'all', 'no-such-rx-entity'), { nodes: [], relations: [] });
  }
});

test('September 1 replay does not leak later platform plans, partnerships or undated products', () => {
  const graph = graphAt('2026-09-01', 'known');
  for (const id of ['sds-orchestrator', 'rainbow-etech', 'rainbow-sfa', 'miracom-orchestrator', 'miracom-rcs', 'sds-mcs']) {
    assert.ok(!graph.relations.some(edge => edge.id === id), id);
  }
  assert.ok(graph.relations.some(edge => edge.id === 'se-rainbow-ownership'));
  assert.ok(!graph.nodes.some(node => node.id === 'rcs'));
});

test('publication and event cutoffs independently constrain ownership without rewriting source dates', () => {
  const ownership = (knownAt: string, eventAsOf: string) => graphAt(knownAt, 'known', { eventAsOf }).relations.find(relation => relation.id === 'se-rainbow-ownership');
  assert.equal(ownership('2026-07-01', '2026-06-30'), undefined, 'an event date does not reveal an unpublished filing');
  assert.equal(ownership('2026-08-14', '2026-06-29'), undefined, 'an available filing does not move its event before the cutoff');
  const eligible = ownership('2026-08-14', '2026-06-30');
  assert.ok(eligible);
  assert.equal(eligible.published_at, '2026-08-14');
  assert.equal(eligible.event_date, '2026-06-30');
  assert.deepEqual(eligible.claim_ids, ['claim:tech-018']);
  assert.deepEqual(eligible.source_ids, graphAt('2026-08-14').relations.find(relation => relation.id === eligible.id)!.source_ids);
});

test('explicit event cutoff reaches graph and hypothesis evidence and excludes unknown event dates', () => {
  const options = { eventAsOf: '2026-09-01' };
  for (const mode of ['known', 'retro'] as const) {
    const records = knowledgeRecordsAt(RESEARCH_MAX_DATE, mode, options);
    const sources = new Map(records.map(source => [source.id, source]));
    assert.ok(records.length > 0);
    assert.ok(records.every(source => source.event_date !== null && source.event_date <= options.eventAsOf));
    const graph = graphAt(RESEARCH_MAX_DATE, mode, options);
    assert.ok(graph.relations.some(relation => relation.id === 'se-rainbow-ownership'));
    for (const id of ['sds-orchestrator', 'rainbow-kai-contract', 'miracom-rcs', 'sds-mcs', 'miracom-mesplus']) {
      assert.ok(!graph.relations.some(relation => relation.id === id), id);
    }
    for (const relation of graph.relations) {
      const eligibleClaims = new Set(relation.source_ids.flatMap(id => getRecordClaims(sources.get(id)!).map(claim => claim.id)));
      assert.ok(relation.claim_ids.every(id => eligibleClaims.has(id)));
    }
    for (const hypothesis of hypothesisAssessments(RESEARCH_MAX_DATE, mode, options)) {
      for (const evidence of [...hypothesis.support, ...hypothesis.challenge, ...hypothesis.context]) {
        const source = sources.get(evidence.source_id);
        assert.ok(source);
        assert.equal(evidence.text, getRecordClaims(source).find(claim => claim.id === evidence.claim_id)?.text);
      }
    }
    for (const eventAsOf of ['', '2026-02-30']) {
      assert.deepEqual(graphAt(RESEARCH_MAX_DATE, mode, { eventAsOf }), { nodes: [], relations: [] });
      assert.ok(hypothesisAssessments(RESEARCH_MAX_DATE, mode, { eventAsOf }).every(h => [...h.support, ...h.challenge, ...h.context].length === 0));
    }
  }
});

test('retrospective ownership uses the disclosed June status but unknown KAI delivery date stays unknown', () => {
  assert.ok(!graphAt('2026-07-01', 'known').relations.some(edge => edge.id === 'se-rainbow-ownership'));
  assert.ok(graphAt('2026-07-01', 'retro').relations.some(edge => edge.id === 'se-rainbow-ownership'));
  assert.ok(!graphAt('2026-06-30', 'retro').relations.some(edge => edge.id === 'rainbow-kai-contract'));
  const edge = graphAt('2026-08-14').relations.find(edge => edge.id === 'rainbow-kai-contract');
  assert.ok(edge);
  assert.equal(edge.event_date, null);
  assert.deepEqual(edge.claim_ids, ['claim:tech-017']);
  assert.match(edge.rationale, /2024/);
  assert.match(edge.rationale, /잔금/);
});

test('all undated reading reports enter only at the current observation date', () => {
  for (const mode of ['known', 'retro'] as const) {
    const old = graphAt('2026-10-29', mode);
    assert.ok(!old.relations.some(edge => edge.status === 'undated_current'));
    const current = graphAt(RESEARCH_MAX_DATE, mode).relations.filter(edge => edge.status === 'undated_current');
    const expected = catalog.records.filter(record => record.scope === 'undated' && ['manual_report', 'primary_read'].includes(record.verification));
    const represented = new Set(current.flatMap(edge => edge.source_ids));
    assert.equal(expected.length, 14);
    for (const record of expected) assert.ok(represented.has(record.id), record.id);
    for (const edge of current) {
      assert.equal(edge.published_at, null);
      assert.equal(edge.observed_at, '2026-10-30');
    }
  }
});

test('merged Walden claim points at the surviving document and remains source attributed', () => {
  const edge = graphAt(RESEARCH_MAX_DATE).relations.find(edge => edge.id === 'sds-walden');
  assert.ok(edge);
  assert.deepEqual(edge.source_ids, ['sds-002']);
  assert.deepEqual(edge.claim_ids, ['claim:tech-014']);
  const source = catalog.records.find(source => source.id === 'sds-002')!;
  assert.match(getRecordClaims(source).find(claim => claim.id === 'claim:tech-014')!.text, /Walden/);
  assert.equal(edge.provenance, 'source_attributed');
});

test('planned platform and manufacturing projects are not promoted to deployed products', () => {
  const graph = graphAt(RESEARCH_MAX_DATE);
  for (const id of ['sds-orchestrator', 'se-factory-2030', 'se-gumi-line', 'sds-gumi-dc', 'rainbow-sfa']) {
    assert.equal(graph.relations.find(edge => edge.id === id)?.status, 'planned', id);
  }
  assert.ok(!graph.nodes.some(node => node.id === 'api' || node.title === 'Common API'));
  assert.ok(!graph.relations.some(edge => edge.from === 'sds' && edge.to === 'kai-drilling-contract'));
});

test('hypothesis evidence is explicit analyst mapping with actual, date-eligible claim text', () => {
  for (const date of ['2026-09-01', RESEARCH_MAX_DATE]) {
    const sources = new Map(knowledgeRecordsAt(date).map(source => [source.id, source]));
    const assessments = hypothesisAssessments(date);
    assert.equal(assessments.length, 3);
    for (const assessment of assessments) {
      assert.equal(assessment.analyst_mapping, true);
      assert.equal(assessment.status, 'analyst_hypothesis');
      assert.ok(assessment.next_check && assessment.alternative);
      assert.ok(!('probability' in assessment));
      for (const role of ['support', 'challenge', 'context'] as const) {
        for (const evidence of assessment[role]) {
          const source = sources.get(evidence.source_id);
          assert.ok(source);
          assert.equal(evidence.text, getRecordClaims(source).find(claim => claim.id === evidence.claim_id)?.text);
          assert.equal(evidence.url, source.url);
          assert.equal(evidence.evidence_role, role);
          assert.equal(evidence.analyst_mapping, true);
          assert.ok(evidence.rationale.length > 15);
        }
      }
    }
  }
  for (const assessment of hypothesisAssessments(RESEARCH_MAX_DATE)) {
    assert.ok(assessment.support.length > 0);
    assert.ok(assessment.challenge.length > 0);
  }
});

test('unknown and pre-window dates do not manufacture graph evidence; mode aliases are equivalent', () => {
  for (const date of ['invalid', '2026-02-30', '2025-10-29']) {
    assert.deepEqual(graphAt(date), { nodes: [], relations: [] });
    assert.ok(hypothesisAssessments(date).every(h => [...h.support, ...h.challenge, ...h.context].length === 0));
  }
  assert.deepEqual(graphAt('2026-09-01', 'known'), graphAt('2026-09-01', 'as-known-at'));
  assert.deepEqual(graphAt('2026-09-01', 'retro'), graphAt('2026-09-01', 'retrospective'));
});
