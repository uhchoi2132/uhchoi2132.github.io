import surveyData from '../research/survey-data.json' with { type: 'json' };

/** Discovery inventory is collection metadata, never extracted claims or verified facts. */
export interface SurveyRun {
  id: string; status: string; started_at?: string; finished_at?: string;
  [key: string]: unknown;
}
export interface SurveyCollection {
  id: string; run_id?: string; url?: string; collection_url?: string; publisher: string; status: string;
  discovered_urls?: string[]; reviewed_urls?: string[]; [key: string]: unknown;
}
export interface SurveyCandidate {
  id: string; run_id?: string; url: string; canonical_url?: string; title?: string; publisher?: string;
  discovered_at?: string; published_at?: string | null;
  fetch_status?: string; relevance?: string; source_ids?: string[]; [key: string]: unknown;
}
export interface ResearchSurvey { collections: SurveyCollection[]; candidates: SurveyCandidate[]; runs: SurveyRun[] }
export const survey = surveyData as unknown as ResearchSurvey;
export function surveyCounts(input: ResearchSurvey = survey) {
  const failed = new Set(['blocked', 'error', 'robots_disallowed', 'access_blocked', 'failed', 'budget_exhausted']);
  const collectionSucceeded = (row: SurveyCollection) => ['fetched', 'success', 'ok', 'reviewed', 'primary_read', 'manual_report'].includes(row.status);
  return {
    runCount: input.runs.length, collections: input.collections.length,
    collectionsFetched: input.collections.filter(collectionSucceeded).length,
    collectionsFailed: input.collections.filter(row => failed.has(row.status)).length,
    candidates: input.candidates.length,
    fetchedCandidates: input.candidates.filter(row => row.fetch_status === 'fetched').length,
    blockedCandidates: input.candidates.filter(row => failed.has(row.fetch_status ?? '')).length,
    reviewedCandidates: input.candidates.filter(row => (row.source_ids?.length ?? 0) > 0).length,
    linkedSources: new Set(input.candidates.flatMap(row => row.source_ids ?? [])).size,
    unreviewedCandidates: input.candidates.filter(row => !row.source_ids?.length).length,
  };
}
