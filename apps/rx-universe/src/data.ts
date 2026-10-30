/**
 * RX Universe — evidence-first seed model.
 * This file is a visualization of the supplied design specification, not an
 * assertion of Samsung's actual products, contracts, reporting lines or results.
 * No externally verified claims or collected evidence have been loaded.
 */
export const SPEC_DATE = '2026-10-28';
export const DATA_LABEL = '설계 기반 Seed · 원출처 검증 전';
export type EntityType = 'Company' | 'Organization' | 'PersonRole' | 'Product' | 'Robot' | 'Technology' | 'Factory' | 'Project' | 'Contract' | 'Investment' | 'Event' | 'Claim' | 'Source' | 'KPI' | 'Hypothesis' | 'Signal' | 'Question';
export type RelationType = 'owns' | 'develops' | 'operates' | 'partners_with' | 'funds' | 'deploys_at' | 'depends_on' | 'supports' | 'contradicts' | 'supersedes' | 'reports_to' | 'measured_by';
export type VerificationStatus = 'seed' | 'unverified' | 'in_review' | 'verified' | 'rejected' | 'corrected';
export interface TemporalRecord {
  event_time?: string | null;
  published_at: string;
  ingested_at?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  /** Publication time of a retraction/change. Prevents future corrections leaking backwards. */
  invalidated_at?: string | null;
}
export interface Entity extends TemporalRecord {
  id: string; type: EntityType; name: string; canonical_name: string;
  aliases: string[]; description: string; cluster: 'enterprise' | 'orchestration' | 'factory' | 'hypothesis' | 'evidence';
  color: string; position: [number, number, number]; status: VerificationStatus;
}
export interface Evidence extends TemporalRecord {
  id: string; source_url: string; publisher: string; title: string; excerpt: string;
  captured_at: string; sha256: string; origin_id: string; status: VerificationStatus;
  independence: 'original' | 'republication'; commercialization_stage: string;
  license: string; source_type: 'official' | 'media' | 'paper' | 'patent' | 'video';
}
export interface Claim extends TemporalRecord {
  id: string; subject: string; predicate: string; object: string;
  source_ids: string[]; status: VerificationStatus; kind: 'official_fact' | 'media_report' | 'inference' | 'forecast';
}
export interface Relation extends TemporalRecord {
  id: string; from: string; to: string; type: RelationType;
  evidence_ids: string[]; inferred: true; rationale: string;
}
export interface Hypothesis extends TemporalRecord {
  id: string; title: string; name: string; summary: string; status: 'seed';
  supporting_evidence_ids: string[]; counterevidence_ids: string[];
  next_check: string; alternative: string; open_question: string;
}
export interface Signal extends TemporalRecord {
  id: string; title: string; trigger: string; source: null;
  event_date: null; claim_ids: string[]; hypothesis_ids: string[];
  impact_level: 'unassessed'; review_priority: 'high'; status: 'watching';
  counterevidence: string; counterevidence_ids: string[]; next_check: string; expiry: null;
}
export interface Question extends TemporalRecord {
  id: string; title: string; owner: string; evidence_needed: string; status: 'open'; related_entities: string[];
}

const colors = { enterprise: '#68a7ff', orchestration: '#52d7bd', factory: '#d5b77b', hypothesis: '#b599f4', evidence: '#8ca6bd' };
const entity = (id: string, name: string, type: EntityType, cluster: Entity['cluster'], position: Entity['position'], description: string, aliases: string[] = []): Entity => ({
  id, name, canonical_name: name, type, cluster, position, color: colors[cluster], aliases,
  description, status: 'seed', event_time: null, published_at: SPEC_DATE, ingested_at: SPEC_DATE,
});
export const entities: Entity[] = [
  entity('se', 'Samsung Electronics', 'Company', 'enterprise', [-5, 1.7, 0], '삼성전자. 삼성SDS와 별도 법인으로 탐색합니다. RX 조직·제품·기술 책임 경계는 원출처 확인 대상입니다.', ['삼성전자', 'Samsung Electronics RX']),
  entity('sds', 'Samsung SDS', 'Company', 'enterprise', [0, 1.4, 0], '삼성SDS. 공통 오케스트레이션 플랫폼 가설의 검증 대상이며 그룹 표준권을 사실로 가정하지 않습니다.', ['삼성SDS', 'SDS RX']),
  entity('miracom', 'Miracom', 'Company', 'enterprise', [4.6, 0.5, 0.3], '미라콤. RCS와 Job/Task 계층의 책임 분리 및 API 경계를 확인할 대상입니다. 법인 소유 관계는 아직 등록하지 않았습니다.', ['미라콤', '미라콤아이앤씨']),
  entity('mes', 'Manufacturing Execution', 'Technology', 'factory', [-5, -2, 0], 'MES: 설계서의 제조 실행 흐름 시작점. 실제 현장 제품 연결은 미검증입니다.', ['MES']),
  entity('job', 'Job Orchestration', 'Technology', 'orchestration', [-2.8, -0.5, 1.4], 'Job: 작업 목표와 생산 맥락을 전달하는 설계 계층입니다.', ['Job']),
  entity('task', 'Task Graph', 'Technology', 'orchestration', [-0.4, -0.5, 2], 'Task Graph: 작업 의존관계를 모델링하는 설계 계층입니다.', ['Task']),
  entity('scheduling', 'Scheduling', 'Technology', 'orchestration', [1.4, -1.4, 1], '작업 자원과 순서를 결정하는 설계 계층입니다. 실제 알고리즘과 책임 조직은 미확인입니다.'),
  entity('dispatch', 'Dispatch', 'Technology', 'orchestration', [3, -1.8, 0], '로봇 작업 명령을 전달하는 설계 계층입니다. 운영 중인 시스템을 의미하지 않습니다.'),
  entity('rcs', 'Robot Control System', 'Technology', 'factory', [5, -2.4, -1], 'RCS/API: 로봇 제어와 상위 오케스트레이션 사이 경계를 검증하기 위한 노드입니다.', ['RCS']),
  entity('robot', 'Robot Fleet', 'Robot', 'factory', [3.5, -3.6, 1.4], '지원 로봇 범위를 확인하기 위한 모델 노드. 제조사·기종·수량은 미등록입니다.', ['Robot']),
  entity('kpi', 'Operational KPI', 'KPI', 'factory', [0.6, -3.7, -1], '사람 개입률, 복구시간, 품질 지표의 공개 여부를 추적합니다. 실측값은 없습니다.', ['KPI']),
  entity('factory', 'Manufacturing Sites', 'Factory', 'factory', [-3.4, -3.3, -1], '제조 관계사의 PoC·유료 운영·반복 배포를 분리하기 위한 자리표시자입니다. 확인된 고객이나 공장은 아닙니다.', ['Factory', '제조 현장']),
  entity('platform', 'Shared Platform', 'Hypothesis', 'hypothesis', [0, 3.4, -1.5], 'H1 · 삼성SDS 공통 플랫폼 가설. 검증 전이며 조직 권한이나 사업화 성공을 뜻하지 않습니다.'),
  entity('vertical', 'Vertical Integration', 'Hypothesis', 'hypothesis', [-4.4, 3.6, -1], 'H2 · 삼성전자 중심 수직통합 가설. 경쟁 가설과 동일한 검증 기준을 적용합니다.'),
  entity('distributed', 'Distributed SI', 'Hypothesis', 'hypothesis', [4.7, 3.4, -1.5], 'H3 · 계열사별 분산 SI 가설. 그룹 공통 API 부재를 전제하지 않습니다.'),
  entity('api', 'Common API', 'Technology', 'orchestration', [2.2, 2.8, 1], '공통 API의 공식 명세·버전·지원 범위를 검증하기 위한 질문 노드입니다. 공식화됐다는 주장이 아닙니다.'),
  entity('partner', 'External Partners', 'Organization', 'enterprise', [-2.5, 2.5, 1.7], '외부 파트너의 계약·연동 범위를 추적할 자리표시자입니다. 파트너 명단은 미등록입니다.'),
  entity('evidence', 'Evidence Vault', 'Source', 'evidence', [0, 0, -2.6], '원출처 수집 전입니다. 원문 URL·발행일·사건일·관측일·해시·출처 계보가 있는 자료만 근거로 등록합니다.'),
];

const relation = (from: string, to: string, type: RelationType, rationale: string): Relation => ({
  id: `${from}-${type}-${to}`, from, to, type, inferred: true, evidence_ids: [],
  rationale: `설계 기반 검증 가설: ${rationale} 실제 관계로 확정되지 않았습니다.`,
  event_time: null, published_at: SPEC_DATE, ingested_at: SPEC_DATE, valid_from: SPEC_DATE, valid_to: null,
});
export const relations: Relation[] = [
  relation('platform', 'sds', 'depends_on', '삼성SDS 공통 플랫폼 가설의 책임 범위를 검증합니다.'),
  relation('vertical', 'se', 'depends_on', '삼성전자 중심 수직통합 가설의 제품 경계를 검증합니다.'),
  relation('distributed', 'miracom', 'depends_on', '분산 SI 가설에서 회사별 역할을 검증합니다.'),
  relation('sds', 'job', 'develops', 'Job 계층의 기술 책임을 확인합니다.'),
  relation('sds', 'task', 'develops', 'Task 계층의 기술 책임을 확인합니다.'),
  relation('miracom', 'rcs', 'develops', 'RCS 책임과 실제 제품문서를 확인합니다.'),
  relation('api', 'sds', 'depends_on', '공통 API와 지원 범위를 확인합니다.'),
  relation('partner', 'api', 'depends_on', '외부 연동을 공식 문서로 확인합니다.'),
  relation('job', 'mes', 'depends_on', 'MES→Job의 개념적 실행 흐름입니다.'),
  relation('task', 'job', 'depends_on', 'Job→Task Graph의 개념적 실행 흐름입니다.'),
  relation('scheduling', 'task', 'depends_on', 'Task Graph→Scheduling의 개념적 실행 흐름입니다.'),
  relation('dispatch', 'scheduling', 'depends_on', 'Scheduling→Dispatch의 개념적 실행 흐름입니다.'),
  relation('rcs', 'dispatch', 'depends_on', 'Dispatch→RCS/API의 개념적 실행 흐름입니다.'),
  relation('robot', 'rcs', 'depends_on', 'RCS/API→Robot의 개념적 실행 흐름입니다.'),
  relation('robot', 'factory', 'deploys_at', '실제 배포 현장과 상시 가동 여부를 확인해야 합니다.'),
  relation('robot', 'kpi', 'measured_by', '개입률·복구시간·품질의 측정 근거를 확인합니다.'),
];

// Deliberately empty: a specification is not evidence of real-world RX activity.
export const evidence: Evidence[] = [];
export const claims: Claim[] = [];

export const hypotheses: Hypothesis[] = [
  { id: 'platform', title: 'SDS 공통 플랫폼', name: 'Shared platform', summary: '삼성SDS의 오케스트레이션이 관계사 공통 플랫폼으로 확장될 수 있다.', status: 'seed', supporting_evidence_ids: [], counterevidence_ids: [], next_check: '그룹 공통 API의 공식 문서, 동일 버전의 다공장 반복 배포, 외부 유료 계약 확인', alternative: '개별 현장별 맞춤 연동이나 프로젝트 단위 SI로 설명될 수 있다.', open_question: '표준 API와 제품·현장 계약의 책임 주체는 누구인가?', published_at: SPEC_DATE },
  { id: 'vertical', title: '삼성전자 중심 수직통합', name: 'Vertical integration', summary: '삼성전자 내부 제조 수요를 중심으로 기술과 제품이 통합될 수 있다.', status: 'seed', supporting_evidence_ids: [], counterevidence_ids: [], next_check: '삼성전자와 SDS의 공식 제품·기술 책임 범위 및 외부 고객 제공 조건 확인', alternative: '삼성전자의 현장 도입과 그룹 공통 플랫폼은 함께 존재할 수 있다.', open_question: '내부 최적화와 외부 사업화의 경계는 어디인가?', published_at: SPEC_DATE },
  { id: 'distributed', title: '계열사별 분산 SI', name: 'Distributed integration', summary: '계열사별 요구에 따라 개별 SI 및 파트너 생태계가 병존할 수 있다.', status: 'seed', supporting_evidence_ids: [], counterevidence_ids: [], next_check: '공장별 제품 구성·계약 주체 및 공통 모듈의 재사용 여부 확인', alternative: '다양한 현장 구현 아래 공통 API와 공통 플랫폼이 존재할 수 있다.', open_question: '현장별 차이는 통합 플랫폼의 설정인가, 별도 구현인가?', published_at: SPEC_DATE },
];

const signal = (id: string, title: string, trigger: string, next_check: string, counterevidence: string, hypothesis_ids: string[]): Signal => ({
  id, title, trigger, next_check, counterevidence, hypothesis_ids, claim_ids: [], source: null,
  event_date: null, impact_level: 'unassessed', review_priority: 'high', status: 'watching',
  counterevidence_ids: [], expiry: null, published_at: SPEC_DATE,
});
export const signals: Signal[] = [
  signal('api-standard', '그룹 공통 API 공식화', '공식 API 명세에서 그룹 공통 범위·버전·책임 주체를 명시', '공식 제품문서와 릴리스 노트 확인', '현장별 비호환 API 또는 개별 연동 문서 확인 필요', ['platform', 'distributed']),
  signal('paid-contract', '외부 유료 수주', '외부 고객·계약 주체·유료 운영 범위를 원출처로 확인', 'IR·공시·공식 계약 발표 확인', 'PoC·MOU·무상 시연에 한정되는지 확인 필요', ['platform', 'vertical']),
  signal('continuous-operation', '90일 이상 상시 가동', '같은 현장에서 90일 이상의 실운영을 확인', '운영 기간·중단 기록·촬영일 확인', '홍보 영상·단발성 시연인지 확인 필요', ['platform', 'distributed']),
  signal('operating-metrics', '개입률·복구시간 공개', '정의·기간·표본을 포함한 운영 KPI 공개', '사람 개입률·품질·복구시간의 측정법 확인', '선택된 시연 구간 또는 정의가 다른 지표인지 확인 필요', ['platform', 'vertical']),
  signal('multi-site', '다공장 반복 배포', '같은 제품·버전의 독립된 복수 현장 배포 확인', '현장별 적용 범위와 커스텀 개발 비중 확인', '동일 기업 재인용 또는 공장별 별도 SI인지 확인 필요', ['platform', 'distributed']),
  signal('recurring-revenue', 'RX 전용 반복매출', 'RX SW에 귀속되는 갱신·구독·재계약 매출 확인', 'RX SW 매출과 하드웨어·전사 투자를 분리 확인', '일회성 구축 매출·GPU 계약·전사 예산인지 확인 필요', ['platform', 'vertical', 'distributed']),
];

export const questions: Question[] = [
  { id: 'Q-01', title: '삼성전자 RX와 삼성SDS RX의 제품·기술 책임 경계는?', owner: '전략 분석', evidence_needed: '공식 조직·제품문서 및 책임 범위', related_entities: ['se', 'sds'], status: 'open', published_at: SPEC_DATE },
  { id: 'Q-02', title: 'SDS 오케스트레이션의 API와 지원 로봇 범위는?', owner: '오케스트레이션 설계', evidence_needed: 'API 명세·지원 기종·버전 정책', related_entities: ['sds', 'api', 'robot'], status: 'open', published_at: SPEC_DATE },
  { id: 'Q-03', title: '미라콤 RCS와 SDS Job/Task는 어떻게 분리되는가?', owner: '제조 SW', evidence_needed: '인터페이스 계약·제품 아키텍처', related_entities: ['miracom', 'sds', 'rcs', 'job', 'task'], status: 'open', published_at: SPEC_DATE },
  { id: 'Q-04', title: 'PoC가 유료 상시 가동으로 전환된 사례는?', owner: '사업 검증', evidence_needed: '계약 조건·운영 기간·실가동 근거', related_entities: ['factory', 'robot'], status: 'open', published_at: SPEC_DATE },
  { id: 'Q-05', title: '외부 고객 재계약과 RX 반복매출은?', owner: '사업 검증', evidence_needed: 'RX SW로 구분된 재계약·수익 자료', related_entities: ['partner', 'sds'], status: 'open', published_at: SPEC_DATE },
  { id: 'Q-06', title: '사람 개입률·품질·복구시간은?', owner: '운영 성능', evidence_needed: '측정 정의·기간·표본을 포함한 운영 지표', related_entities: ['kpi', 'robot', 'factory'], status: 'open', published_at: SPEC_DATE },
];

/** Discovery entry points only; none is registered as claim evidence. */
export const sourceInventory = [
  { id: 'sds-news', name: 'Samsung SDS 뉴스룸', url: 'https://www.samsungsds.com/kr/news/news.html', type: '공식 뉴스룸', status: '수집 대기' },
  { id: 'se-news', name: 'Samsung Electronics 뉴스룸', url: 'https://news.samsung.com/kr/', type: '공식 뉴스룸', status: '수집 대기' },
  { id: 'miracom-site', name: 'Miracom 공식 사이트', url: 'https://www.miracom.co.kr/', type: '공식 제품·기업 정보', status: '수집 대기' },
  { id: 'dart', name: 'DART 전자공시', url: 'https://dart.fss.or.kr/', type: '공시 원문', status: '수집 대기' },
];
export const operationalStatus = {
  mode: 'seed' as const, data_label: DATA_LABEL, verified_claims: 0, collected_sources: 0,
  last_successful_update: null, live_collection: false, automatic_updates: false,
  proposed_schedule: '08:00 KST', proposed_schedule_label: '제안 일정 · 미연동',
  design_targets: { claim_traceability: '100%', official_source_omission: '≤ 5%', change_latency: '≤ 24h', dedup_precision: '≥ 95%', briefing_read_time: '≤ 3m' },
};

export interface TimeQuery {
  as_of: string; known_at: string;
  mode?: 'as-known-at' | 'retrospective';
  /** Required explicit knowledge horizon for retrospective mode. */
  retrospective_known_at?: string;
  /** Reproduce what this particular system had actually collected at that time. */
  require_ingested?: boolean;
}
const cutoff = (value: string): number => {
  const result = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : value);
  if (!Number.isFinite(result)) throw new Error(`Invalid date: ${value}`);
  return result;
};
const beginning = (value: string): number => {
  const result = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value);
  if (!Number.isFinite(result)) throw new Error(`Invalid date: ${value}`);
  return result;
};
/** Publication gates knowledge; event time gates occurrence. Date-only cutoffs include the full day. */
export function visibleAt<T extends TemporalRecord>(records: readonly T[], query: TimeQuery): T[];
export function visibleAt<T extends TemporalRecord>(records: readonly T[], asOf: string, knownAt?: string): T[];
export function visibleAt<T extends TemporalRecord>(records: readonly T[], queryOrDate: TimeQuery | string, knownAt?: string): T[] {
  const query: TimeQuery = typeof queryOrDate === 'string' ? { as_of: queryOrDate, known_at: knownAt ?? queryOrDate } : queryOrDate;
  if (query.mode === 'retrospective' && !query.retrospective_known_at) throw new Error('Retrospective mode requires retrospective_known_at');
  const eventCutoff = cutoff(query.as_of);
  const knowledgeCutoff = cutoff(query.mode === 'retrospective' ? query.retrospective_known_at! : query.known_at);
  return records.filter(record => {
    if (beginning(record.published_at) > knowledgeCutoff) return false;
    if (record.event_time && beginning(record.event_time) > eventCutoff) return false;
    if (record.valid_from && beginning(record.valid_from) > eventCutoff) return false;
    if (query.require_ingested && (!record.ingested_at || beginning(record.ingested_at) > knowledgeCutoff)) return false;
    // A later correction cannot silently alter an earlier as-known-at snapshot.
    if (record.valid_to && record.invalidated_at && beginning(record.invalidated_at) <= knowledgeCutoff && beginning(record.valid_to) <= eventCutoff) return false;
    return true;
  });
}
/** Count an original report and all its citations as one independent origin. */
export function independentEvidence<T extends Pick<Evidence, 'id' | 'origin_id'>>(records: readonly T[]): T[] {
  const origins = new Map<string, T>();
  for (const record of records) {
    if (!record.origin_id.trim()) throw new Error(`Missing origin_id: ${record.id}`);
    if (!origins.has(record.origin_id)) origins.set(record.origin_id, record);
  }
  return [...origins.values()];
}
export const deduplicateOrigins = independentEvidence;

export function createSnapshot(query: TimeQuery = { as_of: SPEC_DATE, known_at: SPEC_DATE }) {
  const visibleEntities = visibleAt(entities, query);
  const ids = new Set(visibleEntities.map(item => item.id));
  const visibleEvidence = visibleAt(evidence, query);
  const sourceIds = new Set(visibleEvidence.map(item => item.id));
  return {
    schema_version: '2.2', query, data_label: DATA_LABEL,
    last_successful_update: operationalStatus.last_successful_update,
    entities: visibleEntities,
    relations: visibleAt(relations, query).filter(item => ids.has(item.from) && ids.has(item.to)),
    claims: visibleAt(claims, query).filter(item => item.source_ids.length > 0 && item.source_ids.every(id => sourceIds.has(id))),
    evidence: visibleEvidence,
    independent_source_count: independentEvidence(visibleEvidence).length,
    hypotheses: visibleAt(hypotheses, query),
    signals: visibleAt(signals, query),
    questions: visibleAt(questions, query),
  };
}
export const snapshot = createSnapshot;
