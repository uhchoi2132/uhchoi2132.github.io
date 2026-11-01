import React, { Component, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import { BufferGeometry, Color, Float32BufferAttribute, Vector3, type PerspectiveCamera } from 'three';
import { Focus, Minus, Plus, RotateCcw } from 'lucide-react';
import type { KnowledgeGraph, KnowledgeNode, KnowledgeRelation } from './knowledge';
import { graphView } from './graph-view';
import './universe.css';

type Position = [number, number, number];
type LabelPortal = React.RefObject<HTMLDivElement | null>;
type CameraAction = { type: 'fit' | 'in' | 'out' | 'reset'; nonce: number };
export interface UniverseProps {
  mode: '3d' | '2d'; filter: string; search: string; graph: KnowledgeGraph;
  onSelect: (nodeId: string) => void;
  onSelectRelation: (relationId: string) => void;
  selectedNodeId?: string;
  onFocusNode?: (nodeId: string) => void;
}
type GraphRendererProps = Pick<UniverseProps, 'graph' | 'onSelect' | 'onSelectRelation' | 'onFocusNode'> & {
  labelIds: Set<string>; emphasized: Set<string>; highlighted?: string; onHover: (id?: string) => void; action: CameraAction;
};
const colors: Record<string, string> = {
  company: '#64edca', organization: '#64edca', technology: '#70b9ff', product: '#52b7ed',
  factory: '#70c7b2', project: '#72a5d8', contract: '#d5bd7d', hypothesis: '#b2a1ef',
  evidence: '#d9b66f', claim: '#e7b876', source: '#8298b5', event: '#86c4bf', question: '#b8a7d8',
};
const kindLabels: Record<string, string> = { company: '기업', organization: '조직 · 기업', technology: '기술', product: '제품', factory: '현장', project: '프로젝트', contract: '계약', hypothesis: '가설', evidence: '근거', claim: '주장', source: '출처', event: '사건', question: '질문' };
const nodeColor = (node: KnowledgeNode) => colors[node.kind] || '#8fbeb9';
const primaryNode = (node: KnowledgeNode) => ['se', 'sds', 'miracom', 'rainbow'].includes(node.id);
const evidenceNode = (node: KnowledgeNode) => ['claim', 'source', 'evidence'].includes(node.kind);
const shortTitle = (node: KnowledgeNode) => primaryNode(node) ? node.subtitle?.split('·')[0].trim() || node.title : node.title;
const trimTitle = (title: string, limit = 30) => title.length > limit ? `${title.slice(0, limit - 1)}…` : title;
const relationStatus = (relation: KnowledgeRelation) => relation.inferred ? '분석 연결 · 검토 필요' : '출처 귀속 관계';
const relationColor = (relation: KnowledgeRelation) => relation.type === 'contradicts' ? '#ce8b83' : relation.inferred ? '#a38dcd' : ['documented_by', 'sourced_from', 'has_source'].includes(relation.type) ? '#aa9365' : '#568f9b';
const documentaryRelation = (relation: KnowledgeRelation) => ['mentions', 'about', 'documented_by'].includes(relation.type);
const relationName = (relation: KnowledgeRelation, from: KnowledgeNode, to: KnowledgeNode) => `${from.title} → ${to.title} · ${relation.label} · ${relationStatus(relation)} · 연결 근거 보기`;
interface Boundaries { center: Position; span: Position }
function graphBounds(nodes: KnowledgeNode[]): Boundaries {
  if (!nodes.length) return { center: [0, 0, 0], span: [10, 6, 2] };
  const min: Position = [Infinity, Infinity, Infinity], max: Position = [-Infinity, -Infinity, -Infinity];
  for (const node of nodes) for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis], node.position[axis] - node.size);
    max[axis] = Math.max(max[axis], node.position[axis] + node.size);
  }
  return { center: min.map((value, axis) => (value + max[axis]) / 2) as Position, span: min.map((value, axis) => Math.max(2, max[axis] - value)) as Position };
}
function semanticLabels(graph: KnowledgeGraph): Set<string> {
  const degree = new Map<string, number>();
  for (const edge of graph.relations) for (const id of [edge.from, edge.to]) degree.set(id, (degree.get(id) || 0) + 1);
  const labels = new Set(graph.nodes.filter(node => primaryNode(node) || node.kind === 'hypothesis').map(node => node.id));
  const candidates = graph.nodes.filter(node => !evidenceNode(node) && !labels.has(node.id));
  candidates.sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0) || a.id.localeCompare(b.id));
  const technical = candidates.filter(node => ['technology', 'product'].includes(node.kind));
  const others = candidates.filter(node => !['technology', 'product'].includes(node.kind));
  const visible = graph.nodes.length <= 38 ? candidates : [...technical.slice(0, 10), ...others.slice(0, 6)];
  for (const node of visible) labels.add(node.id);
  if (graph.nodes.length <= 16) for (const node of graph.nodes) labels.add(node.id);
  return labels;
}
function CameraRig({ bounds, action }: { bounds: Boundaries; action: CameraAction }) {
  const { camera, size, invalidate, controls, gl } = useThree();
  // Observe the rendered camera without React state updates. Browser regressions
  // compare the real view, not graph coordinates or a separately cached target.
  useFrame(() => {
    const orbit = controls as unknown as { target?: Vector3 } | null;
    const state = {
      cameraPosition: JSON.stringify(camera.position.toArray()),
      cameraTarget: JSON.stringify(orbit?.target?.toArray() ?? [0, 0, 0]),
      cameraQuaternion: JSON.stringify(camera.quaternion.toArray()),
      cameraReady: String(Boolean(orbit?.target)),
    };
    for (const [key, value] of Object.entries(state)) if (gl.domElement.dataset[key] !== value) gl.domElement.dataset[key] = value;
  });
  const [x, y, z] = bounds.center, [width, height, depth] = bounds.span;
  const fit = useCallback(() => {
    const perspective = camera as PerspectiveCamera;
    const halfFov = perspective.fov * Math.PI / 360;
    const aspect = Math.max(.2, size.width / Math.max(1, size.height));
    const distance = Math.max((height + 1.4) / (2 * Math.tan(halfFov)), (width + 2.4) / (2 * Math.tan(halfFov) * aspect), 7) * 1.08 + depth / 2;
    perspective.position.set(x, y + height * .025, z + distance);
    perspective.lookAt(x, y, z);
    perspective.updateProjectionMatrix();
    const orbit = controls as unknown as { target?: Vector3; update?: () => void } | null;
    orbit?.target?.set(x, y, z);
    orbit?.update?.(); invalidate();
  }, [camera, size.width, size.height, controls, x, y, z, width, height, depth, invalidate]);
  // A date/filter changes membership, not the user's camera position.
  const fitRef = useRef(fit); fitRef.current = fit;
  const lastAction = useRef(0);
  useEffect(() => { fitRef.current(); }, [camera, controls, size.width, size.height]);
  useEffect(() => {
    if (!action.nonce || action.nonce === lastAction.current) return;
    lastAction.current = action.nonce;
    if (action.type === 'fit' || action.type === 'reset') { fitRef.current(); return; }
    const center = (controls as unknown as { target?: Vector3 } | null)?.target?.clone() ?? new Vector3(x, y, z);
    const offset = camera.position.clone().sub(center);
    const length = Math.max(2, Math.min(180, offset.length() * (action.type === 'in' ? .78 : 1.28)));
    camera.position.copy(center.add(offset.setLength(length)));
    (controls as unknown as { update?: () => void } | null)?.update?.(); invalidate();
  }, [action, camera, controls, invalidate]);
  return null;
}
function GraphNode({ node, label, emphasized, selected, onSelect, onFocusNode, onHover, portal }: {
  node: KnowledgeNode; label: boolean; emphasized: boolean; selected: boolean;
  onSelect: (id: string) => void; onFocusNode?: (id: string) => void; onHover: (id?: string) => void; portal: LabelPortal;
}) {
  const [hover, setHover] = useState(false);
  const color = nodeColor(node), primary = primaryNode(node);
  const visible = label || hover || selected;
  const choose = (event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect(node.id); };
  return <group position={node.position}>
    <mesh onClick={choose} onDoubleClick={event => { event.stopPropagation(); onFocusNode?.(node.id); }}
      onPointerOver={event => { event.stopPropagation(); setHover(true); onHover(node.id); }}
      onPointerOut={() => { setHover(false); onHover(undefined); }}>
      {node.kind === 'claim' ? <octahedronGeometry args={[Math.max(.065, node.size) * (hover ? 1.3 : 1), 0]}/> : <sphereGeometry args={[Math.max(.055, node.size) * (hover ? 1.2 : 1), 16, 12]}/>}
      <meshBasicMaterial color={color} transparent opacity={emphasized ? 1 : .27}/>
    </mesh>
    {(primary || selected) && <>
      <mesh><sphereGeometry args={[node.size * 2.4, 16, 12]}/><meshBasicMaterial color={color} transparent opacity={emphasized ? .075 : .025} depthWrite={false}/></mesh>
      <mesh rotation={[.35, .12, 0]}><torusGeometry args={[node.size * 1.8, .009, 5, 40]}/><meshBasicMaterial color={color} transparent opacity={emphasized ? .6 : .12}/></mesh>
    </>}
    <Html portal={portal as React.ComponentProps<typeof Html>['portal']} center position={[0, -node.size - (primary ? .18 : .13), 0]} style={{ pointerEvents: 'none' }}>
      <button type="button" tabIndex={-1} data-graph-node-id={node.id} data-node-id={node.id} data-layout-x={node.position[0]} data-layout-y={node.position[1]} data-layout-z={node.position[2]} aria-label={`${node.title} 상세 보기`} aria-hidden={!visible}
        className={`universe-node-label ${primary ? 'primary' : ''} ${hover || selected ? 'is-active' : ''} ${emphasized ? '' : 'muted'}`}
        title={`${node.title}${onFocusNode ? ' · 더블클릭: 주변 집중' : ''}`} onClick={() => onSelect(node.id)} onDoubleClick={() => onFocusNode?.(node.id)}
        style={{ '--node-color': color, visibility: visible ? 'visible' : 'hidden', pointerEvents: visible ? 'auto' : 'none' } as React.CSSProperties}>
        {hover ? node.title : trimTitle(shortTitle(node), primary ? 24 : 27)}
      </button>
    </Html>
  </group>;
}
interface EdgeBatch { edges: KnowledgeRelation[]; lines: BufferGeometry; arrows: BufferGeometry; inferred: boolean }
/** Each six arrow/line vertices resolve to a real relation; there are no decorative links. */
function GraphEdges({ graph, highlighted, onSelectRelation, portal }: { graph: KnowledgeGraph; highlighted?: string; onSelectRelation: (id: string) => void; portal: LabelPortal }) {
  const [hovered, setHovered] = useState<KnowledgeRelation | null>(null);
  const nodes = useMemo(() => new Map(graph.nodes.map(node => [node.id, node])), [graph.nodes]);
  const batches = useMemo<EdgeBatch[]>(() => [false, true].map(inferred => {
    const edges = graph.relations.filter(edge => edge.inferred === inferred && nodes.has(edge.from) && nodes.has(edge.to));
    const points: number[] = [], arrowPoints: number[] = [], colors: number[] = [], arrowColors: number[] = [], distances: number[] = [];
    for (const edge of edges) {
      const from = nodes.get(edge.from)!, to = nodes.get(edge.to)!;
      const start = new Vector3(...from.position), end = new Vector3(...to.position);
      const direction = end.clone().sub(start).normalize();
      start.addScaledVector(direction, Math.max(.05, from.size)); end.addScaledVector(direction, -Math.max(.08, to.size * 1.35));
      const focus = !highlighted || edge.from === highlighted || edge.to === highlighted;
      const documentaryDim = documentaryRelation(edge) && (!highlighted || !focus) ? .48 : 1;
      const color = new Color(relationColor(edge)).multiplyScalar((focus ? (highlighted ? 1.5 : 1) : .19) * documentaryDim);
      points.push(...start.toArray(), ...end.toArray()); colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
      distances.push(0, start.distanceTo(end));
      const side = direction.clone().cross(new Vector3(0, 0, 1)).normalize();
      if (side.lengthSq() < .001) side.set(1, 0, 0);
      const length = Math.min(.15, Math.max(.07, start.distanceTo(end) * .06));
      const tail = end.clone().addScaledVector(direction, -length);
      const left = tail.clone().addScaledVector(side, length * .45), right = tail.clone().addScaledVector(side, -length * .45);
      arrowPoints.push(...left.toArray(), ...end.toArray(), ...right.toArray(), ...end.toArray());
      for (let i = 0; i < 4; i++) arrowColors.push(color.r, color.g, color.b);
    }
    const lines = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(points, 3)).setAttribute('color', new Float32BufferAttribute(colors, 3)).setAttribute('lineDistance', new Float32BufferAttribute(distances, 1));
    const arrows = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(arrowPoints, 3)).setAttribute('color', new Float32BufferAttribute(arrowColors, 3));
    return { edges, lines, arrows, inferred };
  }), [graph.relations, nodes, highlighted]);
  useEffect(() => () => { for (const batch of batches) { batch.lines.dispose(); batch.arrows.dispose(); } }, [batches]);
  useEffect(() => setHovered(null), [graph.relations]);
  const target = (event: ThreeEvent<PointerEvent | MouseEvent>, batch: EdgeBatch, arrow = false) => batch.edges[Math.floor((event.index ?? -1) / (arrow ? 4 : 2))];
  const from = hovered && nodes.get(hovered.from), to = hovered && nodes.get(hovered.to);
  return <>
    {batches.filter(batch => batch.edges.length > 0).map(batch => <group key={String(batch.inferred)}>
      <lineSegments geometry={batch.lines}
        onClick={event => { const edge = target(event, batch); if (edge) { event.stopPropagation(); onSelectRelation(edge.id); } }}
        onPointerMove={event => { const edge = target(event, batch); if (edge) { event.stopPropagation(); setHovered(edge); } }} onPointerOut={() => setHovered(null)}>
        {batch.inferred ? <lineDashedMaterial vertexColors transparent opacity={.67} dashSize={.13} gapSize={.085} depthWrite={false}/> : <lineBasicMaterial vertexColors transparent opacity={.58} depthWrite={false}/>}
      </lineSegments>
      <lineSegments geometry={batch.arrows} onClick={event => { const edge = target(event, batch, true); if (edge) { event.stopPropagation(); onSelectRelation(edge.id); } }}>
        <lineBasicMaterial vertexColors transparent opacity={.72} depthWrite={false}/>
      </lineSegments>
    </group>)}
    {hovered && from && to && <>
      <Line points={[from.position, to.position]} color="#d2f5e7" lineWidth={1.8} dashed={hovered.inferred} dashSize={.13} gapSize={.085} transparent opacity={.95} raycast={() => undefined}/>
      <Html portal={portal as React.ComponentProps<typeof Html>['portal']} center position={from.position.map((value, axis) => (value + to.position[axis]) / 2) as Position} style={{ pointerEvents: 'none' }}><span className="universe-edge-tooltip">{hovered.label}<small>{relationStatus(hovered)} · 방향 →</small></span></Html>
    </>}
  </>;
}
function ContextLossFallback({ onLost }: { onLost: () => void }) {
  const gl = useThree(state => state.gl);
  useEffect(() => {
    const handleLost = (event: Event) => { event.preventDefault(); onLost(); };
    gl.domElement.addEventListener('webglcontextlost', handleLost);
    return () => gl.domElement.removeEventListener('webglcontextlost', handleLost);
  }, [gl, onLost]); return null;
}
function Scene({ graph, onSelect, onSelectRelation, onFocusNode, labelIds, highlighted, emphasized, onHover, action, portal }: GraphRendererProps & { portal: LabelPortal }) {
  const bounds = graphBounds(graph.nodes), radius = Math.max(...bounds.span) / 2;
  const maxDistance = useRef(Math.max(180, radius * 12));
  return <>
    <CameraRig bounds={bounds} action={action}/>
    <GraphEdges graph={graph} highlighted={highlighted} onSelectRelation={onSelectRelation} portal={portal}/>
    {graph.nodes.map(node => <GraphNode key={node.id} node={node} label={labelIds.has(node.id)} emphasized={!highlighted || emphasized.has(node.id)} selected={node.id === highlighted} onSelect={onSelect} onFocusNode={onFocusNode} onHover={onHover} portal={portal}/>)}
    {/* CameraRig initializes/explicitly fits the target; membership changes must not retarget or clamp the view. */}
    <OrbitControls makeDefault enablePan enableZoom minDistance={2} maxDistance={maxDistance.current} enableDamping={false}/>
  </>;
}
function FlatGraph({ graph, onSelect, onSelectRelation, onFocusNode, labelIds, highlighted, emphasized, onHover, action }: GraphRendererProps) {
  const markerId = useId().replace(/:/g, ''), svgRef = useRef<SVGSVGElement>(null);
  const [viewport, setViewport] = useState({ zoom: 1, x: 0, y: 0 });
  const [clientSize, setClientSize] = useState({ width: 800, height: 500 });
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const position = (node: KnowledgeNode): [number, number] => [node.position[0] * 50, -node.position[1] * 50];
  const currentBounds = useRef(graphBounds(graph.nodes)); currentBounds.current = graphBounds(graph.nodes);
  const [bounds, setBounds] = useState(() => currentBounds.current);
  const width = Math.max(660, bounds.span[0] * 50 + 150), height = Math.max(370, bounds.span[1] * 50 + 110);
  const cx = bounds.center[0] * 50, cy = -bounds.center[1] * 50;
  // SVG preserveAspectRatio="xMidYMid meet" scales by the limiting dimension.
  // Convert screen pixels back to viewBox units so labels remain readable at fit and after zoom.
  const labelScale = Math.max(width / Math.max(1, clientSize.width), height / Math.max(1, clientSize.height)) / viewport.zoom;
  const zoom = useCallback((factor: number) => setViewport(value => ({ ...value, zoom: Math.max(.45, Math.min(6, value.zoom * factor)) })), []);
  useEffect(() => {
    const svg = svgRef.current; if (!svg) return;
    const measure = () => { const rect = svg.getBoundingClientRect(); if (rect.width && rect.height) setClientSize({ width: rect.width, height: rect.height }); };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(svg);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { if (!action.nonce) return; if (action.type === 'in') zoom(1.25); else if (action.type === 'out') zoom(.8); else { setBounds(currentBounds.current); setViewport({ zoom: 1, x: 0, y: 0 }); } }, [action, zoom]);
  useEffect(() => {
    const svg = svgRef.current; if (!svg) return;
    const wheel = (event: WheelEvent) => { event.preventDefault(); zoom(event.deltaY > 0 ? .9 : 1.1); };
    svg.addEventListener('wheel', wheel, { passive: false }); return () => svg.removeEventListener('wheel', wheel);
  }, [zoom]);
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const viewBox = `${cx + viewport.x - width / viewport.zoom / 2} ${cy + viewport.y - height / viewport.zoom / 2} ${width / viewport.zoom} ${height / viewport.zoom}`;
  return <svg ref={svgRef} className="universe-svg" role="group" tabIndex={0} aria-label="RX 지식 그래프 2D. 화살표는 관계 방향, 점선은 분석 연결. 방향키로 이동하고 + 또는 - 키로 확대합니다." viewBox={viewBox}
    onPointerDown={event => { if ((event.target as Element).closest('[data-node-id],[data-edge-id]')) return; drag.current = { x: event.clientX, y: event.clientY, panX: viewport.x, panY: viewport.y }; event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={event => { if (!drag.current) return; const rect = event.currentTarget.getBoundingClientRect(); setViewport(value => ({ ...value, x: drag.current!.panX - (event.clientX - drag.current!.x) * width / value.zoom / rect.width, y: drag.current!.panY - (event.clientY - drag.current!.y) * height / value.zoom / rect.height })); }}
    onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
    onKeyDown={event => { if (event.target !== event.currentTarget) return; if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.25); } else if (event.key === '-') { event.preventDefault(); zoom(.8); } else if (event.key === '0') { event.preventDefault(); setBounds(currentBounds.current); setViewport({ zoom: 1, x: 0, y: 0 }); } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); setViewport(value => ({ ...value, x: value.x + (event.key === 'ArrowRight' ? 40 : event.key === 'ArrowLeft' ? -40 : 0) / value.zoom, y: value.y + (event.key === 'ArrowDown' ? 40 : event.key === 'ArrowUp' ? -40 : 0) / value.zoom })); } }}>
    <defs>{['#568f9b', '#a38dcd', '#ce8b83', '#aa9365'].map((color, i) => <marker key={color} id={`${markerId}-${i}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 1 L 7 4 L 0 7" fill="none" stroke={color} strokeWidth="1.2"/></marker>)}</defs>
    {graph.relations.map(relation => {
      const from = nodes.get(relation.from), to = nodes.get(relation.to); if (!from || !to) return null;
      const [x1, y1] = position(from), [tx, ty] = position(to), length = Math.hypot(tx - x1, ty - y1) || 1;
      const radius = Math.max(3, to.size * 35) + 2, x2 = tx - (tx - x1) / length * radius, y2 = ty - (ty - y1) / length * radius;
      const active = !highlighted || relation.from === highlighted || relation.to === highlighted;
      const color = relationColor(relation), marker = ['#568f9b', '#a38dcd', '#ce8b83', '#aa9365'].indexOf(color);
      return <g key={relation.id} className={`rx-link ${active ? '' : 'muted'}`} data-relation-id={relation.id} data-edge-id={relation.id} data-inferred={String(relation.inferred)} role="button" aria-label={relationName(relation, from, to)} tabIndex={0}
        onClick={() => onSelectRelation(relation.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectRelation(relation.id); } }}>
        <title>{relationName(relation, from, to)}{`\n${relation.rationale}`}</title>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth="10"/>
        <line x1={x1} y1={y1} x2={x2} y2={y2} className="rx-link-line" stroke={color} strokeDasharray={relation.inferred ? '3 5' : undefined} strokeWidth={active && highlighted ? 1.35 : .8} markerEnd={`url(#${markerId}-${Math.max(0, marker)})`} pointerEvents="none"/>
        <text className="rx-link-caption" x={(x1+x2)/2} y={(y1+y2)/2-7*labelScale} style={{ fontSize: 10 * labelScale, strokeWidth: 3 * labelScale }} textAnchor="middle" pointerEvents="none">{relation.label}</text>
      </g>;
    })}
    {graph.nodes.map(node => { const [x, y] = position(node), primary = primaryNode(node), active = !highlighted || emphasized.has(node.id), selected = node.id === highlighted;
      return <g key={node.id} className={`rx-node ${labelIds.has(node.id) || selected ? 'label-visible' : ''} ${active ? '' : 'muted'}`} data-graph-node-id={node.id} data-node-id={node.id} data-layout-x={node.position[0]} data-layout-y={node.position[1]} data-layout-z={node.position[2]} role="button" aria-label={`${node.title} 상세 보기`} tabIndex={0}
        onClick={() => onSelect(node.id)} onDoubleClick={() => onFocusNode?.(node.id)} onPointerEnter={() => onHover(node.id)} onPointerLeave={() => onHover(undefined)}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(node.id); } }}>
        <title>{node.title} — 상세 보기{onFocusNode ? ' · 더블클릭: 주변 집중' : ''}</title>
        {(primary || selected) && <><circle cx={x} cy={y} r={node.size * 80} fill={nodeColor(node)} opacity=".06"/><circle cx={x} cy={y} r={node.size * 55} fill="none" stroke={nodeColor(node)} strokeWidth=".6" opacity=".5"/></>}
        {node.kind === 'claim' ? <path d={`M ${x} ${y-3.5} l 3.5 3.5 l -3.5 3.5 l -3.5 -3.5 Z`} fill={nodeColor(node)}/> : <circle cx={x} cy={y} r={Math.max(2.3, node.size * 35)} fill={nodeColor(node)}/>}
        <text className="rx-node-label" x={x} y={y + Math.max(5, node.size * 45) + 12 * labelScale} fill={nodeColor(node)} textAnchor="middle" fontSize={(primary ? 11 : 9.5) * labelScale} style={{ strokeWidth: 3 * labelScale }}>{trimTitle(shortTitle(node), 28)}</text>
      </g>;
    })}
  </svg>;
}
class GraphBoundary extends Component<{ children: React.ReactNode; fallback: React.ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false }; static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
function supportsWebGL() {
  if (typeof document === 'undefined') return false;
  // Three r163+ requires WebGL2: https://threejs.org/docs/pages/WebGLRenderer.html
  try { const gl = document.createElement('canvas').getContext('webgl2'); if (!gl) return false; gl.getExtension('WEBGL_lose_context')?.loseContext(); return true; } catch { return false; }
}
export default function Universe({ mode, filter, search, graph: inputGraph, onSelect, onSelectRelation, selectedNodeId, onFocusNode }: UniverseProps) {
  const graph = useMemo(() => graphView(inputGraph, filter, search), [inputGraph, filter, search]);
  const [webgl, setWebgl] = useState(supportsWebGL), [keyboard, setKeyboard] = useState(false), [listSearch, setListSearch] = useState('');
  const [hoveredId, setHoveredId] = useState<string | undefined>();
  const [labelMode, setLabelMode] = useState<'smart' | 'entities'>('smart');
  const [action, setAction] = useState<CameraAction>({ type: 'fit', nonce: 0 });
  const listId = useId(), listToggle = useRef<HTMLButtonElement>(null);
  const [labelHost, setLabelHost] = useState<HTMLDivElement | null>(null);
  const labelPortal = useMemo<LabelPortal>(() => ({ current: labelHost }), [labelHost]);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (clickTimer.current) clearTimeout(clickTimer.current); }, []);
  const selectNode = (id: string) => { if (clickTimer.current) clearTimeout(clickTimer.current); if (!onFocusNode) { onSelect(id); return; } clickTimer.current = setTimeout(() => onSelect(id), 220); };
  const focusNode = (id: string) => { if (clickTimer.current) clearTimeout(clickTimer.current); onFocusNode?.(id); };
  const nodes = useMemo(() => new Map(graph.nodes.map(node => [node.id, node])), [graph.nodes]);
  const highlighted = nodes.has(hoveredId || '') ? hoveredId : nodes.has(selectedNodeId || '') ? selectedNodeId : undefined;
  const emphasized = useMemo(() => { const ids = new Set<string>(); if (highlighted) { ids.add(highlighted); for (const edge of graph.relations) { if (edge.from === highlighted) ids.add(edge.to); if (edge.to === highlighted) ids.add(edge.from); } } return ids; }, [highlighted, graph.relations]);
  const labelIds = useMemo(() => labelMode === 'entities' ? new Set(graph.nodes.filter(node => !evidenceNode(node)).map(node => node.id)) : semanticLabels(graph), [graph, labelMode]);
  const graphProps: GraphRendererProps = { graph, onSelect: selectNode, onSelectRelation, onFocusNode: onFocusNode ? focusNode : undefined, labelIds, highlighted, emphasized, onHover: setHoveredId, action };
  const flat = <FlatGraph {...graphProps}/>;
  const listQuery = listSearch.trim().toLowerCase();
  const listNodes = graph.nodes.filter(node => `${node.title} ${node.id}`.toLowerCase().includes(listQuery));
  const listRelations = graph.relations.filter(edge => `${edge.label} ${nodes.get(edge.from)?.title} ${nodes.get(edge.to)?.title}`.toLowerCase().includes(listQuery));
  const inspected = highlighted ? nodes.get(highlighted) : undefined;
  const camera = (type: CameraAction['type']) => setAction(value => ({ type, nonce: value.nonce + 1 }));
  return <div className="universe-visual" data-renderer={mode === '3d' && webgl ? '3d' : '2d'} data-node-count={graph.nodes.length} data-edge-count={graph.relations.length} data-relation-count={graph.relations.length} data-node-ids={JSON.stringify(graph.nodes.map(node => node.id))} data-edge-ids={JSON.stringify(graph.relations.map(edge => edge.id))} data-active-node-ids={JSON.stringify(graph.nodes.map(node => node.id))} data-active-edge-ids={JSON.stringify(graph.relations.map(edge => edge.id))} data-selected-node-id={selectedNodeId || ''}>
    <div className="universe-grid" aria-hidden="true"/>
    {/* Html owns this stable sibling host. Canvas mounts only after the host exists. */}
    <div ref={setLabelHost} className="universe-label-portal"/>
    {mode === '3d' && webgl ? labelHost && <GraphBoundary fallback={flat} onError={() => setWebgl(false)}><Canvas camera={{ position: [0, 0, 25], fov: 42 }} dpr={[1, 1.5]} frameloop="demand" gl={{ antialias: true, alpha: true }} onCreated={({ raycaster }) => { raycaster.params.Line.threshold = .075; }}><ContextLossFallback onLost={() => setWebgl(false)}/><Scene {...graphProps} portal={labelPortal}/></Canvas></GraphBoundary> : flat}
    <label className="universe-label-controls"><span>라벨</span><select aria-label="그래프 라벨 표시" title="객체 전체를 선택하고 확대하면 기술·제품 이름을 자세히 읽을 수 있습니다." value={labelMode} onChange={event => setLabelMode(event.target.value as 'smart' | 'entities')}><option value="smart">핵심</option><option value="entities">객체 전체</option></select></label>
    <div className="universe-camera-controls" aria-label="그래프 화면 조절">
      <button type="button" aria-label="그래프 확대" title="확대" onClick={() => camera('in')}><Plus size={15}/></button>
      <button type="button" aria-label="그래프 축소" title="축소" onClick={() => camera('out')}><Minus size={15}/></button>
      <span/>
      <button type="button" aria-label="그래프 화면 맞춤" title="화면 맞춤" onClick={() => camera('fit')}><Focus size={15}/></button>
      <button type="button" aria-label="그래프 보기 초기화" title="보기 초기화" onClick={() => { camera('reset'); setHoveredId(undefined); }}><RotateCcw size={14}/></button>
    </div>
    <div className="universe-readout" aria-live="polite">{inspected ? <><strong>{trimTitle(inspected.title, 55)}</strong><span>{kindLabels[inspected.kind] || inspected.kind} · 직접 연결 {emphasized.size - 1}개</span></> : <><strong>{graph.nodes.length} NODES <i/> {graph.relations.length} RELATIONS</strong><span>{mode === '3d' && webgl ? '드래그 회전 · 우클릭 이동' : '배경 드래그 이동'} · 스크롤 확대{onFocusNode ? ' · 더블클릭 집중' : ''}</span></>}</div>
    <button type="button" ref={listToggle} className="universe-list-toggle" onClick={() => setKeyboard(value => !value)} aria-expanded={keyboard} aria-controls={listId}>노드 목록 {keyboard ? '−' : '+'}</button>
    {keyboard && <div id={listId} className="universe-keyboard-list" aria-label="그래프 노드와 연결 목록" onKeyDown={event => { if (event.key === 'Escape') { setKeyboard(false); listToggle.current?.focus(); } }}>
      <input aria-label="노드와 관계 목록 검색" value={listSearch} onChange={event => setListSearch(event.target.value)} placeholder="노드 또는 관계 찾기"/>
      <div className="universe-list-heading">노드 선택 · {listNodes.length}</div>
      {listNodes.map(node => <button type="button" key={node.id} data-list-node-id={node.id} onClick={() => onSelect(node.id)} style={{ color: nodeColor(node) }}><span className="universe-list-dot"/>{node.title}<small>{kindLabels[node.kind] || node.kind}</small></button>)}
      {listRelations.length > 0 && <><div className="universe-list-heading">관계별 근거 · {listRelations.length}</div>{listRelations.map(relation => {
        const from = nodes.get(relation.from)!, to = nodes.get(relation.to)!;
        return <button type="button" key={relation.id} data-relation-id={relation.id} data-edge-id={relation.id} onClick={() => onSelectRelation(relation.id)} aria-label={relationName(relation, from, to)}><b>{relation.label}</b>{from.title} → {to.title}<small>{relationStatus(relation)} · 출처 {relation.source_ids.length}건</small></button>;
      })}</>}
      {!listNodes.length && !listRelations.length && <p>일치하는 노드나 관계가 없습니다.</p>}
    </div>}
    {!graph.nodes.length && <div role="status" className="universe-empty">현재 시점과 탐색 조건에 맞는 노드가 없습니다.</div>}
  </div>;
}
