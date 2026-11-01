import type { KnowledgeCluster, KnowledgeGraph, KnowledgeStatus } from './knowledge';
import { CLUSTER_CENTERS, CLUSTER_LABELS, type Position } from './knowledge-ontology';

export interface TerrainRegion {
  id: KnowledgeCluster;
  label: string;
  /** A fixed navigation anchor, never an importance, confidence or force-layout value. */
  center: Position;
  nodeIds: string[];
  /** Catalog source IDs represented by visible Source nodes, without the source: prefix. */
  documentIds: string[];
  /** IDs of visible Claim nodes; hidden provenance references are not counted. */
  claimIds: string[];
  sourceGroupKeys: string[];
  documentCount: number;
  claimCount: number;
  sourceGroupCount: number;
  /** Incident visible relations. Cross-region relations occur in both endpoint regions. */
  relationIds: string[];
  internalRelationIds: string[];
  crossRegionRelationIds: string[];
  sourceAttributedRelationCount: number;
  analystMappingRelationCount: number;
  /** Invalid legacy status values remain unclassified rather than becoming reported facts. */
  unclassifiedRelationCount: number;
  /** Source-attribution/analysis statuses of incident relations, not verified facts. */
  statusCounts: Record<KnowledgeStatus, number>;
}

const uniqueSorted = (values: string[]) => [...new Set(values)].sort();

/**
 * Summarize an already filtered visible graph, without consulting the catalog.
 * The five neutral anchors are stable even when a region is empty. Region document
 * and claim nodes partition the visible nodes; shared source groups and cross-region
 * relations may recur across regions and must not be summed as independent evidence.
 */
export function terrainRegions(graph: KnowledgeGraph): TerrainRegion[] {
  const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
  const visibleRelations = graph.relations.filter(relation => nodeById.has(relation.from) && nodeById.has(relation.to));
  return (Object.keys(CLUSTER_CENTERS) as KnowledgeCluster[]).map<TerrainRegion>(id => {
    const nodes = graph.nodes.filter(node => node.cluster === id);
    const documents = nodes.filter(node => node.ontology_type === 'Source');
    const documentIds = uniqueSorted(documents.map(node => node.id.startsWith('source:') ? node.id.slice('source:'.length) : node.id));
    const claimIds = uniqueSorted(nodes.filter(node => node.ontology_type === 'Claim').map(node => node.id));
    const sourceGroupKeys = uniqueSorted(documents.flatMap(node => node.origin_key?.trim() ? [node.origin_key.trim()] : []));
    const incident = visibleRelations.filter(relation => nodeById.get(relation.from)!.cluster === id || nodeById.get(relation.to)!.cluster === id);
    const internal = incident.filter(relation => nodeById.get(relation.from)!.cluster === id && nodeById.get(relation.to)!.cluster === id);
    const cross = incident.filter(relation => nodeById.get(relation.from)!.cluster !== nodeById.get(relation.to)!.cluster);
    const statusCounts: Record<KnowledgeStatus, number> = { reported: 0, planned: 0, research: 0, hypothesis: 0, undated_current: 0 };
    let unclassifiedRelationCount = 0;
    for (const relation of incident) {
      if (Object.hasOwn(statusCounts, relation.status)) statusCounts[relation.status] += 1;
      else unclassifiedRelationCount += 1;
    }
    return {
      id, label: CLUSTER_LABELS[id], center: [...CLUSTER_CENTERS[id]],
      nodeIds: uniqueSorted(nodes.map(node => node.id)), documentIds, claimIds, sourceGroupKeys,
      documentCount: documentIds.length, claimCount: claimIds.length, sourceGroupCount: sourceGroupKeys.length,
      relationIds: uniqueSorted(incident.map(relation => relation.id)),
      internalRelationIds: uniqueSorted(internal.map(relation => relation.id)),
      crossRegionRelationIds: uniqueSorted(cross.map(relation => relation.id)),
      sourceAttributedRelationCount: incident.filter(relation => relation.provenance === 'source_attributed').length,
      analystMappingRelationCount: incident.filter(relation => relation.provenance === 'analyst_mapping').length,
      statusCounts, unclassifiedRelationCount,
    };
  });
}
