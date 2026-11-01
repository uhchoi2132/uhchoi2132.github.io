import { lazy, Suspense, useId, useMemo, useState, type CSSProperties } from 'react';
import { ArrowRight, ArrowUpRight, Network } from 'lucide-react';
import type { KnowledgeCluster, KnowledgeGraph } from './knowledge';
import { terrainRegions } from './terrain';
import KnowledgeEvolution from './KnowledgeEvolution';
import type { TerrainMetric, TerrainSurface } from './terrain-surface';
import './terrain.css';
const KnowledgeLandscape = lazy(() => import('./KnowledgeLandscape'));

export interface KnowledgeTerrainProps {
  graph: KnowledgeGraph;
  surface: TerrainSurface;
  settings: { metric: TerrainMetric; includeUndated: boolean };
  onSettingsChange: (settings: { metric: TerrainMetric; includeUndated: boolean }) => void;
  knownAt: string;
  onSource: (id: string) => void;
  onOpenDate: (date: string) => void;
  selectedCluster?: KnowledgeCluster;
  onSelectRegion: (cluster: KnowledgeCluster) => void;
  onShowGraph: () => void;
}

const regionColors: Record<KnowledgeCluster, string> = {
  electronics: '#83b6cc', sds: '#8ac5b7', miracom: '#9cadd6',
  robotics: '#b8bd9b', research: '#b3a3ca',
};
const regionDescriptions: Record<KnowledgeCluster, string> = {
  electronics: '제조 전환과 조직·사업 계획',
  sds: '오케스트레이션과 플랫폼 구성',
  miracom: 'MES·관제와 제조 소프트웨어',
  robotics: '로봇 기업과 협력·계약 자료',
  research: '기술 연구와 논문·특허 자료',
};

const formatCount = (value: number) => value.toLocaleString('ko-KR');

export function KnowledgeTerrain({ graph, surface, settings, onSettingsChange, knownAt, onSource, onOpenDate, selectedCluster, onSelectRegion, onShowGraph }: KnowledgeTerrainProps) {
  const [presentation, setPresentation] = useState<'map' | 'evolution'>('map');
  const regions = useMemo(() => terrainRegions(graph), [graph]);
  const id = useId().replace(/:/g, '');
  const summary = useMemo(() => ({
    documents: new Set(regions.flatMap(region => region.documentIds)).size,
    claims: new Set(regions.flatMap(region => region.claimIds)).size,
    sourceGroups: new Set(regions.flatMap(region => region.sourceGroupKeys)).size,
    nodeIds: [...new Set(regions.flatMap(region => region.nodeIds))].sort(),
    relationIds: [...new Set(regions.flatMap(region => region.relationIds))].sort(),
  }), [regions]);

  return <section className="knowledge-terrain" aria-labelledby={`${id}-title`}
    data-testid="terrain-overview"
    data-terrain-node-ids={JSON.stringify(summary.nodeIds)}
    data-terrain-relation-ids={JSON.stringify(summary.relationIds)}>
    <header className="terrain-heading">
      <div>
        <p className="terrain-eyebrow"><span/>KNOWLEDGE TERRAIN <span className="terrain-edition">/ 03</span></p>
        <h2 id={`${id}-title`}>증거가 쌓이는 지형</h2>
        <p className="terrain-intro">시간을 움직여 근거의 축적을 살펴보고, 지형 위의 주장과 원문을 펼쳐 읽으세요.</p>
      </div>
      <button className="terrain-graph-button" onClick={onShowGraph}><Network size={15}/><span>전체 관계 지도</span><ArrowUpRight size={15}/></button>
    </header>

    <div className="terrain-summary" aria-label="현재 그래프의 등록 자료">
      <span className="terrain-scope"><span className="terrain-scope-dot"/>현재 선택 범위</span>
      <span><b>{formatCount(summary.documents)}</b> 문서</span>
      <span><b>{formatCount(summary.claims)}</b> 주장</span>
      <span><b>{formatCount(summary.sourceGroups)}</b> 출처군</span>
      <span className="terrain-summary-end">5개 주제 구역</span>
    </div>

    <div className="terrain-presentation" aria-label="지식 지형 보기 선택">
      <button aria-pressed={presentation === 'map'} onClick={() => setPresentation('map')}>주제 지도</button>
      <button aria-pressed={presentation === 'evolution'} onClick={() => setPresentation('evolution')}>근거의 시간축</button>
      <span>위치는 유지하고, 축적된 자료를 시간으로 살펴보세요.</span>
    </div>
    {presentation === 'evolution' ? <KnowledgeEvolution graph={graph} knownAt={knownAt} onSource={onSource} onOpenDate={value => { onOpenDate(value); setPresentation('map'); }}/> : <>
    <Suspense fallback={<div className="terrain-loading" role="status">근거 지형을 불러오는 중…</div>}><KnowledgeLandscape graph={graph} surface={surface} settings={settings} onSettingsChange={onSettingsChange} knownAt={knownAt} onOpenDate={onOpenDate} onSource={onSource} onSelectRegion={onSelectRegion}/></Suspense>

    <div className="terrain-region-list" aria-label="탐색할 주제 구역">
      {regions.map((region, index) => {
        const [name, ...topics] = region.label.split(' · ');
        const topic = topics.join(' · ');
        const selected = selectedCluster === region.id;
        return <button key={region.id} className={`terrain-region-button${selected ? ' is-selected' : ''}`}
          style={{ '--region-color': regionColors[region.id] } as CSSProperties}
          aria-label={`${region.label} 구역 탐색`} aria-pressed={selected}
          aria-describedby={`${id}-${region.id}-counts`}
          data-region-id={region.id} data-region-node-ids={JSON.stringify(region.nodeIds)}
          data-region-relation-ids={JSON.stringify(region.relationIds)}
          data-region-document-count={region.documentCount} data-region-claim-count={region.claimCount}
          data-region-source-group-count={region.sourceGroupCount}
          onClick={() => onSelectRegion(region.id)}>
          <span className="terrain-card-top"><span className="terrain-card-index">0{index + 1}</span><ArrowUpRight size={15}/></span>
          <span className="terrain-card-title">{name}<small>{topic}</small></span>
          <span className="terrain-card-description">{regionDescriptions[region.id]}</span>
          <span className="terrain-card-counts" id={`${id}-${region.id}-counts`}><span><b>{formatCount(region.documentCount)}</b> 문서</span><span><b>{formatCount(region.claimCount)}</b> 주장</span><span><b>{formatCount(region.sourceGroupCount)}</b> 출처군</span></span>
          <span className="terrain-card-action">{region.nodeIds.length ? '구역 탐색' : '현재 범위에 등록 자료 없음'}<ArrowRight size={12}/></span>
        </button>;
      })}
    </div>

    </>}
    <footer className="terrain-footnote">
      <p>숫자는 등록 자료의 밀도를 살펴보는 단서이며, 근거의 신뢰도나 사업 성공 확률을 뜻하지 않습니다.</p>
      <p>출처군은 같은 발표·원작을 묶은 수입니다. 독립 검증 횟수가 아닙니다.</p>
    </footer>
  </section>;
}

export default KnowledgeTerrain;
