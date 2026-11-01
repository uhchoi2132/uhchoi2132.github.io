import test from 'node:test';
import assert from 'node:assert/strict';
import { graphAt, type KnowledgeGraph, type KnowledgeNode } from './knowledge';
import { graphView } from './graph-view';
import { catalog, getRecordClaims, RESEARCH_MAX_DATE, type ResearchCatalog, type ResearchRecord } from './research';
import { surfaceRelations, evaluateTerrainHeight, sampleTerrainHeight, terrainSurface, TERRAIN_BOUNDS, TERRAIN_CONTOUR_STEP, TERRAIN_HEIGHT_SCALE, TERRAIN_KERNEL_SIGMA } from './terrain-surface';

const source = (id: string, date: string | null, overrides: Partial<ResearchRecord> = {}): ResearchRecord => ({
  id, title: `Synthetic ${id}`, url: `https://example.test/${id}`, publisher: 'Synthetic fixture',
  published_at: date, event_date: null, source_type: 'official', verification: 'manual_report',
  scope: date ? 'in_window' : 'undated', entity_ids: ['sds'], origin_key: id,
  summary_ko: 'Synthetic source; not Samsung evidence.', excerpt: '',
  claim: { text: `Synthetic claim ${id}`, kind: 'official_statement' },
  commercialization_stage: 'unassessed', limitations: ['Synthetic fixture'], accessed_at: '2026-02-12',
  date_basis: date ? 'page' : 'unknown', evidence_locator: 'Synthetic paragraph', ...overrides,
});
const fixtures: ResearchCatalog = {
  meta: { window_start: '2026-01-01', window_end: '2026-03-31', researched_at: '2026-03-31', coverage_note: 'Synthetic', query_count: 0 },
  records: [
    source('sds-a', '2026-01-10', { origin_key: 'shared', event_date: '2026-03-20' }),
    source('sds-b', '2026-02-05', { origin_key: 'shared' }),
    source('sds-c', '2026-02-06'),
    source('sds-0-hidden', '2026-03-01', { origin_key: 'shared' }),
    source('sds-observed', null),
    source('sds-unobserved', null, { accessed_at: '2026-02-25' }),
  ], queries: [],
};
function node(id: string, claim = false, x = 1, originalY = 2): KnowledgeNode {
  return {
    id: claim ? `claim:${id}` : `source:${id}`, title: `Synthetic ${id}`, kind: claim ? 'claim' : 'source',
    ontology_type: claim ? 'Claim' : 'Source', layer: claim ? 'claims' : 'sources', cluster: 'sds', aliases: [],
    description: 'Synthetic node', position: [x, originalY, .7], size: .1,
    source_ids: ['wrong-source'], claim_ids: ['wrong-claim'], published_at: '2020-01-01', origin_key: 'wrong-origin',
  };
}
const all: KnowledgeGraph = { nodes: [
  node('sds-a', false, -4, 0), node('sds-a', true, -3, 1),
  node('sds-b', false, 2, 0), node('sds-b', true, 3, 1),
  node('sds-c', false, 6, -3), node('sds-c', true, 7, -2),
  node('sds-0-hidden', false, -7, 2), node('sds-0-hidden', true, -8, 3),
  node('sds-observed', false, 3, -5), node('sds-observed', true, 4, -6), node('sds-unobserved', false, 3, -8),
], relations: [] };
const pick = (...ids: string[]): KnowledgeGraph => ({ nodes: all.nodes.filter(node => ids.includes(node.id)), relations: [] });
const small = { columns: 41, rows: 31 };

test('empty or entity-only graph has a flat continuous field with no invented peaks or contours', () => {
  const empty = terrainSurface({ nodes: [], relations: [] }, '2026-02-14', {}, fixtures);
  assert.equal(empty.valid, true);
  assert.equal(empty.field.heights.length, 80 * 64);
  assert.ok(empty.field.heights.every(value => value === 0));
  assert.deepEqual(empty.contours, []);
  assert.deepEqual(empty.evidenceAnchors, []);
  assert.equal(empty.regions.length, 5);
  assert.ok(empty.regions.every(region => region.height === 0 && region.metricCount === 0));
  const entity: KnowledgeNode = { ...node('identity'), id: 'sds', kind: 'company', ontology_type: 'Company', layer: 'entities' };
  const onlyEntity = terrainSurface({ nodes: [entity], relations: [] }, '2026-02-14', {}, fixtures);
  assert.deepEqual(onlyEntity.field.heights, empty.field.heights);
  assert.equal(onlyEntity.fingerprint, empty.fingerprint);
  assert.equal(onlyEntity.anchors[0].eligible, false);
  assert.deepEqual(onlyEntity.scope.nodeIds, ['sds']);
});

test('fixed Gaussian/log formula maps original graph x,y to world x,-z without changing graph positions', () => {
  const graph = pick('source:sds-a');
  const serialized = JSON.stringify(graph);
  const result = terrainSurface(graph, '2026-01-10', small, fixtures);
  assert.deepEqual(result.bounds, TERRAIN_BOUNDS);
  assert.equal(result.kernelAnchors.length, 1);
  assert.deepEqual([result.kernelAnchors[0].x, result.kernelAnchors[0].z], [-4, 0]);
  assert.equal(evaluateTerrainHeight(result.kernelAnchors, -4, 0), TERRAIN_HEIGHT_SCALE * Math.log(2));
  const oneSigma = TERRAIN_HEIGHT_SCALE * Math.log1p(Math.exp(-.5));
  assert.ok(Math.abs(evaluateTerrainHeight(result.kernelAnchors, -4 + TERRAIN_KERNEL_SIGMA, 0) - oneSigma) < 1e-12);
  assert.equal(result.field.positions.length, result.field.heights.length * 3);
  assert.equal(result.field.indices.length, (41 - 1) * (31 - 1) * 6);
  assert.deepEqual(result.field.positions.slice(0, 3), [-20, result.field.heights[0], -14]);
  assert.deepEqual(result.field.positions.slice(-3), [20, result.field.heights.at(-1), 16]);
  assert.deepEqual(result.anchors[0].originalPosition, [-4, 0, .7]);
  assert.equal(result.anchors[0].height, sampleTerrainHeight(result, -4, 0));
  assert.equal(JSON.stringify(graph), serialized);
  assert.equal(result.semantics.dateNormalization, false);
  assert.equal(result.semantics.confidenceMeasured, false);
});

test('actual publication accumulation only raises heights, with unchanged bounds, kernel positions and rendering scale', () => {
  for (const metric of ['documents', 'claims', 'sourceGroups'] as const) {
    const early = terrainSurface(all, '2026-01-20', { ...small, metric }, fixtures);
    const later = terrainSurface(all, '2026-02-14', { ...small, metric }, fixtures);
    assert.deepEqual(later.bounds, early.bounds);
    assert.equal(later.field.heights.length, early.field.heights.length);
    assert.ok(later.field.heights.every((height, index) => height >= early.field.heights[index]), metric);
    assert.ok(later.field.heights.some((height, index) => height > early.field.heights[index]), metric);
    assert.notEqual(later.fingerprint, early.fingerprint);
    assert.deepEqual(early.kernelAnchors.map(point => [point.id, point.x, point.z]), later.kernelAnchors.filter(point => early.kernelAnchors.some(old => old.id === point.id)).map(point => [point.id, point.x, point.z]));
  }
  const unchanged = terrainSurface(pick('source:sds-a'), '2026-01-20', small, fixtures);
  const nextDay = terrainSurface(pick('source:sds-a'), '2026-01-21', small, fixtures);
  assert.equal(unchanged.fingerprint, nextDay.fingerprint, 'fingerprint represents the actual field, not the date label');
});

test('source groups use one globally stable kernel and never disclose a hidden future representative identity', () => {
  const first = terrainSurface(pick('source:sds-a'), '2026-02-14', { ...small, metric: 'sourceGroups' }, fixtures);
  const second = terrainSurface(pick('source:sds-b'), '2026-02-14', { ...small, metric: 'sourceGroups' }, fixtures);
  const together = terrainSurface(pick('source:sds-a', 'source:sds-b'), '2026-02-14', { ...small, metric: 'sourceGroups' }, fixtures);
  assert.equal(together.kernelAnchors.length, 1);
  assert.deepEqual(first.field.heights, second.field.heights);
  assert.deepEqual(first.field.heights, together.field.heights);
  assert.deepEqual(together.contributions.nodeIds, ['source:sds-a', 'source:sds-b']);
  assert.deepEqual(together.contributions.sourceIds, ['sds-a', 'sds-b']);
  assert.deepEqual(together.contributions.sourceGroupKeys, ['shared']);
  assert.deepEqual(together.contributions.claimIds, []);
  assert.equal(together.counts.documentCount, 2);
  assert.equal(together.counts.sourceGroupCount, 1);
  assert.ok(!JSON.stringify(together).includes('sds-0-hidden'), 'canonical future source contributes geometry only, never its ID/title');
  assert.deepEqual(together.evidenceAnchors.map(item => [item.x, item.z]), [[-4, 0], [2, 0]], 'visible evidence markers retain their actual node coordinates');
});

test('metric layers count only visible nodes and claim source ownership uses the catalog, not copied graph metadata', () => {
  const claimsOnly = terrainSurface({ nodes: all.nodes.filter(node => node.ontology_type === 'Claim'), relations: [] }, '2026-02-14', { ...small, metric: 'claims' }, fixtures);
  assert.equal(claimsOnly.counts.documentCount, 0);
  assert.equal(claimsOnly.counts.sourceGroupCount, 0);
  assert.equal(claimsOnly.counts.claimCount, 3);
  assert.deepEqual(claimsOnly.contributions.claimIds, ['claim:sds-a', 'claim:sds-b', 'claim:sds-c']);
  assert.deepEqual(claimsOnly.contributions.sourceIds, ['sds-a', 'sds-b', 'sds-c']);
  assert.ok(claimsOnly.evidenceAnchors.every(anchor => anchor.kind === 'claim' && anchor.claimId === anchor.nodeId));
  const noRestoredDocuments = terrainSurface({ nodes: all.nodes.filter(node => node.ontology_type === 'Claim'), relations: [] }, '2026-02-14', small, fixtures);
  assert.ok(noRestoredDocuments.field.heights.every(height => height === 0));
  assert.equal(noRestoredDocuments.counts.claimCount, 3);
  assert.deepEqual(noRestoredDocuments.contributions.sourceIds, []);
  const sources = terrainSurface(all, '2026-02-14', small, fixtures);
  assert.ok(sources.contributions.nodeIds.every(id => id.startsWith('source:')));
  assert.ok(sources.exclusions.some(row => row.nodeId === 'claim:sds-a' && row.reason === 'metric_not_selected'));
});

test('undated evidence defaults off and its explicit toggle still enforces observation cutoff and absolute publication dates', () => {
  const excluded = terrainSurface(all, '2026-02-14', small, fixtures);
  const included = terrainSurface(all, '2026-02-14', { ...small, includeUndated: true }, fixtures);
  const earlier = terrainSurface(all, '2026-02-11', { ...small, includeUndated: true }, fixtures);
  assert.deepEqual(excluded.contributions.undatedNodeIds, []);
  assert.ok(excluded.exclusions.some(row => row.nodeId === 'source:sds-observed' && row.reason === 'undated_disabled'));
  assert.equal(excluded.anchors.find(row => row.nodeId === 'source:sds-observed')!.eligible, false);
  assert.deepEqual(included.contributions.undatedNodeIds, ['source:sds-observed']);
  assert.deepEqual(earlier.contributions.undatedNodeIds, []);
  assert.ok(included.exclusions.some(row => row.nodeId === 'source:sds-unobserved' && row.reason === 'not_yet_observed'));
  assert.ok(included.exclusions.some(row => row.nodeId === 'source:sds-0-hidden' && row.reason === 'future_publication'));
  assert.ok(excluded.contributions.sourceIds.includes('sds-a'), 'already announced March plan is known from its January publication');
  assert.ok(included.field.heights.every((height, index) => height >= excluded.field.heights[index]));
});

test('marching squares produces fixed-elevation segments exactly on the sampled rendered field', () => {
  const result = terrainSurface(pick('source:sds-a', 'source:sds-c'), '2026-02-14', { columns: 80, rows: 64 }, fixtures);
  assert.ok(result.contours.length > 0);
  for (const contour of result.contours) {
    assert.ok(Math.abs(contour.level / TERRAIN_CONTOUR_STEP - Math.round(contour.level / TERRAIN_CONTOUR_STEP)) < 1e-9);
    assert.equal(contour.segments.length % 6, 0);
    for (let i = 0; i < contour.segments.length; i += 3) {
      const [x, height, z] = contour.segments.slice(i, i + 3);
      assert.equal(height, contour.level);
      assert.ok(Math.abs(sampleTerrainHeight(result, x, z) - contour.level) < 1e-10);
    }
  }
  const [a, b, c] = result.field.indices;
  const p = result.field.positions;
  const normalY = (p[b * 3 + 2] - p[a * 3 + 2]) * (p[c * 3] - p[a * 3]) - (p[b * 3] - p[a * 3]) * (p[c * 3 + 2] - p[a * 3 + 2]);
  assert.ok(normalY > 0, 'triangle winding faces upward');
  assert.equal(sampleTerrainHeight(result, 21, 0), 0);
  assert.equal(sampleTerrainHeight(result, NaN, 0), 0);
});

test('dates, invalid positions and unverified claims fail closed, while grid and JSON output stay bounded and deterministic', () => {
  for (const date of ['2026-02-30', '2025-12-31', '2026-04-01']) {
    const invalid = terrainSurface(all, date, small, fixtures);
    assert.equal(invalid.valid, false);
    assert.ok(invalid.field.heights.every(value => value === 0));
    assert.deepEqual(invalid.contributions.nodeIds, []);
  }
  const invalidOptions = terrainSurface(all, '2026-02-14', { columns: NaN }, fixtures);
  assert.equal(invalidOptions.error, 'invalid_options');
  const limited = terrainSurface({ nodes: [], relations: [] }, '2026-02-14', { columns: 9999, rows: 9999 }, fixtures);
  assert.equal(limited.field.heights.length, 128 * 96);
  const invalidPosition = terrainSurface({ nodes: [node('sds-a', false, NaN)], relations: [] }, '2026-02-14', small, fixtures);
  assert.equal(invalidPosition.exclusions[0].reason, 'invalid_position');
  assert.deepEqual(invalidPosition.anchors, []);
  const outside = terrainSurface({ nodes: [node('sds-a', false, 21)], relations: [] }, '2026-02-14', small, fixtures);
  assert.equal(outside.exclusions[0].reason, 'outside_fixed_bounds');
  const blocked: ResearchCatalog = { ...fixtures, records: [source('sds-a', '2026-01-10', { claims: [{ id: 'claim:sds-a', text: 'Synthetic blocked extraction', kind: 'official_statement', verification: 'search_only' }] })] };
  const rejected = terrainSurface(pick('claim:sds-a'), '2026-02-14', { ...small, metric: 'claims' }, blocked);
  assert.deepEqual(rejected.contributions.nodeIds, []);
  assert.equal(rejected.exclusions[0].reason, 'unusable_claim');
  const normal = terrainSurface(all, '2026-02-14', small, fixtures);
  const reordered = terrainSurface({ nodes: [...all.nodes].reverse().concat(all.nodes[0]), relations: [] }, '2026-02-14', small, fixtures);
  assert.deepEqual(reordered, normal);
  assert.deepEqual(JSON.parse(JSON.stringify(normal)), normal, 'no typed arrays, NaN, undefined array entries, Maps, Sets or mutable class objects');
});

test('real catalog preserves all fixed anchors, exact current IDs, distinct groups and retro cutoff without database mutation', () => {
  const beforeCatalog = JSON.stringify(catalog);
  const graph = graphAt(RESEARCH_MAX_DATE);
  const beforeGraph = JSON.stringify(graph);
  const datedIds = new Set(catalog.records.filter(record => record.scope === 'in_window' && record.published_at !== null && record.published_at <= RESEARCH_MAX_DATE).map(record => record.id));
  const expectedSources = graph.nodes.filter(node => node.ontology_type === 'Source' && datedIds.has(node.id.slice(7))).map(node => node.id).sort();
  const claims = new Map(catalog.records.flatMap(record => getRecordClaims(record).map(claim => [claim.id, record.id] as const)));
  const expectedClaims = graph.nodes.filter(node => node.ontology_type === 'Claim' && datedIds.has(claims.get(node.id)!)).map(node => node.id).sort();
  const docs = terrainSurface(graph, RESEARCH_MAX_DATE, { ...small, metric: 'documents' });
  const currentClaims = terrainSurface(graph, RESEARCH_MAX_DATE, { ...small, metric: 'claims' });
  const withUndated = terrainSurface(graph, RESEARCH_MAX_DATE, { ...small, metric: 'claims', includeUndated: true });
  assert.deepEqual(docs.contributions.nodeIds, expectedSources);
  assert.deepEqual(currentClaims.contributions.nodeIds, expectedClaims);
  assert.equal(docs.anchors.length, graph.nodes.length, 'all real graph coordinates fit the immutable world bounds');
  assert.equal(withUndated.contributions.nodeIds.length, graph.nodes.filter(node => node.ontology_type === 'Claim').length);
  assert.equal(withUndated.counts.documentCount, graph.nodes.filter(node => node.ontology_type === 'Source').length);
  for (const anchor of docs.anchors) {
    const original = graph.nodes.find(node => node.id === anchor.nodeId)!;
    assert.deepEqual([anchor.x, anchor.z], [original.position[0], -original.position[1]]);
  }
  const focusedGraph = graphView(graph, 'all', '', { layer: 'claims', cluster: 'sds' });
  const focused = terrainSurface(focusedGraph, RESEARCH_MAX_DATE, { ...small, metric: 'claims' });
  assert.equal(focused.counts.documentCount, 0);
  assert.ok(focused.regions.filter(region => region.id !== 'sds').every(region => region.metricCount === 0));
  const retro = terrainSurface(graphAt('2026-07-01', 'retro'), '2026-07-01', { ...small, metric: 'claims' });
  assert.ok(retro.exclusions.some(item => item.nodeId === 'claim:tech-018' && item.reason === 'future_publication'));
  assert.ok(!retro.contributions.claimIds.includes('claim:tech-018'));
  assert.equal(JSON.stringify(graph), beforeGraph);
  assert.equal(JSON.stringify(catalog), beforeCatalog);
});


test('terrain connections and detail share exact eligible proof and reject late or partial provenance', () => {
  const graph = graphAt(RESEARCH_MAX_DATE, 'known');
  const surface = terrainSurface(graph, RESEARCH_MAX_DATE, { metric: 'claims' });
  const eligible = surfaceRelations(surface, graph);
  assert.ok(eligible.length > 0);
  const edge = eligible[0];
  const candidates = [edge,
    { ...edge, id: 'synthetic-hidden-source', source_ids: [...edge.source_ids, 'synthetic-missing-source'] },
    { ...edge, id: 'synthetic-hidden-claim', claim_ids: [...edge.claim_ids, 'synthetic-missing-claim'] },
    { ...edge, id: 'synthetic-future-relation', published_at: '2099-01-01' },
    { ...edge, id: 'synthetic-future-observation', published_at: null, observed_at: '2099-01-01' },
  ];
  assert.deepEqual(surfaceRelations(surface, { ...graph, relations: candidates }).map(item => item.id), [edge.id]);
});
