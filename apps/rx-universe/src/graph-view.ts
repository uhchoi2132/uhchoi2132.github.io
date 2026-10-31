import type { KnowledgeGraph, KnowledgeNode } from './knowledge';

export interface GraphViewOptions {
  layer?: 'all' | 'entities' | 'evidence';
  relationType?: string;
  provenance?: 'all' | 'source_attributed' | 'analyst_mapping';
  focusNodeId?: string;
  hops?: 1 | 2;
  searchContext?: boolean;
  pathFrom?: string;
  pathTo?: string;
}
export interface GraphRoute { nodeIds: string[]; relationIds: string[] }
type SearchableNode = KnowledgeNode & { layer?: 'entities' | 'claims' | 'sources'; aliases?: string[] };

function evidenceNode(node: SearchableNode) {
  return node.layer === 'claims' || node.layer === 'sources' || ['claim', 'source', 'evidence'].includes(node.kind);
}
function matchesType(node: KnowledgeNode, filter: string) {
  const kind: string = node.kind;
  if (!filter || filter === 'all') return true;
  if (filter === 'company') return ['company', 'organization'].includes(kind);
  if (filter === 'technology') return ['technology', 'product', 'factory', 'project', 'contract', 'event'].includes(kind);
  if (filter === 'evidence') return evidenceNode(node);
  return kind === filter;
}
function adjacency(graph: KnowledgeGraph) {
  const links = new Map(graph.nodes.map(node => [node.id, new Set<string>()]));
  for (const relation of graph.relations) {
    if (!links.has(relation.from) || !links.has(relation.to)) continue;
    links.get(relation.from)!.add(relation.to);
    links.get(relation.to)!.add(relation.from);
  }
  return links;
}

/** Exploration is undirected; returned relations retain their original direction and provenance. */
export function graphNeighborhood(graph: KnowledgeGraph, focus: string, hops: 1 | 2 = 1): GraphRoute {
  const links = adjacency(graph);
  if (!links.has(focus)) return { nodeIds: [], relationIds: [] };
  const selected = new Set([focus]);
  let frontier = [focus];
  for (let distance = 0; distance < hops; distance++) {
    const next: string[] = [];
    for (const id of frontier) for (const neighbor of links.get(id) ?? []) {
      if (selected.has(neighbor)) continue;
      selected.add(neighbor);
      next.push(neighbor);
    }
    frontier = next;
  }
  return {
    nodeIds: graph.nodes.filter(node => selected.has(node.id)).map(node => node.id),
    relationIds: graph.relations.filter(relation => selected.has(relation.from) && selected.has(relation.to)).map(relation => relation.id),
  };
}

/** One deterministic shortest connection path, not a causal or dependency assertion. */
export function graphPath(graph: KnowledgeGraph, from: string, to: string): GraphRoute {
  const links = adjacency(graph);
  if (!links.has(from) || !links.has(to)) return { nodeIds: [], relationIds: [] };
  const previous = new Map<string, string | null>([[from, null]]);
  const queue = [from];
  for (let index = 0; index < queue.length && !previous.has(to); index++) {
    const current = queue[index];
    for (const neighbor of [...links.get(current)!].sort()) {
      if (previous.has(neighbor)) continue;
      previous.set(neighbor, current);
      queue.push(neighbor);
    }
  }
  if (!previous.has(to)) return { nodeIds: [], relationIds: [] };
  const nodeIds: string[] = [];
  for (let current: string | null = to; current !== null; current = previous.get(current) ?? null) nodeIds.unshift(current);
  const steps = new Set(nodeIds.slice(1).map((id, index) => JSON.stringify([nodeIds[index], id].sort())));
  return {
    nodeIds,
    relationIds: graph.relations.filter(relation => steps.has(JSON.stringify([relation.from, relation.to].sort()))).map(relation => relation.id),
  };
}

/**
 * The visible graph and export use this one projection. Type/layer/relationship
 * constraints apply before traversal. Search, focus and path constraints intersect;
 * none may cross an excluded relationship or manufacture a connecting edge.
 */
export function graphView(graph: KnowledgeGraph, filter = 'all', search = '', options: GraphViewOptions = {}): KnowledgeGraph {
  const query = search.trim().toLowerCase();
  const layer = options.layer ?? 'all';
  let nodes = graph.nodes.filter(node => matchesType(node, filter) &&
    (layer === 'all' || (layer === 'evidence' ? evidenceNode(node) : !evidenceNode(node))));
  const allowedIds = new Set(nodes.map(node => node.id));
  const relationFilter = options.relationType && options.relationType !== 'all';
  const provenanceFilter = options.provenance && options.provenance !== 'all';
  let relations = graph.relations.filter(relation => allowedIds.has(relation.from) && allowedIds.has(relation.to) &&
    (!relationFilter || relation.type === options.relationType) &&
    (!provenanceFilter || relation.provenance === options.provenance));
  if (relationFilter || provenanceFilter) {
    const incident = new Set(relations.flatMap(relation => [relation.from, relation.to]));
    nodes = nodes.filter(node => incident.has(node.id));
  }
  const eligible: KnowledgeGraph = { ...graph, nodes, relations };
  let selected = new Set(nodes.map(node => node.id));
  const intersect = (ids: Iterable<string>) => {
    const constraint = new Set(ids);
    selected = new Set([...selected].filter(id => constraint.has(id)));
  };
  if (query) {
    const matches = nodes.filter((node: SearchableNode) =>
      [node.id, node.title, node.subtitle, node.description, ...(node.aliases ?? [])].join(' ').toLowerCase().includes(query));
    const matchIds = new Set(matches.map(node => node.id));
    if (options.searchContext) {
      const context = new Set(matchIds);
      for (const relation of relations) {
        if (matchIds.has(relation.from)) context.add(relation.to);
        if (matchIds.has(relation.to)) context.add(relation.from);
      }
      intersect(context);
    } else intersect(matchIds);
  }
  if (options.focusNodeId) intersect(graphNeighborhood(eligible, options.focusNodeId, options.hops ?? 1).nodeIds);
  if (options.pathFrom && options.pathTo) {
    const path = graphPath(eligible, options.pathFrom ?? '', options.pathTo ?? '');
    intersect(path.nodeIds);
    const pathRelations = new Set(path.relationIds);
    relations = relations.filter(relation => pathRelations.has(relation.id));
  }
  return {
    ...graph,
    nodes: nodes.filter(node => selected.has(node.id)),
    relations: relations.filter(relation => selected.has(relation.from) && selected.has(relation.to)),
  };
}
