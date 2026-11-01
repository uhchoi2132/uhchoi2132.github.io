import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Crosshair, FileText, Layers3, Minus, Pause, Play, Plus, RotateCcw } from 'lucide-react';
import type { KnowledgeCluster, KnowledgeGraph } from './knowledge';
import { catalog, getRecordClaims, type ResearchClaim, type ResearchRecord } from './research';
import { surfaceRelations, type TerrainMetric, type TerrainSurface as SurfaceModel } from './terrain-surface';
import TerrainSurface, { type TerrainSurfaceProps } from './TerrainSurface';
import './landscape.css';

export interface LandscapeSettings { metric: TerrainMetric; includeUndated: boolean }
export interface KnowledgeLandscapeProps {
  graph: KnowledgeGraph;
  knownAt: string;
  surface: SurfaceModel;
  settings: LandscapeSettings;
  onSettingsChange: (settings: LandscapeSettings) => void;
  onOpenDate: (date: string) => void;
  onSource: (id: string) => void;
  onSelectRegion: (cluster: KnowledgeCluster) => void;
}

interface ChainItem { nodeId: string; source: ResearchRecord; claim?: ResearchClaim }
const metrics: Record<TerrainMetric, string> = { documents: '문서', claims: '주장', sourceGroups: '출처군' };
const claimKinds: Record<ResearchClaim['kind'], string> = { official_statement: '공식 발표의 주장', media_report: '언론 보도', research_result: '연구 결과', inference: '분석 추론' };
const records = new Map(catalog.records.map(record => [record.id, record]));
const claims = new Map(catalog.records.flatMap(record => getRecordClaims(record).map(claim => [claim.id, { claim, record }] as const)));
const dayValue = (date: string) => Date.parse(`${date}T00:00:00.000Z`) / 86400000;
const dayString = (day: number) => new Date(day * 86400000).toISOString().slice(0, 10);
const format = (value: number) => value.toLocaleString('ko-KR');
const windowStart = catalog.meta.window_start;
const windowEnd = catalog.meta.window_end;
const startDay = dayValue(windowStart);
const endDay = dayValue(windowEnd);

/** Fixed month-end checkpoints, bounded by the actual catalog window. */
const checkpoints = (() => {
  const values = [windowStart];
  const cursor = new Date(`${windowStart}T00:00:00.000Z`);
  while (true) {
    const end = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    if (end >= windowEnd) break;
    if (end > windowStart) values.push(end);
    cursor.setUTCDate(1);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return [...new Set([...values, windowEnd])];
})();
const nextDate = (date: string) => checkpoints.find(value => value > date) ?? windowEnd;
const previousDate = (date: string) => [...checkpoints].reverse().find(value => value < date) ?? windowStart;

/** The supplied model is also the parent's export model; this view never recomputes it. */
export default function KnowledgeLandscape({ graph, knownAt, surface, settings, onSettingsChange, onOpenDate, onSource, onSelectRegion }: KnowledgeLandscapeProps) {
  const id = useId().replace(/:/g, '');
  const [view, setView] = useState<'3d' | '2d'>('3d');
  const [unavailable, setUnavailable] = useState(false);
  const handleUnavailable = useCallback(() => { setUnavailable(true); setView('2d'); }, []);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [selectedCluster, setSelectedCluster] = useState<KnowledgeCluster>();
  const [activeNode, setActiveNode] = useState<string>();
  const [expanded, setExpanded] = useState(false);
  const [cameraAction, setCameraAction] = useState<TerrainSurfaceProps['cameraAction']>();
  const dateRef = useRef(knownAt);
  const openDateRef = useRef(onOpenDate);
  useEffect(() => { dateRef.current = knownAt; openDateRef.current = onOpenDate; }, [knownAt, onOpenDate]);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const current = dateRef.current;
      if (current >= windowEnd) { setPlaying(false); return; }
      const next = nextDate(current);
      dateRef.current = next;
      openDateRef.current(next);
      if (next >= windowEnd) setPlaying(false);
    }, 1800);
    return () => window.clearInterval(timer);
  }, [playing]);

  // Only model-approved evidence can appear in the chain. The parent graph may
  // be retrospective and contain later publications, so graph membership alone
  // is deliberately insufficient here.
  const evidence = useMemo(() => {
    const anchors = surface.anchors.filter(anchor => anchor.eligible);
    const nodeIds = new Set(anchors.map(anchor => anchor.nodeId));
    const sourceIds = new Set(anchors.flatMap(anchor => anchor.sourceId ? [anchor.sourceId] : []));
    const claimIds = new Set(anchors.flatMap(anchor => anchor.claimId ? [anchor.claimId] : []));
    const relations = surfaceRelations(surface, graph);
    return { anchors, nodeIds, sourceIds, claimIds, relations };
  }, [surface, graph]);
  const relation = evidence.relations.find(item => item.id === selected);
  const selectedAnchor = evidence.anchors.find(anchor => anchor.nodeId === selected);
  const chain = useMemo(() => {
    const sourceIds = selectedAnchor?.sourceId ? [selectedAnchor.sourceId] : relation?.source_ids ?? [];
    const output: ChainItem[] = [];
    for (const sourceId of [...new Set(sourceIds)]) {
      const source = records.get(sourceId);
      if (!source || !evidence.sourceIds.has(sourceId)) continue;
      for (const anchor of evidence.anchors.filter(item => item.sourceId === sourceId && item.claimId)) {
        const resolved = claims.get(anchor.claimId!);
        if (resolved && resolved.record.id === sourceId && (!relation || relation.claim_ids.includes(resolved.claim.id))) {
          output.push({ nodeId: anchor.nodeId, source, claim: resolved.claim });
        }
      }
      // A claim's original source remains inspectable even in a claim-only
      // projection, without adding a hidden Source to the rendered/count graph.
      output.push({ nodeId: `source:${sourceId}`, source });
    }
    return output;
  }, [selectedAnchor, relation, evidence]);
  const requestedIndex = chain.findIndex(item => item.nodeId === activeNode);
  const initialIndex = chain.findIndex(item => item.nodeId === selected);
  const chainIndex = requestedIndex >= 0 ? requestedIndex : Math.max(0, initialIndex);
  const current = chain[chainIndex];
  const activeCluster = selectedCluster && surface.regions.find(region => region.id === selectedCluster);
  const rendererSelection = relation?.id ?? (current && evidence.nodeIds.has(current.nodeId) ? current.nodeId : selectedAnchor?.nodeId);
  const contributingCount = settings.metric === 'documents' ? surface.contributions.sourceIds.length
    : settings.metric === 'claims' ? surface.contributions.claimIds.length : surface.contributions.sourceGroupKeys.length;

  const changeDate = (date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(dayValue(date)) || dayString(dayValue(date)) !== date || date < windowStart || date > windowEnd) return;
    setPlaying(false); dateRef.current = date; onOpenDate(date);
  };
  const togglePlayback = () => {
    if (playing) { setPlaying(false); return; }
    if (knownAt >= windowEnd || knownAt < windowStart) { dateRef.current = windowStart; onOpenDate(windowStart); }
    setPlaying(true);
  };
  const chooseNode = (nodeId: string) => {
    const anchor = evidence.anchors.find(item => item.nodeId === nodeId);
    if (!anchor) return;
    setSelected(nodeId); setActiveNode(nodeId); setSelectedCluster(anchor.cluster); setExpanded(false);
  };
  const chooseRelation = (relationId: string) => {
    if (!evidence.relations.some(item => item.id === relationId)) return;
    setSelected(relationId); setActiveNode(undefined); setExpanded(true);
  };
  const chooseRegion = (cluster: KnowledgeCluster) => {
    setSelectedCluster(cluster);
    const first = surface.evidenceAnchors.find(anchor => anchor.cluster === cluster);
    setSelected(first?.nodeId); setActiveNode(first?.nodeId); setExpanded(false);
  };
  const camera = (type: NonNullable<TerrainSurfaceProps['cameraAction']>['type']) => setCameraAction(previous => ({ type, token: (previous?.token ?? 0) + 1 }));

  return <section className="knowledge-landscape" data-testid="knowledge-landscape" aria-labelledby={`${id}-title`}
    data-known-at={knownAt} data-metric={settings.metric} data-include-undated={String(settings.includeUndated)}
    data-surface-fingerprint={surface.fingerprint} data-contributing-node-ids={JSON.stringify(surface.contributions.nodeIds)}>
    <header className="landscape-heading">
      <div><p className="landscape-eyebrow"><Layers3 size={12}/>EVIDENCE LANDSCAPE</p><h3 id={`${id}-title`}>시간이 쌓이는 지식 지형</h3><p>공개된 근거의 축적을 살펴보고, 봉우리에서 주장과 원문으로 내려가세요.</p></div>
      <div className="landscape-metric"><label htmlFor={`${id}-metric`}>높이에 반영할 지표</label><select id={`${id}-metric`} aria-label="지형 집계 지표" value={settings.metric} onChange={event => onSettingsChange({ ...settings, metric: event.target.value as TerrainMetric })}><option value="documents">문서</option><option value="claims">주장</option><option value="sourceGroups">출처군</option></select></div>
    </header>
    <div className="landscape-toolbar">
      <label className="landscape-undated"><input type="checkbox" aria-label="게시일 미상 관측자료 포함" checked={settings.includeUndated} onChange={event => onSettingsChange({ ...settings, includeUndated: event.target.checked })}/><span>게시일 미상 관측자료 포함</span></label>
      <div className="landscape-view" role="group" aria-label="지형 표현 방식"><button aria-label="3D 지형" aria-pressed={view === '3d'} disabled={unavailable} title={unavailable ? 'WebGL을 사용할 수 없어 동일한 근거를 2D 지형으로 표시합니다.' : '3D 지형으로 보기'} onClick={() => setView('3d')}>3D</button><button aria-label="2D 지형" aria-pressed={view === '2d'} onClick={() => setView('2d')}>2D</button></div>
      <div className="landscape-camera" role="group" aria-label="지형 카메라 조작"><button aria-label="지형 확대" title="확대" onClick={() => camera('zoom-in')}><Plus size={15}/></button><button aria-label="지형 축소" title="축소" onClick={() => camera('zoom-out')}><Minus size={15}/></button>{view === '3d' && <><button aria-label="지형 왼쪽 회전" title="왼쪽 회전" onClick={() => camera('rotate-left')}><ChevronLeft size={15}/></button><button aria-label="지형 오른쪽 회전" title="오른쪽 회전" onClick={() => camera('rotate-right')}><ChevronRight size={15}/></button><button aria-label="지형 위에서 보기" title="위에서 보기" onClick={() => camera('tilt-up')}><ChevronUp size={15}/></button><button aria-label="지형 낮춰 보기" title="낮춰 보기" onClick={() => camera('tilt-down')}><ChevronDown size={15}/></button></>}<button aria-label="지형 전체 맞춤" title="전체 맞춤" onClick={() => camera('fit')}><Crosshair size={15}/></button><button aria-label="지형 시점 초기화" title="시점 초기화" onClick={() => camera('reset')}><RotateCcw size={14}/></button></div>
    </div>
    <div className="landscape-current-scope"><span><b>{format(contributingCount)}</b> {metrics[settings.metric]}의 분포</span><span>표시 문서 {format(surface.counts.documentCount)} · 주장 {format(surface.counts.claimCount)} · 출처군 {format(surface.counts.sourceGroupCount)}</span><span>높이 = 자료 밀도 · 신뢰도 아님</span></div>
    {!surface.valid && <p className="landscape-alert" role="status">{surface.errorMessage ?? '유효한 날짜와 지표를 선택하세요.'}</p>}
    <div className="landscape-stage">
      <TerrainSurface model={surface} graph={graph} selected={rendererSelection} selectedCluster={selectedCluster} onNode={chooseNode} onRelation={chooseRelation} onRegion={chooseRegion} view={view} cameraAction={cameraAction} onUnavailable={handleUnavailable}/>
    </div>
    <div className="landscape-date-strip">
      <div className="landscape-date-title"><span>PUBLICATION CUTOFF</span><label htmlFor={`${id}-date`}>공개 기준일</label><input id={`${id}-date`} aria-label="지형 기준일" type="date" value={knownAt} min={windowStart} max={windowEnd} onChange={event => changeDate(event.target.value)}/></div>
      <div className="landscape-playback"><button aria-label="이전 월" disabled={knownAt <= windowStart} onClick={() => changeDate(previousDate(knownAt))}><ChevronLeft size={16}/></button><button className="landscape-play" aria-label={playing ? '월별 축적 일시정지' : '월별 축적 재생'} aria-pressed={playing} onClick={togglePlayback}>{playing ? <Pause size={14}/> : <Play size={14}/>}<span>{playing ? '일시정지' : '월별 재생'}</span></button><button aria-label="다음 월" disabled={knownAt >= windowEnd} onClick={() => changeDate(nextDate(knownAt))}><ChevronRight size={16}/></button></div>
      <div className="landscape-date-range"><input type="range" aria-label="지형 기준일 슬라이더" min={startDay} max={endDay} step="1" value={Math.max(startDay, Math.min(endDay, Number.isFinite(dayValue(knownAt)) ? dayValue(knownAt) : startDay))} aria-valuetext={knownAt} onChange={event => changeDate(dayString(Number(event.target.value)))}/><div><span>{windowStart}</span><span>{windowEnd}</span></div></div>
    </div>
    <p className="landscape-time-note">선택한 날짜까지 공개된 자료가 높이에 반영됩니다. {settings.includeUndated ? `게시일 미상 ${format(surface.contributions.undatedNodeIds.length)}개 표식은 관측일 기준으로 포함했습니다.` : '게시일 미상 자료는 높이에서 제외했습니다.'} 출처군은 같은 발표·원작을 묶은 수이며 독립 검증 횟수가 아닙니다.</p>
    {activeCluster && <div className="landscape-topic-selection"><span>{activeCluster.label}<small>문서 {format(activeCluster.documentCount)} · 주장 {format(activeCluster.claimCount)}</small></span><button onClick={() => onSelectRegion(activeCluster.id)}>관계 탐색<ArrowRight size={13}/></button></div>}
    {current ? <section className="landscape-chain" data-testid="landscape-chain" aria-labelledby={`${id}-chain-title`}
      data-chain-node-ids={JSON.stringify(chain.map(item => item.nodeId))} data-current-node-id={current.nodeId}
      data-current-source-id={current.source.id} data-current-claim-id={current.claim?.id ?? ''} data-current-relation-id={relation?.id ?? ''}>
      <div className="landscape-chain-heading"><div><span className={`landscape-chain-kind ${current.claim ? 'is-claim' : 'is-source'}`}><FileText size={12}/>{current.claim ? 'CLAIM · 주장' : 'SOURCE · 원문'}</span><span className="landscape-chain-position">{chainIndex + 1} / {chain.length}</span></div><div className="landscape-chain-navigation"><button aria-label="이전 근거" disabled={chainIndex === 0} onClick={() => setActiveNode(chain[chainIndex - 1].nodeId)}><ChevronLeft size={15}/></button><button aria-label="다음 근거" disabled={chainIndex >= chain.length - 1} onClick={() => setActiveNode(chain[chainIndex + 1].nodeId)}><ChevronRight size={15}/></button></div></div>
      <h4 id={`${id}-chain-title`}>{current.claim?.text ?? current.source.title}</h4>
      <p className="landscape-chain-meta">{current.source.publisher}<span>·</span>{current.source.published_at ?? `게시일 미상 · 관측 ${current.source.accessed_at.slice(0, 10)}`}<span>·</span>{current.claim ? claimKinds[current.claim.kind] : '원출처 문서'}</p>
      <div className="landscape-chain-actions"><button className="landscape-source-open" aria-label="원문 근거 열기" onClick={() => onSource(current.source.id)}>원문 근거 열기<ArrowRight size={13}/></button><button className="landscape-detail-toggle" aria-label={expanded ? '근거 상세 접기' : '근거 상세 펼치기'} aria-expanded={expanded} aria-controls={`${id}-chain-detail`} onClick={() => setExpanded(value => !value)}>근거 상세{expanded ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}</button></div>
      {expanded && <div id={`${id}-chain-detail`} className="landscape-chain-detail" data-testid="landscape-chain-detail" data-source-id={current.source.id} data-claim-id={current.claim?.id ?? ''}>
        {relation && <div className="landscape-relation-detail" data-relation-id={relation.id}><b>{relation.label}</b><span>{graph.nodes.find(node => node.id === relation.from)?.title ?? relation.from} → {graph.nodes.find(node => node.id === relation.to)?.title ?? relation.to}</span><p>{relation.rationale}</p><small>{relation.inferred ? '분석자가 연결한 추론 관계' : '출처에 귀속된 관계 · 독립 검증 아님'}</small></div>}
        <dl><div><dt>연결 원문</dt><dd>{current.source.title}</dd></div><div><dt>원문 위치</dt><dd>{current.claim?.evidence_locator ?? current.source.evidence_locator}</dd></div><div><dt>검증 상태</dt><dd>{current.source.verification === 'primary_read' ? '아카이브 원문 확보 · 진위의 독립 검증과 구별' : '수동 열람 보고 · 원문 아카이브 미확보'}</dd></div></dl>
        {current.source.excerpt && <blockquote>{current.source.excerpt}</blockquote>}
        {(current.claim?.limitations ?? current.source.limitations).length > 0 && <p className="landscape-chain-limit">{(current.claim?.limitations ?? current.source.limitations).join(' ')}</p>}
      </div>}
    </section> : <div className="landscape-chain-empty" role="status"><FileText size={16}/><span>{surface.evidenceAnchors.length ? '지형의 근거 표식을 선택하면 주장 → 원문 연결을 따라갈 수 있습니다.' : '이 날짜·필터·지표에서 높이에 기여할 등록 자료가 없습니다. 날짜나 지표를 바꿔 살펴보세요.'}</span></div>}
    <p className="landscape-method-note">고정 좌표와 동일한 높이 척도로 비교합니다. 필터나 지표를 바꾸면 포함 자료와 높이도 달라집니다. 지형은 실제 지리·기업 권한·인과관계를 나타내지 않습니다.</p>
  </section>;
}
