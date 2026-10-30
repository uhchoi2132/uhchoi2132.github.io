import {
  catalog, getRecordClaims, hasReliablePublicationDate, researchAt, researchClaims,
  type ResearchCatalog, type ResearchClaim, type ResearchClaimWithSource, type ResearchMode, type ResearchRecord,
} from './research.ts';

export type BriefingPeriod = 'daily' | 'weekly' | 'monthly';
export type BriefingStage = 'announcement' | 'demo' | 'pilot' | 'paid' | 'production' | 'unknown';
export const stageLabels: Record<BriefingStage, string> = {
  announcement: '계획 · 발표', demo: '시연', pilot: 'PoC · 실증', paid: '유료 계약 · 매출 언급', production: '현장 적용 언급', unknown: '미분류',
};
export const periodLabels: Record<BriefingPeriod, string> = { daily: '일간', weekly: '주간', monthly: '월간' };
export interface PeriodBounds {
  start: string; end: string; previousStart: string; previousEnd: string; days: number;
  requestedEnd: string; clamped: boolean;
}
const dayMilliseconds = 86_400_000;
function validDay(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(`${day}T00:00:00Z`))
    && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
}
function shift(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * dayMilliseconds).toISOString().slice(0, 10);
}
/** Inclusive publication windows: selected day; trailing seven days; month to date. */
export function periodBounds(date: string, period: BriefingPeriod = 'daily', horizon = catalog.meta.window_end): PeriodBounds | null {
  if (!validDay(date) || !validDay(horizon) || !['daily', 'weekly', 'monthly'].includes(period)) return null;
  const end = date > horizon ? horizon : date;
  const start = period === 'daily' ? end : period === 'weekly' ? shift(end, -6) : `${end.slice(0, 7)}-01`;
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / dayMilliseconds) + 1;
  const previousEnd = shift(start, -1);
  return { start, end, days, previousStart: shift(previousEnd, 1 - days), previousEnd, requestedEnd: date, clamped: date !== end };
}
function newestFirst(a: ResearchRecord, b: ResearchRecord): number {
  return (b.published_at ?? '').localeCompare(a.published_at ?? '')
    || Number(b.source_type === 'official' || b.source_type === 'filing') - Number(a.source_type === 'official' || a.source_type === 'filing')
    || a.id.localeCompare(b.id);
}
export interface BriefingOriginGroup { originKey: string; records: ResearchRecord[]; latest: ResearchRecord }
function originGroups(records: readonly ResearchRecord[]): BriefingOriginGroup[] {
  const groups = new Map<string, ResearchRecord[]>();
  for (const record of records) {
    const key = record.origin_key.trim() || record.url;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return [...groups].map(([originKey, group]) => {
    const sorted = [...group].sort(newestFirst);
    return { originKey, records: sorted, latest: sorted[0] };
  }).sort((a, b) => newestFirst(a.latest, b.latest));
}
function stage(record: ResearchRecord): BriefingStage {
  return Object.hasOwn(stageLabels, record.commercialization_stage) ? record.commercialization_stage as BriefingStage : 'unknown';
}
export interface SignalCandidate {
  id: string; title: string; claim: ResearchClaim; source: ResearchRecord; relatedSources: ResearchRecord[];
  stage: BriefingStage; status: 'review_candidate'; highImpactVerified: false;
  priority: 'review' | 'monitor'; priorityReason: string;
  counterevidence: { text: string; url: string; sourceId: string; kind: 'source_limitation' }[];
  counterevidenceStatus: 'source_limitations_only'; nextCheck: string;
}
const nextChecks: Partial<Record<BriefingStage, string>> = {
  announcement: '공식 출시·계약·실증 결과 원문을 확인하고 발표한 계획과 실제 이행을 구분합니다.',
  demo: '시연의 촬영·가동 조건, 사람 개입 여부, 실제 현장 실증 결과를 확인합니다.',
  pilot: 'PoC에서 생산라인 파일럿·상시 운영으로 전환했는지 원문과 가동 기간·개입률을 확인합니다.',
  paid: '계약 범위·매출 인식·대금 수령을 구분하고 로봇 하드웨어와 RX 소프트웨어 반복매출을 각각 확인합니다.',
  production: '현장별 가동 기간, 안전 승인, 사람 개입률, 복구시간과 유료 운영 여부를 확인합니다.',
};
/** Candidates for human review; a source limitation is not independent counterevidence. */
export function signalCandidatesFor(records: readonly ResearchRecord[]): SignalCandidate[] {
  return originGroups(records).map((group): SignalCandidate => {
    const source = group.latest;
    const currentStage = stage(source);
    let priorityReason = '이 기간에 공개된 문서의 주장과 한계를 후속 검토할 수 있습니다.';
    let nextCheck = nextChecks[currentStage] ?? '주장의 적용 법인·제품·현장·사업화 단계와 이를 뒷받침하는 원문을 추가 확인합니다.';
    if (source.id === 'sds-005' || source.id === 'sds-013') {
      priorityReason = '삼성SDS의 관계사 현장 실증 추진이 공개되어 PoC와 상용 운영의 경계 확인이 필요합니다.';
      nextCheck = '2027년 플랫폼 출시와 실제 생산라인 파일럿 전환, 유료 계약·가동 기간·개입률의 공개 근거를 확인합니다.';
    } else if (source.id === 'tech-017') {
      priorityReason = 'KAI 로봇 장비 계약의 납품·대금 수령 진행을 확인할 수 있는 공시입니다. 원계약은 2024년이며 SDS RX SW 신규 수주가 아닙니다.';
      nextCheck = 'KAI 장비 시스템 검증 완료와 잔금 수령의 후속 공시를 확인합니다. SDS RX SW 반복매출과 구분합니다.';
    } else if (source.id === 'mi-002') {
      priorityReason = '제조 AI 사례에서 실제 피킹·이송의 수행 주체가 사람임을 명시해 로봇 자율화 판단 범위를 좁힙니다.';
      nextCheck = '로봇 연결이 실제로 완료됐는지 후속 현장 자료와 작업자 개입·안전 지표를 확인합니다.';
    } else if (source.id === 'mi-016') {
      priorityReason = '휴머노이드 배터리의 고객 성능평가가 보도됐습니다. 목표 상용화와 완료 사실의 구분이 필요합니다.';
      nextCheck = '삼성SDI 공식 IR의 평가 완료·양산 일정과 실제 공급 계약을 확인합니다.';
    }
    const limitations = [...new Set(group.records.flatMap(record => [
      ...record.limitations, ...getRecordClaims(record).flatMap(claim => claim.limitations ?? []),
    ]))];
    return {
      id: `candidate:${source.id}`, title: source.title, claim: getRecordClaims(source)[0], source,
      relatedSources: group.records, stage: currentStage, status: 'review_candidate', highImpactVerified: false,
      priority: ['pilot', 'paid', 'production'].includes(currentStage) || source.id === 'mi-002' ? 'review' : 'monitor',
      priorityReason,
      counterevidence: limitations.map(text => {
        const owner = group.records.find(record => record.limitations.includes(text) || getRecordClaims(record).some(claim => claim.limitations?.includes(text))) ?? source;
        return { text, url: owner.url, sourceId: owner.id, kind: 'source_limitation' as const };
      }),
      counterevidenceStatus: 'source_limitations_only', nextCheck,
    };
  });
}
export interface BriefingResult {
  date: string; mode: ResearchMode; period: BriefingPeriod; bounds: PeriodBounds | null;
  withinPeriod: ResearchRecord[]; previousPeriod: ResearchRecord[]; cumulative: ResearchRecord[];
  claims: ResearchClaimWithSource[]; groups: BriefingOriginGroup[]; previousGroups: BriefingOriginGroup[];
  sourceCountDelta: number; newOriginGroups: BriefingOriginGroup[];
  sourceAdditions: ResearchRecord[]; corrections: 'not_tracked'; withdrawals: 'not_tracked';
  stageCounts: Record<BriefingStage, number>; candidates: SignalCandidate[];
  latest: { source: ResearchRecord; claim: ResearchClaim } | null;
  laterDisclosures: ResearchRecord[]; unknownPublicationDates: ResearchRecord[]; unknownEventDates: ResearchRecord[];
  observedAt: string; completePeriodCoverage: boolean; completePreviousPeriodCoverage: boolean;
}
/** Publication changes within one manual catalog, never a claim of ingestion or correction detection. */
export function briefingFor(date: string, mode: ResearchMode = 'known', period: BriefingPeriod = 'daily', source: ResearchCatalog = catalog): BriefingResult {
  const bounds = periodBounds(date, period, source.meta.window_end);
  const validMode = ['known', 'retro', 'as-known-at', 'retrospective'].includes(mode);
  const cumulative = bounds && validMode ? [...researchAt(bounds.end, mode, source)].sort(newestFirst) : [];
  const inRange = (records: readonly ResearchRecord[], start: string, end: string) => records.filter(record =>
    hasReliablePublicationDate(record) && record.published_at! >= start && record.published_at! <= end).sort(newestFirst);
  const withinPeriod = bounds ? inRange(cumulative, bounds.start, bounds.end) : [];
  const previousPeriod = bounds && validMode ? inRange(researchAt(bounds.previousEnd, mode, source), bounds.previousStart, bounds.previousEnd) : [];
  const groups = originGroups(withinPeriod);
  const previousGroups = originGroups(previousPeriod);
  // Earlier publications establish already-seen origin groups, regardless of the event's later scheduled date.
  const earlier = bounds && validMode ? researchAt(bounds.previousEnd, 'known', source) : [];
  const earlierOrigins = new Set(earlier.map(record => record.origin_key.trim() || record.url));
  const stageCounts = { announcement: 0, demo: 0, pilot: 0, paid: 0, production: 0, unknown: 0 };
  withinPeriod.forEach(record => { stageCounts[stage(record)] += 1; });
  const unknownPublicationDates = bounds && validMode && bounds.end >= source.meta.researched_at.slice(0, 10)
    ? source.records.filter(record => record.scope === 'undated' || !hasReliablePublicationDate(record)) : [];
  return {
    date, mode, period, bounds, withinPeriod, previousPeriod, cumulative, claims: researchClaims(withinPeriod), groups, previousGroups,
    sourceCountDelta: withinPeriod.length - previousPeriod.length,
    newOriginGroups: groups.filter(group => !earlierOrigins.has(group.originKey)),
    sourceAdditions: withinPeriod, corrections: 'not_tracked', withdrawals: 'not_tracked', stageCounts,
    candidates: signalCandidatesFor(withinPeriod),
    latest: withinPeriod[0] ? { source: withinPeriod[0], claim: getRecordClaims(withinPeriod[0])[0] } : null,
    laterDisclosures: bounds ? cumulative.filter(record => record.published_at! > bounds.end) : [],
    unknownPublicationDates, unknownEventDates: withinPeriod.filter(record => record.event_date === null),
    observedAt: source.meta.researched_at,
    completePeriodCoverage: !!bounds && bounds.start >= source.meta.window_start,
    completePreviousPeriodCoverage: !!bounds && bounds.previousStart >= source.meta.window_start,
  };
}
