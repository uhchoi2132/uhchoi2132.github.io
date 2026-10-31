import test from 'node:test';
import assert from 'node:assert/strict';
import type { KnowledgeGraph, KnowledgeNode, KnowledgeRelation } from './knowledge';
import { graphNeighborhood, graphPath, graphView } from './graph-view';

// Synthetic graph fixtures never enter the research catalog or public export.
function node(id: string, kind: string, layer: 'entities' | 'claims' | 'sources' = 'entities', aliases: string[] = []): KnowledgeNode {
  return {
    id, title: `Fixture ${id}`, description: `Synthetic ${id} description`, kind: kind as KnowledgeNode['kind'],
    layer, aliases, cluster: 'research', position: [0, 0, 0], size: .1,
    ontology_type: 'Technology', source_ids: ['fixture-source'], claim_ids: ['fixture-claim'],
  } as KnowledgeNode;
}
function edge(id: string, from: string, to: string, type: string, inferred = false): KnowledgeRelation {
  return {
    id, from, to, type, label: id, source_ids: ['fixture-source'], claim_ids: ['fixture-claim'], inferred,
    rationale: 'Synthetic test relation, not a Samsung claim.', provenance: inferred ? 'analyst_mapping' : 'source_attributed',
    status: inferred ? 'hypothesis' : 'reported', published_at: '2026-08-01', event_date: '2026-07-15', observed_at: '2026-10-30', limitations: ['Synthetic fixture'],
  };
}
const fixture: KnowledgeGraph = {
  nodes: [node('a', 'company', 'entities', ['anchor alias']), node('b', 'technology'), node('c', 'claim', 'claims'), node('d', 'source', 'sources'), node('e', 'organization'), node('f', 'hypothesis'), node('z', 'source', 'sources')],
  relations: [
    edge('ab', 'a', 'b', 'develops'), edge('cb', 'c', 'b', 'about'), edge('bc', 'b', 'c', 'has_claim'),
    edge('cd', 'c', 'd', 'documented_by'), edge('ae', 'a', 'e', 'partners_with'), edge('ce', 'c', 'e', 'about'),
    edge('bf', 'b', 'f', 'supports', true), edge('fe', 'f', 'e', 'supports', true), edge('bb', 'b', 'b', 'depends_on'),
  ],
};
const ids = (graph: KnowledgeGraph) => graph.nodes.map(item => item.id);
const edgeIds = (graph: KnowledgeGraph) => graph.relations.map(item => item.id);

test('all projection preserves canonical objects, source IDs and directed relationship metadata', () => {
  const before = structuredClone(fixture);
  const view = graphView(fixture);
  assert.deepEqual(view, fixture);
  for (const item of view.nodes) assert.equal(item, fixture.nodes.find(original => original.id === item.id));
  for (const item of view.relations) assert.equal(item, fixture.relations.find(original => original.id === item.id));
  graphView(fixture, 'all', 'anchor alias', { searchContext: true, focusNodeId: 'a' });
  graphPath(fixture, 'd', 'a');
  assert.deepEqual(fixture, before);
});

test('semantic layers and type filters retain only their actual endpoint relationships', () => {
  assert.deepEqual(ids(graphView(fixture, 'company')), ['a', 'e']);
  assert.deepEqual(edgeIds(graphView(fixture, 'company')), ['ae']);
  assert.deepEqual(ids(graphView(fixture, 'all', '', { layer: 'evidence' })), ['c', 'd', 'z']);
  assert.deepEqual(edgeIds(graphView(fixture, 'all', '', { layer: 'evidence' })), ['cd']);
  assert.deepEqual(ids(graphView(fixture, 'all', '', { layer: 'entities' })), ['a', 'b', 'e', 'f']);
  const kinds = ['technology', 'product', 'factory', 'project', 'contract', 'event'];
  assert.deepEqual(ids(graphView({ nodes: kinds.map(kind => node(kind, kind)), relations: [] }, 'technology')), kinds);
});

test('alias search optionally adds exactly one hop and retains a directly matching isolated source', () => {
  assert.deepEqual(ids(graphView(fixture, 'all', ' ANCHOR ALIAS ')), ['a']);
  const context = graphView(fixture, 'all', 'anchor alias', { searchContext: true });
  assert.deepEqual(ids(context), ['a', 'b', 'e']);
  assert.deepEqual(edgeIds(context), ['ab', 'ae', 'bb']);
  assert.deepEqual(ids(graphView(fixture, 'all', 'Synthetic z description', { searchContext: true })), ['z']);
  assert.deepEqual(graphView(fixture, 'all', 'missing phrase', { searchContext: true }), { nodes: [], relations: [] });
});

test('focus neighborhoods stop at one or two hops despite cycles and preserve reverse-direction evidence', () => {
  assert.deepEqual(graphNeighborhood(fixture, 'b', 1).nodeIds, ['a', 'b', 'c', 'f']);
  assert.deepEqual(graphNeighborhood(fixture, 'b', 2).nodeIds, ['a', 'b', 'c', 'd', 'e', 'f']);
  const focused = graphView(fixture, 'all', '', { focusNodeId: 'b', hops: 1 });
  assert.deepEqual(ids(focused), ['a', 'b', 'c', 'f']);
  assert.ok(focused.relations.includes(fixture.relations.find(item => item.id === 'cb')!));
  assert.deepEqual(graphView(fixture, 'all', '', { focusNodeId: 'absent', hops: 2 }), { nodes: [], relations: [] });
});

test('relationship and provenance constraints apply before traversal and discard unrelated orphan nodes', () => {
  const documentation = graphView(fixture, 'all', '', { relationType: 'documented_by' });
  assert.deepEqual(ids(documentation), ['c', 'd']);
  assert.deepEqual(edgeIds(documentation), ['cd']);
  const analysis = graphView(fixture, 'all', '', { provenance: 'analyst_mapping', focusNodeId: 'b', hops: 2 });
  assert.deepEqual(ids(analysis), ['b', 'e', 'f']);
  assert.deepEqual(edgeIds(analysis), ['bf', 'fe']);
  assert.deepEqual(graphView(fixture, 'all', 'anchor alias', { provenance: 'analyst_mapping', searchContext: true }), { nodes: [], relations: [] });
  assert.deepEqual(graphView(fixture, 'all', '', { relationType: 'unrepresented' }), { nodes: [], relations: [] });
});

test('shortest connection path is deterministic and does not reinterpret edge direction as causality', () => {
  const path = graphPath(fixture, 'd', 'a');
  assert.deepEqual(path.nodeIds, ['d', 'c', 'b', 'a']);
  assert.deepEqual(path.relationIds, ['ab', 'cb', 'bc', 'cd']);
  const view = graphView(fixture, 'all', '', { pathFrom: 'd', pathTo: 'a' });
  assert.deepEqual(ids(view), ['a', 'b', 'c', 'd']);
  assert.deepEqual(edgeIds(view), path.relationIds);
  assert.equal(view.relations.find(item => item.id === 'cb')!.from, 'c');
  assert.equal(view.relations.find(item => item.id === 'cb')!.to, 'b');
  assert.deepEqual(view.relations.find(item => item.id === 'cb')!.claim_ids, ['fixture-claim']);
  const reversed = { nodes: [...fixture.nodes].reverse(), relations: [...fixture.relations].reverse() };
  assert.deepEqual(graphPath(reversed, 'd', 'a').nodeIds, path.nodeIds);
});

test('missing paths and incompatible constraints fail closed; a zero-length path creates no edge', () => {
  for (const options of [{ pathFrom: 'z', pathTo: 'a' }, { pathFrom: 'a', pathTo: 'absent' }, { pathFrom: 'a', pathTo: 'd', layer: 'entities' as const }]) {
    assert.deepEqual(graphView(fixture, 'all', '', options), { nodes: [], relations: [] });
  }
  assert.deepEqual(graphView(fixture, 'all', '', { pathFrom: 'a' }), fixture, 'a pending starting endpoint keeps potential destinations visible');
  assert.deepEqual(graphView(fixture, 'all', '', { pathTo: 'a' }), fixture, 'a pending destination keeps potential starting points visible');
  assert.deepEqual(graphPath(fixture, 'b', 'b'), { nodeIds: ['b'], relationIds: [] });
  assert.deepEqual(edgeIds(graphView(fixture, 'all', '', { pathFrom: 'b', pathTo: 'b' })), []);
  assert.deepEqual(ids(graphView(fixture, 'all', 'Synthetic e description', { pathFrom: 'd', pathTo: 'a' })), []);
});
