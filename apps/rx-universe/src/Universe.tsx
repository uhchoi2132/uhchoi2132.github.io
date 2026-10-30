import React, { Component, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import type { PerspectiveCamera } from 'three';
import type { KnowledgeGraph, KnowledgeNode, KnowledgeRelation } from './knowledge';
import { graphView } from './graph-view';

type Position = [number, number, number];
type LabelPortal = React.RefObject<HTMLDivElement | null>;
export interface UniverseProps {
  mode: '3d' | '2d';
  filter: string;
  search: string;
  graph: KnowledgeGraph;
  onSelect: (nodeId: string) => void;
  onSelectRelation: (relationId: string) => void;
}
type GraphRendererProps = Pick<UniverseProps, 'graph' | 'onSelect' | 'onSelectRelation'>;
const colors: Record<KnowledgeNode['kind'], string> = { organization: '#4ce8c4', technology: '#62acff', hypothesis: '#a896f4', evidence: '#d8ab61' };
const primaryNode = (node: KnowledgeNode) => node.kind === 'organization' && node.size >= .16;
const relationStatus = (relation: KnowledgeRelation) => relation.inferred ? '분석 연결 · 검토 필요' : '출처 귀속 관계';
const relationColor = (relation: KnowledgeRelation) => relation.type === 'contradicts' ? '#bd847a' : relation.inferred ? '#8b78bb' : '#547f79';
const relationName = (relation: KnowledgeRelation, from: KnowledgeNode, to: KnowledgeNode) => `${from.title} → ${to.title} · ${relation.label} · ${relationStatus(relation)} · 연결 근거 보기`;
interface Boundaries { center: Position; span: Position }
function graphBounds(nodes: KnowledgeNode[]): Boundaries {
  if (!nodes.length) return { center: [0, 0, 0], span: [10, 6, 2] };
  const min: Position = [Infinity, Infinity, Infinity];
  const max: Position = [-Infinity, -Infinity, -Infinity];
  for (const node of nodes) for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis], node.position[axis] - node.size);
    max[axis] = Math.max(max[axis], node.position[axis] + node.size);
  }
  return { center: min.map((value, axis) => (value + max[axis]) / 2) as Position, span: min.map((value, axis) => Math.max(2, max[axis] - value)) as Position };
}
function FitCamera({ bounds }: { bounds: Boundaries }) {
  const { camera, size, invalidate } = useThree();
  const [x, y, z] = bounds.center;
  const [width, height, depth] = bounds.span;
  useEffect(() => {
    const perspective = camera as PerspectiveCamera;
    const halfFov = perspective.fov * Math.PI / 360;
    const aspect = Math.max(.2, size.width / Math.max(1, size.height));
    const distance = Math.max(height / (2 * Math.tan(halfFov)), (width + 2) / (2 * Math.tan(halfFov) * aspect), 7) * 1.25 + depth / 2;
    perspective.position.set(x, y, z + distance);
    perspective.lookAt(x, y, z);
    perspective.updateProjectionMatrix();
    invalidate();
  }, [camera, size.width, size.height, x, y, z, width, height, depth, invalidate]);
  return null;
}
function Node({ node, active, onSelect, portal, showMinorLabels }: { node: KnowledgeNode; active: boolean; onSelect: (id: string) => void; portal: LabelPortal; showMinorLabels: boolean }) {
  const [hover, setHover] = useState(false);
  useEffect(() => () => { document.body.style.cursor = ''; }, []);
  useEffect(() => { if (!active) { setHover(false); document.body.style.cursor = ''; } }, [active]);
  const color = colors[node.kind];
  const primary = primaryNode(node);
  const labelVisible = primary || node.kind === 'hypothesis' || showMinorLabels || hover;
  const displayTitle = primary ? node.subtitle?.split('·')[0].trim() || node.title : node.title;
  return <group position={node.position}>
    <mesh onClick={event => { if (!active) return; event.stopPropagation(); onSelect(node.id); }} onPointerOver={event => { if (!active) return; event.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; }} onPointerOut={() => { setHover(false); document.body.style.cursor = ''; }}>
      <sphereGeometry args={[node.size * (hover ? 1.16 : 1), 24, 24]}/><meshBasicMaterial color={color} transparent opacity={active ? .94 : .11}/>
    </mesh>
    <mesh><sphereGeometry args={[node.size * 1.65, 24, 24]}/><meshBasicMaterial color={color} transparent opacity={active ? (hover ? .16 : .065) : .015} depthWrite={false}/></mesh>
    {primary && <mesh rotation={[Math.PI / 2.8, .2, .3]}><torusGeometry args={[node.size * 2.1, .008, 8, 64]}/><meshBasicMaterial color={color} transparent opacity={active ? .55 : .06}/></mesh>}
    {active && <Html portal={portal as React.ComponentProps<typeof Html>['portal']} center position={[0, -node.size - (primary ? .28 : .22), 0]} distanceFactor={15} style={{ pointerEvents: 'none' }}>
      <button type="button" tabIndex={-1} data-graph-node-id={node.id} data-node-id={node.id} aria-label={`${node.title} 상세 보기`} aria-hidden={!labelVisible} title={node.subtitle ? `${node.title} · ${node.subtitle}` : node.title} onClick={() => onSelect(node.id)} style={{ visibility: labelVisible ? 'visible' : 'hidden', pointerEvents: labelVisible ? 'auto' : 'none', color: primary ? '#deeee9' : color, background: hover ? 'rgba(12,33,31,.97)' : 'rgba(8,20,22,.88)', border: 'none', padding: primary ? '5px 8px' : '4px 7px', borderRadius: 3, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit', fontSize: primary || hover ? 11 : 9, letterSpacing: '.15px', fontWeight: primary ? 600 : 400, textAlign: 'center', opacity: primary || hover ? 1 : .9 }}>
        {displayTitle}
      </button>
    </Html>}
  </group>;
}
function GraphLink({ relation, from, to, active, onSelectRelation, portal }: { relation: KnowledgeRelation; from: KnowledgeNode; to: KnowledgeNode; active: boolean; onSelectRelation: (id: string) => void; portal: LabelPortal }) {
  const [hover, setHover] = useState(false);
  useEffect(() => () => { document.body.style.cursor = ''; }, []);
  useEffect(() => { if (!active) { setHover(false); document.body.style.cursor = ''; } }, [active]);
  const points: Position[] = [from.position, to.position];
  const midpoint = from.position.map((value, axis) => (value + to.position[axis]) / 2) as Position;
  return <group>
    <Line points={points} color={hover ? '#c4e8dc' : relationColor(relation)} lineWidth={hover ? 1.6 : 1} dashed={relation.inferred} dashSize={.075} gapSize={.065} transparent opacity={active ? (hover ? .95 : .65) : .08}/>
    {active && <Line points={points} lineWidth={10} transparent opacity={0} depthWrite={false}
      onClick={event => { event.stopPropagation(); onSelectRelation(relation.id); }}
      onPointerOver={event => { event.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { setHover(false); document.body.style.cursor = ''; }}/>}
    {active && hover && <Html portal={portal as React.ComponentProps<typeof Html>['portal']} center position={midpoint} style={{ pointerEvents: 'none' }}><span style={{ display: 'block', padding: '5px 8px', border: '1px solid #47665b', background: '#10211ff2', borderRadius: 4, color: '#c7e3da', fontSize: 10, whiteSpace: 'nowrap' }}>{relation.label} · {relationStatus(relation)}</span></Html>}
  </group>;
}
function ContextLossFallback({ onLost }: { onLost: () => void }) {
  const gl = useThree(state => state.gl);
  useEffect(() => {
    const handleLost = (event: Event) => { event.preventDefault(); onLost(); };
    gl.domElement.addEventListener('webglcontextlost', handleLost);
    return () => gl.domElement.removeEventListener('webglcontextlost', handleLost);
  }, [gl, onLost]);
  return null;
}
function Scene({ graph, onSelect, onSelectRelation, portal }: GraphRendererProps & { portal: LabelPortal }) {
  const nodesById = new Map(graph.nodes.map(node => [node.id, node]));
  const bounds = graphBounds(graph.nodes);
  const radius = Math.max(...bounds.span) / 2;
  return <>
    <FitCamera bounds={bounds}/>
    {graph.relations.map(relation => { const from = nodesById.get(relation.from), to = nodesById.get(relation.to); return from && to ? <GraphLink key={relation.id} relation={relation} from={from} to={to} active onSelectRelation={onSelectRelation} portal={portal}/> : null; })}
    {graph.nodes.map(node => <Node key={node.id} node={node} active onSelect={onSelect} portal={portal} showMinorLabels={graph.nodes.length <= 10}/>)}
    <OrbitControls makeDefault target={bounds.center} enablePan enableZoom minDistance={Math.max(3, radius * .5)} maxDistance={Math.max(100, radius * 10)} maxPolarAngle={Math.PI * .8} minPolarAngle={Math.PI * .2} enableDamping={false}/>
  </>;
}
function FlatGraph({ graph, onSelect, onSelectRelation }: GraphRendererProps) {
  const glowId = useId();
  const position = (node: KnowledgeNode): [number, number] => [node.position[0] * 50, -node.position[1] * 50];
  const bounds = graphBounds(graph.nodes);
  const width = Math.max(660, bounds.span[0] * 50 + 180), height = Math.max(370, bounds.span[1] * 50 + 110);
  const viewBox = `${bounds.center[0] * 50 - width / 2} ${-bounds.center[1] * 50 - height / 2} ${width} ${height}`;
  const nodesById = new Map(graph.nodes.map(node => [node.id, node]));
  return <svg role="group" aria-label="RX 지식 그래프 2D. 실선은 출처 귀속 관계, 점선은 분석 연결입니다." viewBox={viewBox} style={{ width: '100%', height: '100%', overflow: 'visible' }}>
    <defs><radialGradient id={glowId}><stop offset="0" stopColor="#40d1b6" stopOpacity=".08"/><stop offset="1" stopColor="#40d1b6" stopOpacity="0"/></radialGradient></defs>
    {graph.nodes.filter(primaryNode).map(node => <circle key={`glow-${node.id}`} cx={position(node)[0]} cy={position(node)[1]} r="65" fill={`url(#${glowId})`} pointerEvents="none"/>)}
    {graph.relations.map(relation => {
      const from = nodesById.get(relation.from), to = nodesById.get(relation.to);
      if (!from || !to) return null;
      const active = true;
      const [x1, y1] = position(from), [x2, y2] = position(to);
      return <g key={relation.id} className="rx-link" data-relation-id={relation.id} data-edge-id={relation.id} data-inferred={String(relation.inferred)} role="button" aria-disabled={!active} aria-label={relationName(relation, from, to)} tabIndex={active ? 0 : -1}
        onClick={() => { if (active) onSelectRelation(relation.id); }} onKeyDown={event => { if (active && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelectRelation(relation.id); } }} style={{ cursor: active ? 'pointer' : 'default', outline: 'none', pointerEvents: active ? 'auto' : 'none' }}>
        <title>{relationName(relation, from, to)}{`\n${relation.rationale}`}</title>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth="12"/>
        <line x1={x1} y1={y1} x2={x2} y2={y2} className="rx-link-line" stroke={relationColor(relation)} strokeDasharray={relation.inferred ? '3 5' : undefined} opacity={active ? .7 : .1} strokeWidth="1" pointerEvents="none"/>
        <text className="rx-link-caption" x={(x1+x2)/2} y={(y1+y2)/2-7} fill="#c7e6db" stroke="#0b171b" strokeWidth="4" paintOrder="stroke" textAnchor="middle" fontFamily="inherit" fontSize="9" pointerEvents="none">{relation.label}</text>
      </g>;
    })}
    {graph.nodes.map(node => { const [x, y] = position(node), primary = primaryNode(node), active = true; return <g key={node.id} data-graph-node-id={node.id} data-node-id={node.id} role="button" aria-disabled={!active} aria-label={`${node.title} 상세 보기`} tabIndex={active ? 0 : -1}
      onClick={() => { if (active) onSelect(node.id); }} onKeyDown={event => { if (active && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect(node.id); } }} style={{ cursor: active ? 'pointer' : 'default', outline: 'none', opacity: active ? 1 : .1, pointerEvents: active ? 'auto' : 'none' }}>
      <title>{node.title} — 상세 보기{node.subtitle ? ` · ${node.subtitle}` : ''}</title>
      <circle cx={x} cy={y} r={node.size * 70} fill={colors[node.kind]} opacity=".09"/>
      {primary && <circle cx={x} cy={y} r={node.size * 57} fill="none" stroke={colors[node.kind]} strokeWidth=".6" opacity=".5"/>}
      <circle cx={x} cy={y} r={node.size * 35} fill={colors[node.kind]}/>
      <text x={x} y={y + node.size * 45 + 14} fill={primary ? '#d7e7e4' : colors[node.kind]} textAnchor="middle" fontFamily="inherit" fontSize={primary ? '10' : '8.5'} letterSpacing={primary ? '.8px' : '.1px'}>{node.title}</text>
      {primary && node.subtitle && <text x={x} y={y + node.size * 45 + 28} fill="#7b8e8d" textAnchor="middle" fontFamily="inherit" fontSize="7.5">{node.subtitle}</text>}
    </g>; })}
  </svg>;
}
class GraphBoundary extends Component<{ children: React.ReactNode; fallback: React.ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
function supportsWebGL() {
  if (typeof document === 'undefined') return false;
  // Three r163+ requires WebGL2; WebGL1 devices use the same graph's SVG renderer.
  // https://threejs.org/docs/pages/WebGLRenderer.html
  try { const canvas = document.createElement('canvas'); const gl = canvas.getContext('webgl2'); if (!gl) return false; gl.getExtension('WEBGL_lose_context')?.loseContext(); return true; } catch { return false; }
}
export default function Universe({ mode, filter, search, graph: inputGraph, onSelect, onSelectRelation }: UniverseProps) {
  const graph = useMemo(() => graphView(inputGraph, filter, search), [inputGraph, filter, search]);
  const [webgl, setWebgl] = useState(supportsWebGL);
  const [keyboard, setKeyboard] = useState(false);
  const listId = useId();
  const listToggle = useRef<HTMLButtonElement>(null);
  const [labelHost, setLabelHost] = useState<HTMLDivElement | null>(null);
  const labelPortal = useMemo<LabelPortal>(() => ({ current: labelHost }), [labelHost]);
  const graphProps = { graph, onSelect, onSelectRelation };
  const flat = <FlatGraph {...graphProps}/>;
  const activeNodes = graph.nodes;
  const activeRelations = graph.relations;
  const nodesById = new Map(graph.nodes.map(node => [node.id, node]));
  return <div className="universe-visual" data-renderer={mode === '3d' && webgl ? '3d' : '2d'} data-node-count={graph.nodes.length} data-edge-count={graph.relations.length} data-relation-count={graph.relations.length} data-node-ids={JSON.stringify(graph.nodes.map(node => node.id))} data-edge-ids={JSON.stringify(graph.relations.map(relation => relation.id))} data-active-node-ids={JSON.stringify(activeNodes.map(node => node.id))} data-active-edge-ids={JSON.stringify(activeRelations.map(relation => relation.id))} style={{ position: 'relative', width: '100%', height: '100%', minHeight: 330, isolation: 'isolate', background: 'radial-gradient(ellipse at 48% 47%, rgba(20,59,58,.1), transparent 70%)' }}>
    <style>{`.universe-visual [role=button]:focus-visible circle:last-of-type{stroke:#fff;stroke-width:2px}.universe-visual button:focus-visible{outline:2px solid #76d9c1;outline-offset:3px}.universe-visual .rx-link:focus-visible .rx-link-line,.universe-visual .rx-link:hover .rx-link-line{stroke:#d6fff2;stroke-width:2px;opacity:1}.universe-visual .rx-link-caption{opacity:0}.universe-visual .rx-link:focus-visible .rx-link-caption,.universe-visual .rx-link:hover .rx-link-caption{opacity:1}`}</style>
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, zIndex: -1, opacity: .08, backgroundImage: 'linear-gradient(#78a09c .5px, transparent .5px),linear-gradient(90deg,#78a09c .5px,transparent .5px)', backgroundSize: '28px 28px' }}/>
    {/* Html exclusively owns this stable sibling host's children. Mount Canvas only after the host exists. */}
    <div ref={setLabelHost} className="universe-label-portal" style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none', overflow: 'hidden' }}/>
    {mode === '3d' && webgl ? labelHost && <GraphBoundary fallback={flat} onError={() => setWebgl(false)}><Canvas camera={{ position: [0, .15, 15], fov: 40 }} dpr={[1, 1.5]} frameloop="demand" gl={{ antialias: true, alpha: true }} style={{ background: 'transparent' }}><ContextLossFallback onLost={() => setWebgl(false)}/><Scene {...graphProps} portal={labelPortal}/></Canvas></GraphBoundary> : flat}
    <button type="button" ref={listToggle} onClick={() => setKeyboard(value => !value)} aria-expanded={keyboard} aria-controls={listId} style={{ position: 'absolute', right: 14, bottom: 30, zIndex: 2, padding: '5px 8px', border: '1px solid #263a3a', borderRadius: 4, color: '#92aaa4', background: '#0b171b', fontFamily: 'inherit', fontSize: 9, cursor: 'pointer' }}>노드 목록 {keyboard ? '−' : '+'}</button>
    {keyboard && <div id={listId} aria-label="그래프 노드와 연결 목록" onKeyDown={event => { if (event.key === 'Escape') { setKeyboard(false); listToggle.current?.focus(); } }} style={{ position: 'absolute', right: 14, bottom: 61, zIndex: 2, maxHeight: 280, overflow: 'auto', width: 260, maxWidth: 'calc(100% - 28px)', padding: 7, border: '1px solid #2b4140', background: '#0c181df5', borderRadius: 5 }}>
      <div style={{ padding: '6px 7px', fontSize: 10, color: '#849b96' }}>노드 선택 · {activeNodes.length}</div>
      {activeNodes.map(node => <button type="button" key={node.id} onClick={() => onSelect(node.id)} style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: colors[node.kind], padding: '8px 7px', fontSize: 11, cursor: 'pointer' }}>{node.title}</button>)}
      {activeRelations.length > 0 && <><div style={{ padding: '12px 7px 6px', fontSize: 10, color: '#849b96', borderTop: '1px solid #263a3a', marginTop: 5 }}>관계별 근거 · {activeRelations.length}</div>{activeRelations.map(relation => {
        const from = nodesById.get(relation.from)!, to = nodesById.get(relation.to)!;
        return <button type="button" key={relation.id} data-relation-id={relation.id} data-edge-id={relation.id} onClick={() => onSelectRelation(relation.id)} aria-label={relationName(relation, from, to)} style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: '#b6c5c0', padding: '9px 7px', fontSize: 10, lineHeight: 1.7, cursor: 'pointer' }}><span style={{ display: 'block', color: '#a2cdbf' }}>{relation.label}</span>{from.title} → {to.title}<small style={{ display: 'block', color: '#7b9490', fontSize: 9 }}>{relationStatus(relation)} · 출처 {relation.source_ids.length}건</small></button>;
      })}</>}
      {!activeNodes.length && <span style={{ color: '#93a09f', fontSize: 11 }}>일치하는 노드가 없습니다.</span>}
    </div>}
    {!activeNodes.length && <div role="status" style={{ position: 'absolute', inset: '40% 20% auto', textAlign: 'center', color: '#acb9b5', fontSize: 13, padding: 15, background: '#0b171be6', border: '1px solid #273c3a', borderRadius: 6 }}>{graph.nodes.length ? '검색 조건에 맞는 노드가 없습니다.' : '선택 시점에 표시할 관계가 없습니다.'}</div>}
  </div>;
}
