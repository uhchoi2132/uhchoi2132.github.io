import expansionData from './knowledge-expansion.json' with { type: 'json' };
import { catalog, getRecordClaims, RESEARCH_MAX_DATE, researchAt, type ResearchMode, type ResearchRecord, type ResearchVerification, type ResearchTimeOptions, type ResearchClaim, scheduledEventDate } from './research';

import { ontologyDefinitions, matchedAlias, layerPosition, type KnowledgeKind, type OntologyType, type KnowledgeLayer, type KnowledgeCluster, type Position } from './knowledge-ontology';
export type { KnowledgeKind, OntologyType, KnowledgeLayer, KnowledgeCluster } from './knowledge-ontology';

/** Every factual-looking edge is a source-attributed statement, not an independent audit. */
export type KnowledgeStatus = 'reported' | 'planned' | 'research' | 'hypothesis' | 'undated_current';
export interface KnowledgeNode {
  id: string; title: string; subtitle?: string; kind: KnowledgeKind;
  position: [number, number, number]; size: number; description: string;
  ontology_type: OntologyType; layer: KnowledgeLayer; cluster: KnowledgeCluster; aliases: string[];
  published_at?: string | null; event_date?: string | null; observed_at?: string; scheduled_event_date?: string | null;
  verification?: ResearchVerification; source_url?: string; origin_key?: string;
  source_ids: string[]; claim_ids: string[];
}
export interface KnowledgeRelation {
  id: string; from: string; to: string; type: string; label: string;
  claim_ids: string[]; source_ids: string[]; inferred: boolean; rationale: string;
  provenance: 'source_attributed' | 'analyst_mapping'; status: KnowledgeStatus;
  /** Source publication is not necessarily the occurrence date of the assertion. */
  published_at: string | null; event_date: string | null; observed_at: string;
  limitations: string[];
  evidence_basis?: 'extracted_claim' | 'catalog_text' | 'source_metadata' | 'analyst_mapping';
  matched_alias?: string; evidence_text?: string;
}
export interface KnowledgeGraph { nodes: KnowledgeNode[]; relations: KnowledgeRelation[] }
export type HypothesisEvidenceRole = 'support' | 'challenge' | 'context';
export interface HypothesisEvidence {
  id: string; source_id: string; source_ids: string[]; claim_id: string; claim_ids: string[];
  text: string; rationale: string; url: string; publisher: string; published_at: string | null;
  evidence_role: HypothesisEvidenceRole; analyst_mapping: true; verification: ResearchVerification;
}
export interface HypothesisAssessment {
  id: 'platform' | 'vertical' | 'distributed'; title: string; summary: string;
  status: 'analyst_hypothesis'; analyst_mapping: true;
  support: HypothesisEvidence[]; challenge: HypothesisEvidence[]; context: HypothesisEvidence[];
  next_check: string; alternative: string; limitations: string[];
}


export interface EdgeDefinition { id: string; from: string; to: string; type: string; label: string; claim_id: string; status: KnowledgeStatus; rationale: string }
const edge = (id: string, from: string, to: string, type: string, label: string, record: string, status: KnowledgeStatus, rationale: string): EdgeDefinition => ({
  id, from, to, type, label, claim_id: record.startsWith('claim:') ? record : `claim:${record}`, status, rationale,
});
const edgeDefinitions: EdgeDefinition[] = [
  edge('se-nvidia', 'se', 'nvidia', 'partners_with', 'AI 제조 협력 발표', 'se-001', 'reported', '공동 기술 협력 발표에 귀속하며 파트너의 독립 성능 검증으로 간주하지 않습니다.'),
  edge('se-megafactory', 'se', 'ai-megafactory', 'develops', 'AI 메가팩토리 추진 계획', 'se-001', 'planned', '원문은 계획 발표입니다. 전체 인프라 구축 완료나 RX SW 예산은 확인하지 않습니다.'),
  edge('se-factory-2030', 'se', 'ai-factory-2030', 'develops', '2030년 전환 목표', 'se-004', 'planned', '목표 시점의 계획이며 현재 국내외 공장 전환 완료를 의미하지 않습니다.'),
  edge('se-gumi-line', 'se', 'gumi-robot-line', 'develops', '휴머노이드 양산 라인 계획', 'se-008', 'planned', '그룹 발표에서 삼성전자 담당 계획으로 명시한 범위만 연결합니다.'),
  edge('sds-gumi-dc', 'sds', 'gumi-data-center', 'develops', 'AI 데이터센터 건설 계획', 'se-008', 'planned', '같은 그룹 발표에서 삼성SDS 담당 계획으로 명시한 범위만 연결합니다. 전자 RX와 법인을 합치지 않습니다.'),
  edge('se-rx-organization', 'se', 'se-rx', 'has_organization', 'RX사업추진실 신설 보도', 'se-010', 'reported', '연합뉴스가 인용한 조직 신설 발표입니다. 미공개 결재선·예산·정원은 추정하지 않습니다.'),
  edge('se-rainbow-ownership', 'se', 'rainbow', 'owns', '의결권 지분 35% · 종속기업 공시', 'tech-018', 'reported', '2026년 6월말 반기보고서의 의결권 지분과 종속기업 분류입니다. 신규 취득 사건이나 기술 지휘권을 뜻하지 않습니다.'),
  edge('rainbow-kai-contract', 'rainbow', 'kai-drilling-contract', 'supplies', '장비 납품·기능시험·대금수령 공시', 'tech-017', 'reported', '장비 납품·기능테스트 완료와 누적 대금수령 3,527,500천원 공시입니다. 시스템 검증 후 잔금은 예정이며 원계약은 2024년입니다.'),
  edge('kai-contract-customer', 'kai-drilling-contract', 'kai', 'supplied_to', 'KF-21 자동화 장비 계약 상대방', 'tech-017', 'reported', '외부 하드웨어 계약의 진행 현황입니다. SDS RX SW 수주·반복매출·90일 가동 근거로 바꾸지 않습니다.'),
  edge('rainbow-etech', 'rainbow', 'etech', 'partners_with', '미국 공인 SI·서비스 계약 발표', 'se-012', 'reported', '파트너 발표의 통합·설치·서비스 계약입니다. 개별 최종 고객의 유료 설치 실적은 공개하지 않습니다.'),
  edge('rainbow-sfa', 'rainbow', 'sfa', 'partners_with', '자율제조 R&D·영업 MOU 보도', 'se-016', 'planned', 'MOU 체결 보도이며 공동 제품 완성·유료 수주를 뜻하지 않습니다.'),
  edge('sds-orchestrator', 'sds', 'orchestrator', 'develops', '2027년부터 플랫폼 공개 계획', 'sds-004', 'planned', '공식 발표의 미래 출시 계획입니다. 이미 공개된 그룹 공통 API로 승격하지 않습니다.'),
  edge('orchestrator-mes', 'orchestrator', 'mes', 'integrates_with', '다종 로봇·MES 연계 사업 추진', 'sds-002', 'planned', '실적 발표에 담긴 사업 방향입니다. 배포 완료나 공개 인터페이스 명세를 입증하지 않습니다.'),
  edge('sds-walden', 'sds', 'walden', 'funds', 'Walden 전략적 투자 발표', 'tech-014', 'reported', '합쳐진 동일 원문에 보존한 별도 주장으로 투자 관계를 연결합니다. 투자액·지분율·RX SW 배정액은 추정하지 않습니다.'),
  edge('sds-affiliate-poc', 'sds', 'affiliate-poc', 'conducts', '관계사 현장 실증 추진 발표', 'sds-005', 'reported', '회사가 보고한 실증 추진 단계입니다. 실제 생산라인 상시 운영·유료 계약을 의미하지 않습니다.'),
  edge('miracom-orchestrator', 'miracom', 'orchestrator', 'integrates_with', 'MES·오케스트레이션 연계 계획', 'mi-001', 'planned', '미라콤의 공식 연계 계획입니다. SDS와의 Job/Task·RCS 상세 책임 분리는 미확인입니다.'),
  edge('miracom-rcs', 'miracom', 'rcs', 'describes', '로봇 작업·상태 관제 제품 설명', 'mi-003', 'undated_current', '게시일 없는 공식 제품문서의 현재 관측입니다. 과거 특정 날짜의 출시·지원 상태로 소급하지 않습니다.'),
  edge('sds-mcs', 'sds', 'mcs', 'provides', '삼성SDS 솔루션으로 명시', 'mi-004', 'undated_current', '미라콤 문서에 명시된 솔루션 귀속입니다. 회사 소유 구조나 신규 RX 공통 API의 근거는 아닙니다.'),
  edge('miracom-mesplus', 'miracom', 'mesplus', 'describes', 'MESplus 기능 확장 API 안내', 'mi-005', 'undated_current', 'MES 기능 확장 설명입니다. 그룹 공통 로봇 API·지원 로봇 명세와 같지 않습니다.'),
  edge('miracom-nexphere', 'miracom', 'nexphere', 'describes', '제조 AI 제품 구성 설명', 'mi-021', 'reported', '미라콤 기고문의 Platform·Analytics·Chat 구성 설명입니다. 최초 출시일이나 독립 성능 검증으로 해석하지 않습니다.'),
  edge('se-dam-vla', 'se', 'dam-vla', 'researches', '삼성 소속 연구진 VLA 연구', 'tech-006', 'research', '소속 연구진의 논문과 연구 실험을 연결합니다. 현장 상용화 또는 회사 제품 성능을 단정하지 않습니다.'),
  edge('se-h-vla', 'se', 'h-vla', 'researches', '계층형 로봇 조작 모델 연구', 'tech-007', 'research', '논문의 키 액션 추론·동작 생성 연구 범위입니다. 상용 RX 제품 출시 근거가 아닙니다.'),
  edge('rainbow-rbq', 'rainbow', 'rbq', 'describes', 'RBQ 보행·자율주행 기능 설명', 'tech-011', 'reported', '회사 공식 제품 설명입니다. 산업 현장 가동률·복구시간의 독립 검증은 아닙니다.'),
  edge('miracom-pilot', 'miracom', 'ax-rx-pilot', 'conducts', '제조기업 AX·RX 실증 추진 보도', 'mi-006', 'planned', 'BI KOREA의 사업 추진 보도입니다. 6개사 전체 구축 완료나 유료 상시 운영으로 계산하지 않습니다.'),
  edge("orchestrator-intelligence", "orchestrator", "intelligence", "has_component", "준비 중 플랫폼의 인텔리전스 영역", "claim:sds-012", "planned", "등록된 ZDNet 보도 주장은 준비 중인 플랫폼의 두 구성 영역을 명시합니다. 출시·API 공개·내부 구현 완료는 확인하지 않습니다."),
  edge("orchestrator-fleet", "orchestrator", "fleet", "has_component", "준비 중 플랫폼의 플릿 영역", "claim:sds-012", "planned", "같은 등록 주장의 플릿 구성 설명입니다. 인텔리전스에서 플릿으로 전달되는 Job/Task 규격이나 실행 의존성은 주장하지 않습니다."),
  edge("sds-team-rex", "sds", "team-rex", "organizes", "10개사 Team REX 구성 보도", "claim:sds-014", "reported", "서울경제의 등록 주장은 삼성SDS가 하드웨어·지능·데이터·시뮬레이션 분야 10개사와 Team REX를 구성했다고 보도합니다. 개별 회원사 이름·각 회사의 계약이나 유료 고객 수를 이 주장으로 확정하지 않습니다."),
  edge("walden-sds-poc", "walden", "sds", "partners_with", "제조 사용 사례 공동 PoC 진행 소개", "claim:sds-011", "undated_current", "Walden 공식 계정에 귀속된 공동 PoC 진행 주장입니다. 게시일 미상으로 현재 발견 목록에서만 표시하며 역사 시점에 소급하지 않습니다. 투자 관계와 별개이며 상시 운영·유료 계약·지원 로봇 범위는 미확인입니다."),
  edge("rcs-manufacturing-control", "rcs", "manufacturing-logistics-robots", "controls", "제조·물류 로봇 작업·상태 통합 관제 설명", "claim:mi-003", "undated_current", "미라콤 제품문서의 RCS 기능 설명 범위입니다. 게시일 미상이며 특정 모델 지원, 전체 로봇 호환, SDS Job/Task 계층의 책임·인터페이스를 확정하지 않습니다."),
  edge("mesplus-open-api", "mesplus", "open-api", "extends_via", "기능 확장 수단으로 Open API 안내", "claim:mi-005", "undated_current", "등록된 제품문서는 MESplus의 기능 확장 수단으로 Open API를 안내합니다. 그룹 공통 로봇 API나 공개 엔드포인트·지원 기종 명세로 일반화하지 않습니다."),
  edge("nexphere-platform-component", "nexphere", "nexphere-platform", "has_component", "Platform 구성 설명", "claim:mi-021", "reported", "미라콤 기고문의 등록 주장이 명시한 Nexphere AI의 세 구성 요소 중 하나입니다. 각 요소 간 실행 의존성·API·독립 성능 검증은 이 구성 설명에 포함되지 않습니다."),
  edge("nexphere-analytics-component", "nexphere", "nexphere-analytics", "has_component", "Analytics 구성 설명", "claim:mi-021", "reported", "미라콤 기고문의 등록 주장이 명시한 Nexphere AI의 세 구성 요소 중 하나입니다. 각 요소 간 실행 의존성·API·독립 성능 검증은 이 구성 설명에 포함되지 않습니다."),
  edge("nexphere-chat-component", "nexphere", "nexphere-chat", "has_component", "Chat 구성 설명", "claim:mi-021", "reported", "미라콤 기고문의 등록 주장이 명시한 Nexphere AI의 세 구성 요소 중 하나입니다. 각 요소 간 실행 의존성·API·독립 성능 검증은 이 구성 설명에 포함되지 않습니다."),
  edge("miracom-greencos-mes", "miracom", "greencos-mes-project", "develops", "그린코스 MES 프로젝트 착수 발표 보도", "claim:mi-007", "planned", "한국경제에 게재된 보도자료의 프로젝트 착수 발표입니다. 구축 완료·계약금액·로봇 운영 실적을 확정하지 않습니다."),
  edge("greencos-mes-site", "greencos-mes-project", "greencos-gimpo3", "targets_site", "그린코스 3공장 대상 MES 구축", "claim:mi-007", "planned", "등록 주장에 적시된 공장과 프로젝트의 대상 관계입니다. claim은 3공장까지 명시하므로 제목에 추가 소재지 정보는 붙이지 않습니다."),
  edge("miracom-korea-iron-project", "miracom", "korea-iron-digital-factory", "develops", "한국철강 디지털팩토리 착수 보도", "claim:mi-008", "planned", "BI KOREA의 등록 주장은 한국철강과 환영철강의 디지털팩토리 프로젝트 착수를 다룹니다. 별도의 로봇 도입·자율운영·유료 상시 운영을 뜻하지 않습니다."),
  edge("korea-iron-project-target", "korea-iron-digital-factory", "korea-iron", "targets_company", "한국철강 대상 프로젝트", "claim:mi-008", "planned", "주장에 명시된 대상 기업과 프로젝트를 연결합니다. 고객 수·매출·계약금액을 생성하지 않습니다."),
  edge("miracom-hwanyoung-project", "miracom", "hwanyoung-digital-factory", "develops", "환영철강 디지털팩토리 착수 보도", "claim:mi-008", "planned", "같은 등록 보도에서 환영철강 대상 프로젝트를 별도로 모델링합니다. 독립 원출처나 별도의 확정 매출 건수로 중복 계산하지 않습니다."),
  edge("hwanyoung-project-target", "hwanyoung-digital-factory", "hwanyoung-steel", "targets_company", "환영철강 대상 프로젝트", "claim:mi-008", "planned", "주장에 명시된 대상 기업과 프로젝트를 연결합니다. 구축 완료 또는 로봇 가동 완료의 의미가 아닙니다."),
  edge("miracom-chemtopia", "miracom", "chemtopia", "partners_with", "스마트팩토리·탄소중립 MOU 체결 보도", "claim:mi-010", "reported", "등록된 전자과학 주장은 2025-11-25 MOU 체결을 보도합니다. 협력 의향을 유료 계약·RX 로봇 수주·반복매출로 승격하지 않습니다."),
  edge("sdi-solid-state-showcase", "sdi", "solid-state-battery", "plans_showcase", "로봇용 전고체 배터리 샘플 공개 계획", "claim:mi-015", "planned", "삼성SDI의 인터배터리 2026 샘플 공개 계획에 귀속합니다. 양산·상용 공급·고객 로봇 통합 완료와 구분합니다."),
  edge("semco-humanoid-camera", "semco", "humanoid-camera-module", "plans_production", "2026년 하반기 생산 계획 보도", "claim:mi-018", "planned", "아시아경제가 보도한 삼성전기 사장의 생산 계획입니다. 예정 시점의 경과만으로 생산 개시·수주·출하 완료를 만들지 않습니다."),
  edge("shi-rx-automation", "shi-rx", "welding-painting-automation", "develops", "용접·도장 자동화 장비 개발·현장 적용 활동", "claim:se-018", "reported", "삼성 명장 자료의 등록 주장이 삼성중공업 RX센터의 개발·현장 적용 활동을 명시합니다. 삼성전자 RX·삼성SDS 조직과 합치거나 공개되지 않은 결재선·KPI를 추정하지 않습니다."),
  edge("megafactory-omniverse", "ai-megafactory", "omniverse", "plans_use", "Omniverse 제조 디지털 트윈 활용 계획", "claim:se-001", "planned", "삼성전자의 AI 메가팩토리 계획에 명시된 기술 활용 관계입니다. 솔루션 사용 계획을 구축 완료 또는 성능 검증으로 해석하지 않습니다."),
  edge("megafactory-jetson-thor", "ai-megafactory", "jetson-thor", "plans_use", "Jetson Thor 등 로봇 플랫폼 활용 계획", "claim:se-001", "planned", "등록된 계획 주장의 로봇 플랫폼 활용 범위입니다. RX SW 예산·배포 기종·삼성SDS 플랫폼 의존성을 추정하지 않습니다."),
  edge("se-isaac-sim", "se", "isaac-sim", "uses", "가상·실제 로봇 데이터 연결 활용 발표", "claim:se-002", "reported", "NVIDIA가 삼성전자의 Isaac Sim·Cosmos·Jetson Thor 활용을 설명한 주장 중 하나입니다. 공급사 발표에 귀속하며 독립 현장 검증이나 그룹 공통 표준으로 취급하지 않습니다."),
  edge("se-cosmos", "se", "cosmos", "uses", "가상·실제 로봇 데이터 연결 활용 발표", "claim:se-002", "reported", "같은 NVIDIA 등록 주장에 명시된 Cosmos 활용 관계입니다. Isaac Sim과 Cosmos 사이의 방향성 데이터 의존성은 문장에 없으므로 추가하지 않습니다."),
  edge("rainbow-sales-se", "rainbow", "se", "sells_to", "2026년 1분기 특수관계자 매출 공시", "claim:tech-016", "reported", "등록된 공시 주장은 삼성전자 대상 매출 2,415,164천원을 명시합니다. 제품 종류·현장 용도·삼성SDS RX SW 매출·반복매출로 확장하지 않습니다."),
  edge("se-kt-ai-ran", "se", "kt", "contracts_with", "KT AI RAN 사업 계약 발표", "claim:se-013", "reported", "삼성전자의 등록 주장은 KT·SKT AI RAN 사업 계약과 피지컬 AI 검증 계획을 구분합니다. 계약은 AI RAN 범위이며 로봇 플랫폼 유료 수주로 분류하지 않습니다."),
  edge("se-skt-ai-ran", "se", "sktelecom", "contracts_with", "SKT AI RAN 사업 계약 발표", "claim:se-013", "reported", "같은 공식 주장에 명시된 SKT 계약 상대방입니다. 피지컬 AI 검증의 완료 또는 RX SW 계약금액을 뜻하지 않습니다."),
  edge("rainbow-us-rby1", "rainbow-us", "rb-y1", "sells", "미국법인 RB-Y1 판매 확대 보도", "claim:se-011", "reported", "ZDNet의 등록 주장이 미국법인의 RB-Y1 판매 확대를 명시합니다. 개별 고객·현장·가동률·SDS 오케스트레이션 연계를 추정하지 않습니다."),
  edge("samsung-displays-kuka-installation", "samsung-commercial-displays", "kuka-showroom-installation", "exhibited_in", "KUKA 쇼룸 로봇과 결합한 설치 소개", "claim:se-007", "reported", "삼성전자가 자사 디스플레이와 산업용 로봇의 설치 사례를 소개했다는 등록 주장입니다. 삼성디스플레이 법인과 혼동하지 않으며 KUKA의 Team REX 회원 자격·사업 계약·SDS 의존성을 추정하지 않습니다."),
];

/** A manual reading report permits attribution, never an archived or independently verified fact. */
function permitsAttribution(verification: ResearchVerification) {
  return verification === 'primary_read' || verification === 'manual_report';
}
function validDate(date: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}
/** Undated reading reports are current observations, never historical disclosures. */
export function knowledgeRecordsAt(date: string, mode: ResearchMode = 'known', options: ResearchTimeOptions = {}): ResearchRecord[] {
  if (!validDate(date) || !['known', 'retro', 'as-known-at', 'retrospective'].includes(mode)) return [];
  const dated = researchAt(date, mode, catalog, options).filter(record => permitsAttribution(record.verification));
  if (options.eventAsOf !== undefined || options.occurredOnly) return dated;
  const current = catalog.records.filter(record => record.scope === 'undated' && permitsAttribution(record.verification) && record.accessed_at.slice(0, 10) <= (date > RESEARCH_MAX_DATE ? RESEARCH_MAX_DATE : date));
  return [...dated, ...current];
}
function findClaim(records: readonly ResearchRecord[], claimId: string) {
  for (const source of records) {
    const claim = getRecordClaims(source).find(item => item.id === claimId);
    if (claim && (!claim.verification || permitsAttribution(claim.verification))) return { source, claim };
  }
  return undefined;
}

interface Mapping { role: HypothesisEvidenceRole; claim: string; rationale: string }
interface HypothesisDefinition extends Omit<HypothesisAssessment, 'support' | 'challenge' | 'context'> { anchor: string; mappings: Mapping[] }
const map = (role: HypothesisEvidenceRole, record: string, rationale: string): Mapping => ({ role, claim: `claim:${record}`, rationale });
const hypothesisDefinitions: HypothesisDefinition[] = [
  {
    id: 'platform', title: 'SDS 공통 플랫폼', anchor: 'sds', status: 'analyst_hypothesis', analyst_mapping: true,
    summary: 'SDS 오케스트레이션이 여러 제조 현장에 재사용되는 공통 운영 기반으로 발전할 수 있다는 가설입니다.',
    next_check: '공식 API·버전·지원 기종, 다공장 동일 제품 배포, 외부 유료 계약과 RX SW 매출 귀속을 확인합니다.',
    alternative: '공통 조정 계층 아래 현장별 SI와 서로 다른 제품이 공존할 수 있습니다.',
    limitations: ['계획·실증 자료를 플랫폼 완성 또는 그룹 표준권으로 승격하지 않습니다.', '지지·도전 분류는 분석가 해석이며 확률·자동 평가 결과가 아닙니다.'],
    mappings: [
      map('support', 'sds-004', '플랫폼 공개 계획은 공통 운영 기반을 구축하려는 방향의 단서입니다. 현재 출시 완료의 증거는 아닙니다.'),
      map('support', 'mi-001', 'MES와 오케스트레이션의 연계 계획은 계층 간 결합 가능성을 지지하지만 상세 API 경계는 확인되지 않았습니다.'),
      map('challenge', 'media-001', '다중 로봇 제조 운용이 완성 단계가 아니라는 현장 발언은 이미 완성된 공통 플랫폼이라는 강한 해석에 도전합니다.'),
      map('challenge', 'mi-002', '공개 자재공급 사례에서 실제 피킹·이송은 사람의 작업이므로 엔드투엔드 로봇 실행 완료로 일반화할 수 없습니다.'),
      map('context', 'media-002', '기존 MES 고객·생산라인 기반은 잠재 수요 맥락이며 RX 유료 설치 고객 수가 아닙니다.'),
      map('context', 'media-003', '전사 투자 범위는 배경 정보이며 RX SW 예산·매출에 직접 귀속되지 않습니다.'),
    ],
  },
  {
    id: 'vertical', title: '삼성전자 중심 수직통합', anchor: 'se', status: 'analyst_hypothesis', analyst_mapping: true,
    summary: '삼성전자의 로봇 연구·제품·내부 제조 수요가 결합되는 수직통합 경로가 우세할 수 있다는 가설입니다.',
    next_check: '전자 RX·레인보우·SDS 사이의 공개 제품 책임과 공급 계약, 데이터·API 권한 및 외부 판매 조건을 확인합니다.',
    alternative: '전자 내부 통합과 SDS의 외부 플랫폼 사업은 동시에 존재할 수 있습니다.',
    limitations: ['소유 지분은 기술 책임·예산 권한·최종 결재선의 증거가 아닙니다.', '역할 비공개는 협력 부재의 증거가 아닙니다.'],
    mappings: [
      map('support', 'tech-018', '회계상 지분·종속기업 관계는 통합의 제도적 기반이 될 수 있으나 제품 통합 완료를 증명하지 않습니다.'),
      map('support', 'se-010', '전자 내부 RX 조직 신설 보도는 자사 로봇 사업 추진 역량 결집의 단서입니다.'),
      map('support', 'se-004', '내부 공장의 자율화 목표는 자체 제조 수요와 기술 개발의 연결 가능성을 보여줍니다.'),
      map('challenge', 'media-004', '고객별 공급 제품·적용 현장·용도 비공개 때문에 수직통합의 구체적 역할을 확정할 수 없습니다.'),
      map('challenge', 'se-015', '연구 발표에서 제시된 신뢰성의 미해결 과제는 산업용 통합이 이미 완성됐다는 해석을 약화합니다.'),
      map('context', 'tech-017', '레인보우 외부 하드웨어 계약은 수익 활동의 맥락입니다. 전자 내부 제품 책임이나 SDS SW 매출을 직접 입증하지 않습니다.'),
    ],
  },
  {
    id: 'distributed', title: '계열사별 분산 SI 병존', anchor: 'rainbow', status: 'analyst_hypothesis', analyst_mapping: true,
    summary: '계열사·고객별 요구에 따라 여러 SI·로봇 공급 생태계가 병존할 수 있다는 가설입니다.',
    next_check: '현장별 계약 주체·제품 버전·커스텀 코드와 공통 모듈 재사용 비율을 공개 문서로 확인합니다.',
    alternative: '여러 SI 파트너가 같은 공통 플랫폼 위에서 통합 서비스를 제공할 수 있습니다.',
    limitations: ['외부 SI의 존재만으로 그룹 공통 플랫폼의 부재를 주장하지 않습니다.', 'MOU·파트너 계약을 고객 현장 운영 실적으로 합산하지 않습니다.'],
    mappings: [
      map('support', 'se-012', '미국 공인 SI·서비스 계약은 복수 통합 사업자가 역할을 맡을 수 있다는 단서입니다.'),
      map('support', 'se-016', 'SFA의 자율제조 SW와 레인보우 기술 협력 구상은 다른 공급 경로가 병존할 가능성을 보여줍니다.'),
      map('support', 'mi-003', '현재 관측된 미라콤 RCS 제품 설명은 별도 구현 계층의 단서이지만 SDS와의 인터페이스 분리를 확정하지 않습니다.'),
      map('challenge', 'sds-004', '공통 오케스트레이션 추진 계획은 완전히 분리된 현장 SI만 존재한다는 강한 가설의 대안입니다.'),
      map('challenge', 'mi-001', 'MES와 오케스트레이션의 공식 연계 계획은 제품 간 공통 연결 가능성을 제시합니다.'),
      map('context', 'se-018', '삼성중공업의 별도 RX 활동은 법인별 제조 수요 맥락이며 삼성전자·SDS 내부 보고 관계를 증명하지 않습니다.'),
    ],
  },
];

export function hypothesisAssessments(date: string, mode: ResearchMode = 'known', options: ResearchTimeOptions = {}): HypothesisAssessment[] {
  const records = knowledgeRecordsAt(date, mode, options);
  return hypothesisDefinitions.map(({ mappings, anchor: _anchor, ...definition }) => {
    const result: HypothesisAssessment = { ...definition, support: [], challenge: [], context: [] };
    for (const mapping of mappings) {
      const found = findClaim(records, mapping.claim);
      if (!found) continue;
      result[mapping.role].push({
        id: `${definition.id}:${mapping.role}:${found.claim.id}`, source_id: found.source.id, source_ids: [found.source.id],
        claim_id: found.claim.id, claim_ids: [found.claim.id], text: found.claim.text,
        rationale: mapping.rationale, url: found.source.url, publisher: found.source.publisher, published_at: found.source.published_at,
        evidence_role: mapping.role, analyst_mapping: true, verification: found.source.verification,
      });
    }
    return result;
  });
}


/** Grouping only controls the fixed layout; it never creates an ownership or dependency edge. */
export function sourceCluster(record: ResearchRecord): KnowledgeCluster {
  if (record.source_type === 'paper' || record.source_type === 'patent' || ['se-006', 'tech-008', 'tech-009', 'tech-010'].includes(record.id)) return 'research';
  if (record.id.startsWith('x-eco-')) return 'robotics';
  if (record.id.startsWith('x-mf-') && record.entity_ids.includes('miracom')) return 'miracom';
  if (['media-004', 'se-011', 'se-012', 'se-016', 'se-020', 'tech-011', 'tech-012', 'tech-015', 'tech-016', 'tech-017'].includes(record.id)) return 'robotics';
  if (record.id.startsWith('sds-') || record.id.startsWith('x-sds-') || record.id.startsWith('media-')) return 'sds';
  if ((record.id.startsWith('mi-') || record.id.startsWith('x-mi-')) && !['mi-015', 'mi-016', 'mi-017', 'mi-018'].includes(record.id)) return 'miracom';
  return 'electronics';
}
const layoutSlots = new Map<string, { cluster: KnowledgeCluster; index: number; count: number }>();
for (const cluster of ['electronics', 'sds', 'miracom', 'robotics', 'research'] as const) {
  const sources = catalog.records.filter(record => sourceCluster(record) === cluster).sort((a, b) => a.id.localeCompare(b.id));
  sources.forEach((record, index) => layoutSlots.set(record.id, { cluster, index, count: sources.length }));
}
function documentPosition(source: ResearchRecord, layer: KnowledgeLayer, claimIndex = 0): Position {
  const slot = layoutSlots.get(source.id)!;
  return layerPosition(slot.cluster, layer, slot.index + claimIndex * .22, slot.count);
}
function claimStatus(source: ResearchRecord, claim?: ResearchClaim): KnowledgeStatus {
  if (source.scope === 'undated') return 'undated_current';
  if (claim?.kind === 'inference') return 'hypothesis';
  if (scheduledEventDate(source)) return 'planned';
  if (source.source_type === 'paper' || source.source_type === 'patent') return 'research';
  return 'reported';
}
function sourceText(source: ResearchRecord, claims: ResearchClaim[]) {
  return [source.title, source.summary_ko, ...claims.map(claim => claim.text)].join('\n');
}
function provenance(source: ResearchRecord, claims: ResearchClaim[]) {
  return {
    source_ids: [source.id], claim_ids: claims.map(claim => claim.id), published_at: source.published_at,
    event_date: source.event_date, observed_at: source.accessed_at, limitations: [...source.limitations],
  };
}

export function graphAt(date: string, mode: ResearchMode = 'known', options: ResearchTimeOptions = {}): KnowledgeGraph {
  const records = knowledgeRecordsAt(date, mode, options);
  const relations: KnowledgeRelation[] = [];
  const generated = new Map<string, KnowledgeNode>();
  const usableClaims = (source: ResearchRecord) => getRecordClaims(source).filter(claim => !claim.verification || permitsAttribution(claim.verification));
  const connect = (source: ResearchRecord, claims: ResearchClaim[], values: Pick<KnowledgeRelation, 'id' | 'from' | 'to' | 'type' | 'label' | 'rationale'> & Partial<KnowledgeRelation>) => {
    if (!claims.length) return;
    const inferred = values.inferred ?? false;
    relations.push({ ...provenance(source, claims), inferred, provenance: inferred ? 'analyst_mapping' : 'source_attributed', status: claimStatus(source, claims[0]), ...values });
  };

  // Curated predicate edges require the exact extracted assertion, not keyword co-occurrence.
  for (const definition of [...edgeDefinitions, ...(expansionData.relations as EdgeDefinition[])]) {
    const found = findClaim(records, definition.claim_id);
    if (!found) continue;
    const { claim_id, ...edgeData } = definition;
    connect(found.source, [found.claim], { ...edgeData, evidence_basis: 'extracted_claim', evidence_text: found.claim.text });
  }

  for (const source of records) {
    const claims = usableClaims(source);
    if (!claims.length) continue;
    const sourceId = `source:${source.id}`;
    const cluster = sourceCluster(source);
    const metadata = { ...provenance(source, claims), scheduled_event_date: scheduledEventDate(source), verification: source.verification, source_url: source.url, origin_key: source.origin_key };
    generated.set(sourceId, {
      id: sourceId, title: source.title, subtitle: `${source.publisher} · ${source.published_at ?? '게시일 미상'}`,
      kind: 'source', ontology_type: 'Source', layer: 'sources', cluster, aliases: [source.id, source.publisher, source.url],
      size: .085, position: documentPosition(source, 'sources'), description: source.summary_ko, ...metadata,
    });
    claims.forEach((claim, index) => {
      generated.set(claim.id, {
        id: claim.id, title: claim.text, subtitle: `추출 주장 · ${claim.kind}`, description: claim.text,
        kind: 'claim', ontology_type: 'Claim', layer: 'claims', cluster, aliases: [claim.id, claim.origin_record_id ?? source.id],
        size: .065, position: documentPosition(source, 'claims', index), ...metadata, claim_ids: [claim.id], verification: claim.verification ?? source.verification,
      });
      connect(source, [claim], {
        id: `documented:${claim.id}`, from: claim.id, to: sourceId, type: 'documented_by', label: '추출 주장 → 원출처',
        rationale: '이 주장을 추출한 문서로 연결합니다. 동일 문서에서 보존한 다른 주장과 독립 증거 수를 혼동하지 않습니다.',
        evidence_basis: 'extracted_claim', evidence_text: claim.text,
      });
      for (const definition of ontologyDefinitions) {
        const alias = matchedAlias(claim.text, definition.aliases);
        if (!alias) continue;
        connect(source, [claim], {
          id: `about:${claim.id}:${definition.id}`, from: claim.id, to: definition.id, type: 'about', label: '주장에 명시된 대상·키워드',
          rationale: `추출 주장에 “${alias}”가 직접 등장합니다. 대상 식별 연결이며 소유·의존·도입 관계를 추론하지 않습니다.`,
          evidence_basis: 'extracted_claim', matched_alias: alias, evidence_text: claim.text,
        });
      }
    });
    const text = sourceText(source, claims);
    for (const definition of ontologyDefinitions) {
      const alias = matchedAlias(text, definition.aliases);
      if (!alias) continue;
      const matchingText = text.split('\n').find(part => matchedAlias(part, [alias]))!;
      connect(source, claims, {
        id: `mentions:${source.id}:${definition.id}`, from: sourceId, to: definition.id, type: 'mentions', label: '문서에 등장하는 대상·키워드',
        rationale: `등록한 제목·요약·주장 텍스트에 “${alias}”가 등장합니다. 요약의 문장 단위 추적이며 원문 보존본·독립 검증을 뜻하지 않습니다.`,
        evidence_basis: 'catalog_text', matched_alias: alias, evidence_text: matchingText,
      });
    }
    if (source.source_type === 'patent') {
      const id = `patent:${source.id}`;
      const identifier = source.title.match(/(?:WO|US|EP)\d+[A-Z]\d?/)?.[0] ?? source.title;
      generated.set(id, {
        id, title: identifier, subtitle: '공개특허 · 상용화 입증 아님', description: source.summary_ko,
        kind: 'technology', ontology_type: 'Patent', layer: 'entities', cluster: 'research', aliases: [identifier],
        position: documentPosition(source, 'entities'), size: .105, ...metadata,
      });
      connect(source, claims, { id: `publication:${source.id}`, from: sourceId, to: id, type: 'describes_publication', label: '공개특허 문헌 식별', evidence_basis: 'source_metadata', evidence_text: source.title, rationale: '등록된 특허 문헌 식별자를 연결합니다. 특허 공개·기술 기재를 제품 채택·실행 의존성·상용화로 승격하지 않습니다.' });
      for (const claim of claims) connect(source, [claim], { id: `patent-about:${claim.id}`, from: claim.id, to: id, type: 'about', label: '공개특허 내용 추출', evidence_basis: 'extracted_claim', evidence_text: claim.text, rationale: '이 공개특허에서 추출한 주장을 해당 문헌에 연결합니다. 발명일·상용 서비스 개시일 또는 현장 성능을 추정하지 않습니다.' });
    }
  }

  // Same origin is a conservative lineage group, never a second independent confirmation.
  const groups = new Map<string, ResearchRecord[]>();
  for (const source of records.filter(source => usableClaims(source).length)) {
    const key = source.origin_key.trim() || source.url;
    groups.set(key, [...groups.get(key) ?? [], source]);
  }
  for (const [origin, members] of groups) {
    const ordered = [...members].sort((a, b) => (a.published_at ?? a.accessed_at).localeCompare(b.published_at ?? b.accessed_at) || a.id.localeCompare(b.id));
    for (const source of ordered.slice(1)) {
      const first = ordered[0];
      connect(source, usableClaims(source), {
        id: `lineage:${first.id}:${source.id}`, from: `source:${source.id}`, to: `source:${first.id}`, type: 'shares_source_group', label: '공통 사건·발언 출처군', inferred: true,
        source_ids: [source.id, first.id], claim_ids: [...usableClaims(source), ...usableClaims(first)].map(claim => claim.id), evidence_basis: 'analyst_mapping',
        rationale: `검토된 출처군 ${origin}을 공유합니다. 화살표는 탐색용 대표 자료 방향이며 재인용 경로·복제·독립 확증을 뜻하지 않습니다. ${source.lineage_review?.rationale ?? ''}`,
      });
    }
  }

  const connected = new Set(relations.flatMap(relation => [relation.from, relation.to]));
  for (const assessment of hypothesisAssessments(date, mode, options)) {
    const definition = hypothesisDefinitions.find(item => item.id === assessment.id)!;
    if (!assessment.support.length || !connected.has(definition.anchor)) continue;
    const sources = [...new Set(assessment.support.map(item => item.source_id))];
    const latestPublication = assessment.support.map(item => item.published_at).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
    const hypothesisRelation: KnowledgeRelation = {
      id: `hypothesis-${assessment.id}`, from: definition.anchor, to: assessment.id, type: 'supports',
      label: '분석가 가설 연결 · 지지 단서', source_ids: sources,
      claim_ids: [...new Set(assessment.support.map(item => item.claim_id))], inferred: true,
      provenance: 'analyst_mapping', status: 'hypothesis', rationale: assessment.support.map(item => item.rationale).join(' '),
      published_at: latestPublication, event_date: null, observed_at: catalog.meta.researched_at,
      limitations: assessment.limitations, evidence_basis: 'analyst_mapping',
    };
    relations.push(hypothesisRelation);
    for (const role of ['support', 'challenge', 'context'] as const) for (const evidence of assessment[role]) {
      const source = records.find(record => record.id === evidence.source_id)!;
      const claim = usableClaims(source).find(item => item.id === evidence.claim_id)!;
      connect(source, [claim], {
        id: `assessment:${assessment.id}:${role}:${claim.id}`, from: claim.id, to: assessment.id,
        type: role === 'support' ? 'supports' : role === 'challenge' ? 'contradicts' : 'provides_context',
        label: role === 'support' ? '가설 지지 해석' : role === 'challenge' ? '강한 가설 해석에 도전' : '가설의 배경 맥락',
        inferred: true, status: 'hypothesis', evidence_basis: 'analyst_mapping', evidence_text: claim.text, rationale: evidence.rationale,
      });
    }
    const entity = ontologyDefinitions.find(item => item.id === assessment.id)!;
    const questionId = `question:${assessment.id}`;
    generated.set(questionId, {
      id: questionId, title: assessment.id === 'platform' ? '공통 API·지원 기종·반복 배포는?' : assessment.id === 'vertical' ? '전자·SDS 제품 책임 경계는?' : '공통 모듈과 현장 SI의 경계는?',
      description: assessment.next_check, subtitle: '분석가 확인 질문', kind: 'question', ontology_type: 'Question',
      layer: 'entities', cluster: entity.cluster, aliases: [], position: [entity.position[0], entity.position[1] + .55, entity.position[2] + .55], size: .09,
      source_ids: sources, claim_ids: hypothesisRelation.claim_ids,
    });
    relations.push({ ...hypothesisRelation, id: `question-link:${assessment.id}`, from: assessment.id, to: questionId, type: 'raises_question', label: '다음 확인 질문', rationale: assessment.next_check });
  }
  const referenced = new Set(relations.flatMap(relation => [relation.from, relation.to]));
  const definitions: Omit<KnowledgeNode, 'source_ids' | 'claim_ids'>[] = ontologyDefinitions.filter(item => referenced.has(item.id));
  const nodes: KnowledgeNode[] = definitions.map(item => {
    const incident = relations.filter(relation => relation.from === item.id || relation.to === item.id);
    return { ...item, source_ids: [...new Set(incident.flatMap(relation => relation.source_ids))], claim_ids: [...new Set(incident.flatMap(relation => relation.claim_ids))] };
  });
  nodes.push(...generated.values());
  return { nodes, relations };
}
