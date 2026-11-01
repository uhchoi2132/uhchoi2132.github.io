import { useId, useMemo, type CSSProperties } from 'react';
import { ArrowRight, ArrowUpRight, Network } from 'lucide-react';
import type { KnowledgeCluster, KnowledgeGraph } from './knowledge';
import { terrainRegions } from './terrain';
import './terrain.css';

export interface KnowledgeTerrainProps {
  graph: KnowledgeGraph;
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

/** Equal, fixed rings encode navigation levels, never a score or amount. */
const contour = 'M -145 -8 C -155 -65 -109 -99 -54 -106 C -5 -122 55 -112 102 -83 C 147 -55 157 -6 137 38 C 116 85 55 107 4 99 C -49 108 -106 83 -132 45 C -145 27 -146 8 -145 -8 Z';
const levels = [1, .77, .54];
const formatCount = (value: number) => value.toLocaleString('ko-KR');

export function KnowledgeTerrain({ graph, selectedCluster, onSelectRegion, onShowGraph }: KnowledgeTerrainProps) {
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
        <p className="terrain-eyebrow"><span/>KNOWLEDGE TERRAIN <span className="terrain-edition">/ 01</span></p>
        <h2 id={`${id}-title`}>주제 구역에서 시작하세요</h2>
        <p className="terrain-intro">관심 있는 구역을 선택해 기업과 기술의 관계를 살펴보고, 주장과 원문까지 따라가세요.</p>
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

    <div className="terrain-map-shell">
      <div className="terrain-map-caption"><span>TOPIC OVERVIEW</span><span>구역 선택 → 관계 탐색</span></div>
      {/* Equivalent HTML buttons below provide the full keyboard and mobile path. */}
      <svg className="terrain-map" viewBox="0 0 1000 535" aria-hidden="true" focusable="false">
        <defs>
          <pattern id={`${id}-dots`} x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".65" fill="#537080" opacity=".27"/></pattern>
          <radialGradient id={`${id}-wash`}><stop offset="0" stopColor="#152d39" stopOpacity=".42"/><stop offset="1" stopColor="#0b141d" stopOpacity="0"/></radialGradient>
        </defs>
        <rect width="1000" height="535" fill={`url(#${id}-dots)`}/>
        <rect width="1000" height="535" fill={`url(#${id}-wash)`}/>
        <path className="terrain-map-frame" d="M24 60 V24 H60 M940 24 H976 V60 M24 475 V511 H60 M940 511 H976 V475"/>
        <path className="terrain-map-crosshair" d="M492 271 H508 M500 263 V279"/>
        {regions.map((region, index) => {
          const [x, y] = [500 + region.center[0] * 29, 245 - region.center[1] * 20];
          const [name, ...topics] = region.label.split(' · ');
          const topic = topics.join(' · ');
          const selected = selectedCluster === region.id;
          const empty = region.nodeIds.length === 0;
          return <g key={region.id} className={`terrain-map-region${selected ? ' is-selected' : ''}${empty ? ' is-empty' : ''}`}
            transform={`translate(${x} ${y})`} style={{ '--region-color': regionColors[region.id] } as CSSProperties}
            data-terrain-region={region.id} onClick={() => onSelectRegion(region.id)}>
            <title>{`${region.label} · 문서 ${region.documentCount} · 주장 ${region.claimCount} · 출처군 ${region.sourceGroupCount}`}</title>
            {levels.map((scale, ring) => <path key={scale} className={`terrain-contour terrain-contour-${ring + 1}`} d={contour} transform={`scale(${scale})`}/>)}
            <circle className="terrain-region-dot" cx="0" cy="-37" r="3.5"/>
            <text className="terrain-map-title" textAnchor="middle" y="-9">{name}</text>
            <text className="terrain-map-subtitle" textAnchor="middle" y="13">{topic}</text>
            <text className="terrain-map-count" textAnchor="middle" y="42">문서 {formatCount(region.documentCount)} <tspan className="terrain-count-separator"> / </tspan> 주장 {formatCount(region.claimCount)}</text>
            <text className="terrain-map-index" x="-119" y="-76">0{index + 1}</text>
            <path className="terrain-region-arrow" d="M104 69 H114 V79 M114 69 L103 80"/>
          </g>;
        })}
      </svg>
      <div className="terrain-map-key">
        <span className="terrain-key-rings" aria-hidden="true"><i/><i/><i/></span>
        <p><b>주제 → 관계 → 원문</b><span>3겹의 등고선은 탐색 단계입니다. 높이·성과·확신도를 나타내지 않습니다.</span></p>
      </div>
    </div>

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

    <footer className="terrain-footnote">
      <p>숫자는 등록 자료의 밀도를 살펴보는 단서이며, 근거의 신뢰도나 사업 성공 확률을 뜻하지 않습니다.</p>
      <p>출처군은 같은 발표·원작을 묶은 수입니다. 독립 검증 횟수가 아닙니다.</p>
    </footer>
  </section>;
}

export default KnowledgeTerrain;
