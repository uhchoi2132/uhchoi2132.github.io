import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog, RESEARCH_MAX_DATE, type ResearchMode } from './research';
import { graphAt } from './knowledge';
import { graphView, type GraphViewOptions } from './graph-view';
import { compareSnapshots, type TemporalComparisonError } from './temporal-comparison';

const ids = (rows: { id: string }[]) => rows.map(row => row.id).sort();
const difference = (after: string[], before: string[]) => after.filter(id => !new Set(before).has(id)).sort();

test('invalid calendar dates, reversed ranges and future selections fail closed without fabricated history', () => {
  const future = new Date(Date.parse(RESEARCH_MAX_DATE) + 86400000).toISOString().slice(0, 10);
  const cases: [string, string, ResearchMode, { time?: { eventAsOf?: string } }, TemporalComparisonError][] = [
    ['2026-02-30', RESEARCH_MAX_DATE, 'known', {}, 'invalid_date'],
    ['2026-9-1', RESEARCH_MAX_DATE, 'known', {}, 'invalid_date'],
    [RESEARCH_MAX_DATE, '2026-09-01', 'known', {}, 'reversed_range'],
    ['2026-09-01', future, 'known', {}, 'future_date'],
    ['2026-09-01', RESEARCH_MAX_DATE, 'unknown' as ResearchMode, {}, 'invalid_mode'],
    ['2026-09-01', RESEARCH_MAX_DATE, 'known', { time: { eventAsOf: '' } }, 'invalid_event_date'],
    ['2026-09-01', RESEARCH_MAX_DATE, 'known', { time: { eventAsOf: future } }, 'future_event_date'],
  ];
  for (const [before, after, mode, options, expected] of cases) {
    const result = compareSnapshots(before, after, mode, options);
    assert.equal(result.valid, false);
    assert.equal(result.error, expected);
    assert.ok(result.errorMessage);
    assert.deepEqual(result.before.graph, { nodes: [], relations: [] });
    assert.deepEqual(result.after.graph, { nodes: [], relations: [] });
    assert.deepEqual(result.newPublishedSources, []);
    assert.deepEqual(result.undatedObservedSources, []);
    assert.deepEqual(result.newlyVisibleRelations, []);
    assert.equal(result.history.corrections, null, 'unsupported does not become a zero-count observation');
  }
});

test('publication delta includes an announced future showcase without declaring its occurrence', () => {
  const result = compareSnapshots('2026-03-08', '2026-03-09');
  assert.equal(result.valid, true);
  const expected = catalog.records.filter(source => source.scope === 'in_window' && source.published_at !== null && source.published_at > '2026-03-08' && source.published_at <= '2026-03-09');
  assert.deepEqual(ids(result.newPublishedSources), ids(expected));
  const sdi = result.newPublishedSources.find(source => source.id === 'mi-015')!;
  assert.ok(sdi);
  assert.equal(sdi.event_date, '2026-03-11');
  assert.ok(result.newlyVisibleNodes.some(node => node.id === 'source:mi-015'));
  assert.ok(result.newlyVisibleClaimIds.includes('claim:mi-015'));
  assert.equal(result.newlyVisibleRelations.find(relation => relation.id === 'sdi-solid-state-showcase')?.status, 'planned');
  assert.ok(!result.before.sourceIds.includes('mi-015'));
  const occurred = compareSnapshots('2026-03-08', '2026-03-09', 'known', { time: { eventAsOf: '2026-03-09' } });
  assert.ok(!occurred.after.sourceIds.includes('mi-015'));
  assert.ok(!occurred.newlyVisibleRelations.some(relation => relation.id === 'sdi-solid-state-showcase'));
});

test('late disclosure and retrospective visibility are separated from the publication interval', () => {
  const known = compareSnapshots('2026-07-01', '2026-08-14', 'known');
  const retrospective = compareSnapshots('2026-07-01', '2026-08-14', 'retro');
  assert.ok(known.newlyVisibleRelations.some(relation => relation.id === 'se-rainbow-ownership'));
  assert.ok(retrospective.before.graph.relations.some(relation => relation.id === 'se-rainbow-ownership'));
  assert.ok(!retrospective.newlyVisibleRelations.some(relation => relation.id === 'se-rainbow-ownership'));
  assert.ok(retrospective.before.sourceIds.includes('tech-018'));
  assert.ok(retrospective.newPublishedSources.some(source => source.id === 'tech-018'), 'August publication is distinct from prior retrospective visibility of June status');
  assert.equal(known.after.sources.find(source => source.id === 'tech-018')?.event_date, '2026-06-30');
  assert.equal(retrospective.semantics.comparison, 'snapshot_visibility_and_publication_dates');
});

test('new observations of undated pages remain distinct from newly published sources and preserve low verification status', () => {
  const result = compareSnapshots('2026-10-30', '2026-10-31');
  const expected = catalog.records.filter(source => source.scope === 'undated' && source.accessed_at.slice(0, 10) > '2026-10-30' && source.accessed_at.slice(0, 10) <= '2026-10-31');
  assert.deepEqual(ids(result.undatedObservedSources), ids(expected));
  assert.ok(result.undatedObservedSources.some(source => source.id === 'x-eco-004'));
  assert.ok(result.newlyVisibleNodes.some(node => node.id === 'source:x-eco-004'));
  assert.ok(result.newPublishedSources.every(source => source.published_at === '2026-10-31'));
  assert.ok(!result.newPublishedSources.some(source => source.scope === 'undated'));
  const unreviewed = result.undatedObservedSources.find(source => source.id === 'x-eco-016')!;
  assert.equal(unreviewed.verification, 'search_only');
  assert.ok(!result.after.graph.nodes.some(node => node.id === 'source:x-eco-016'));
  const strict = compareSnapshots('2026-10-30', '2026-10-31', 'known', { time: { eventAsOf: RESEARCH_MAX_DATE } });
  assert.deepEqual(strict.undatedObservedSources, []);
  assert.ok(strict.after.sources.every(source => source.event_date !== null));
});

test('the same graph projection applies to both dates and source scope follows projected provenance', () => {
  const view: GraphViewOptions = { layer: 'claims', cluster: 'sds' };
  const result = compareSnapshots('2026-09-01', RESEARCH_MAX_DATE, 'known', { view });
  assert.equal(result.semantics.sourceScope, 'visible_graph_provenance');
  for (const snapshot of [result.before, result.after]) {
    const projected = graphView(graphAt(snapshot.date), 'all', '', view);
    assert.deepEqual(snapshot.graph, projected);
    assert.ok(snapshot.graph.nodes.every(node => node.layer === 'claims' && node.cluster === 'sds'));
    assert.deepEqual(snapshot.claimIds, snapshot.nodeIds);
    const sourceIds = new Set([...projected.nodes, ...projected.relations].flatMap(item => item.source_ids));
    assert.ok(snapshot.sources.every(source => sourceIds.has(source.id)));
    assert.ok(snapshot.sources.length > 0);
  }
  assert.deepEqual(result.newlyVisibleClaimIds.sort(), difference(result.after.claimIds, result.before.claimIds));
  assert.deepEqual(result.newlyVisibleRelations, [], 'a claims-only projection cannot retain invisible links to source/entity layers');
  const empty = compareSnapshots('2026-09-01', RESEARCH_MAX_DATE, 'known', { search: 'no-such-rx-comparison-object' });
  assert.deepEqual(empty.after.graph, { nodes: [], relations: [] });
  assert.deepEqual(empty.newPublishedSources, []);
  assert.deepEqual(empty.undatedObservedSources, []);
});

test('exportable node and relation deltas are exact ID differences with stable surviving coordinates', () => {
  const result = compareSnapshots('2026-09-01', RESEARCH_MAX_DATE);
  assert.deepEqual(ids(result.newlyVisibleNodes), difference(result.after.nodeIds, result.before.nodeIds));
  assert.deepEqual(ids(result.noLongerVisibleNodes), difference(result.before.nodeIds, result.after.nodeIds));
  assert.deepEqual(ids(result.newlyVisibleRelations), difference(result.after.relationIds, result.before.relationIds));
  assert.deepEqual(ids(result.noLongerVisibleRelations), difference(result.before.relationIds, result.after.relationIds));
  const after = new Map(result.after.graph.nodes.map(node => [node.id, node]));
  for (const node of result.before.graph.nodes) if (after.has(node.id)) assert.deepEqual(node.position, after.get(node.id)!.position, node.id);
  const sourceIds = new Set(catalog.records.map(source => source.id));
  for (const relation of result.newlyVisibleRelations) {
    assert.ok(after.has(relation.from) && after.has(relation.to));
    assert.ok(relation.source_ids.every(id => sourceIds.has(id)));
  }
  const exported = JSON.parse(JSON.stringify(result));
  assert.deepEqual(exported.after.nodeIds, result.after.nodeIds);
  assert.deepEqual(exported.before.relationIds, result.before.relationIds);
  assert.ok(result.after.graph.relations.some(relation => relation.type === 'contradicts' && relation.inferred));
  assert.deepEqual(result.unsupportedHistory, ['claim_versions', 'corrections', 'withdrawals', 'claim_refutations']);
  assert.deepEqual(result.history, { supported: false, claimVersions: null, corrections: null, withdrawals: null, claimRefutations: null });
  assert.ok(!('refutedClaimIds' in exported));
});

test('equal dates produce an empty delta, while an identical strict event cutoff constrains both snapshots', () => {
  const equal = compareSnapshots('2026-09-01', '2026-09-01');
  assert.equal(equal.valid, true);
  assert.deepEqual(equal.before.graph, equal.after.graph);
  for (const rows of [equal.newPublishedSources, equal.undatedObservedSources, equal.newlyVisibleNodes, equal.newlyVisibleRelations, equal.newlyVisibleClaimIds, equal.noLongerVisibleRelations]) assert.deepEqual(rows, []);
  const options = { time: { eventAsOf: '2026-06-30' } };
  const strict = compareSnapshots('2026-07-01', '2026-08-14', 'known', options);
  for (const snapshot of [strict.before, strict.after]) {
    assert.ok(snapshot.sources.every(source => source.event_date !== null && source.event_date <= options.time.eventAsOf && source.published_at !== null && source.published_at <= snapshot.date));
  }
  assert.ok(strict.newlyVisibleRelations.some(relation => relation.id === 'se-rainbow-ownership'));
  assert.deepEqual(strict.undatedObservedSources, []);
});
