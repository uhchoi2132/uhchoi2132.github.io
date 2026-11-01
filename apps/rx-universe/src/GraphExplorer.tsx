import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Focus, GitBranch, Network, RotateCcw, Search } from 'lucide-react';
import type { KnowledgeGraph } from './knowledge';
import type { GraphViewOptions } from './graph-view';
import { CLUSTER_LABELS } from './knowledge-ontology';
import './explorer.css';

export const defaultExploration: GraphViewOptions = { layer: 'all', provenance: 'all', hops: 1, searchContext: true };
const layerNames: Record<string, string> = { entities: '기업 · 기술 · 사업', claims: '출처 귀속 주장', sources: '원문 자료' };

interface Props {
  graph: KnowledgeGraph;
  visible: KnowledgeGraph;
  options: GraphViewOptions;
  onChange: (options: GraphViewOptions) => void;
  onReset: () => void;
}
export function ExplorationControls({ graph, visible, options, onChange, onReset }: Props) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => { setFrom(options.pathFrom || ''); setTo(options.pathTo || ''); }, [options.pathFrom, options.pathTo]);
  const entities = graph.nodes;
  const update = (patch: Partial<GraphViewOptions>) => onChange({ ...options, ...patch });
  const relationTypes = [...new Set(graph.relations.map(relation => relation.type))].sort();
  const focus = graph.nodes.find(node => node.id === options.focusNodeId);
  const pathActive = !!options.pathFrom && !!options.pathTo;
  const pathPending = !!options.pathFrom !== !!options.pathTo;
  return <div className="exploration-controls" aria-label="지식 그래프 탐색 도구">
    <div className="exploration-row">
      <label>표시 레이어<select aria-label="그래프 레이어" value={options.layer || 'all'} onChange={event => update({ layer: event.target.value as GraphViewOptions['layer'] })}><option value="all">전체 · 기업 + 주장 + 원문</option><option value="entities">기업 · 기술 · 사업 구조</option><option value="evidence">주장 · 원문 근거</option><option value="claims">주장만</option><option value="sources">원문만</option></select></label>
      <label>주제 구역<select aria-label="주제 구역" value={options.cluster || ''} onChange={event => update({ cluster: event.target.value as GraphViewOptions['cluster'] || undefined, focusNodeId: undefined, pathFrom: undefined, pathTo: undefined })}><option value="">모든 구역</option>{Object.entries(CLUSTER_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>관계 유형<select aria-label="관계 유형" value={options.relationType || 'all'} onChange={event => update({ relationType: event.target.value === 'all' ? undefined : event.target.value })}><option value="all">모든 관계</option>{relationTypes.map(type => <option key={type} value={type}>{type}</option>)}</select></label>
      <label>연결 분류<select aria-label="연결 분류" value={options.provenance || 'all'} onChange={event => update({ provenance: event.target.value as GraphViewOptions['provenance'] })}><option value="all">출처 귀속 + 분석 연결</option><option value="source_attributed">출처 귀속</option><option value="analyst_mapping">분석 연결</option></select></label>
      <label className="context-check"><input type="checkbox" aria-label="검색 주변 연결 포함" checked={options.searchContext ?? false} onChange={event => update({ searchContext: event.target.checked })}/>검색 주변 연결 포함</label>
      <button className="button" onClick={() => { setFrom(''); setTo(''); onReset(); }}><RotateCcw size={13}/>탐색 초기화</button>
    </div>
    <div className="exploration-row exploration-focus">
      <label><span><Focus size={12}/>중심 노드</span><select aria-label="중심 노드" value={options.focusNodeId || ''} onChange={event => update({ focusNodeId: event.target.value || undefined, pathFrom: undefined, pathTo: undefined })}><option value="">전체 네트워크</option>{graph.nodes.map(node => <option key={node.id} value={node.id}>{node.title}</option>)}</select></label>
      <label>탐색 깊이<select aria-label="탐색 깊이" value={options.hops || 1} onChange={event => update({ hops: Number(event.target.value) as 1 | 2 })}><option value="1">1단계 이웃</option><option value="2">2단계 이웃</option></select></label>
      <details className="path-disclosure" open={pathPending || pathActive || undefined}><summary><GitBranch size={13}/>두 노드 사이 경로</summary><div className="path-controls">
        <label>시작<select aria-label="경로 시작" value={from} onChange={event => setFrom(event.target.value)}><option value="">시작 노드 선택</option>{entities.map(node => <option key={node.id} value={node.id}>{node.title}</option>)}</select></label>
        <ArrowRight size={14}/><label>도착<select aria-label="경로 도착" value={to} onChange={event => setTo(event.target.value)}><option value="">도착 노드 선택</option>{entities.map(node => <option key={node.id} value={node.id}>{node.title}</option>)}</select></label>
        <button className="button" disabled={!from || !to} onClick={() => update({ pathFrom: from, pathTo: to, focusNodeId: undefined })}>경로 찾기</button>
        <small>선택한 필터 안의 최소 연결 경로입니다. 연결 방향은 화살표로 표시하며 인과관계·실행 순서를 뜻하지 않습니다.</small>
      </div></details>
    </div>
    <div className="exploration-context" role="status"><span><b>{visible.nodes.length}</b> / {graph.nodes.length} 노드 · <b>{visible.relations.length}</b> / {graph.relations.length} 연결</span><span>{focus ? `${focus.title} · ${options.hops || 1}단계 이웃` : pathActive ? (visible.nodes.length ? '두 노드의 연결 경로' : '현재 필터에서 연결 경로가 없습니다.') : pathPending ? '경로 한쪽을 지정했습니다. 다른 노드의 상세에서 나머지 끝점을 지정하세요.' : '기업 → 세부 기술 → 주장 → 원문을 따라 탐색하세요.'}</span>{(focus || pathActive) && <button onClick={() => update({ focusNodeId: undefined, pathFrom: undefined, pathTo: undefined })}>전체 네트워크로</button>}</div>
  </div>;
}

export function GraphIndex({ graph, visible, onSelect, onFocus, query, onQueryChange }: { graph: KnowledgeGraph; visible: KnowledgeGraph; onSelect: (id: string) => void; onFocus: (id: string) => void; query: string; onQueryChange: (query: string) => void }) {
  const degree = useMemo(() => {
    const result = new Map<string, number>();
    visible.relations.forEach(relation => { result.set(relation.from, (result.get(relation.from) || 0) + 1); result.set(relation.to, (result.get(relation.to) || 0) + 1); });
    return result;
  }, [visible]);
  const entities = [...visible.nodes].sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0));
  const filtered = entities;
  return <section className="panel graph-index" aria-label="네트워크 탐색 목록"><div className="panel-head"><div><Network size={16}/><h2>Object Explorer</h2></div><span className="tag">{entities.length}</span></div>
    <div className="graph-layer-summary">{(['entities', 'claims', 'sources'] as const).map(layer => <div key={layer}><span className={`layer-dot ${layer}`}/><span>{layerNames[layer]}</span><b>{visible.nodes.filter(node => node.layer === layer).length}</b></div>)}</div>
    <label className="index-search"><Search size={13}/><input aria-label="노드 목록 검색" placeholder="지도·목록·내보내기 함께 검색" value={query} onChange={event => onQueryChange(event.target.value)}/></label>
    <div className="graph-index-list">{filtered.map(node => <div key={node.id}><button className="index-object" data-index-node-id={node.id} onClick={() => onSelect(node.id)}><span>{node.title}</span><small>{node.ontology_type} · 연결 {degree.get(node.id) || 0} · 자료 {node.source_ids.length}</small></button><button className="index-focus" onClick={() => onFocus(node.id)} aria-label={`${node.title} 주변 탐색`} title="주변 연결에 집중"><Focus size={14}/></button></div>)}{!filtered.length && <p>현재 조건에 맞는 객체·주장·원문이 없습니다.</p>}</div>
    <div className="graph-reading-guide"><b>관계 읽는 법</b><p>화살표: 관계의 방향<br/>실선: 출처에 귀속된 관계<br/>점선: 분석가가 연결한 관계</p><p>키워드 언급은 기술 의존성이나 사업 계약을 뜻하지 않습니다. 선을 선택하면 주장과 원문을 확인할 수 있습니다.</p><p>노드 크기: 유형별 구분<br/>거리·배치: 탐색을 위한 군집</p></div>
  </section>;
}
