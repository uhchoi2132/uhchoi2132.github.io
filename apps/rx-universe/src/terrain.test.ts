import test from 'node:test';
import assert from 'node:assert/strict';
import { graphAt, type KnowledgeCluster, type KnowledgeGraph, type KnowledgeNode, type KnowledgeRelation } from './knowledge';
import { CLUSTER_CENTERS, CLUSTER_LABELS } from './knowledge-ontology';
import { RESEARCH_MAX_DATE } from './research';
import { graphView } from './graph-view';
import { terrainRegions } from './terrain';

const sorted = (values: string[]) => [...values].sort();
const current = graphAt(RESEARCH_MAX_DATE);

test('five neutral region anchors and surviving graph coordinates stay fixed across historical dates', () => {
  const expected = Object.entries(CLUSTER_CENTERS).map(([id, center]) => ({ id, center, label: CLUSTER_LABELS[id as KnowledgeCluster] }));
  for (const date of ['2026-03-01', '2026-09-01', RESEARCH_MAX_DATE]) {
    const graph = graphAt(date);
    assert.deepEqual(terrainRegions(graph).map(({ id, center, label }) => ({ id, center, label })), expected);
    for (const node of graph.nodes) assert.deepEqual(node.position, current.nodes.find(item => item.id === node.id)!.position);
  }
  assert.deepEqual(terrainRegions({ nodes: [], relations: [] }).map(({ id, center, label }) => ({ id, center, label })), expected);
});

test('every visible node belongs to exactly one region and relation membership retains endpoint boundaries', () => {
  const regions = terrainRegions(current);
  const nodes = new Map(current.nodes.map(node => [node.id, node]));
  const allNodeIds = regions.flatMap(region => region.nodeIds);
  assert.deepEqual(sorted(allNodeIds), sorted(current.nodes.map(node => node.id)));
  assert.equal(new Set(allNodeIds).size, allNodeIds.length);
  assert.equal(regions.reduce((sum, region) => sum + region.documentCount, 0), current.nodes.filter(node => node.ontology_type === 'Source').length);
  assert.equal(regions.reduce((sum, region) => sum + region.claimCount, 0), current.nodes.filter(node => node.ontology_type === 'Claim').length);
  for (const region of regions) {
    assert.equal(region.documentCount, region.documentIds.length);
    assert.equal(region.claimCount, region.claimIds.length);
    assert.equal(region.sourceGroupCount, new Set(region.sourceGroupKeys).size);
    assert.deepEqual(sorted([...region.internalRelationIds, ...region.crossRegionRelationIds]), region.relationIds);
    assert.equal(region.sourceAttributedRelationCount + region.analystMappingRelationCount, region.relationIds.length);
    assert.equal(Object.values(region.statusCounts).reduce((a, b) => a + b, 0) + region.unclassifiedRelationCount, region.relationIds.length);
  }
  for (const relation of current.relations) {
    const endpointClusters = new Set([nodes.get(relation.from)!.cluster, nodes.get(relation.to)!.cluster]);
    assert.deepEqual(sorted(regions.filter(region => region.relationIds.includes(relation.id)).map(region => region.id)), sorted([...endpointClusters]));
  }
});

test('terrain and cluster graph/list/export projections contain the same canonical IDs without moving nodes', () => {
  for (const cluster of Object.keys(CLUSTER_CENTERS) as KnowledgeCluster[]) {
    const filtered = graphView(current, 'all', '', { cluster });
    const regions = terrainRegions(filtered);
    const region = regions.find(item => item.id === cluster)!;
    assert.deepEqual(region.nodeIds, sorted(filtered.nodes.map(node => node.id)));
    assert.deepEqual(region.internalRelationIds, sorted(filtered.relations.map(relation => relation.id)));
    assert.deepEqual(region.crossRegionRelationIds, []);
    assert.equal(regions.filter(item => item.id !== cluster).flatMap(item => item.nodeIds).length, 0);
    for (const node of filtered.nodes) assert.equal(node, current.nodes.find(item => item.id === node.id));
  }
  const entities = graphView(current, 'all', '삼성SDS', { cluster: 'sds', layer: 'entities', searchContext: true });
  assert.ok(entities.nodes.length > 0);
  assert.ok(terrainRegions(entities).every(region => region.documentCount === 0 && region.claimCount === 0 && region.sourceGroupCount === 0));
});

// Synthetic provenance deliberately references hidden IDs; those must never inflate visible counts.
function node(id: string, cluster: KnowledgeCluster, ontology_type: KnowledgeNode['ontology_type'], origin_key?: string): KnowledgeNode {
  return { id, title: id, description: 'Synthetic fixture', cluster, ontology_type, origin_key,
    kind: ontology_type === 'Source' ? 'source' : ontology_type === 'Claim' ? 'claim' : 'technology',
    layer: ontology_type === 'Source' ? 'sources' : ontology_type === 'Claim' ? 'claims' : 'entities',
    position: [0, 0, 0], size: .1, aliases: [], source_ids: ['hidden-document'], claim_ids: ['hidden-claim'] };
}
function relation(id: string, from: string, to: string, inferred = false): KnowledgeRelation {
  return { id, from, to, type: 'synthetic', label: id, inferred, rationale: 'Synthetic fixture',
    provenance: inferred ? 'analyst_mapping' : 'source_attributed', status: inferred ? 'hypothesis' : 'reported',
    source_ids: ['hidden-document'], claim_ids: ['hidden-claim'], published_at: null, event_date: null, observed_at: '2026-10-31', limitations: [] };
}
const fixture: KnowledgeGraph = {
  nodes: [node('source:a', 'sds', 'Source', 'shared-origin'), node('source:b', 'sds', 'Source', 'shared-origin'),
    node('claim:a', 'sds', 'Claim'), node('claim:b', 'sds', 'Claim'), node('claim:c', 'sds', 'Claim'), node('entity', 'sds', 'Technology'),
    node('source:c', 'research', 'Source', 'shared-origin')],
  relations: [relation('internal', 'claim:a', 'source:a'), relation('cross', 'source:a', 'source:c', true)],
};

test('document, claim and source-group counts stay distinct and ignore hidden provenance references', () => {
  const regions = terrainRegions(fixture);
  const sds = regions.find(region => region.id === 'sds')!;
  assert.deepEqual([sds.documentCount, sds.claimCount, sds.sourceGroupCount], [2, 3, 1]);
  assert.deepEqual(sds.documentIds, ['a', 'b']);
  assert.deepEqual(sds.claimIds, ['claim:a', 'claim:b', 'claim:c']);
  assert.deepEqual(sds.sourceGroupKeys, ['shared-origin']);
  assert.deepEqual(sds.internalRelationIds, ['internal']);
  assert.deepEqual(sds.crossRegionRelationIds, ['cross']);
  assert.equal(sds.statusCounts.reported, 1);
  assert.equal(sds.statusCounts.hypothesis, 1);
  assert.deepEqual(regions.find(region => region.id === 'research')!.crossRegionRelationIds, ['cross']);
  assert.equal(new Set(regions.flatMap(region => region.sourceGroupKeys)).size, 1, 'shared groups are not independent evidence across regions');
  assert.ok(!JSON.stringify(regions).includes('hidden-'));
});

test('empty regions disclose no node titles or IDs, and calculations leave graph and anchor constants untouched', () => {
  const before = structuredClone(fixture);
  const anchors = structuredClone(CLUSTER_CENTERS);
  const regions = terrainRegions(fixture);
  for (const region of regions.filter(item => item.id !== 'sds' && item.id !== 'research')) {
    assert.deepEqual(region.nodeIds, []);
    assert.deepEqual(region.relationIds, []);
    assert.equal(region.documentCount + region.claimCount + region.sourceGroupCount, 0);
  }
  assert.deepEqual(terrainRegions({ nodes: [...fixture.nodes].reverse(), relations: [...fixture.relations].reverse() }), regions);
  regions[0].center[0] = 999;
  assert.deepEqual(CLUSTER_CENTERS, anchors);
  assert.deepEqual(fixture, before);
});

test('relations with an invisible endpoint cannot enter a terrain summary', () => {
  const regions = terrainRegions({ ...fixture, relations: [...fixture.relations, relation('invalid', 'entity', 'invisible-node')] });
  assert.ok(regions.every(region => !region.relationIds.includes('invalid')));
});

test('unexpected legacy statuses stay unclassified and never become reported or NaN counts', () => {
  const legacy = { ...relation('legacy', 'claim:b', 'source:b'), status: 'official_statement' } as unknown as KnowledgeRelation;
  const region = terrainRegions({ ...fixture, relations: [...fixture.relations, legacy] }).find(item => item.id === 'sds')!;
  assert.equal(region.unclassifiedRelationCount, 1);
  assert.equal(region.statusCounts.reported, 1);
  assert.ok(Object.values(region.statusCounts).every(Number.isFinite));
});
