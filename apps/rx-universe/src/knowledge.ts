import { catalog, getRecordClaims, RESEARCH_MAX_DATE, researchAt, type ResearchMode, type ResearchRecord, type ResearchVerification } from './research';

/** Every factual-looking edge is a source-attributed statement, not an independent audit. */
export type KnowledgeKind = 'organization' | 'technology' | 'hypothesis' | 'evidence';
export type KnowledgeStatus = 'reported' | 'planned' | 'research' | 'hypothesis' | 'undated_current';
export interface KnowledgeNode {
  id: string; title: string; subtitle?: string; kind: KnowledgeKind;
  position: [number, number, number]; size: number; description: string;
  ontology_type: 'Company' | 'Organization' | 'Product' | 'Project' | 'Contract' | 'Technology' | 'Hypothesis';
  source_ids: string[]; claim_ids: string[];
}
export interface KnowledgeRelation {
  id: string; from: string; to: string; type: string; label: string;
  claim_ids: string[]; source_ids: string[]; inferred: boolean; rationale: string;
  provenance: 'source_attributed' | 'analyst_mapping'; status: KnowledgeStatus;
  /** Source publication is not necessarily the occurrence date of the assertion. */
  published_at: string | null; event_date: string | null; observed_at: string;
  limitations: string[];
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

type NodeDefinition = Omit<KnowledgeNode, 'source_ids' | 'claim_ids'>;
const node = (id: string, title: string, ontology_type: KnowledgeNode['ontology_type'], position: KnowledgeNode['position'], description: string, subtitle?: string): NodeDefinition => ({
  id, title, ontology_type, position, description, subtitle,
  kind: ontology_type === 'Hypothesis' ? 'hypothesis' : ['Company', 'Organization'].includes(ontology_type) ? 'organization' : 'technology',
  size: ['se', 'sds', 'miracom'].includes(id) ? .21 : ontology_type === 'Company' ? .14 : .095,
});

/** Stable coordinates and generic descriptions do not encode facts from later sources. */
const nodeDefinitions: NodeDefinition[] = [
  node('se', 'SAMSUNG ELECTRONICS', 'Company', [-4.4, 1.1, .2], '삼성전자. 삼성SDS와 별도 법인이며 연결된 자료별 주장과 시점을 확인합니다.', '삼성전자 · 출처별 관계'),
  node('sds', 'SAMSUNG SDS', 'Company', [0, 1.1, .4], '삼성SDS. 오케스트레이션 사업의 계획·실증·제품문서를 구분합니다.', '삼성SDS · 출처별 관계'),
  node('miracom', 'MIRACOM', 'Company', [4.3, .7, .1], '미라콤아이앤씨. 제조 SW 설명과 향후 로봇 연계 계획은 별개 근거로 표시합니다.', '미라콤 · 제조 소프트웨어'),
  node('rainbow', 'RAINBOW ROBOTICS', 'Company', [-3.8, -1.1, .6], '레인보우로보틱스. 지분 관계, 로봇 제품, 외부 계약을 구분합니다.', '레인보우로보틱스'),
  node('nvidia', 'NVIDIA', 'Company', [-5.7, 2.6, -.8], '삼성전자와의 기술 협력 당사자. 당사자 발표는 독립 현장 검증과 구별됩니다.'),
  node('se-rx', '전자 RX사업추진실', 'Organization', [-5.7, .1, -.6], '삼성전자 RX 조직에 관한 공개 보도를 연결합니다. SDS RX와 합치지 않습니다.'),
  node('ai-megafactory', 'AI Megafactory 계획', 'Project', [-3.1, 2.7, -.3], 'AI 제조 인프라 계획. GPU·전사 투자액을 RX SW 예산으로 변환하지 않습니다.'),
  node('ai-factory-2030', 'AI 자율공장 · 2030 목표', 'Project', [-5.4, -1.5, -1], '2030년 전환 목표와 실제 완료 실적을 구분하는 프로젝트입니다.'),
  node('gumi-robot-line', '구미 휴머노이드 라인 계획', 'Project', [-3.9, -.1, -1.2], '삼성전자 구미 휴머노이드 양산 라인 계획. 준공·운영 완료를 뜻하지 않습니다.'),
  node('gumi-data-center', '구미 AI 데이터센터 계획', 'Project', [-1.9, .1, -1], '삼성SDS의 AI 데이터센터 계획. RX 전용 SW 상품 또는 매출로 분류하지 않습니다.'),
  node('walden', 'WALDEN ROBOTICS', 'Company', [1.7, 2.8, -.9], '삼성SDS의 전략적 투자 관련 공개자료에 등장하는 로봇 기업입니다.'),
  node('orchestrator', 'Robot Orchestration', 'Product', [1.9, 1.2, -.2], '로봇 오케스트레이션 사업과 출시 계획. 그룹 공통 API가 확정되었다는 주장이 아닙니다.'),
  node('mes', 'MES 연계', 'Technology', [2.3, -.4, .8], '제조 실행 시스템과 로봇의 연계 구상. 공통 API·지원 기종 규격은 별도 검증 대상입니다.'),
  node('affiliate-poc', '관계사 RX 실증', 'Project', [.3, -.8, .2], '관계사 현장 실증. 유료 상시 생산 운영과 RX 반복매출로 해석하지 않습니다.'),
  node('rcs', 'Miracom RCS', 'Product', [5.7, 1.9, -.7], '미라콤 제조 로보틱스 제품문서의 로봇 작업·상태 관제 설명. 게시일은 미상입니다.'),
  node('mcs', 'Nexplant MCS', 'Product', [3.5, 2.7, -.2], '미라콤 문서에 삼성SDS 솔루션으로 표기된 물류제어 제품. 신규 RX 공통 API와 구분합니다.'),
  node('mesplus', 'Nexplant MESplus', 'Product', [5.7, -.7, -.6], '미라콤의 MES 제품 설명. Open API 표기가 그룹 공통 로봇 API를 의미하지 않습니다.'),
  node('nexphere', 'Nexphere AI', 'Product', [4.6, -2, .3], '미라콤 기고문이 설명하는 제조 AI 제품 구성. 독립 성능 검증 자료는 아닙니다.'),
  node('ax-rx-pilot', '제조 AX·RX 실증 사업', 'Project', [3.2, -3.1, -.8], '제조기업 현장 실증 추진 사업. 착수·예정과 구축 완료를 분리합니다.'),
  node('kai', 'KAI', 'Company', [-5.6, -3.1, .4], 'KF-21 공정 자동화 로봇 장비 계약의 상대방입니다.'),
  node('kai-drilling-contract', 'KF-21 로봇 드릴링 계약', 'Contract', [-3.8, -2.8, -.2], '2024년 원계약의 공시상 진행 현황. 장비 납품·기능시험·대금수령과 잔여 시스템 검증을 구분합니다.'),
  node('etech', 'E TECH GROUP', 'Company', [-2.2, -1.5, -.6], '미국 로봇 시스템 통합·설치·서비스 계약 당사자. 특정 고객 유료 배포와 구분합니다.'),
  node('sfa', 'SFA', 'Company', [-1.3, -2.9, .4], '레인보우와 자율제조 공동 R&D·영업 협력 MOU가 보도된 기업입니다.'),
  node('rbq', 'RBQ 로봇 시리즈', 'Product', [-5.9, -.7, .9], '레인보우 공식 설명의 사족보행 로봇 제품군. 제조 현장 장기 운영 KPI는 별도 확인 대상입니다.'),
  node('dam-vla', 'DAM-VLA 연구', 'Technology', [-1.9, 2.9, 1], '삼성 소속 연구진의 VLA 연구. 실험 결과를 산업 생산 성공률로 일반화하지 않습니다.'),
  node('h-vla', 'H-VLA 연구', 'Technology', [-2.2, 1.5, 1.4], '삼성 소속 연구진의 계층형 로봇 조작 연구. 제품 배포를 입증하지 않습니다.'),
  node('platform', 'H1 · SDS 공통 플랫폼', 'Hypothesis', [.2, 3.4, 1], '분석가 가설. 공개자료와의 지지·도전 연결은 해석이며 사실 확정이나 성공 확률이 아닙니다.'),
  node('vertical', 'H2 · 삼성전자 수직통합', 'Hypothesis', [-4.3, 3.6, 1], '분석가 가설. 소유 관계만으로 제품 책임·그룹 표준권을 단정하지 않습니다.'),
  node('distributed', 'H3 · 분산 SI 병존', 'Hypothesis', [1.1, -3, 1], '분석가 가설. 여러 공급사의 존재만으로 공통 플랫폼 부재를 단정하지 않습니다.'),
];

interface EdgeDefinition { id: string; from: string; to: string; type: string; label: string; claim_id: string; status: KnowledgeStatus; rationale: string }
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
];

const currentProductIds = new Set(['mi-003', 'mi-004', 'mi-005']);
function validDate(date: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}
/** Undated product descriptions are current observations, never historical disclosures. */
export function knowledgeRecordsAt(date: string, mode: ResearchMode = 'known'): ResearchRecord[] {
  if (!validDate(date) || !['known', 'retro', 'as-known-at', 'retrospective'].includes(mode)) return [];
  const dated = researchAt(date, mode).filter(record => record.verification === 'primary_read');
  if (date < RESEARCH_MAX_DATE) return dated;
  const current = catalog.records.filter(record => currentProductIds.has(record.id) && record.scope === 'undated' && record.verification === 'primary_read' && record.accessed_at <= date);
  return [...dated, ...current];
}
function findClaim(records: readonly ResearchRecord[], claimId: string) {
  for (const source of records) {
    const claim = getRecordClaims(source).find(item => item.id === claimId);
    if (claim && (!claim.verification || claim.verification === 'primary_read')) return { source, claim };
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

export function hypothesisAssessments(date: string, mode: ResearchMode = 'known'): HypothesisAssessment[] {
  const records = knowledgeRecordsAt(date, mode);
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

export function graphAt(date: string, mode: ResearchMode = 'known'): KnowledgeGraph {
  const records = knowledgeRecordsAt(date, mode);
  const relations: KnowledgeRelation[] = [];
  for (const definition of edgeDefinitions) {
    const found = findClaim(records, definition.claim_id);
    if (!found) continue;
    const { claim_id, ...edgeData } = definition;
    relations.push({
      ...edgeData, source_ids: [found.source.id], claim_ids: [claim_id], inferred: false,
      provenance: 'source_attributed', published_at: found.source.published_at,
      event_date: found.source.event_date, observed_at: found.source.accessed_at,
      limitations: [...found.source.limitations],
    });
  }
  // Graph hypothesis links use only the listed supporting claims; the War Room
  // separately exposes challenge and context, without a score or probability.
  const connected = new Set(relations.flatMap(relation => [relation.from, relation.to]));
  for (const assessment of hypothesisAssessments(date, mode)) {
    const definition = hypothesisDefinitions.find(item => item.id === assessment.id)!;
    if (!assessment.support.length || !connected.has(definition.anchor)) continue;
    const sources = [...new Set(assessment.support.map(item => item.source_id))];
    const latestPublication = assessment.support.map(item => item.published_at).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
    relations.push({
      id: `hypothesis-${assessment.id}`, from: definition.anchor, to: assessment.id, type: 'supports',
      label: '분석가 가설 연결 · 지지 단서', source_ids: sources,
      claim_ids: [...new Set(assessment.support.map(item => item.claim_id))], inferred: true,
      provenance: 'analyst_mapping', status: 'hypothesis', rationale: assessment.support.map(item => item.rationale).join(' '),
      published_at: latestPublication, event_date: null, observed_at: catalog.meta.researched_at,
      limitations: assessment.limitations,
    });
  }
  const referenced = new Set(relations.flatMap(relation => [relation.from, relation.to]));
  const nodes: KnowledgeNode[] = nodeDefinitions.filter(item => referenced.has(item.id)).map(item => {
    const incident = relations.filter(relation => relation.from === item.id || relation.to === item.id);
    return { ...item, source_ids: [...new Set(incident.flatMap(relation => relation.source_ids))], claim_ids: [...new Set(incident.flatMap(relation => relation.claim_ids))] };
  });
  return { nodes, relations };
}
