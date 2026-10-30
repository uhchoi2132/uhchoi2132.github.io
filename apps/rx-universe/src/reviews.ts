/** Personal annotations only. This log never changes research claims or their verification. */
export const REVIEW_STORAGE_KEY = 'rx-personal-reviews-v1';
export const REVIEW_VERDICTS = ['undecided', 'support', 'challenge', 'context'] as const;
export type ReviewVerdict = typeof REVIEW_VERDICTS[number];
export type ReviewMode = 'known' | 'retro';
export interface ReviewTarget {
  hypothesis_id: string;
  evidence_id: string;
  source_ids: string[];
  claim_ids: string[];
  as_of: string;
  mode: ReviewMode;
}
export interface ReviewEvent extends ReviewTarget {
  id: string;
  created_at: string;
  verdict: ReviewVerdict;
  previous_verdict: ReviewVerdict | null;
  reason: string;
  actor: 'local_browser_user';
  fact_promotion: false;
}
export interface ReviewLog {
  version: 1;
  scope: 'browser_personal_review';
  events: ReviewEvent[];
}
export const emptyReviewLog = (): ReviewLog => ({ version: 1, scope: 'browser_personal_review', events: [] });
export function normalizeReviewMode(mode: string): ReviewMode { return mode === 'retro' || mode === 'retrospective' ? 'retro' : 'known'; }
function isDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
function isId(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= 200; }
function isIds(value: unknown): value is string[] { return Array.isArray(value) && value.length > 0 && value.length <= 100 && value.every(isId); }
function isVerdict(value: unknown): value is ReviewVerdict { return REVIEW_VERDICTS.includes(value as ReviewVerdict); }
function validTarget(value: ReviewTarget): boolean {
  return isId(value.hypothesis_id) && isId(value.evidence_id) && isIds(value.source_ids) && isIds(value.claim_ids)
    && isDay(value.as_of) && (value.mode === 'known' || value.mode === 'retro');
}
/** Date and replay mode scope notes so a later assessment cannot leak into earlier replay. */
export function reviewTargetKey(target: Pick<ReviewTarget, 'hypothesis_id' | 'evidence_id' | 'as_of' | 'mode'>): string {
  return JSON.stringify([target.hypothesis_id, target.evidence_id, target.as_of, target.mode]);
}
export function latestReviews(log: ReviewLog): Map<string, ReviewEvent> {
  return new Map(log.events.map(event => [reviewTargetKey(event), event]));
}
export function appendReview(log: ReviewLog, target: ReviewTarget, verdict: ReviewVerdict, reason: string, createdAt: string, id: string): ReviewLog {
  const cleanReason = reason.trim();
  if (!cleanReason) throw new Error('판단의 근거와 한계를 사유에 입력해 주세요.');
  if (cleanReason.length > 2000) throw new Error('검토 사유는 2,000자 이내로 입력해 주세요.');
  if (!validTarget(target) || !isVerdict(verdict)) throw new Error('검토 대상이나 선택 시점을 확인할 수 없습니다.');
  if (!isId(id) || log.events.some(event => event.id === id)) throw new Error('검토 기록 ID가 올바르지 않습니다.');
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error('검토 시각을 확인할 수 없습니다.');
  const previous = latestReviews(log).get(reviewTargetKey(target));
  const event: ReviewEvent = {
    ...target, source_ids: [...target.source_ids], claim_ids: [...target.claim_ids],
    id, created_at: createdAt, verdict, previous_verdict: previous?.verdict ?? null,
    reason: cleanReason, actor: 'local_browser_user', fact_promotion: false,
  };
  return { version: 1, scope: 'browser_personal_review', events: [...log.events, event] };
}
export function parseReviewLog(raw: string | null): { log: ReviewLog; invalid: boolean } {
  if (raw === null) return { log: emptyReviewLog(), invalid: false };
  try {
    const value = JSON.parse(raw);
    if (!value || value.version !== 1 || value.scope !== 'browser_personal_review' || !Array.isArray(value.events)) throw new Error('schema');
    const seen = new Set<string>();
    const previous = new Map<string, ReviewVerdict>();
    for (const event of value.events) {
      if (!event || !validTarget(event) || !isId(event.id) || seen.has(event.id) || !isVerdict(event.verdict)
        || typeof event.reason !== 'string' || !event.reason.trim() || event.reason.length > 2000
        || typeof event.created_at !== 'string' || !Number.isFinite(Date.parse(event.created_at))
        || event.actor !== 'local_browser_user' || event.fact_promotion !== false) throw new Error('event');
      const key = reviewTargetKey(event);
      if (event.previous_verdict !== (previous.get(key) ?? null)) throw new Error('history');
      seen.add(event.id);
      previous.set(key, event.verdict);
    }
    return { log: value as ReviewLog, invalid: false };
  } catch { return { log: emptyReviewLog(), invalid: true }; }
}
