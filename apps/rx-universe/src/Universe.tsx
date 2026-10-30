import React, { Component, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

type Kind = 'organization' | 'technology' | 'hypothesis' | 'evidence';
type Position = [number, number, number];
type LabelPortal = React.RefObject<HTMLDivElement | null>;
interface GraphNode { id: string; title: string; subtitle?: string; kind: Kind; position: Position; size: number }
export interface UniverseProps { mode: '3d' | '2d'; filter: string; search: string; onSelect: (id: string) => void }
const colors: Record<Kind, string> = { organization: '#4ce8c4', technology: '#62acff', hypothesis: '#a896f4', evidence: '#d8ab61' };
const nodes: GraphNode[] = [
  { id: 'se', title: 'SAMSUNG ELECTRONICS', subtitle: '삼성전자 · 독립 탐색 축', kind: 'organization', position: [-4.9, 1.55, .1], size: .21 },
  { id: 'sds', title: 'SAMSUNG SDS', subtitle: '삼성SDS · 독립 탐색 축', kind: 'organization', position: [.4, .65, 1], size: .28 },
  { id: 'miracom', title: 'MIRACOM', subtitle: '미라콤 · 독립 탐색 축', kind: 'organization', position: [4.7, -.8, -.4], size: .19 },
  { id: 'mes', title: 'MES', kind: 'technology', position: [4.1, 1.3, -.5], size: .10 },
  { id: 'job', title: 'Job orchestration', kind: 'technology', position: [-.95, 2.2, -.5], size: .10 },
  { id: 'task', title: 'Task graph', kind: 'technology', position: [2, 1.9, -.7], size: .11 },
  { id: 'scheduling', title: 'Scheduling', kind: 'technology', position: [-.8, -1.5, 0], size: .10 },
  { id: 'dispatch', title: 'Dispatch', kind: 'technology', position: [2.4, -2.15, .4], size: .09 },
  { id: 'rcs', title: 'RCS / API', kind: 'technology', position: [5.6, 1, .7], size: .11 },
  { id: 'robot', title: 'Robot fleet', kind: 'technology', position: [5.9, -2.15, .6], size: .11 },
  { id: 'kpi', title: 'Operational KPI', kind: 'evidence', position: [3.7, -3, .1], size: .10 },
  { id: 'factory', title: 'Manufacturing sites', subtitle: '현장·상용화 검증 필요', kind: 'organization', position: [-3.5, -1.2, .6], size: .12 },
  { id: 'platform', title: 'Shared platform', kind: 'hypothesis', position: [.3, 3.2, -.4], size: .12 },
  { id: 'vertical', title: 'Vertical integration', kind: 'hypothesis', position: [-5.7, -1.55, -.2], size: .11 },
  { id: 'distributed', title: 'Distributed SI', kind: 'hypothesis', position: [6, -3.05, -.2], size: .10 },
  { id: 'api', title: 'Common API', kind: 'technology', position: [2.5, -.1, .7], size: .11 },
  { id: 'partner', title: 'External partners', kind: 'organization', position: [-2.8, 3.15, -.7], size: .10 },
  { id: 'evidence', title: 'Evidence vault', subtitle: '원출처 검증 대기', kind: 'evidence', position: [-2.1, -3, -.5], size: .12 },
];
const connections: [string, string][] = [
  ['se', 'vertical'], ['se', 'factory'], ['se', 'partner'], ['sds', 'platform'], ['sds', 'job'], ['sds', 'task'],
  ['sds', 'scheduling'], ['sds', 'api'], ['sds', 'partner'], ['sds', 'factory'], ['miracom', 'mes'], ['miracom', 'rcs'],
  ['miracom', 'robot'], ['miracom', 'distributed'], ['job', 'task'], ['task', 'scheduling'], ['scheduling', 'dispatch'],
  ['dispatch', 'rcs'], ['rcs', 'robot'], ['robot', 'kpi'], ['factory', 'evidence'], ['platform', 'api'], ['api', 'rcs'],
  ['evidence', 'sds'], ['evidence', 'kpi'], ['mes', 'job'],
];
const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
function matches(node: GraphNode, filter: string, search: string) {
  const normalized = filter.trim().toLowerCase();
  const category = !normalized || ['all', '전체', 'all types'].includes(normalized) || normalized.includes(node.kind) ||
    (node.kind === 'organization' && /compan|기업|조직/.test(normalized)) ||
    (node.kind === 'technology' && /tech|기술/.test(normalized)) ||
    (node.kind === 'hypothesis' && /hypothes|가설/.test(normalized)) ||
    (node.kind === 'evidence' && /source|근거|증거/.test(normalized));
  return category && `${node.id} ${node.title} ${node.subtitle ?? ''}`.toLowerCase().includes(search.trim().toLowerCase());
}
function seeded(index: number) { const x = Math.sin(index * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
const cloud = Array.from({ length: 132 }, (_, i) => {
  const center = [nodes[0], nodes[1], nodes[2]][i % 3];
  const angle = seeded(i + 1) * Math.PI * 2, radius = .45 + seeded(i + 72) * 2;
  return { position: [center.position[0] + Math.cos(angle) * radius, center.position[1] + Math.sin(angle) * radius * .8, center.position[2] + (seeded(i + 50) - .5) * 2.6] as Position, parent: center, size: .012 + seeded(i + 200) * .026 };
});

function StarCloud() {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(cloud.flatMap(p => p.position), 3));
    return g;
  }, []);
  return <group>
    <points geometry={geometry}><pointsMaterial color="#73c6bc" size={.035} transparent opacity={.5} sizeAttenuation depthWrite={false} /></points>
    {cloud.filter((_, i) => i % 2 === 0).map((p, i) => <Line key={i} points={[p.parent.position, p.position]} color="#254c49" lineWidth={.6} transparent opacity={.36} />)}
  </group>;
}

function Node({ node, active, onSelect, portal }: { node: GraphNode; active: boolean; onSelect: (id: string) => void; portal: LabelPortal }) {
  const [hover, setHover] = useState(false);
  useEffect(() => () => { document.body.style.cursor = ''; }, []);
  useEffect(() => { if (!active) { setHover(false); document.body.style.cursor = ''; } }, [active]);
  const color = colors[node.kind];
  const primary = ['se', 'sds', 'miracom'].includes(node.id);
  return <group position={node.position}>
    <mesh onClick={e => { if (!active) return; e.stopPropagation(); onSelect(node.id); }} onPointerOver={e => { if (!active) return; e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; }} onPointerOut={() => { setHover(false); document.body.style.cursor = ''; }}>
      <sphereGeometry args={[node.size * (hover ? 1.16 : 1), 24, 24]} />
      <meshBasicMaterial color={color} transparent opacity={active ? .94 : .11} />
    </mesh>
    <mesh><sphereGeometry args={[node.size * 1.65, 24, 24]} /><meshBasicMaterial color={color} transparent opacity={active ? (hover ? .16 : .065) : .015} depthWrite={false} /></mesh>
    {primary && <mesh rotation={[Math.PI / 2.8, .2, .3]}><torusGeometry args={[node.size * 2.1, .008, 8, 64]} /><meshBasicMaterial color={color} transparent opacity={active ? .55 : .06} /></mesh>}
    {active && <Html portal={portal as React.ComponentProps<typeof Html>['portal']} center position={[0, -node.size - (primary ? .38 : .22), 0]} distanceFactor={15} style={{ pointerEvents: 'none' }}>
      <button type="button" tabIndex={-1} onClick={() => onSelect(node.id)} style={{ pointerEvents: 'auto', color: primary ? '#deeee9' : color, background: primary ? 'rgba(8,20,22,.72)' : 'rgba(8,18,21,.53)', border: 'none', padding: primary ? '6px 9px' : '3px 6px', borderRadius: 3, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit', fontSize: primary ? 11 : 9, letterSpacing: primary ? '1px' : '.15px', fontWeight: primary ? 600 : 400, textAlign: 'center', opacity: primary || hover ? 1 : .78 }}>
        {node.title}{primary && <span style={{ display: 'block', color: '#78958e', fontSize: 8, letterSpacing: '.2px', marginTop: 5 }}>{node.subtitle}</span>}
      </button>
    </Html>}
  </group>;
}
function GraphLink({ from, to, active, onSelect }: { from: GraphNode; to: GraphNode; active: boolean; onSelect: (id: string) => void }) {
  const [hover, setHover] = useState(false);
  useEffect(() => () => { document.body.style.cursor = ''; }, []);
  useEffect(() => { if (!active) { setHover(false); document.body.style.cursor = ''; } }, [active]);
  const points: Position[] = [from.position, to.position];
  return <group>
    <Line points={points} color={hover ? '#bce8db' : from.kind === 'hypothesis' || to.kind === 'hypothesis' ? '#7965b2' : '#497476'} lineWidth={hover ? 1.3 : .7} dashed dashSize={.075} gapSize={.065} transparent opacity={active ? (hover ? .9 : .52) : .08} />
    {active && <Line points={points} lineWidth={10} transparent opacity={0} depthWrite={false}
      onClick={event => { event.stopPropagation(); onSelect('evidence'); }}
      onPointerOver={event => { event.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { setHover(false); document.body.style.cursor = ''; }} />}
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
function Scene({ filter, search, onSelect, portal }: Omit<UniverseProps, 'mode'> & { portal: LabelPortal }) {
  const activeIds = new Set(nodes.filter(n => matches(n, filter, search)).map(n => n.id));
  return <>
    <StarCloud />
    {connections.map(([a, b]) => <GraphLink key={`${a}-${b}`} from={byId[a]} to={byId[b]} active={activeIds.has(a) && activeIds.has(b)} onSelect={onSelect} />)}
    {nodes.map(node => <Node key={node.id} node={node} active={activeIds.has(node.id)} onSelect={onSelect} portal={portal} />)}
    <OrbitControls makeDefault enablePan enableZoom minDistance={8} maxDistance={25} maxPolarAngle={Math.PI * .8} minPolarAngle={Math.PI * .2} enableDamping={false} />
  </>;
}
function FlatGraph({ filter, search, onSelect }: Omit<UniverseProps, 'mode'>) {
  const glowId = useId();
  const pos = (n: GraphNode) => [460 + n.position[0] * 57, 248 - n.position[1] * 52];
  const activeIds = new Set(nodes.filter(n => matches(n, filter, search)).map(n => n.id));
  return <svg role="group" aria-label="RX 지식 그래프 2D. 모든 연결은 검증 전 가설입니다." viewBox="0 0 920 500" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
    <defs><radialGradient id={glowId}><stop offset="0" stopColor="#40d1b6" stopOpacity=".12" /><stop offset="1" stopColor="#40d1b6" stopOpacity="0" /></radialGradient></defs>
    {nodes.slice(0, 3).map(n => <circle key={`glow-${n.id}`} cx={pos(n)[0]} cy={pos(n)[1]} r="125" fill={`url(#${glowId})`} />)}
    {cloud.map((p, i) => { const x = 460 + p.position[0] * 57, y = 248 - p.position[1] * 52; return <g key={i}><line x1={pos(p.parent)[0]} y1={pos(p.parent)[1]} x2={x} y2={y} stroke="#284b48" strokeWidth=".5" opacity=".45" /><circle cx={x} cy={y} r={p.size * 37} fill="#82c2b7" opacity=".45" /></g>; })}
    {connections.map(([a, b]) => { const active = activeIds.has(a) && activeIds.has(b); const line = { x1: pos(byId[a])[0], y1: pos(byId[a])[1], x2: pos(byId[b])[0], y2: pos(byId[b])[1] }; return <g key={`${a}-${b}`} className="rx-link" role="button" aria-disabled={!active} aria-label={`${byId[a].title}와 ${byId[b].title} 연결 근거 보기 — 검증 전 가설`} tabIndex={active ? 0 : -1} onClick={() => { if (active) onSelect('evidence'); }} onKeyDown={e => { if (active && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect('evidence'); } }} style={{ cursor: active ? 'pointer' : 'default', outline: 'none', pointerEvents: active ? 'auto' : 'none' }}>
      <title>{byId[a].title} ↔ {byId[b].title} · 연결 근거 보기 (검증 전)</title>
      <line {...line} stroke="transparent" strokeWidth="12" />
      <line {...line} className="rx-link-line" stroke="#54717b" strokeDasharray="3 5" opacity={active ? .55 : .1} strokeWidth=".9" pointerEvents="none" />
    </g>; })}
    {nodes.map(n => { const [x, y] = pos(n), primary = ['se', 'sds', 'miracom'].includes(n.id), active = activeIds.has(n.id); return <g key={n.id} role="button" aria-disabled={!active} aria-label={`${n.title} 상세 보기`} tabIndex={active ? 0 : -1} onClick={() => { if (active) onSelect(n.id); }} onKeyDown={e => { if (!active) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(n.id); } }} style={{ cursor: active ? 'pointer' : 'default', outline: 'none', opacity: active ? 1 : .1, pointerEvents: active ? 'auto' : 'none' }}>
      <title>{n.title} — 상세 보기 · 검증 전 설계 노드</title>
      <circle cx={x} cy={y} r={n.size * 70} fill={colors[n.kind]} opacity=".09" />
      {primary && <circle cx={x} cy={y} r={n.size * 57} fill="none" stroke={colors[n.kind]} strokeWidth=".6" opacity=".5" />}
      <circle cx={x} cy={y} r={n.size * 35} fill={colors[n.kind]} />
      <text x={x} y={y + n.size * 45 + 14} fill={primary ? '#d7e7e4' : colors[n.kind]} textAnchor="middle" fontFamily="inherit" fontSize={primary ? '10' : '8.5'} letterSpacing={primary ? '.8px' : '.1px'}>{n.title}</text>
      {primary && <text x={x} y={y + n.size * 45 + 28} fill="#7b8e8d" textAnchor="middle" fontFamily="inherit" fontSize="7.5">{n.subtitle}</text>}
    </g>; })}
  </svg>;
}
class GraphBoundary extends Component<{ children: React.ReactNode; fallback: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
function supportsWebGL() {
  if (typeof document === 'undefined') return false;
  try { const c = document.createElement('canvas'); const gl = c.getContext('webgl2'); if (!gl) return false; gl.getExtension('WEBGL_lose_context')?.loseContext(); return true; } catch { return false; }
}
export default function Universe({ mode, filter, search, onSelect }: UniverseProps) {
  const [webgl, setWebgl] = useState(supportsWebGL);
  const [keyboard, setKeyboard] = useState(false);
  const listId = useId();
  const listToggle = useRef<HTMLButtonElement>(null);
  const [labelHost, setLabelHost] = useState<HTMLDivElement | null>(null);
  const labelPortal = useMemo<LabelPortal>(() => ({ current: labelHost }), [labelHost]);
  const flat = <FlatGraph filter={filter} search={search} onSelect={onSelect} />;
  const activeNodes = nodes.filter(n => matches(n, filter, search));
  const activeIds = new Set(activeNodes.map(n => n.id));
  const activeConnections = connections.filter(([a, b]) => activeIds.has(a) && activeIds.has(b));
  return <div className="universe-visual" style={{ position: 'relative', width: '100%', height: '100%', minHeight: 330, isolation: 'isolate', background: 'radial-gradient(ellipse at 48% 47%, rgba(20,59,58,.1), transparent 70%)' }}>
    <style>{`.universe-visual [role=button]:focus-visible circle:last-of-type { stroke: #fff; stroke-width: 2px; } .universe-visual button:focus-visible { outline: 2px solid #76d9c1; outline-offset: 3px; } .universe-visual .rx-link:focus-visible .rx-link-line, .universe-visual .rx-link:hover .rx-link-line { stroke: #d6fff2; stroke-width: 2px; opacity: 1; }`}</style>
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, zIndex: -1, opacity: .14, backgroundImage: 'radial-gradient(#78a09c .55px, transparent .55px)', backgroundSize: '24px 24px' }} />
    {/* Drei owns this host's label children; React and Canvas never reconcile them. */}
    <div ref={setLabelHost} className="universe-label-portal" style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none', overflow: 'hidden' }} />
    {mode === '3d' && webgl ? labelHost && <GraphBoundary fallback={flat}><Canvas camera={{ position: [0, .15, 15], fov: 40 }} dpr={[1, 1.5]} frameloop="demand" gl={{ antialias: true, alpha: true }} style={{ background: 'transparent' }}><ContextLossFallback onLost={() => setWebgl(false)} /><Scene filter={filter} search={search} onSelect={onSelect} portal={labelPortal} /></Canvas></GraphBoundary> : flat}
    <button type="button" ref={listToggle} onClick={() => setKeyboard(v => !v)} aria-expanded={keyboard} aria-controls={listId} style={{ position: 'absolute', right: 14, bottom: 30, zIndex: 2, padding: '5px 8px', border: '1px solid #263a3a', borderRadius: 4, color: '#92aaa4', background: '#0b171b', fontFamily: 'inherit', fontSize: 9, cursor: 'pointer' }}>노드 목록 {keyboard ? '−' : '+'}</button>
    {keyboard && <div id={listId} aria-label="그래프 노드와 연결 목록" onKeyDown={event => { if (event.key === 'Escape') { setKeyboard(false); listToggle.current?.focus(); } }} style={{ position: 'absolute', right: 14, bottom: 61, zIndex: 2, maxHeight: 280, overflow: 'auto', width: 230, padding: 7, border: '1px solid #2b4140', background: '#0c181deF', borderRadius: 5 }}><div style={{ padding: '6px 7px', fontSize: 10, color: '#849b96' }}>노드 선택</div>{activeNodes.map(n => <button type="button" key={n.id} onClick={() => onSelect(n.id)} style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: colors[n.kind], padding: '8px 7px', fontSize: 11, cursor: 'pointer' }}>{n.title}</button>)}{activeConnections.length > 0 && <><div style={{ padding: '12px 7px 6px', fontSize: 10, color: '#849b96', borderTop: '1px solid #263a3a', marginTop: 5 }}>연결 근거 · 검증 전</div>{activeConnections.map(([a, b]) => <button type="button" key={`${a}-${b}`} onClick={() => onSelect('evidence')} aria-label={`${byId[a].title}와 ${byId[b].title} 연결 근거 보기`} style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: '#b6c5c0', padding: '8px 7px', fontSize: 10, cursor: 'pointer' }}>{byId[a].title} ↔ {byId[b].title}</button>)}</>}{!activeNodes.length && <span style={{ color: '#93a09f', fontSize: 11 }}>일치하는 노드가 없습니다.</span>}</div>}
    {!activeNodes.length && <div role="status" style={{ position: 'absolute', inset: '40% 20% auto', textAlign: 'center', color: '#acb9b5', fontSize: 13, padding: 15, background: '#0b171be6', border: '1px solid #273c3a', borderRadius: 6 }}>검색 조건에 맞는 노드가 없습니다.</div>}
  </div>;
}
