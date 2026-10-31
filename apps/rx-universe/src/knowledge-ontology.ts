/** Reviewed names from the existing source inventory; aliases identify text, not business dependencies. */
export type KnowledgeKind = 'company' | 'organization' | 'technology' | 'product' | 'factory' | 'project' | 'contract' | 'claim' | 'source' | 'event' | 'hypothesis' | 'question' | 'evidence';
export type OntologyType = 'Company' | 'Organization' | 'Product' | 'Robot' | 'Technology' | 'Factory' | 'Project' | 'Contract' | 'Claim' | 'Source' | 'Event' | 'Hypothesis' | 'Question' | 'Paper' | 'Patent' | 'Keyword';
export type KnowledgeLayer = 'entities' | 'claims' | 'sources';
export type KnowledgeCluster = 'electronics' | 'sds' | 'miracom' | 'robotics' | 'research';
export type Position = [number, number, number];
export interface OntologyDefinition {
  id: string; title: string; subtitle?: string; kind: KnowledgeKind; ontology_type: OntologyType;
  position: Position; size: number; description: string;
  layer: KnowledgeLayer; cluster: KnowledgeCluster; aliases: string[];
}
export const CLUSTER_CENTERS: Record<KnowledgeCluster, Position> = {
  electronics: [-10.4, 3.7, 0], sds: [0, 3.7, 0], miracom: [10.4, 3.7, 0],
  robotics: [-5.5, -7.6, 0], research: [5.5, -7.6, 0],
};
export const CLUSTER_LABELS: Record<KnowledgeCluster, string> = {
  electronics: '삼성전자 · 제조 전략', sds: '삼성SDS · 오케스트레이션', miracom: '미라콤 · 제조 SW',
  robotics: '로봇 · 파트너 생태계', research: '연구 · 기술 · 특허',
};
export function kindFor(type: OntologyType): KnowledgeKind {
  const special: Partial<Record<OntologyType, KnowledgeKind>> = { Company: 'company', Organization: 'organization', Product: 'product', Robot: 'product', Factory: 'factory', Project: 'project', Contract: 'contract', Claim: 'claim', Source: 'source', Event: 'event', Hypothesis: 'hypothesis', Question: 'question' };
  return special[type] ?? 'technology';
}
const legacyAliases: Record<string, string[]> = {
  se: ['삼성전자', 'Samsung Electronics'], sds: ['삼성SDS', '삼성 SDS', 'Samsung SDS'], miracom: ['미라콤', 'Miracom'],
  rainbow: ['레인보우로보틱스', '레인보우', 'Rainbow Robotics'], nvidia: ['NVIDIA', '엔비디아'], 'se-rx': ['RX사업추진실', 'RX 사업추진실'],
  'ai-megafactory': ['AI 메가팩토리', 'AI Megafactory'], 'ai-factory-2030': ['AI 자율공장'],
  'gumi-robot-line': ['구미 휴머노이드 양산', '구미 삼성전자 피지컬AI'], 'gumi-data-center': ['구미 AI 데이터센터'],
  walden: ['Walden', '월든'], orchestrator: ['로봇 오케스트레이션', 'Robot Orchestration', '오케스트레이션 플랫폼'],
  mes: ['MES', '제조 실행 시스템', '제조실행시스템'], 'affiliate-poc': ['관계사 현장', '계열사 현장', '관계사 실증'],
  rcs: ['RCS'], mcs: ['Nexplant MCS', 'MCS'], mesplus: ['MESplus', 'MES plus'], nexphere: ['Nexphere AI', 'Nexphere'],
  'ax-rx-pilot': ['상생형 AX', 'AX·RX 현장 실증'], kai: ['KAI', '한국항공우주산업'],
  'kai-drilling-contract': ['KF-21'], etech: ['E Tech Group'], sfa: ['SFA'], rbq: ['RBQ'],
  'dam-vla': ['DAM-VLA'], 'h-vla': ['H-VLA'], platform: [], vertical: [], distributed: [],
};
const clusterOverrides: Record<string, KnowledgeCluster> = {
  se: 'electronics', nvidia: 'electronics', 'se-rx': 'electronics', 'ai-megafactory': 'electronics', 'ai-factory-2030': 'electronics', 'gumi-robot-line': 'electronics', vertical: 'electronics',
  sds: 'sds', walden: 'sds', orchestrator: 'sds', 'affiliate-poc': 'sds', 'gumi-data-center': 'sds', platform: 'sds',
  miracom: 'miracom', mes: 'miracom', rcs: 'miracom', mcs: 'miracom', mesplus: 'miracom', nexphere: 'miracom', 'ax-rx-pilot': 'miracom',
  rainbow: 'robotics', kai: 'robotics', 'kai-drilling-contract': 'robotics', etech: 'robotics', sfa: 'robotics', rbq: 'robotics', distributed: 'robotics',
  'dam-vla': 'research', 'h-vla': 'research',
};
/** Static identity labels must not encode functionality learned from later documents. */
export const identityDescription = (title: string, type: OntologyType) =>
  `${title} · ${type} 식별 항목입니다. 기능·역할·계약·계획은 선택한 날짜의 연결 주장과 출처에서 확인합니다.`;
const node = (id: string, title: string, ontology_type: OntologyType, subtitle?: string): OntologyDefinition => ({
  id, title, ontology_type, position: [0, 0, 0], description: identityDescription(title, ontology_type), subtitle, kind: kindFor(ontology_type),
  layer: 'entities', cluster: clusterOverrides[id] ?? 'research', aliases: legacyAliases[id] ?? [title],
  size: ['se', 'sds', 'miracom'].includes(id) ? .25 : ontology_type === 'Company' ? .16 : .11,
});
const legacyDefinitions: OntologyDefinition[] = [
  node('se', 'SAMSUNG ELECTRONICS', 'Company', '삼성전자'),
  node('sds', 'SAMSUNG SDS', 'Company', '삼성SDS'),
  node('miracom', 'MIRACOM', 'Company', '미라콤아이앤씨'),
  node('rainbow', 'RAINBOW ROBOTICS', 'Company', '레인보우로보틱스'),
  node('nvidia', 'NVIDIA', 'Company'),
  node('se-rx', '전자 RX사업추진실', 'Organization'),
  node('ai-megafactory', 'AI Megafactory', 'Project'),
  node('ai-factory-2030', 'AI 자율공장', 'Project'),
  node('gumi-robot-line', '구미 휴머노이드 라인', 'Project'),
  node('gumi-data-center', '구미 AI 데이터센터', 'Project'),
  node('walden', 'WALDEN ROBOTICS', 'Company'),
  node('orchestrator', 'Robot Orchestration', 'Product'),
  node('mes', 'MES', 'Technology'),
  node('affiliate-poc', '관계사 RX 실증', 'Project'),
  node('rcs', 'Miracom RCS', 'Product'),
  node('mcs', 'Nexplant MCS', 'Product'),
  node('mesplus', 'Nexplant MESplus', 'Product'),
  node('nexphere', 'Nexphere AI', 'Product'),
  node('ax-rx-pilot', '제조 AX·RX 실증 사업', 'Project'),
  node('kai', 'KAI', 'Company'),
  node('kai-drilling-contract', 'KF-21 로봇 드릴링 계약', 'Contract'),
  node('etech', 'E TECH GROUP', 'Company'),
  node('sfa', 'SFA', 'Company'),
  node('rbq', 'RBQ 로봇 시리즈', 'Product'),
  node('dam-vla', 'DAM-VLA 연구', 'Paper'),
  node('h-vla', 'H-VLA 연구', 'Paper'),
  node('platform', 'H1 · SDS 공통 플랫폼', 'Hypothesis'),
  node('vertical', 'H2 · 삼성전자 수직통합', 'Hypothesis'),
  node('distributed', 'H3 · 분산 SI 병존', 'Hypothesis'),
];

interface Term { id: string; title: string; type: OntologyType; cluster: KnowledgeCluster; aliases: string[] }
const term = (id: string, title: string, type: OntologyType, cluster: KnowledgeCluster, ...aliases: string[]): Term => ({ id, title, type, cluster, aliases });
/** Literal, bounded phrases reviewed against catalog titles, summaries and extracted claims. */
export const ONTOLOGY_TERMS: Term[] = [
  term('manufacturing-logistics-robots', "제조·물류 로봇 작업·상태", 'Technology', 'miracom', "제조·물류 로봇 작업·상태"),
  term('greencos-mes-project', "그린코스 3공장 MES 구축 프로젝트", 'Project', 'miracom', "그린코스 3공장 MES 구축 프로젝트"),
  term('korea-iron-digital-factory', "한국철강 디지털팩토리 프로젝트", 'Project', 'miracom', "한국철강 디지털팩토리 프로젝트"),
  term('hwanyoung-digital-factory', "환영철강 디지털팩토리 프로젝트", 'Project', 'miracom', "환영철강 디지털팩토리 프로젝트"),
  term('samsung-commercial-displays', "삼성전자 디스플레이 제품", 'Product', 'electronics', "삼성전자 디스플레이 제품"),
  term('kuka-showroom-installation', "KUKA 쇼룸 로봇·디스플레이 설치 사례", 'Project', 'robotics', "KUKA 쇼룸 로봇·디스플레이 설치 사례", 'KUKA 쇼룸', 'KUKA 아우크스부르크'),
  term('sdi', '삼성SDI', 'Company', 'electronics', '삼성SDI', '삼성 SDI'),
  term('semco', '삼성전기', 'Company', 'electronics', '삼성전기'),
  term('samsung-display', '삼성디스플레이', 'Company', 'electronics', '삼성디스플레이', '삼성D'),
  term('shi', '삼성중공업', 'Company', 'electronics', '삼성중공업'),
  term('samsung-ea', '삼성E&A', 'Company', 'electronics', '삼성E&A'),
  term('semes', '세메스', 'Company', 'electronics', '세메스', 'SEMES'),
  term('samsung-venture', '삼성벤처투자', 'Company', 'sds', '삼성벤처투자'),
  term('sra', 'Samsung Research America', 'Organization', 'research', 'Samsung Research America', 'SRA'),
  term('src-beijing', '삼성 베이징 연구소', 'Organization', 'research', 'SRC-Beijing', '삼성 중국 베이징 연구소', '삼성 중국 베이징 연구진'),
  term('ds-ai-center', 'DS AI Center', 'Organization', 'research', 'DS AI Center'),
  term('ds-ax-pi', 'DS AX/PI센터', 'Organization', 'electronics', 'DS AX/PI센터'),
  term('sds-america', 'Samsung SDS America', 'Organization', 'sds', '삼성SDS America', 'Samsung SDS America'),
  term('shi-rx', '삼성중공업 RX센터', 'Organization', 'electronics', '삼성중공업 RX센터', '삼성중공업 항목은 RX센터'),
  term('rainbow-us', '레인보우 미국법인', 'Organization', 'robotics', '레인보우로보틱스 미국법인', '레인보우 미국법인', 'RAINBOW ROBOTICS USA'),
  term('team-rex', 'Team REX', 'Organization', 'sds', 'Team REX', '팀 REX'),
  term('roboforce', 'RoboForce', 'Company', 'robotics', 'RoboForce'),
  term('genesis-ai', 'Genesis AI', 'Company', 'robotics', 'Genesis AI'),
  term('airobot', 'AiRobot · 에이로봇', 'Company', 'robotics', 'AiRobot', '에이로봇'),
  term('holiday-robotics', 'Holiday Robotics', 'Company', 'robotics', 'Holiday Robotics'),
  term('wuji', 'Wuji', 'Company', 'robotics', 'Wuji'),
  term('real-world', 'Real World', 'Company', 'robotics', 'Real World'),
  term('config-intelligence', 'Config Intelligence', 'Company', 'robotics', 'Config Intelligence'),
  term('ndot-light', 'Ndot Light', 'Company', 'robotics', 'Ndot Light'),
  term('kuka', 'KUKA', 'Company', 'robotics', 'KUKA'),
  term('kkr', 'KKR', 'Company', 'sds', 'KKR'),
  term('kt', 'KT', 'Company', 'electronics', 'KT'),
  term('sktelecom', 'SK Telecom', 'Company', 'electronics', 'SK Telecom', 'SKT'),
  term('greencos', '그린코스', 'Company', 'miracom', '그린코스'),
  term('korea-iron', '한국철강', 'Company', 'miracom', '한국철강'),
  term('hwanyoung-steel', '환영철강', 'Company', 'miracom', '환영철강'),
  term('chemtopia', '켐토피아', 'Company', 'miracom', '켐토피아'),
  term('soulbrain', '솔브레인', 'Company', 'miracom', '솔브레인'),
  term('hana-micron', '하나마이크론', 'Company', 'miracom', '하나마이크론'),
  term('magnachip', '매그나칩반도체', 'Company', 'miracom', '매그나칩반도체'),
  term('kumho-tire', '금호타이어', 'Company', 'miracom', '금호타이어'),
  term('eugene-robot', '유진로봇', 'Company', 'robotics', '유진로봇'),
  term('staubli', '스토브리', 'Company', 'robotics', '스토브리'),
  term('printpia', '프린피아', 'Company', 'miracom', '프린피아'),
  term('turbolink', '터보링크', 'Company', 'miracom', '터보링크'),
  term('greencos-gimpo3', '그린코스 3공장', 'Factory', 'miracom', '그린코스 3공장', '그린코스 김포 3공장'),
  term('korea-iron-changwon', '한국철강 창원공장', 'Factory', 'miracom', '한국철강 창원공장'),
  term('hwanyoung-dangjin', '환영철강 당진공장', 'Factory', 'miracom', '환영철강 당진공장'),
  term('semco-mexico', '삼성전기 멕시코 공장', 'Factory', 'electronics', '멕시코 공장'),
  term('geoje-shipyard', '거제 자율형 조선소', 'Project', 'electronics', '거제 자율형 조선소'),
  term('gumi-data-factory', '구미 로봇 데이터 팩토리', 'Project', 'electronics', '구미 로봇 데이터 팩토리', '구미 데이터 팩토리'),
  term('omniverse', 'NVIDIA Omniverse', 'Product', 'electronics', 'Omniverse'),
  term('isaac-sim', 'NVIDIA Isaac Sim', 'Product', 'research', 'Isaac Sim'),
  term('cosmos', 'NVIDIA Cosmos', 'Product', 'research', 'Cosmos'),
  term('jetson-thor', 'NVIDIA Jetson Thor', 'Product', 'electronics', 'Jetson Thor'),
  term('rb-y1', 'RB-Y1', 'Robot', 'robotics', 'RB-Y1'),
  term('rby', 'RBY 제품군', 'Robot', 'robotics', 'RBY'),
  term('rb-cobot', 'RB 협동로봇', 'Robot', 'robotics', 'RB 협동로봇', 'RBC'),
  term('rbm', 'RBM AMR', 'Robot', 'robotics', 'RBM'),
  term('solid-state-battery', '로봇용 전고체 배터리', 'Product', 'electronics', '전고체 배터리', '전고체 셀'),
  term('humanoid-camera-module', '휴머노이드 카메라 모듈', 'Product', 'electronics', '휴머노이드 카메라 모듈', '휴머노이드용 카메라 모듈'),
  term('humanoid-oled', '휴머노이드용 OLED', 'Product', 'electronics', '휴머노이드용 OLED', '휴머노이드용 디스플레이'),
  term('nexphere-platform', 'Nexphere Platform', 'Product', 'miracom', 'Nexphere Platform'),
  term('nexphere-analytics', 'Nexphere Analytics', 'Product', 'miracom', 'Nexphere Analytics'),
  term('nexphere-chat', 'Nexphere Chat', 'Product', 'miracom', 'Nexphere Chat'),
  term('open-api', 'Open API', 'Technology', 'miracom', 'Open API'),
  term('intelligence', '인텔리전스 영역', 'Technology', 'sds', '인텔리전스'),
  term('fleet', '플릿 영역', 'Technology', 'sds', '플릿'),
  term('physical-ai', 'Physical AI', 'Keyword', 'research', 'Physical AI', '피지컬 AI', '피지컬AI'),
  term('vla', 'Vision-Language-Action', 'Technology', 'research', 'VLA', 'Vision-Language-Action'),
  term('vlm', 'Vision-Language Model', 'Technology', 'research', 'VLM'),
  term('world-model', '월드 모델', 'Technology', 'research', '월드 모델', '월드모델', 'world model'),
  term('robot-foundation-model', '로봇 파운데이션 모델', 'Technology', 'research', '로봇 파운데이션 모델', '로봇 기반 모델'),
  term('digital-twin', '디지털 트윈', 'Technology', 'electronics', '디지털 트윈', 'digital twin'),
  term('ai-agent', 'AI Agent', 'Technology', 'miracom', 'AI Agent', 'AI 에이전트'),
  term('humanoid', '휴머노이드', 'Keyword', 'robotics', '휴머노이드', 'humanoid'),
  term('amr', 'AMR · 자율주행 운반로봇', 'Technology', 'robotics', 'AMR', '자율주행 운반로봇'),
  term('cobot', '협동로봇', 'Technology', 'robotics', '협동로봇'),
  term('robot-manipulation', '로봇 조작', 'Technology', 'research', '로봇 조작', '정밀 조작', 'Robot Manipulation'),
  term('skill-learning', '스킬 러닝', 'Technology', 'research', '스킬 러닝', 'Skill Learning'),
  term('reinforcement-learning', '강화학습', 'Technology', 'research', '강화학습'),
  term('teleoperation', '원격조작', 'Technology', 'research', '원격조작'),
  term('motion-planning', '동작 생성 · 경로 계획', 'Technology', 'research', '동작 생성', 'Motion Planning', '경유점'),
  term('fault-recovery', '오류 복구', 'Technology', 'research', '실패 복구', '오류 유형', '오류 후', '장애 대응'),
  term('robot-safety', '로봇 안전', 'Keyword', 'research', '안전 제약', '신뢰성·안전', '비용·안전'),
  term('knowledge-graph', '지식 그래프', 'Technology', 'research', '지식 그래프'),
  term('edge-inference', '엣지·로컬 추론', 'Technology', 'sds', '엣지', '로컬 추론'),
  term('cloud', '클라우드', 'Technology', 'sds', '클라우드'),
  term('erp', 'ERP', 'Technology', 'miracom', 'ERP'),
  term('pdm', 'PDM', 'Technology', 'miracom', 'PDM'),
  term('scada', 'SCADA', 'Technology', 'miracom', 'SCADA'),
  term('fems', 'FEMS', 'Technology', 'miracom', 'FEMS'),
  term('ai-ran', 'AI RAN', 'Technology', 'electronics', 'AI RAN'),
  term('welding-painting-automation', '용접·도장 자동화', 'Technology', 'electronics', '용접·도장 자동화'),
  term('sim-to-real', '시뮬레이션·실제 로봇 실험', 'Keyword', 'research', '시뮬레이션 및 실제', '가상·실제 로봇'),
  term('simpler-env', 'SIMPLER · SimplerEnv', 'Technology', 'research', 'SIMPLER', 'SimplerEnv'),
  term('furniture-bench', 'FurnitureBench', 'Technology', 'research', 'FurnitureBench'),
  term('agilex', 'Agilex', 'Product', 'research', 'Agilex'),
  term('real-summit-2026', 'REAL Summit 2026', 'Event', 'sds', 'REAL Summit 2026', '리얼 서밋'),
  term('rx-art-2026', 'RX ART 2026', 'Event', 'sds', 'RX ART 2026'),
  term('ai-festa-2026', 'AI FESTA 26', 'Event', 'sds', 'AI FESTA 26', 'AI FESTA 2026', '인공지능 페스타 2026'),
  term('ai-forum-2026', '삼성 AI 포럼 2026', 'Event', 'electronics', 'AI 포럼 2026', 'AI Forum2026', 'AI Forum 2026'),
  term('stc-2025', 'Samsung Tech Conference 2025', 'Event', 'electronics', 'STC2025', '삼성 테크 콘퍼런스 2025'),
  term('mwc-2026', 'MWC 2026', 'Event', 'electronics', 'MWC2026', 'MWC 2026'),
  term('automate-2026', 'Automate 2026', 'Event', 'robotics', 'Automate2026', 'Automate 2026'),
  term('interbattery-2026', '인터배터리 2026', 'Event', 'electronics', '인터배터리 2026'),
  term('smartbiz-expo-2026', '스마트비즈엑스포 2026', 'Event', 'miracom', '스마트비즈엑스포'),
  term('aw-webinar', 'AW 2026 물류 웨비나', 'Event', 'miracom', '웨비나', '베스트 솔루션 데이'),
  term('start-2026', '2026 START 연구 공모', 'Project', 'research', '2026 START'),
];

const extraDefinitions: OntologyDefinition[] = ONTOLOGY_TERMS.map(item => ({
  id: item.id, title: item.title, ontology_type: item.type, kind: kindFor(item.type),
  cluster: item.cluster, layer: 'entities', aliases: item.aliases, position: [0, 0, 0],
  size: item.type === 'Company' ? .14 : item.type === 'Keyword' ? .085 : .105,
  description: identityDescription(item.title, item.type),
}));

/** Fixed inventories determine slots, so changing a date never moves a surviving node. */
export function layerPosition(cluster: KnowledgeCluster, layer: KnowledgeLayer, index: number, count: number): Position {
  const center = CLUSTER_CENTERS[cluster];
  const angle = (index / Math.max(1, count)) * Math.PI * 2 + (layer === 'entities' ? .31 : 0);
  const radius = layer === 'sources' ? 4.7 : layer === 'claims' ? 3.65 : 2.2 + (index % 3) * .28;
  const z = (layer === 'sources' ? -1.6 : layer === 'claims' ? 1.45 : 0) + Math.sin(index * 2.399) * .65;
  return [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius * .86, z].map(value => Number(value.toFixed(4))) as Position;
}
export const ontologyDefinitions: OntologyDefinition[] = [...legacyDefinitions, ...extraDefinitions];
for (const cluster of Object.keys(CLUSTER_CENTERS) as KnowledgeCluster[]) {
  const items = ontologyDefinitions.filter(item => item.cluster === cluster).sort((a, b) => a.id.localeCompare(b.id));
  items.forEach((item, index) => { item.position = layerPosition(cluster, 'entities', index, items.length); });
}
for (const id of ['se', 'sds', 'miracom', 'rainbow', 'physical-ai']) {
  const item = ontologyDefinitions.find(item => item.id === id)!;
  item.position = [...CLUSTER_CENTERS[item.cluster]];
}

/** English token boundaries prevent e.g. RCS matching an unrelated larger token. Korean aliases retain suffixes. */
export function matchedAlias(text: string, aliases: readonly string[]): string | undefined {
  const normalized = text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
  return aliases.find(alias => {
    const phrase = alias.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
    let offset = normalized.indexOf(phrase);
    while (offset >= 0) {
      const before = normalized[offset - 1] ?? '';
      const after = normalized[offset + phrase.length] ?? '';
      if ((!/^[a-z0-9]/.test(phrase) || !/[a-z0-9]/.test(before)) && (!/[a-z0-9]$/.test(phrase) || !/[a-z0-9]/.test(after))) return true;
      offset = normalized.indexOf(phrase, offset + 1);
    }
    return false;
  });
}
