import sourceData from './research-data.json' with { type: 'json' };

export type ResearchSourceType = 'official' | 'media' | 'paper' | 'patent' | 'filing' | 'video' | 'product';
export type ResearchVerification = 'primary_read' | 'search_only' | 'access_blocked';
export type ResearchMode = 'known' | 'retro' | 'as-known-at' | 'retrospective';
export interface ResearchRecord {
  id: string;
  title: string;
  url: string;
  publisher: string;
  published_at: string | null;
  event_date: string | null;
  source_type: ResearchSourceType;
  verification: ResearchVerification;
  scope: 'in_window' | 'undated' | 'out_of_window';
  entity_ids: string[];
  origin_key: string;
  summary_ko: string;
  excerpt: string;
  claim: { text: string; kind: 'official_statement' | 'media_report' | 'research_result' | 'inference' };
  commercialization_stage: string;
  limitations: string[];
  accessed_at: string;
  date_basis: 'page' | 'search_index' | 'unknown';
  evidence_locator: string;
}
export interface ResearchQuery {
  query: string;
  category: string;
  [key: string]: unknown;
}
export interface ResearchCatalog {
  meta: {
    window_start: string;
    window_end: string;
    researched_at: string;
    coverage_note: string;
    query_count: number;
    [key: string]: unknown;
  };
  records: ResearchRecord[];
  queries: ResearchQuery[];
}
export interface ResearchCounts {
  total: number; claims: number; dated: number; inWindow: number; undated: number; outOfWindow: number;
  independentOrigins: number; primaryRead: number; searchOnly: number; accessBlocked: number;
  official: number; media: number; papers: number; patents: number; filings: number; videos: number; products: number;
}
/** Records are source-attributed statements, not independently verified facts. */
export const CLAIM_EDITORIAL_STATUS = 'source_attributed_not_independently_verified';
export const catalog = sourceData as unknown as ResearchCatalog;
export const RESEARCH_MAX_DATE = catalog.meta.window_end;

function validDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
export function hasReliablePublicationDate(record: ResearchRecord): boolean {
  return validDay(record.published_at) && (record.date_basis === 'page' || record.date_basis === 'search_index');
}
/**
 * Replay this research window without leaking later publication/event dates.
 * Search-index dates are eligible but retain search_only/access_blocked status.
 * A retrospective replay can use later disclosures of an earlier dated event.
 * An undated event is never assigned an earlier occurrence date: its source is
 * visible only from publication. Undated discovery pages stay in catalog only.
 */
export function researchAt(date: string, mode: ResearchMode = 'known', source: ResearchCatalog = catalog): ResearchRecord[] {
  if (!validDay(date)) return [];
  if (!['known', 'retro', 'as-known-at', 'retrospective'].includes(mode)) return [];
  const eventCutoff = date > source.meta.window_end ? source.meta.window_end : date;
  const knownCutoff = mode === 'retro' || mode === 'retrospective' ? source.meta.window_end : eventCutoff;
  return source.records.filter(record => {
    if (record.scope !== 'in_window' || !hasReliablePublicationDate(record)) return false;
    const published = record.published_at!;
    if (published < source.meta.window_start || published > knownCutoff || published > source.meta.window_end) return false;
    if (record.event_date !== null && !validDay(record.event_date)) return false;
    return (record.event_date ?? published) <= eventCutoff;
  });
}
/** Independent origins, not article count: republications share origin_key. */
export function researchCounts(records: readonly ResearchRecord[] = catalog.records): ResearchCounts {
  const typeCount = (type: ResearchSourceType) => records.filter(record => record.source_type === type).length;
  return {
    total: records.length,
    claims: records.length,
    dated: records.filter(hasReliablePublicationDate).length,
    inWindow: records.filter(record => record.scope === 'in_window').length,
    undated: records.filter(record => record.scope === 'undated').length,
    outOfWindow: records.filter(record => record.scope === 'out_of_window').length,
    independentOrigins: new Set(records.map(record => record.origin_key).filter(key => key.trim().length > 0)).size,
    primaryRead: records.filter(record => record.verification === 'primary_read').length,
    searchOnly: records.filter(record => record.verification === 'search_only').length,
    accessBlocked: records.filter(record => record.verification === 'access_blocked').length,
    official: typeCount('official'), media: typeCount('media'), papers: typeCount('paper'),
    patents: typeCount('patent'), filings: typeCount('filing'), videos: typeCount('video'), products: typeCount('product'),
  };
}
