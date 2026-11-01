import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog, getRecordClaims, RESEARCH_MAX_DATE, type ResearchCatalog, type ResearchRecord } from './research';
import { graphAt, type KnowledgeCluster, type KnowledgeGraph, type KnowledgeNode } from './knowledge';
import { graphView } from './graph-view';
import { CLUSTER_LABELS } from './knowledge-ontology';
import { knowledgeEvolution } from './knowledge-evolution';

const fixtureRecord = (id: string, published_at: string | null, overrides: Partial<ResearchRecord> = {}): ResearchRecord => ({
  id, title: `Synthetic ${id}`, url: `https://example.test/${id}`, publisher: 'Synthetic publisher',
  published_at, event_date: null, source_type: 'official', verification: 'manual_report',
  audit_status: 'unarchived', archive_url: null, content_sha256: null, verification_note: 'Synthetic reading report',
  scope: published_at ? 'in_window' : 'undated', entity_ids: ['sds'], origin_key: id,
  summary_ko: 'Synthetic test record, not real Samsung evidence.', excerpt: '',
  claim: { text: `Synthetic claim ${id}`, kind: 'official_statement' },
  commercialization_stage: 'unassessed', limitations: ['Synthetic fixture'], accessed_at: '2026-02-12',
  date_basis: published_at ? 'page' : 'unknown', evidence_locator: 'Synthetic paragraph', ...overrides,
});
const fixtures: ResearchCatalog = {
  meta: { window_start: '2026-01-05', window_end: '2026-03-31', researched_at: '2026-03-31', coverage_note: 'Synthetic fixtures', query_count: 0 },
  records: [
    fixtureRecord('a', '2026-01-10', { origin_key: 'shared-announcement', event_date: '2026-03-15', claims: [
      { id: 'claim:a', text: 'Synthetic first extraction', kind: 'official_statement' },
      { id: 'claim:a:2', text: 'Synthetic second extraction', kind: 'official_statement' },
    ] }),
    fixtureRecord('b', '2026-02-05', { origin_key: 'shared-announcement' }),
    fixtureRecord('cross-region', '2026-02-06', { origin_key: 'shared-announcement' }),
    fixtureRecord('future', '2026-02-28', { event_date: '2026-01-01' }),
    fixtureRecord('observed', null),
    fixtureRecord('unobserved', null, { accessed_at: '2026-02-20' }),
  ], queries: [],
};
function node(id: string, type: 'Source' | 'Claim', cluster: KnowledgeCluster = 'sds'): KnowledgeNode {
  return {
    id: type === 'Source' ? `source:${id}` : id, title: id, kind: type === 'Source' ? 'source' : 'claim',
    ontology_type: type, layer: type === 'Source' ? 'sources' : 'claims', cluster, aliases: [], description: 'Synthetic node',
    source_ids: ['intentionally-not-authoritative'], claim_ids: ['claim:hidden'], position: [1, 2, 3], size: .1,
    published_at: '2025-01-01', origin_key: 'intentionally-not-authoritative',
  };
}
const graph: KnowledgeGraph = { nodes: [
  node('a', 'Source'), node('claim:a', 'Claim'), node('claim:a:2', 'Claim'),
  node('b', 'Source'), node('claim:b', 'Claim'), node('cross-region', 'Source', 'electronics'),
  node('future', 'Source'), node('claim:future', 'Claim'),
  node('observed', 'Source'), node('claim:observed', 'Claim'), node('unobserved', 'Source'),
], relations: [] };
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

test('monthly and cumulative counts use actual publication dates, exact visible claim IDs and distinct origin sets', () => {
  const result = knowledgeEvolution(graph, '2026-02-14', fixtures);
  assert.equal(result.valid, true);
  assert.deepEqual(result.months, ['2026-01', '2026-02']);
  const sds = result.topics.find(topic => topic.id === 'sds')!;
  const january = sds.months[0];
  const february = sds.months[1];
  assert.deepEqual([january.from, january.to], ['2026-01-05', '2026-01-31']);
  assert.deepEqual([february.from, february.to], ['2026-02-01', '2026-02-14']);
  assert.deepEqual([january.documentCount, january.claimCount, january.sourceGroupCount], [1, 2, 1]);
  assert.deepEqual(january.documentIds, ['a']);
  assert.deepEqual(january.claimIds, ['claim:a', 'claim:a:2']);
  assert.deepEqual([february.documentCount, february.claimCount, february.sourceGroupCount], [1, 1, 1]);
  assert.deepEqual([february.cumulative.documentCount, february.cumulative.claimCount, february.cumulative.sourceGroupCount], [2, 3, 1]);
  assert.deepEqual(february.cumulative.sourceGroupKeys, ['shared-announcement']);
  assert.equal(result.totals.published.documentCount, 3);
  assert.equal(result.totals.published.sourceGroupCount, 1, 'one origin appearing in two regions/months is not added repeatedly');
  assert.equal(sum(result.topics.map(topic => topic.published.sourceGroupCount)), 2, 'topic counts are intentionally nonadditive');
  assert.ok(!result.scope.contributingSourceIds.includes('intentionally-not-authoritative'));
  assert.ok(result.exclusions.some(item => item.nodeId === 'source:future' && item.reason === 'future_publication'));
  assert.ok(result.exclusions.some(item => item.nodeId === 'claim:future' && item.reason === 'future_publication'));
});

test('claim-only and source-only projections never restore hidden evidence nodes to counts', () => {
  const claimOnly = knowledgeEvolution({ nodes: graph.nodes.filter(item => item.ontology_type === 'Claim'), relations: [] }, '2026-02-14', fixtures);
  const sds = claimOnly.topics.find(topic => topic.id === 'sds')!;
  assert.equal(sds.published.documentCount, 0);
  assert.equal(sds.published.claimCount, 3);
  assert.equal(sds.published.sourceGroupCount, 0);
  assert.deepEqual(sds.published.documentIds, []);
  assert.deepEqual(sds.published.contributingSourceIds, ['a', 'b']);
  assert.equal(sds.undated.documentCount, 0);
  assert.equal(sds.undated.claimCount, 1);
  assert.deepEqual(sds.undated.contributingSourceIds, ['observed']);
  const sourceOnly = knowledgeEvolution({ nodes: graph.nodes.filter(item => item.ontology_type === 'Source'), relations: [] }, '2026-02-14', fixtures);
  assert.equal(sourceOnly.totals.published.claimCount, 0);
  assert.equal(sourceOnly.totals.published.documentCount, 3);
  assert.deepEqual(sourceOnly.totals.published.claimIds, []);
});

test('undated evidence is observed by the cutoff and kept outside all monthly publication accumulation', () => {
  const result = knowledgeEvolution(graph, '2026-02-14', fixtures);
  const sds = result.topics.find(topic => topic.id === 'sds')!;
  assert.deepEqual(sds.undated.documentIds, ['observed']);
  assert.deepEqual(sds.undated.claimIds, ['claim:observed']);
  assert.ok(result.exclusions.some(item => item.nodeId === 'source:unobserved' && item.reason === 'not_yet_observed'));
  assert.ok(sds.months.every(month => !month.documentIds.includes('observed') && !month.cumulative.claimIds.includes('claim:observed')));
  assert.equal(sds.published.documentCount, sum(sds.months.map(month => month.documentCount)));
  const earlier = knowledgeEvolution(graph, '2026-02-11', fixtures);
  assert.equal(earlier.totals.undated.documentCount, 0);
  assert.equal(earlier.totals.undated.claimCount, 0);
  assert.equal(earlier.topics.find(topic => topic.id === 'sds')!.published.documentCount, 2, 'dated documents are reconstructed by public date, not the later research capture date');
});

test('invalid cutoffs and dates fail closed; unknown visible IDs cannot create publication counts', () => {
  for (const knownAt of ['invalid', '2026-02-30', '2026-01-04', '2026-04-01']) {
    const result = knowledgeEvolution(graph, knownAt, fixtures);
    assert.equal(result.valid, false);
    assert.ok(result.errorMessage);
    assert.deepEqual(result.months, []);
    assert.equal(result.totals.published.documentCount, 0);
    assert.equal(result.totals.undated.claimCount, 0);
  }
  const malformed = { ...fixtures, records: [fixtureRecord('malformed', '2026-02-30'), fixtureRecord('bad-observation', null, { accessed_at: '2026-02-30' })] };
  const invalidNodes = { nodes: [node('malformed', 'Source'), node('bad-observation', 'Source'), node('missing', 'Source'), node('claim:missing', 'Claim')], relations: [] };
  const result = knowledgeEvolution(invalidNodes, '2026-02-14', malformed);
  assert.equal(result.valid, true);
  assert.equal(result.totals.published.documentCount, 0);
  assert.equal(result.totals.undated.documentCount, 0);
  assert.deepEqual(new Set(result.exclusions.map(item => item.reason)), new Set(['invalid_publication_date', 'invalid_observation_date', 'unknown_source', 'unknown_claim']));
});

test('empty months and regions stay explicit, and input ordering or repeated rendering nodes cannot inflate counts', () => {
  const result = knowledgeEvolution(graph, '2026-03-31', fixtures);
  assert.deepEqual(result.topics.map(topic => [topic.id, topic.label]), Object.entries(CLUSTER_LABELS));
  const sds = result.topics.find(topic => topic.id === 'sds')!;
  assert.equal(sds.months[2].month, '2026-03');
  assert.equal(sds.months[2].documentCount, 0);
  assert.equal(sds.months[2].claimCount, 0);
  assert.deepEqual(sds.months[2].cumulative, sds.published);
  assert.ok(result.topics.find(topic => topic.id === 'miracom')!.months.every(month => month.documentCount === 0 && month.claimCount === 0));
  const reordered = knowledgeEvolution({ nodes: [...graph.nodes].reverse().concat(graph.nodes[0]), relations: [] }, '2026-03-31', fixtures);
  assert.deepEqual(reordered, result);
  assert.equal(result.semantics.historicalGraphSnapshots, false);
  assert.equal(result.semantics.claimVersionHistory, false);
  assert.equal(result.semantics.coverageCompletenessMeasured, false);
  assert.equal(result.semantics.personalInterestMeasured, false);
  assert.equal(result.semantics.confidenceMeasured, false);
});

test('real current catalog preserves all visible dated and undated node IDs without mutating the graph', () => {
  const visible = graphAt(RESEARCH_MAX_DATE);
  const before = JSON.stringify(visible);
  const result = knowledgeEvolution(visible, RESEARCH_MAX_DATE);
  assert.equal(result.valid, true);
  assert.equal(result.months.length, 13);
  assert.equal(result.topics[0].months[0].from, catalog.meta.window_start);
  assert.equal(result.topics[0].months.at(-1)!.to, RESEARCH_MAX_DATE);
  const sourceMap = new Map(catalog.records.map(source => [source.id, source]));
  const expectedDocuments = visible.nodes.filter(item => item.ontology_type === 'Source').map(item => item.id.slice('source:'.length));
  const dated = expectedDocuments.filter(id => sourceMap.get(id)!.published_at !== null).sort();
  const undated = expectedDocuments.filter(id => sourceMap.get(id)!.published_at === null).sort();
  assert.deepEqual(result.totals.published.documentIds, dated);
  assert.deepEqual(result.totals.undated.documentIds, undated);
  assert.deepEqual(result.scope.claimIds, visible.nodes.filter(item => item.ontology_type === 'Claim').map(item => item.id).sort());
  assert.equal(result.exclusions.length, 0);
  assert.equal(JSON.stringify(visible), before);
  assert.deepEqual(JSON.parse(JSON.stringify(result)).totals, result.totals);
});

test('retrospective visible graphs still obey the absolute selected publication cutoff and projected topic/layer scope', () => {
  const retro = graphAt('2026-07-01', 'retro');
  assert.ok(retro.nodes.some(node => node.id === 'source:tech-018'), 'the retro graph includes the later August disclosure of June ownership');
  const result = knowledgeEvolution(retro, '2026-07-01');
  assert.ok(!result.scope.documentIds.includes('tech-018'));
  assert.ok(!result.scope.claimIds.includes('claim:tech-018'));
  assert.ok(result.exclusions.some(item => item.nodeId === 'source:tech-018' && item.reason === 'future_publication'));
  const projected = graphView(graphAt(RESEARCH_MAX_DATE), 'all', '', { layer: 'claims', cluster: 'sds' });
  const claims = knowledgeEvolution(projected, RESEARCH_MAX_DATE);
  assert.equal(claims.totals.published.documentCount, 0);
  assert.equal(claims.totals.undated.documentCount, 0);
  assert.equal(claims.totals.published.sourceGroupCount, 0);
  assert.ok(claims.topics.filter(topic => topic.id !== 'sds').every(topic => topic.published.claimCount === 0 && topic.undated.claimCount === 0));
  assert.deepEqual(claims.scope.claimIds, projected.nodes.map(node => node.id).sort());
  const claimSources = new Map(catalog.records.flatMap(source => getRecordClaims(source).map(claim => [claim.id, source.id] as const)));
  assert.deepEqual(claims.scope.contributingSourceIds, [...new Set(projected.nodes.map(node => claimSources.get(node.id)!))].sort());
});
