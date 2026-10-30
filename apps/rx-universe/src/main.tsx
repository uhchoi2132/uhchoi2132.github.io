import React, { useState, useEffect, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDownToLine, ArrowRight, Box, ChevronRight, CircleHelp, Clock3, Database, Expand, ExternalLink, FileText, GitBranch, Layers3, LayoutDashboard, ListChecks, Menu, Network, RotateCcw, Search, Settings2, ShieldCheck, X, Zap } from 'lucide-react';
import './style.css';
import './improvements.css';
import { catalog, getRecordClaims, researchAt, researchClaims, researchCounts, type ResearchMode } from './research';
import ResearchVault, { ResearchSourceList, RESEARCH_DATE, sourceText } from './ResearchVault';
import { graphAt, hypothesisAssessments } from './knowledge';
import { graphView } from './graph-view';
import HypothesisWorkbench from './AnalysisWorkbench';
import BriefingPanel, { RecentChanges, SignalCandidates } from './BriefingPanel';
import { briefingFor, stageLabels, type SignalCandidate } from './briefing';
import ActionPlan from './ActionPlan';

type Selection = { kind: 'entity' | 'relation' | 'source'; id: string } | { kind: 'signal'; id: string; candidate: SignalCandidate };
const Universe = lazy(() => import('./Universe'));
const START = '2025-10-01';
const TIMELINE_DAYS = Math.round((Date.parse(RESEARCH_DATE) - Date.parse(START)) / 86400000);
const nav = [
  { id: 'command', name: 'Command Center', icon: LayoutDashboard },
  { id: 'universe', name: '3D Universe', icon: Network },
  { id: 'time', name: 'Time Machine', icon: Clock3 },
  { id: 'evidence', name: 'Evidence Vault', icon: Database },
  { id: 'hypotheses', name: 'Hypothesis War Room', icon: GitBranch },
  { id: 'factory', name: 'Factory Twin', icon: Box },
  { id: 'briefing', name: 'Briefing Studio', icon: FileText },
  { id: 'actions', name: 'Action Items', icon: ListChecks },
];
const descriptions: Record<string, string> = {
  command: '흩어진 신호를 연결하고, 증거로 다음 움직임을 읽다.',
  universe: '원문에 귀속된 관계와 분석가 가설을 탐색합니다.',
  time: '사건의 시간과 당시 공개된 정보를 분리해 판단을 재구성합니다.',
  evidence: '모든 판단은 원문에서 시작합니다. 주장과 출처 계보를 추적합니다.',
  hypotheses: '경쟁 가설의 지지·반박 근거를 비교하고 개인 검토를 기록합니다.',
  factory: '제조 계획에서 로봇 실행까지, 공개 사례와 미확인 운영 지표를 구분합니다.',
  briefing: '실제 공개 기간에 따라 변화, 근거와 미확인 질문을 정리합니다.',
  actions: '진단한 부족한 점을 실행 항목과 검증 가능한 인수 기준으로 추적합니다.',
};
const questions = ['삼성전자와 삼성SDS의 제품·기술 책임 경계는?', 'SDS 오케스트레이션의 API와 지원 로봇 범위는?', '미라콤 RCS와 SDS의 Job / Task 역할은 어떻게 나뉘는가?', '외부 유료 상시 가동과 RX 전용 반복매출이 확인되는가?'];
function pageFromHash() { const id = window.location.hash.slice(1); return nav.some(item => item.id === id) ? id : 'command'; }
function validDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= START && value <= RESEARCH_DATE && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }

function App() {
  const [page, setPage] = useState(pageFromHash);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'3d' | '2d'>(window.innerWidth < 768 ? '2d' : '3d');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<Selection | null>(null);
  const [date, setDate] = useState(RESEARCH_DATE);
  const [temporal, setTemporal] = useState<ResearchMode>('known');
  const [limitEvents, setLimitEvents] = useState(false);
  const [eventAsOf, setEventAsOf] = useState(RESEARCH_DATE);
  const [mobile, setMobile] = useState(false);
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState<'status' | 'help' | null>(null);
  const current = nav.find(item => item.id === page)!;
  const timeOptions = page === 'time' && limitEvents ? { eventAsOf } : {};
  const researchSources = researchAt(date, temporal, catalog, timeOptions);
  const undated = catalog.records.filter(record => record.scope === 'undated');
  const snapshotSources = date === RESEARCH_DATE && !timeOptions.eventAsOf ? [...researchSources, ...catalog.records.filter(record => record.scope !== 'in_window')] : researchSources;
  const stats = researchCounts(snapshotSources);
  const completeGraph = graphAt(date, temporal, timeOptions);
  const visibleGraph = graphView(completeGraph, filter, search);
  const weekly = briefingFor(date, temporal, 'weekly');
  const selectedRelation = completeGraph.relations.find(relation => selected?.kind === 'relation' && relation.id === selected.id);
  const selectedNode = completeGraph.nodes.find(node => selected?.kind === 'entity' && node.id === selected.id);
  const selectedSource = snapshotSources.find(source => selected?.kind === 'source' && source.id === selected.id)
  const selectedSignal = selected?.kind === 'signal' ? selected.candidate : undefined;
  const relatedRelations = completeGraph.relations.filter(relation => selectedNode ? relation.from === selectedNode.id || relation.to === selectedNode.id : selectedSource ? relation.source_ids.includes(selectedSource.id) : false);
  const sourceIds = selectedRelation?.source_ids || selectedNode?.source_ids || (selectedSource ? [selectedSource.id] : selectedSignal ? selectedSignal.relatedSources.map(source => source.id) : []);
  const selectedSources = snapshotSources.filter(source => sourceIds.includes(source.id));
  const claimIds = selectedRelation?.claim_ids || selectedNode?.claim_ids || (selectedSignal ? [selectedSignal.claim.id] : undefined);
  const drawerTitle = selectedRelation?.label || selectedNode?.title || selectedSource?.title || selectedSignal?.title || '연결 근거';

  useEffect(() => {
    const onNavigate = () => { setPage(pageFromHash()); setMobile(false); setSelected(null); setModal(null); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', onNavigate);
    window.addEventListener('popstate', onNavigate);
    return () => { window.removeEventListener('hashchange', onNavigate); window.removeEventListener('popstate', onNavigate); };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setModal(null); setSelected(null); setMobile(false); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (!document.querySelector('[aria-modal="true"]')) document.querySelector<HTMLInputElement>('.global-search input')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    const overlay = document.querySelector<HTMLElement>(modal ? '.modal' : selected ? '.detail-drawer' : '.no-overlay');
    if (!overlay) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const focusable = () => Array.from(overlay.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')).filter(element => element.getClientRects().length > 0);
    const focusFirst = () => (focusable()[0] || overlay).focus();
    const onTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); overlay.focus(); return; }
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !overlay.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !overlay.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    const containFocus = (event: FocusEvent) => { if (event.target instanceof Node && !overlay.contains(event.target)) focusFirst(); };
    document.body.style.overflow = 'hidden'; focusFirst();
    document.addEventListener('keydown', onTab); document.addEventListener('focusin', containFocus);
    return () => { document.removeEventListener('keydown', onTab); document.removeEventListener('focusin', containFocus); document.body.style.overflow = previousOverflow; if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [selected, modal]);
  function go(id: string) {
    if (!nav.some(item => item.id === id)) return;
    setPage(id); setMobile(false); setSelected(null); setModal(null);
    if (id === 'time') { setFilter('all'); setSearch(''); }
    if (window.location.hash !== `#${id}`) window.history.pushState(null, '', `#${id}`);
    window.scrollTo(0, 0);
  }
  function updateDate(value: string) { if (validDate(value)) { setDate(value); setSelected(null); } }
  function updateTimeline(value: string) { const offset = Number(value); if (Number.isFinite(offset) && offset >= 0 && offset <= TIMELINE_DAYS) updateDate(new Date(Date.parse(START) + Math.round(offset) * 86400000).toISOString().slice(0, 10)); }
  function download() {
    const claims = researchClaims(snapshotSources);
    const payload = {
      title: 'SAMSUNG RX Intelligence Universe', version: '2.4', as_of: timeOptions.eventAsOf ?? date, event_as_of: timeOptions.eventAsOf ?? null, selected_knowledge_date: date, known_at: temporal === 'known' ? date : RESEARCH_DATE, mode: temporal,
      generated_at: new Date().toISOString(), graph: visibleGraph, entities: visibleGraph.nodes, relations: visibleGraph.relations,
      claims, research_claims: claims, research_records: snapshotSources, research_counts: stats, hypotheses: hypothesisAssessments(date, temporal, timeOptions), view: { filter, search },
      collection_status: 'manual_research_snapshot', automatic_collection_status: 'not_connected', last_successful_update: null,
      research_collected_at: catalog.meta.researched_at, research_claim_status: 'source_attributed_not_independently_verified',
      scope_policy: '현재 날짜에는 81건 전체 목록을 포함합니다. 날짜 미상·기간 밖 자료는 역사 조회에서 제외합니다. 그래프는 화면과 같은 검색·유형 필터를 적용합니다.',
      disclaimer: '출처의 주장과 분석가 연결을 구분합니다. As-known-at은 현재 수집한 공개자료로 당시 공개 범위를 재구성하며 당시 저장된 시스템 스냅샷은 아닙니다.',
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `rx-snapshot-${date}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice('화면의 그래프와 선택 시점의 자료·주장을 내보냈습니다.'); setTimeout(() => setNotice(''), 3500);
  }
  const graph = <div className="graph-stage" data-graph-node-count={visibleGraph.nodes.length} data-graph-relation-count={visibleGraph.relations.length}>
    <div className="graph-topline"><span className="micro">RX KNOWLEDGE GRAPH</span><span className="graph-label"><i/> SOURCE-ATTRIBUTED</span></div>
    <Suspense fallback={<div className="empty">Universe 불러오는 중…</div>}><Universe graph={visibleGraph} mode={mode} filter="all" search="" onSelect={id => setSelected({ kind: 'entity', id })} onSelectRelation={id => setSelected({ kind: 'relation', id })}/></Suspense>
    <div className="graph-bottom"><span><span className="tiny-dot"/>{visibleGraph.nodes.length} NODES · {visibleGraph.relations.length} RELATIONS</span><span>실선: 출처 귀속 · 점선: 분석 추론</span></div>
  </div>;
  const modeControls = <div className="segmented"><button className={mode === '3d' ? 'selected' : ''} onClick={() => setMode('3d')}>3D</button><button className={mode === '2d' ? 'selected' : ''} onClick={() => setMode('2d')}>2D</button></div>;
  return <div className="app">
    <aside className={`sidebar ${mobile ? 'open' : ''}`}>
      <a href="#command" onClick={event => { event.preventDefault(); go('command'); }} className="brand"><div className="brand-mark"><Network size={25}/></div><div><b>SAMSUNG <span>RX</span></b><small>INTELLIGENCE UNIVERSE</small></div></a>
      <div className="workspace-label">STRATEGIC WORKSPACE <span>v2.4</span></div>
      <nav>{nav.map(item => <button key={item.id} className={page === item.id ? 'nav active' : 'nav'} onClick={() => go(item.id)}><item.icon size={17}/><span>{item.name}</span>{item.id === 'universe' && <small>3D</small>}{page === item.id && <div className="active-dot"/>}</button>)}</nav>
      <div className="sidebar-section"><span className="micro">INTELLIGENCE CYCLE</span><div className="cycle">{['Observe', 'Verify', 'Connect', 'Infer', 'Challenge', 'Monitor', 'Brief'].map(step => <div key={step}><i/>{step}</div>)}</div></div>
      <div className="sidebar-bottom"><div className="system-card"><div><span className="amber-dot"/> Public research workspace</div><p>수동 조사 반영 · 자동 수집 미연결</p><button onClick={() => setModal('status')}>운영 상태 보기 <ArrowRight size={13}/></button></div><button className="side-help" onClick={() => setModal('help')}><CircleHelp size={17}/>워크스페이스 가이드<ExternalLink size={13}/></button><p className="workspace-access-note">로그인 없이 공개 열람<br/>개인 검토는 이 브라우저에 저장됩니다.</p></div>
    </aside>{mobile && <div className="sidebar-scrim" onClick={() => setMobile(false)}/>}
    <div className="workspace"><header className="topbar"><div className="breadcrumb"><button className="mobile-toggle icon-btn" onClick={() => setMobile(!mobile)} aria-label="메뉴"><Menu size={20}/></button><span>Workspace</span><ChevronRight size={13}/><b>{current.name}</b></div><div className="topbar-actions"><div className="global-search"><Search size={15}/><input aria-label="엔티티 검색" placeholder="엔티티, 자료, 주장 검색…" value={search} onChange={event => setSearch(event.target.value)}/><kbd>⌘ K</kbd></div><button className="icon-btn" aria-label="운영 상태" onClick={() => setModal('status')}><CircleHelp size={17}/></button></div></header>
    <main><div className="page-heading"><div><div className="eyebrow"><span/> STRATEGIC INTELLIGENCE OPERATING SYSTEM</div><h1>{current.name}<span className="version-tag">{page === 'command' ? 'OVERVIEW' : page === 'universe' ? 'EXPLORE' : 'WORKSPACE'}</span></h1><p>{descriptions[page]}</p></div><div className="heading-actions"><label className="date-control"><Clock3 size={14}/><input type="date" aria-label="정보 기준일" min={START} max={RESEARCH_DATE} value={date} onChange={event => updateDate(event.target.value)}/></label><button className="button primary" onClick={download}><ArrowDownToLine size={15}/>스냅샷 내보내기</button></div></div>
    <div className="context-bar"><div><span className="teal-dot"/><b>EVIDENCE FIRST</b><span className="context-separator"/>공식 발표 · 언론 보도 · 분석 추론 · 전망을 분리합니다.</div><button onClick={() => setModal('status')}><span className="amber-dot"/>수동 조사 반영<ChevronRight size={12}/></button></div>
    {(page === 'command' || page === 'universe') && <>
      {page === 'command' && <div className="stats-grid"><Stat label="PUBLIC SOURCE INVENTORY" value={stats.total} sub={date === RESEARCH_DATE ? '기간 내 65 · 날짜 미상 14 · 배경 2' : '선택 시점에 공개된 기간 내 자료'} icon={Database} note="수동 조사"/><Stat label="SOURCE-ATTRIBUTED CLAIMS" value={stats.claims} sub="출처가 발표한 주장 · 독립 검증 아님" icon={FileText} note="다중 주장 보존"/><Stat label="TRACEABLE RELATIONS" value={completeGraph.relations.length} sub="원문·주장이 연결된 관계와 분석 추론" icon={Network} note="단일 그래프"/><Stat label="NEW THIS WEEK" value={weekly.withinPeriod.length} sub={`${weekly.bounds?.start} – ${weekly.bounds?.end} 공개`} icon={Clock3} note="발표 문서 수"/></div>}
      <div className={`intelligence-grid ${page === 'universe' ? 'expanded' : ''}`}><section className="panel universe-panel"><div className="panel-head"><div><Network size={17}/><h2>RX Intelligence Universe</h2><span className="tag">LINKED EVIDENCE</span></div><div>{modeControls}<button className="icon-btn" aria-label="그래프 확장" onClick={() => go(page === 'universe' ? 'command' : 'universe')}><Expand size={15}/></button></div></div><div className="graph-toolbar"><div className="filter-tabs">{[['all', '전체'], ['company', '조직 · 기업'], ['technology', '기술 · 제품'], ['hypothesis', '가설']].map(([id, label]) => <button className={filter === id ? 'on' : ''} key={id} onClick={() => setFilter(id)}>{label}</button>)}</div><button className="icon-btn" aria-label="필터 초기화" onClick={() => { setFilter('all'); setSearch(''); }}><Settings2 size={15}/></button></div>{graph}<div className="graph-footer"><div><span className="legend cyan"/>조직 · 기업 <span className="legend blue"/>기술 · 제품 <span className="legend purple"/>가설</div><button onClick={() => go('time')}><Clock3 size={13}/>Time Machine<ArrowRight size={13}/></button></div></section><section className="panel signal-panel"><div className="panel-head"><div><Zap size={17} className="cyan-text"/><h2>Signal Radar</h2></div><span className="tag">REVIEW</span></div><div className="section-intro">최근 7일 자료의 우선 검토 후보<span>성립 확인된 고영향 신호와 구분합니다.</span></div><SignalCandidates date={date} mode={temporal} limit={3} onSelectCandidate={candidate => setSelected({ kind: 'signal', id: candidate.id, candidate })}/><button className="panel-bottom-link" onClick={() => go('hypotheses')}>경쟁 가설과 확인 지표 보기<ArrowRight size={14}/></button></section></div>
      {page === 'command' && <><RecentChanges briefing={weekly}/><div className="lower-grid"><section className="panel"><div className="panel-head"><div><Layers3 size={17}/><h2>Priority Questions</h2></div><span className="tag">OPEN {questions.length}</span></div><div className="question-list">{questions.slice(0, 3).map((question, index) => <button key={question} onClick={() => go('hypotheses')}><span>0{index + 1}</span><p>{question}</p><span className="question-status">추가 검증</span><ArrowRight size={15}/></button>)}</div></section><section className="panel next-panel"><div className="panel-head"><div><ListChecks size={17}/><h2>Improvement Cycle</h2></div><span className="tag">ITERATION 02</span></div><div className="checkpoint"><div className="checkpoint-time">15<small>REVIEW COMMENTS</small></div><div><h3>데이터 → 근거 → 판단 → 검증</h3><p>리뷰 반영 · 원문 보관본 확보는 후속 작업</p><span className="amber-text">08:00 자동 수집은 후속 구현 항목</span></div></div><button className="panel-bottom-link" onClick={() => go('actions')}>실행 항목과 인수 기준 보기<ArrowRight size={14}/></button></section></div></>}
    </>}
    {page === 'time' && <><div className="time-controls panel"><div><span className="micro">TEMPORAL PERSPECTIVE</span><div className="segmented"><button className={temporal === 'known' ? 'selected' : ''} onClick={() => { setTemporal('known'); setSelected(null); }}>As-known-at</button><button className={temporal === 'retro' ? 'selected' : ''} onClick={() => { setTemporal('retro'); setSelected(null); }}>Retrospective</button></div></div><p>{temporal === 'known' ? '선택일까지 공개된 자료입니다. 이미 발표된 미래 계획은 포함하며, 실제 완료와 구분합니다.' : '현재 공개자료로 과거 사건을 재평가합니다. 뒤늦게 발표된 자료는 게시일을 따로 표시합니다.'}</p>{modeControls}</div><section className="panel event-axis"><label><input type="checkbox" aria-label="사건 기준일 제한" checked={limitEvents} onChange={event => { setLimitEvents(event.target.checked); setSelected(null); }}/>사건 기준일을 별도로 제한</label>{limitEvents && <label>사건 기준일<input type="date" aria-label="사건 기준일" min={START} max={RESEARCH_DATE} value={eventAsOf} onChange={event => { if (validDate(event.target.value)) { setEventAsOf(event.target.value); setSelected(null); } }}/></label>}<p>정보 기준일과 별개의 필터입니다. 사용하면 사건일·예정일이 확인된 자료만 포함하며, 실제 완료를 뜻하지 않습니다. 이 필터는 Time Machine과 해당 화면의 내보내기에 적용됩니다.</p></section><section className="panel universe-panel">{graph}<div className="timeline"><button className="icon-btn" aria-label="현재 날짜로 돌아가기" onClick={() => updateDate(RESEARCH_DATE)}><RotateCcw size={16}/></button><span>2025.10</span><input aria-label="시점 슬라이더" type="range" min="0" max={TIMELINE_DAYS} value={Math.round((Date.parse(date) - Date.parse(START)) / 86400000)} onChange={event => updateTimeline(event.target.value)}/><span>{RESEARCH_DATE.replaceAll('-', '.')}</span></div></section><section className="panel research-recent"><div className="panel-head"><div><Clock3 size={17}/><h2>선택 시점의 공개자료</h2></div></div><ResearchSourceList records={researchSources} limit={4}/></section><div className="info-grid"><Info title="사건과 예정" text="실제 사건일·발표일·예정일을 구분합니다. 미래 계획을 이미 가동한 성과로 계산하지 않습니다."/><Info title="당시 공개 범위 재구성" text="2026.10.30에 수집한 자료로 과거 공개 범위를 재구성합니다. 당시 시스템에 저장된 이력은 아닙니다."/><Info title="버전 관리 범위" text="개인 검토는 변경 이력을 보존합니다. 원문 정정·철회 자동 감지와 서버 그래프 버전 관리는 후속 항목입니다."/></div></>}
    {page === 'evidence' && <ResearchVault records={researchSources} discoveries={undated} date={date} temporal={temporal} search={search} onSearchChange={setSearch} onSnapshot={download} onExploreSource={id => setSelected({ kind: 'source', id })}/>}
    {page === 'hypotheses' && <HypothesisWorkbench date={date} mode={temporal}/>}
    {page === 'factory' && <><section className="panel factory-panel"><div className="panel-head"><div><Box size={17}/><h2>Execution Architecture</h2></div><span className="tag">CONCEPTUAL WORKFLOW</span></div><div className="factory-flow">{['MES', 'Job', 'Task Graph', 'Scheduling', 'Dispatch', 'RCS / API', 'Robot', 'KPI'].map((label, index) => <React.Fragment key={label}><div className="factory-stage"><span>0{index + 1}</span><Box size={24}/><b>{label}</b><small>{['생산 계획', '작업 목표', '태스크 분해', '자원 배정', '명령 전달', '제어 연동', '현장 실행', '성과 측정'][index]}</small></div>{index < 7 && <ArrowRight size={16}/>}</React.Fragment>)}</div><div className="factory-note"><CircleHelp size={16}/>설계 워크플로입니다. 실시간 설비·MES 연결과 운영 시뮬레이션은 미구현입니다.</div></section><div className="info-grid"><Info title="Human intervention" text="사람 개입률 · 공개 근거 및 실측값 없음"/><Info title="Recovery time" text="오류 복구시간 · 공개 근거 및 실측값 없음"/><Info title="Deployment repeatability" text="유료 상시 운영 · 다공장 반복 배포는 추가 검증 필요"/></div><section className="panel factory-cases"><div className="panel-head"><div><Database size={17}/><h2>사례별 사업화 단계</h2></div></div><p>관계사 실증과 외부 하드웨어 계약을 구분합니다. 장비 대금수령은 SDS RX 소프트웨어 반복매출이 아닙니다.</p><ResearchSourceList records={snapshotSources.filter(source => ['sds-005', 'tech-017', 'mi-006'].includes(source.id))} limit={3}/></section></>}
    {page === 'briefing' && <BriefingPanel date={date} mode={temporal} onSelectCandidate={candidate => setSelected({ kind: 'signal', id: candidate.id, candidate })}/>}
    {page === 'actions' && <ActionPlan/>}
    <footer className="main-footer"><span>SAMSUNG RX <b>INTELLIGENCE UNIVERSE</b></span><span>PUBLIC RESEARCH · v2.4 · 출처와 해석을 구분합니다.</span></footer></main></div>
    {selected && <><div className="drawer-backdrop" onClick={() => setSelected(null)}/><aside className="detail-drawer" role="dialog" aria-modal="true" aria-labelledby="detail-title" tabIndex={-1} data-relation-id={selectedRelation?.id} data-selection-kind={selected.kind} data-signal-id={selectedSignal?.id}><div className="drawer-top"><span className="micro">{selectedSignal ? 'SIGNAL REVIEW CANDIDATE' : selectedRelation ? 'RELATION PROVENANCE' : 'CONNECTED EVIDENCE'}</span><button className="icon-btn" aria-label="상세 닫기" onClick={() => setSelected(null)}><X size={20}/></button></div><span className="tag">{selectedSignal ? 'REVIEW CANDIDATE · 성립 미확인' : selectedRelation?.inferred ? 'ANALYST INFERENCE' : selectedRelation ? 'SOURCE-ATTRIBUTED' : selectedNode?.ontology_type || 'SOURCE'}</span><h2 id="detail-title">{drawerTitle}</h2><p>{selectedRelation?.rationale || selectedNode?.description || selectedSource?.summary_ko || selectedSignal?.priorityReason}</p>
      {selectedRelation && <div className="relation-proof"><dl><div><dt>관계</dt><dd>{selectedRelation.from} → {selectedRelation.to}</dd></div><div><dt>상태</dt><dd>{selectedRelation.status}</dd></div><div><dt>게시일 / 사건일</dt><dd>{selectedRelation.published_at || '게시일 미상'} / {selectedRelation.event_date || '사건일 미확인'}</dd></div></dl>{selectedRelation.limitations.map((limit, index) => <p key={index}>{limit}</p>)}</div>}
      {selectedSignal && <section className="signal-detail"><dl><div><dt>사업화 단계</dt><dd>{stageLabels[selectedSignal.stage]}</dd></div><div><dt>게시일 / 사건일</dt><dd>{selectedSignal.source.published_at || '미확인'} / {selectedSignal.source.event_date || '미확인'}</dd></div><div><dt>다음 확인 지표</dt><dd>{selectedSignal.nextCheck}</dd></div></dl><h3>자료 해석의 한계 · 독립 반증과 구분</h3><p>아래는 자료와 조사에 기록된 한계입니다. 독립 반대 증거를 확보했다는 뜻이 아닙니다.</p><ul>{selectedSignal.counterevidence.map((item, index) => <li key={`${item.sourceId}-${index}`}><a href={item.url} data-counterevidence-source-id={item.sourceId} target="_blank" rel="noreferrer">{item.text}<ExternalLink size={12}/></a></li>)}</ul><p>동일 출처군의 문서 {selectedSignal.relatedSources.length}건을 함께 연결합니다. 검토 우선순위는 성공 확률이 아닙니다.</p></section>}
      <p className="research-countline">원문 {selectedSources.length}건 · 출처 귀속 주장 · 독립 검증과 구분</p>
      {selectedSources.flatMap(source => getRecordClaims(source).filter(claim => !claimIds || claimIds.includes(claim.id)).map(claim => <section className="claim-proof" data-claim-id={claim.id} key={claim.id}><span>{claim.id} · {claim.kind}</span><p>{claim.text}</p><small>근거 위치: {sourceText(claim.evidence_locator || source.evidence_locator) || '원문 확인 필요'}</small></section>))}
      <ResearchSourceList records={selectedSources} limit={selectedSources.length} compact/>
      {!selectedRelation && !selectedSignal && <section className="drawer-relations"><h3>연결 관계 {relatedRelations.length}개</h3>{relatedRelations.map(relation => <button key={relation.id} onClick={() => setSelected({ kind: 'relation', id: relation.id })}><span>{relation.label}<small>{relation.inferred ? '분석 추론' : '출처 귀속'} · {relation.source_ids.length}개 원문</small></span><ArrowRight size={15}/></button>)}{!relatedRelations.length && <p>이 자료에 대해 등록한 출처 귀속 관계는 아직 없습니다. 자료의 존재만으로 관계를 자동 생성하지 않습니다.</p>}</section>}
      <button className="button primary" onClick={() => go('evidence')}>Evidence Vault 열기<ArrowRight size={14}/></button>
    </aside></>}
    {modal && <div className="modal-backdrop" onClick={() => setModal(null)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabIndex={-1} onClick={event => event.stopPropagation()}><button className="modal-close icon-btn" aria-label="닫기" onClick={() => setModal(null)}><X size={20}/></button><span className="micro">WORKSPACE GUIDE</span><h2 id="modal-title">{modal === 'status' ? '운영 상태' : '근거에서 판단까지'}</h2>{modal === 'status' ? <><p>공개자료 81건과 출처 귀속 주장 84건을 반영한 수동 조사 서비스입니다. 수집 기준일: 2026.10.30.</p><Info title="자동 갱신" text="미연결 · 마지막 자동 성공 업데이트: 없음. 08:00 KST는 제안 일정입니다."/><Info title="연결된 기능" text="날짜별 자료·그래프, 관계 근거 탐색, 개인 검토 기록, 기간별 브리핑, JSON·SQLite 내보내기"/><Info title="후속 기반" text="서버 API·공동 검토·OIDC·자동 수집·AI 추출·현장 데이터 연결은 아직 구현되지 않았습니다."/></> : <><p>노드로 법인·기술을 탐색하고 관계를 선택하면 해당 주장과 원문이 열립니다. 점선은 분석가 가설의 연결입니다.</p><p>Time Machine의 As-known-at은 그때까지 공개된 자료만 표시합니다. 미래 계획도 발표된 시점부터 보이지만 실제 성과와 구분합니다.</p><p>War Room의 개인 검토는 이 브라우저에만 저장됩니다. 원문의 사실 상태를 바꾸지 않습니다. 모바일은 같은 그래프의 2D 화면을 제공합니다.</p></>}<button className="button primary" onClick={() => go('actions')}>Action Items 보기<ArrowRight size={14}/></button></section></div>}
    {notice && <div className="toast" role="status"><ShieldCheck size={16}/>{notice}</div>}
  </div>;
}
function Stat({ label, value, sub, icon: Icon, note }: { label: string; value: number; sub: string; icon: React.ElementType; note: string }) { return <div className="stat-card"><div className="stat-label"><span>{label}</span><Icon size={17}/></div><div className="stat-value">{String(value).padStart(2, '0')}<span>{note}</span></div><p>{sub}</p></div>; }
function Info({ title, text }: { title: string; text: string }) { return <div className="info-card"><span className="micro">{title}</span><p>{text}</p></div>; }
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
