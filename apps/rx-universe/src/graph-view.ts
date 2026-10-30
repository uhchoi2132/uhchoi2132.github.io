import type { KnowledgeGraph } from './knowledge';

/** The visible graph is also the export graph: one projection for every renderer. */
export function graphView(graph: KnowledgeGraph, filter = 'all', search = ''): KnowledgeGraph {
  const query = search.trim().toLowerCase();
  const nodes = graph.nodes.filter(node => {
    const category = filter === 'all' ||
      (filter === 'company' && node.kind === 'organization') ||
      (filter === 'technology' && node.kind === 'technology') ||
      (filter === 'hypothesis' && node.kind === 'hypothesis');
    return category && (!query || [node.id, node.title, node.subtitle, node.description].join(' ').toLowerCase().includes(query));
  });
  const ids = new Set(nodes.map(node => node.id));
  return { ...graph, nodes, relations: graph.relations.filter(relation => ids.has(relation.from) && ids.has(relation.to)) };
}
