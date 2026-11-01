import { graphAt, type KnowledgeGraph, type KnowledgeNode, type KnowledgeRelation } from './knowledge';
import { graphView, type GraphViewOptions } from './graph-view';
import { catalog, researchAt, type ResearchMode, type ResearchRecord, type ResearchTimeOptions } from './research';

export interface TemporalComparisonOptions {
  /** The same publication/event interpretation is applied to both dates. */
  time?: ResearchTimeOptions;
  /** The same projection is independently applied to each canonical graph. */
  view?: GraphViewOptions;
  filter?: string;
  search?: string;
}
export interface TemporalSnapshot {
  date: string;
  graph: KnowledgeGraph;
  /** Date-eligible catalog entries, including their unchanged verification status. */
  sources: ResearchRecord[];
  sourceIds: string[];
  nodeIds: string[];
  relationIds: string[];
  /** IDs of Claim nodes actually present in the projected graph. */
  claimIds: string[];
  /** Source IDs referenced by the projected nodes or relations. */
  graphSourceIds: string[];
}
export type TemporalComparisonError = 'invalid_date' | 'reversed_range' | 'future_date' | 'invalid_mode' | 'invalid_event_date' | 'future_event_date';
export type UnsupportedHistory = 'claim_versions' | 'corrections' | 'withdrawals' | 'claim_refutations';
export interface TemporalComparison {
  valid: boolean;
  error: TemporalComparisonError | null;
  errorMessage: string | null;
  mode: ResearchMode;
  options: TemporalComparisonOptions;
  researchWindow: { start: string; end: string };
  before: TemporalSnapshot;
  after: TemporalSnapshot;
  /** Publication-date interval, not necessarily a graph ID addition in retrospective mode. */
  newPublishedSources: ResearchRecord[];
  /** Undated pages observed in the interval; never labeled newly published. */
  undatedObservedSources: ResearchRecord[];
  newlyVisibleSources: ResearchRecord[];
  noLongerVisibleSources: ResearchRecord[];
  newlyVisibleNodes: KnowledgeNode[];
  noLongerVisibleNodes: KnowledgeNode[];
  newlyVisibleRelations: KnowledgeRelation[];
  noLongerVisibleRelations: KnowledgeRelation[];
  newlyVisibleClaimIds: string[];
  noLongerVisibleClaimIds: string[];
  unsupportedHistory: UnsupportedHistory[];
  history: {
    supported: false;
    claimVersions: null;
    corrections: null;
    withdrawals: null;
    claimRefutations: null;
  };
  semantics: {
    comparison: 'snapshot_visibility_and_publication_dates';
    sourceScope: 'temporal_catalog' | 'visible_graph_provenance';
    limitations: string[];
  };
}

const limitations = [
  '현재 카탈로그로 두 날짜를 재구성한 비교입니다. 당시 저장된 그래프 버전이나 주장 수정 이력을 재생하는 기능은 아닙니다.',
  '새로 보이는 관계·노드는 선택한 날짜와 필터에 따른 노출 차이입니다. 실제 사업 관계의 신규 발생·종료를 판정하지 않습니다.',
  '신규 공개 문서는 (이전일, 이후일]의 게시일 기준입니다. Retrospective에서는 현재 지식으로 이전 화면에도 이미 포함될 수 있습니다.',
  '게시일 미상 자료는 관측일 기준으로 분리하며, 그 관측일을 발표일·출시일·사건 발생일로 바꾸지 않습니다.',
  '가설을 향한 분석가의 contradicts 연결은 주장 자체의 반증·철회 판정이 아닙니다. 버전·정정·철회·주장 반증 이력은 지원하지 않습니다.',
  '사건 필터와 Retrospective의 사건일은 발생 완료를 독립 검증한 값이 아닙니다. 기존 시간 모델의 날짜 기준을 그대로 적용합니다.',
];
const messages: Record<TemporalComparisonError, string> = {
  invalid_date: '두 기준일을 유효한 YYYY-MM-DD 날짜로 선택하세요.',
  reversed_range: '이전 기준일은 이후 기준일보다 늦을 수 없습니다.',
  future_date: '조사 스냅샷의 마지막 날짜를 넘어서 비교할 수 없습니다.',
  invalid_mode: '지원하지 않는 시간 재현 모드입니다.',
  invalid_event_date: '사건 기준일을 유효한 YYYY-MM-DD 날짜로 선택하세요.',
  future_event_date: '사건 기준일이 조사 스냅샷의 마지막 날짜를 넘습니다.',
};
function isDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
function errorFor(before: string, after: string, mode: ResearchMode, time: ResearchTimeOptions): TemporalComparisonError | null {
  if (!isDay(before) || !isDay(after)) return 'invalid_date';
  if (before > after) return 'reversed_range';
  if (before > catalog.meta.window_end || after > catalog.meta.window_end) return 'future_date';
  if (!['known', 'retro', 'as-known-at', 'retrospective'].includes(mode)) return 'invalid_mode';
  if (time.eventAsOf !== undefined && !isDay(time.eventAsOf)) return 'invalid_event_date';
  if (time.eventAsOf !== undefined && time.eventAsOf > catalog.meta.window_end) return 'future_event_date';
  return null;
}
function hasGraphConstraint(options: TemporalComparisonOptions): boolean {
  const view = options.view ?? {};
  return Boolean((options.filter && options.filter !== 'all') || options.search?.trim() ||
    (view.layer && view.layer !== 'all') || (view.relationType && view.relationType !== 'all') ||
    (view.provenance && view.provenance !== 'all') || (view.cluster && String(view.cluster) !== 'all') || view.focusNodeId || (view.pathFrom && view.pathTo));
}
function emptySnapshot(date: string): TemporalSnapshot {
  return { date, graph: { nodes: [], relations: [] }, sources: [], sourceIds: [], nodeIds: [], relationIds: [], claimIds: [], graphSourceIds: [] };
}
function snapshotAt(date: string, mode: ResearchMode, options: TemporalComparisonOptions): TemporalSnapshot {
  const time = options.time ?? {};
  const graph = graphView(graphAt(date, mode, time), options.filter ?? 'all', options.search ?? '', options.view ?? {});
  const graphSourceIds = [...new Set([...graph.nodes, ...graph.relations].flatMap(item => item.source_ids))].sort();
  const sourceConstraint = hasGraphConstraint(options) ? new Set(graphSourceIds) : undefined;
  const dated = researchAt(date, mode, catalog, time);
  const undated = time.eventAsOf !== undefined || time.occurredOnly ? [] : catalog.records.filter(source => {
    const observed = source.accessed_at.slice(0, 10);
    return source.scope === 'undated' && isDay(observed) && observed <= date;
  });
  const sources = [...dated, ...undated].filter(source => !sourceConstraint || sourceConstraint.has(source.id)).sort((a, b) => a.id.localeCompare(b.id));
  return {
    date, graph, sources, sourceIds: sources.map(source => source.id), graphSourceIds,
    nodeIds: graph.nodes.map(node => node.id), relationIds: graph.relations.map(relation => relation.id),
    claimIds: graph.nodes.filter(node => node.layer === 'claims').map(node => node.id),
  };
}
function newlyPresent<T extends { id: string }>(after: readonly T[], before: readonly T[]): T[] {
  const previous = new Set(before.map(item => item.id));
  return after.filter(item => !previous.has(item.id));
}
function newIds(after: readonly string[], before: readonly string[]): string[] {
  const previous = new Set(before);
  return after.filter(id => !previous.has(id));
}

/**
 * Compare current-catalog reconstructions, with no synthetic history or status promotion.
 * Invalid dates/ranges fail closed with empty snapshots and explicit unsupported history.
 * Unfiltered sources retain search-only/blocked metadata; such records never gain graph assertions.
 */
export function compareSnapshots(beforeDate: string, afterDate: string, mode: ResearchMode = 'known', options: TemporalComparisonOptions = {}): TemporalComparison {
  const time = options.time ?? {};
  const error = errorFor(beforeDate, afterDate, mode, time);
  const before = error ? emptySnapshot(beforeDate) : snapshotAt(beforeDate, mode, options);
  const after = error ? emptySnapshot(afterDate) : beforeDate === afterDate ? { ...before } : snapshotAt(afterDate, mode, options);
  return {
    valid: error === null, error, errorMessage: error ? messages[error] : null, mode,
    options: { ...options, time: { ...time }, view: { ...options.view } },
    researchWindow: { start: catalog.meta.window_start, end: catalog.meta.window_end }, before, after,
    newPublishedSources: after.sources.filter(source => isDay(source.published_at) && source.published_at > beforeDate && source.published_at <= afterDate),
    undatedObservedSources: after.sources.filter(source => source.scope === 'undated' && source.accessed_at.slice(0, 10) > beforeDate && source.accessed_at.slice(0, 10) <= afterDate),
    newlyVisibleSources: newlyPresent(after.sources, before.sources), noLongerVisibleSources: newlyPresent(before.sources, after.sources),
    newlyVisibleNodes: newlyPresent(after.graph.nodes, before.graph.nodes), noLongerVisibleNodes: newlyPresent(before.graph.nodes, after.graph.nodes),
    newlyVisibleRelations: newlyPresent(after.graph.relations, before.graph.relations), noLongerVisibleRelations: newlyPresent(before.graph.relations, after.graph.relations),
    newlyVisibleClaimIds: newIds(after.claimIds, before.claimIds), noLongerVisibleClaimIds: newIds(before.claimIds, after.claimIds),
    unsupportedHistory: ['claim_versions', 'corrections', 'withdrawals', 'claim_refutations'],
    history: { supported: false, claimVersions: null, corrections: null, withdrawals: null, claimRefutations: null },
    semantics: { comparison: 'snapshot_visibility_and_publication_dates', sourceScope: hasGraphConstraint(options) ? 'visible_graph_provenance' : 'temporal_catalog', limitations: [...limitations] },
  };
}
