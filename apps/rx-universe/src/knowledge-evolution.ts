import type { KnowledgeCluster, KnowledgeGraph, KnowledgeNode } from './knowledge';
import { CLUSTER_LABELS } from './knowledge-ontology';
import { catalog, getRecordClaims, hasReliablePublicationDate, type ResearchCatalog, type ResearchRecord } from './research';

export interface EvolutionCounts {
  documentCount: number;
  claimCount: number;
  sourceGroupCount: number;
  /** Catalog IDs represented by visible Source nodes only. */
  documentIds: string[];
  /** Visible Claim-node IDs resolved to their actual source extraction. */
  claimIds: string[];
  /** Distinct origin keys of the counted document nodes, never independent-evidence counts. */
  sourceGroupKeys: string[];
  /** Detail links for counted document AND claim nodes; may include sources whose nodes are hidden. */
  contributingSourceIds: string[];
}
export interface EvolutionMonth extends EvolutionCounts {
  month: string;
  from: string;
  to: string;
  cumulative: EvolutionCounts;
}
export interface TopicKnowledgeEvolution {
  id: KnowledgeCluster;
  label: string;
  months: EvolutionMonth[];
  published: EvolutionCounts;
  undated: EvolutionCounts;
}
export type KnowledgeEvolutionError = 'invalid_known_at' | 'invalid_catalog_window' | 'outside_catalog_window';
export type EvolutionExclusionReason = 'unknown_topic' | 'unknown_source' | 'unknown_claim' | 'ambiguous_source_id' | 'ambiguous_claim_id' | 'conflicting_node_identity' | 'invalid_publication_date' | 'outside_publication_window' | 'future_publication' | 'invalid_observation_date' | 'not_yet_observed';
export interface EvolutionExclusion {
  nodeId: string;
  sourceId?: string;
  reason: EvolutionExclusionReason;
}
export interface KnowledgeEvolution {
  valid: boolean;
  error: KnowledgeEvolutionError | null;
  errorMessage: string | null;
  knownAt: string;
  window: { from: string; to: string };
  months: string[];
  topics: TopicKnowledgeEvolution[];
  /** Globally deduplicated sets, not sums of topic source-group counts. */
  totals: { published: EvolutionCounts; undated: EvolutionCounts };
  scope: {
    kind: 'visible_source_and_claim_nodes';
    nodeIds: string[];
    documentIds: string[];
    claimIds: string[];
    contributingSourceIds: string[];
    excludedNodeIds: string[];
  };
  exclusions: EvolutionExclusion[];
  semantics: {
    kind: 'current_visible_publication_distribution';
    title: string;
    description: string;
    historicalGraphSnapshots: false;
    claimVersionHistory: false;
    coverageCompletenessMeasured: false;
    personalInterestMeasured: false;
    confidenceMeasured: false;
    limitations: string[];
  };
}

interface CountSets {
  documentIds: Set<string>;
  claimIds: Set<string>;
  sourceGroupKeys: Set<string>;
  contributingSourceIds: Set<string>;
}
interface TopicSets { months: Map<string, CountSets>; undated: CountSets }
const topicIds = Object.keys(CLUSTER_LABELS) as KnowledgeCluster[];
const setFields = ['documentIds', 'claimIds', 'sourceGroupKeys', 'contributingSourceIds'] as const;
const sorted = (values: Iterable<string>) => [...new Set(values)].sort();
const emptySets = (): CountSets => ({ documentIds: new Set(), claimIds: new Set(), sourceGroupKeys: new Set(), contributingSourceIds: new Set() });
function counts(sets: CountSets): EvolutionCounts {
  return {
    documentCount: sets.documentIds.size, claimCount: sets.claimIds.size, sourceGroupCount: sets.sourceGroupKeys.size,
    documentIds: sorted(sets.documentIds), claimIds: sorted(sets.claimIds), sourceGroupKeys: sorted(sets.sourceGroupKeys),
    contributingSourceIds: sorted(sets.contributingSourceIds),
  };
}
function unite(target: CountSets, input: CountSets): void {
  for (const field of setFields) for (const id of input[field]) target[field].add(id);
}
function isDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
function periods(from: string, to: string): { month: string; from: string; to: string }[] {
  const result: { month: string; from: string; to: string }[] = [];
  let cursor = `${from.slice(0, 7)}-01`;
  while (cursor <= to) {
    const next = new Date(`${cursor}T00:00:00.000Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const nextDay = next.toISOString().slice(0, 10);
    const lastDay = new Date(next.getTime() - 86400000).toISOString().slice(0, 10);
    result.push({ month: cursor.slice(0, 7), from: cursor < from ? from : cursor, to: lastDay > to ? to : lastDay });
    cursor = nextDay;
  }
  return result;
}
function exclusionFor(source: ResearchRecord, knownAt: string, start: string): EvolutionExclusionReason | null {
  if (source.published_at === null) {
    if (source.scope !== 'undated' || source.date_basis !== 'unknown') return 'invalid_publication_date';
    const observed = source.accessed_at.slice(0, 10);
    if (!isDay(observed)) return 'invalid_observation_date';
    return observed > knownAt ? 'not_yet_observed' : null;
  }
  if (!hasReliablePublicationDate(source)) return 'invalid_publication_date';
  if (source.published_at > knownAt) return 'future_publication';
  if (source.scope !== 'in_window' || source.published_at < start) return 'outside_publication_window';
  return null;
}
function semanticDescription(): KnowledgeEvolution['semantics'] {
  return {
    kind: 'current_visible_publication_distribution', title: '현재 선택 자료의 공개 시점 분포',
    description: '현재 보이는 문서·주장을 원출처 게시월로 나눈 분포와 누적 집계입니다. 선택한 공개 기준일 이후의 자료는 포함하지 않습니다.',
    historicalGraphSnapshots: false, claimVersionHistory: false, coverageCompletenessMeasured: false,
    personalInterestMeasured: false, confidenceMeasured: false,
    limitations: [
      '이전 월의 그래프를 다시 생성한 기록이 아닙니다. 현재 주제·검색·레이어 선택에 남은 노드의 공개일 분포입니다.',
      '문서는 보이는 Source 노드만, 주장은 보이는 Claim 노드만 집계합니다. 숨은 출처는 주장 상세의 연결 목록에만 나타날 수 있습니다.',
      '주장 게시월은 원출처의 게시일입니다. 분석가의 작성일·수정일·반증 시점이나 사건 발생일을 뜻하지 않습니다.',
      '게시일 미상 자료는 관측일까지 알려진 항목으로 별도 표시하며 월별 공개·누적 시계열에 넣지 않습니다.',
      '월별·주제별 출처군은 겹칠 수 있습니다. 누적 출처군은 집합으로 계산하며 독립적인 확증의 개수가 아닙니다.',
      '월별 0건은 현재 선택에 해당하는 공개 자료가 없다는 뜻입니다. 웹 전체의 자료 부재·조사 완전성·개인 관심도·확신 변화를 뜻하지 않습니다.',
    ],
  };
}

/**
 * A pure distribution of an already projected graph. It never expands hidden
 * provenance into counted nodes, replays monthly graph snapshots, mutates the
 * graph/catalog, or relaxes knownAt because the supplied graph is retrospective.
 */
export function knowledgeEvolution(graph: KnowledgeGraph, knownAt: string, source: ResearchCatalog = catalog): KnowledgeEvolution {
  const start = source.meta.window_start;
  const end = source.meta.window_end;
  const error: KnowledgeEvolutionError | null = !isDay(knownAt) ? 'invalid_known_at' :
    !isDay(start) || !isDay(end) || start > end ? 'invalid_catalog_window' :
    knownAt < start || knownAt > end ? 'outside_catalog_window' : null;
  const messages: Record<KnowledgeEvolutionError, string> = {
    invalid_known_at: '유효한 공개 기준일을 선택하세요.',
    invalid_catalog_window: '조사기간 날짜가 유효하지 않아 집계할 수 없습니다.',
    outside_catalog_window: '공개 기준일은 현재 카탈로그의 조사기간 안에 있어야 합니다.',
  };
  const range = error ? [] : periods(start, knownAt);
  const topicSets = new Map<KnowledgeCluster, TopicSets>(topicIds.map(id => [id, { months: new Map(range.map(period => [period.month, emptySets()])), undated: emptySets() }]));
  const exclusions: EvolutionExclusion[] = [];

  if (!error) {
    const sources = new Map<string, ResearchRecord>();
    const ambiguousSources = new Set<string>();
    const claimSources = new Map<string, ResearchRecord>();
    const ambiguousClaims = new Set<string>();
    for (const record of source.records) {
      if (sources.has(record.id)) ambiguousSources.add(record.id);
      sources.set(record.id, record);
      for (const claim of getRecordClaims(record)) {
        if (claimSources.has(claim.id)) ambiguousClaims.add(claim.id);
        claimSources.set(claim.id, record);
      }
    }
    // Repeated identical rendering nodes count once; conflicting identities fail closed.
    const nodes = new Map<string, KnowledgeNode>();
    const conflictingNodes = new Set<string>();
    for (const node of graph.nodes) {
      const previous = nodes.get(node.id);
      if (previous && (previous.ontology_type !== node.ontology_type || previous.cluster !== node.cluster)) conflictingNodes.add(node.id);
      nodes.set(node.id, node);
    }
    for (const node of [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      if (node.ontology_type !== 'Source' && node.ontology_type !== 'Claim') continue;
      if (conflictingNodes.has(node.id)) { exclusions.push({ nodeId: node.id, reason: 'conflicting_node_identity' }); continue; }
      const topic = topicSets.get(node.cluster);
      if (!topic) { exclusions.push({ nodeId: node.id, reason: 'unknown_topic' }); continue; }
      const document = node.ontology_type === 'Source';
      const sourceId = document ? (node.id.startsWith('source:') ? node.id.slice('source:'.length) : node.id) : claimSources.get(node.id)?.id;
      if (!document && ambiguousClaims.has(node.id)) { exclusions.push({ nodeId: node.id, reason: 'ambiguous_claim_id' }); continue; }
      const record = sourceId ? sources.get(sourceId) : undefined;
      if (!record) { exclusions.push({ nodeId: node.id, sourceId, reason: document ? 'unknown_source' : 'unknown_claim' }); continue; }
      if (ambiguousSources.has(record.id)) { exclusions.push({ nodeId: node.id, sourceId: record.id, reason: 'ambiguous_source_id' }); continue; }
      const reason = exclusionFor(record, knownAt, start);
      if (reason) { exclusions.push({ nodeId: node.id, sourceId: record.id, reason }); continue; }
      const bucket = record.published_at === null ? topic.undated : topic.months.get(record.published_at.slice(0, 7))!;
      if (document) {
        bucket.documentIds.add(record.id);
        if (record.origin_key.trim()) bucket.sourceGroupKeys.add(record.origin_key.trim());
      } else bucket.claimIds.add(node.id);
      bucket.contributingSourceIds.add(record.id);
    }
  }

  const publishedTotal = emptySets();
  const undatedTotal = emptySets();
  const topics = topicIds.map<TopicKnowledgeEvolution>(id => {
    const topic = topicSets.get(id)!;
    const cumulative = emptySets();
    const months = range.map<EvolutionMonth>(period => {
      const month = topic.months.get(period.month)!;
      unite(cumulative, month);
      return { ...period, ...counts(month), cumulative: counts(cumulative) };
    });
    unite(publishedTotal, cumulative);
    unite(undatedTotal, topic.undated);
    return { id, label: CLUSTER_LABELS[id], months, published: counts(cumulative), undated: counts(topic.undated) };
  });
  const all = emptySets();
  unite(all, publishedTotal); unite(all, undatedTotal);
  return {
    valid: error === null, error, errorMessage: error === 'outside_catalog_window' && knownAt < start ? '선택한 날짜는 조사기간 시작 전입니다. 기간 내 공개자료가 없어 시계열을 표시하지 않습니다.' : error ? messages[error] : null, knownAt,
    window: { from: start, to: knownAt }, months: range.map(period => period.month), topics,
    totals: { published: counts(publishedTotal), undated: counts(undatedTotal) },
    scope: { kind: 'visible_source_and_claim_nodes', nodeIds: error ? [] : sorted(graph.nodes.map(node => node.id)),
      documentIds: sorted(all.documentIds), claimIds: sorted(all.claimIds), contributingSourceIds: sorted(all.contributingSourceIds),
      excludedNodeIds: sorted(exclusions.map(item => item.nodeId)) },
    exclusions, semantics: semanticDescription(),
  };
}
