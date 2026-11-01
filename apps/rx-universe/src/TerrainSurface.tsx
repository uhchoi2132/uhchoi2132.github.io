import React, { Component, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import { BufferGeometry, Color, Float32BufferAttribute, Spherical, Vector3, type PerspectiveCamera } from 'three';
import { ArrowUpRight, List, Search } from 'lucide-react';
import type { KnowledgeCluster, KnowledgeGraph } from './knowledge';
import { sampleTerrainHeight, surfaceRelations, type TerrainSurface as SurfaceModel } from './terrain-surface';
import './surface.css';

type Position = [number, number, number];
type Portal = React.RefObject<HTMLDivElement | null>;
type CameraSnapshot = { position: number[]; target: number[]; quaternion: number[] };
export interface TerrainSurfaceProps {
  model: SurfaceModel;
  graph: KnowledgeGraph;
  selected?: string;
  selectedCluster?: KnowledgeCluster;
  onNode: (id: string) => void;
  onRelation: (id: string) => void;
  onRegion: (cluster: KnowledgeCluster) => void;
  /** Reports WebGL2 absence/runtime loss, never a user-requested 2D view. */
  onUnavailable?: () => void;
  view: '3d' | '2d';
  cameraAction?: { type: 'fit' | 'reset' | 'zoom-in' | 'zoom-out' | 'rotate-left' | 'rotate-right' | 'tilt-up' | 'tilt-down'; token: number };
}
const colors: Record<KnowledgeCluster, string> = { electronics: '#459ec6', sds: '#54c2c0', miracom: '#6e88ce', robotics: '#8a9adb', research: '#aa82cb' };
const countFor = (region: SurfaceModel['regions'][number], metric: SurfaceModel['metric']) => metric === 'claims' ? region.claimCount : metric === 'sourceGroups' ? region.sourceGroupCount : region.documentCount;
const metricLabel = (metric: SurfaceModel['metric']) => metric === 'claims' ? '주장' : metric === 'sourceGroups' ? '출처군' : '문서';

/** Color is a fixed topic palette and a fixed height ramp, never a confidence score. */
function surfaceColor(model: SurfaceModel, x: number, z: number, height: number): Color {
  const mixed = new Color(0, 0, 0); let sum = 0;
  for (const region of model.regions) {
    const weight = 1 / (12 + (x - region.x) ** 2 + (z - region.z) ** 2);
    mixed.add(new Color(colors[region.id]).multiplyScalar(weight)); sum += weight;
  }
  if (sum) mixed.multiplyScalar(1 / sum);
  return new Color('#102038').lerp(mixed, Math.min(.88, .10 + Math.max(0, height) * .12));
}
function supportsWebGL2() {
  if (typeof document === 'undefined') return false;
  try {
    const context = document.createElement('canvas').getContext('webgl2');
    if (!context) return false;
    context.getExtension('WEBGL_lose_context')?.loseContext(); return true;
  } catch { return false; }
}
class SurfaceBoundary extends Component<{ children: React.ReactNode; fallback: React.ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
function ContextGuard({ onLost }: { onLost: () => void }) {
  const gl = useThree(state => state.gl);
  useEffect(() => {
    const lost = (event: Event) => { event.preventDefault(); onLost(); };
    gl.domElement.addEventListener('webglcontextlost', lost);
    return () => gl.domElement.removeEventListener('webglcontextlost', lost);
  }, [gl, onLost]); return null;
}
function CameraRig({ model, action, host, snapshot }: {
  model: SurfaceModel; action?: TerrainSurfaceProps['cameraAction']; host: React.RefObject<HTMLDivElement | null>;
  snapshot: React.RefObject<CameraSnapshot | null>;
}) {
  const { camera, controls, size, invalidate, gl } = useThree();
  const initialized = useRef(false), lastAction = useRef(0);
  const fit = useCallback((reset: boolean) => {
    const orbit = controls as unknown as { target: Vector3; update: () => void } | null;
    if (!orbit) return;
    const center = new Vector3((model.bounds.minX + model.bounds.maxX) / 2, 1.1, (model.bounds.minZ + model.bounds.maxZ) / 2);
    const perspective = camera as PerspectiveCamera;
    const fov = perspective.fov * Math.PI / 180;
    const aspect = Math.max(.35, size.width / Math.max(1, size.height));
    const direction = reset ? new Vector3(.72, .69, 1) : camera.position.clone().sub(orbit.target).normalize();
    direction.normalize();
    const right = new Vector3(0, 1, 0).cross(direction).normalize(), up = direction.clone().cross(right).normalize();
    const corners: Vector3[] = [];
    for (const x of [model.bounds.minX, model.bounds.maxX]) for (const y of [0, 7]) for (const z of [model.bounds.minZ, model.bounds.maxZ]) corners.push(new Vector3(x, y, z).sub(center));
    const span = (axis: Vector3) => Math.max(...corners.map(p => p.dot(axis))) - Math.min(...corners.map(p => p.dot(axis)));
    const distance = Math.max(span(up) / (2 * Math.tan(fov / 2)), span(right) / (2 * Math.tan(fov / 2) * aspect)) * 1.03 + span(direction) * .10;
    camera.position.copy(center.clone().add(direction.normalize().multiplyScalar(distance)));
    orbit.target.copy(center); camera.lookAt(center); perspective.updateProjectionMatrix(); orbit.update(); invalidate();
  }, [camera, controls, size.width, size.height, model.bounds, invalidate]);
  const fitRef = useRef(fit); fitRef.current = fit;
  useEffect(() => {
    if (initialized.current || !controls || size.width < 1 || size.height < 1) return;
    initialized.current = true;
    const orbit = controls as unknown as { target: Vector3; update: () => void };
    if (snapshot.current) {
      camera.position.fromArray(snapshot.current.position); orbit.target.fromArray(snapshot.current.target);
      camera.quaternion.fromArray(snapshot.current.quaternion); orbit.update(); invalidate();
    } else fitRef.current(true);
  }, [camera, controls, invalidate, snapshot, size.width, size.height]);
  useEffect(() => {
    if (!action?.token || action.token === lastAction.current || !controls) return;
    lastAction.current = action.token;
    if (action.type === 'fit' || action.type === 'reset') { fitRef.current(action.type === 'reset'); return; }
    const orbit = controls as unknown as { target: Vector3; update: () => void };
    const offset = camera.position.clone().sub(orbit.target);
    if (action.type === 'zoom-in' || action.type === 'zoom-out') offset.setLength(Math.max(10, Math.min(160, offset.length() * (action.type === 'zoom-in' ? .82 : 1.22))));
    else {
      const spherical = new Spherical().setFromVector3(offset);
      if (action.type === 'rotate-left' || action.type === 'rotate-right') spherical.theta += action.type === 'rotate-left' ? -.18 : .18;
      else spherical.phi = Math.max(.28, Math.min(Math.PI / 2 - .075, spherical.phi + (action.type === 'tilt-up' ? -.12 : .12)));
      offset.setFromSpherical(spherical);
    }
    camera.position.copy(orbit.target.clone().add(offset)); camera.lookAt(orbit.target); orbit.update(); invalidate();
  }, [action?.token, action?.type, controls, camera, invalidate]);
  useFrame(() => {
    const orbit = controls as unknown as { target?: Vector3 } | null;
    const current = { position: camera.position.toArray(), target: orbit?.target?.toArray() ?? [0, 0, 0], quaternion: camera.quaternion.toArray() };
    snapshot.current = current;
    const values = { cameraPosition: JSON.stringify(current.position), cameraTarget: JSON.stringify(current.target), cameraQuaternion: JSON.stringify(current.quaternion), cameraReady: String(Boolean(orbit?.target)) };
    for (const element of [host.current, gl.domElement]) if (element) for (const [key, value] of Object.entries(values)) if (element.dataset[key] !== value) element.dataset[key] = value;
  }); return null;
}
function HeightField({ model, host }: { model: SurfaceModel; host: React.RefObject<HTMLDivElement | null> }) {
  const gl = useThree(state => state.gl);
  const geometry = useMemo(() => {
    const value = new BufferGeometry();
    value.setAttribute('position', new Float32BufferAttribute(model.field.positions, 3)); value.setIndex(model.field.indices);
    const vertexColors: number[] = [];
    for (let i = 0; i < model.field.positions.length; i += 3) {
      const color = surfaceColor(model, model.field.positions[i], model.field.positions[i + 2], model.field.positions[i + 1]);
      vertexColors.push(color.r, color.g, color.b);
    }
    value.setAttribute('color', new Float32BufferAttribute(vertexColors, 3)); value.computeVertexNormals();
    return value;
  }, [model]);
  const contours = useMemo(() => {
    const positions: number[] = [], lineColors: number[] = [];
    for (const contour of model.contours) for (let i = 0; i < contour.segments.length; i += 3) {
      const [x, y, z] = contour.segments.slice(i, i + 3);
      positions.push(x, y + .06, z);
      const color = surfaceColor(model, x, z, contour.level).lerp(new Color('#8cb9ce'), .36);
      lineColors.push(color.r, color.g, color.b);
    }
    return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3)).setAttribute('color', new Float32BufferAttribute(lineColors, 3));
  }, [model]);
  useEffect(() => {
    // Read back the actual mesh buffer for browser verification, rather than metadata alone.
    const position = geometry.getAttribute('position'); let min = Infinity, max = -Infinity, peak = 0;
    for (let i = 0; i < position.count; i++) { const height = position.getY(i); if (height < min) min = height; if (height > max) { max = height; peak = i; } }
    const buffer = position.array as Float32Array;
    const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let checksum = 2166136261;
    for (const byte of bytes) checksum = Math.imul(checksum ^ byte, 16777619) >>> 0;
    const values = { renderedHeightMin: String(min), renderedHeightMax: String(max), renderedPeakPosition: JSON.stringify([position.getX(peak), position.getY(peak), position.getZ(peak)]), renderedVertexCount: String(position.count), renderedHeightFingerprint: `float32-fnv1a-${checksum.toString(16).padStart(8, '0')}` };
    for (const element of [host.current, gl.domElement]) if (element) for (const [key, value] of Object.entries(values)) element.dataset[key] = value;
  }, [geometry, model.fingerprint, host, gl]);
  useEffect(() => () => { geometry.dispose(); contours.dispose(); }, [geometry, contours]);
  return <>
    <mesh geometry={geometry} receiveShadow><meshStandardMaterial vertexColors roughness={.86} metalness={.17} emissive="#071426" emissiveIntensity={.32}/></mesh>
    <lineSegments geometry={contours} raycast={() => undefined}><lineBasicMaterial vertexColors transparent opacity={.62} depthWrite={false}/></lineSegments>
  </>;
}
function relationPaths(model: SurfaceModel, graph: KnowledgeGraph, selected?: string) {
  if (!selected) return [];
  const anchors = new Map(model.anchors.map(anchor => [anchor.nodeId, anchor]));
  return surfaceRelations(model, graph).filter(edge => edge.id === selected || edge.from === selected || edge.to === selected).map(edge => {
    const a = anchors.get(edge.from)!, b = anchors.get(edge.to)!;
    const points: Position[] = Array.from({ length: 33 }, (_, index) => {
      const t = index / 32, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      return [x, sampleTerrainHeight(model, x, z) + .10 + Math.sin(t * Math.PI) * .18, z];
    }); return { edge, points };
  });
}
function EvidencePoints({ model, selected, onNode, portal }: { model: SurfaceModel; selected?: string; onNode: (id: string) => void; portal: Portal }) {
  const [hovered, setHovered] = useState<string>();
  const geometry = useMemo(() => {
    const points: number[] = [], values: number[] = [];
    for (const anchor of model.evidenceAnchors) {
      points.push(anchor.x, anchor.height + .13, anchor.z);
      const color = new Color(colors[anchor.cluster]).lerp(new Color('#d7f5ee'), .48); values.push(color.r, color.g, color.b);
    }
    return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(points, 3)).setAttribute('color', new Float32BufferAttribute(values, 3));
  }, [model.evidenceAnchors]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const active = model.evidenceAnchors.find(anchor => anchor.nodeId === hovered) ?? model.evidenceAnchors.find(anchor => anchor.nodeId === selected);
  return <>
    <points geometry={geometry} onClick={event => { const anchor = model.evidenceAnchors[event.index ?? -1]; if (anchor) { event.stopPropagation(); onNode(anchor.nodeId); } }}
      onPointerMove={event => { const anchor = model.evidenceAnchors[event.index ?? -1]; if (anchor) { event.stopPropagation(); setHovered(anchor.nodeId); } }} onPointerOut={() => setHovered(undefined)}>
      <pointsMaterial vertexColors size={.12} sizeAttenuation transparent opacity={.85} depthWrite={false}/>
    </points>
    {active && <group position={[active.x, active.height + .15, active.z]}>
      <mesh><sphereGeometry args={[.105, 12, 10]}/><meshBasicMaterial color="#d4fff0"/></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -.01, 0]}><ringGeometry args={[.18, .205, 32]}/><meshBasicMaterial color="#a9dfdf" transparent opacity={.8}/></mesh>
      <Html portal={portal as React.ComponentProps<typeof Html>['portal']} center position={[0, .75, 0]} style={{ pointerEvents: 'none' }}>
        <button className="surface-evidence-label" data-surface-node-id={active.nodeId} onClick={() => onNode(active.nodeId)}><span>{active.kind === 'claim' ? '주장' : '원문'}</span>{active.title}<ArrowUpRight size={12}/></button>
      </Html>
    </group>}
  </>;
}
function SurfaceScene({ model, graph, selected, selectedCluster, onNode, onRelation, onRegion, cameraAction, host, snapshot, portal }: TerrainSurfaceProps & { host: React.RefObject<HTMLDivElement | null>; snapshot: React.RefObject<CameraSnapshot | null>; portal: Portal }) {
  const paths = useMemo(() => relationPaths(model, graph, selected), [model, graph, selected]);
  return <>
    <color attach="background" args={['#08121e']}/><fog attach="fog" args={['#08121e', 45, 108]}/>
    <ambientLight intensity={.62} color="#9fb6d3"/><directionalLight position={[-10, 26, 12]} intensity={1.55} color="#b8e9ee"/><directionalLight position={[18, 10, -12]} intensity={1.35} color="#8a79cb"/>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -.07, 0]}><planeGeometry args={[180, 180]}/><meshStandardMaterial color="#091624" roughness={1}/></mesh>
    <gridHelper args={[80, 40, '#203849', '#152b3c']} position={[0, -.055, 0]}/>
    <HeightField model={model} host={host}/>
    {paths.map(({ edge, points }) => <Line key={edge.id} points={points} color={edge.inferred ? '#c3a3e4' : '#a9e7df'} lineWidth={edge.id === selected ? 2 : 1.3} dashed={edge.inferred} dashSize={.18} gapSize={.12} transparent opacity={.85} onClick={event => { event.stopPropagation(); onRelation(edge.id); }}/>) }
    <EvidencePoints model={model} selected={selected} onNode={onNode} portal={portal}/>
    {model.regions.map(region => <group key={region.id} position={[region.x, region.height + .25, region.z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[selectedCluster === region.id ? .39 : .22, selectedCluster === region.id ? .42 : .24, 36]}/><meshBasicMaterial color={colors[region.id]} transparent opacity={.8}/></mesh>
      <Line points={[[0, 0, 0], [0, 1.45, 0]]} color={colors[region.id]} lineWidth={.7} transparent opacity={.6} raycast={() => undefined}/>
      <Html portal={portal as React.ComponentProps<typeof Html>['portal']} center position={[0, 1.7, 0]} style={{ pointerEvents: 'none' }}>
        <button className={`surface-region-label${selectedCluster === region.id ? ' is-selected' : ''}`} data-surface-region-id={region.id} aria-label={`${region.label} 지형 구역 선택`} aria-pressed={selectedCluster === region.id} onClick={() => onRegion(region.id)} style={{ '--surface-color': colors[region.id] } as React.CSSProperties}><b>{region.label.split(' · ')[0]}</b><small>{region.label.split(' · ').slice(1).join(' · ')}<span>{countFor(region, model.metric)} {metricLabel(model.metric)}</span></small></button>
      </Html>
    </group>)}
    <OrbitControls makeDefault enablePan enableZoom enableDamping={false} minDistance={10} maxDistance={160} minPolarAngle={.28} maxPolarAngle={Math.PI / 2 - .075}/>
    <CameraRig model={model} action={cameraAction} host={host} snapshot={snapshot}/>
  </>;
}

const project = (x: number, height: number, z: number): [number, number] => [520 + (x - z) * 12.1, 301 + (x + z) * 5.2 - height * 22];
function FlatSurface({ model, graph, selected, selectedCluster, onNode, onRelation, onRegion, cameraAction }: TerrainSurfaceProps) {
  const [zoom, setZoom] = useState(1);
  const id = useId().replace(/:/g, '');
  useEffect(() => {
    if (!cameraAction?.token) return;
    if (cameraAction.type === 'fit' || cameraAction.type === 'reset') setZoom(1);
    else if (cameraAction.type === 'zoom-in') setZoom(value => Math.min(2.5, value * 1.25));
    else if (cameraAction.type === 'zoom-out') setZoom(value => Math.max(.75, value / 1.25));
  }, [cameraAction?.token, cameraAction?.type]);
  const faces = useMemo(() => {
    const result: { key: string; points: string; color: string; depth: number }[] = [];
    const { positions, columns, rows } = model.field;
    const point = (column: number, row: number) => positions.slice((row * columns + column) * 3, (row * columns + column) * 3 + 3) as Position;
    const step = Math.max(1, Math.ceil(columns / 32));
    for (let row = 0; row < rows - 1; row += step) for (let column = 0; column < columns - 1; column += step) {
      const endX = Math.min(columns - 1, column + step), endZ = Math.min(rows - 1, row + step);
      const corners = [point(column, row), point(endX, row), point(endX, endZ), point(column, endZ)];
      for (const triangle of [[corners[0], corners[1], corners[2]], [corners[0], corners[2], corners[3]]]) {
        const center = triangle.reduce((sum, p) => sum.map((v, i) => v + p[i] / 3) as Position, [0, 0, 0] as Position);
        result.push({ key: `${row}-${column}-${result.length}`, points: triangle.map(p => project(...p).join(',')).join(' '), color: `#${surfaceColor(model, center[0], center[2], center[1]).getHexString()}`, depth: center[0] + center[2] });
      }
    } return result.sort((a, b) => a.depth - b.depth);
  }, [model]);
  const paths = useMemo(() => relationPaths(model, graph, selected), [model, graph, selected]);
  const activate = (event: React.KeyboardEvent, callback: () => void) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); callback(); } };
  return <div className="surface-flat-wrap">
    <svg data-testid="terrain-surface-2d" data-flat-face-count={faces.length} data-flat-zoom={zoom} className="surface-flat" viewBox={`${520 - 520 / zoom} ${310 - 310 / zoom} ${1040 / zoom} ${620 / zoom}`} role="group" aria-label="동일 근거 높이를 표시한 등각 지형 지도">
      <defs><radialGradient id={`${id}-ground`}><stop offset="0" stopColor="#142b3b"/><stop offset="1" stopColor="#08121e"/></radialGradient></defs>
      <rect x="-800" y="-800" width="2600" height="2200" fill={`url(#${id}-ground)`}/>
      {faces.map(face => <polygon key={face.key} points={face.points} fill={face.color} stroke={face.color} strokeWidth=".4"/>)}
      {model.contours.map(contour => <path key={contour.level} d={Array.from({ length: contour.segments.length / 6 }, (_, i) => {
        const a = project(contour.segments[i * 6], contour.segments[i * 6 + 1], contour.segments[i * 6 + 2]);
        const b = project(contour.segments[i * 6 + 3], contour.segments[i * 6 + 4], contour.segments[i * 6 + 5]);
        return `M${a.join(',')}L${b.join(',')}`;
      }).join(' ')} fill="none" stroke={contour.level > 3 ? '#a6a4d1' : '#558ca7'} strokeWidth=".65" opacity=".63" pointerEvents="none"/>)}
      {paths.map(({ edge, points }) => <g key={edge.id} role="button" tabIndex={0} aria-label={`${edge.label} 연결 근거 보기`} data-surface-relation-id={edge.id} onClick={() => onRelation(edge.id)} onKeyDown={event => activate(event, () => onRelation(edge.id))}><polyline points={points.map(p => project(...p).join(',')).join(' ')} fill="none" stroke="transparent" strokeWidth="12"/><polyline points={points.map(p => project(...p).join(',')).join(' ')} fill="none" stroke={edge.inferred ? '#b9a2df' : '#9dded4'} strokeWidth="1.6" strokeDasharray={edge.inferred ? '5 4' : undefined}/></g>)}
      {model.evidenceAnchors.map(anchor => {
        const [x, y] = project(anchor.x, anchor.height + .12, anchor.z);
        return <g key={anchor.nodeId} role="button" tabIndex={-1} data-surface-node-id={anchor.nodeId} aria-label={`${anchor.title} 근거 보기`} onClick={() => onNode(anchor.nodeId)} onKeyDown={event => activate(event, () => onNode(anchor.nodeId))} className="surface-flat-marker"><title>{anchor.title}</title><circle cx={x} cy={y} r="7" fill="transparent"/><circle cx={x} cy={y} r={selected === anchor.nodeId ? 4 : 2} fill={selected === anchor.nodeId ? '#e1fff2' : '#9cc9db'} stroke={selected === anchor.nodeId ? '#80d6d4' : 'none'} strokeWidth="3"/></g>;
      })}
      {model.regions.map(region => {
        const [x, y] = project(region.x, region.height, region.z);
        return <g key={region.id} role="button" tabIndex={0} data-surface-region-id={region.id} aria-label={`${region.label} 지형 구역 선택`} aria-pressed={selectedCluster === region.id} onClick={() => onRegion(region.id)} onKeyDown={event => activate(event, () => onRegion(region.id))} className={`surface-flat-region${selectedCluster === region.id ? ' is-selected' : ''}`}>
          <line x1={x} y1={y} x2={x} y2={y - 30} stroke={colors[region.id]} opacity=".7"/><circle cx={x} cy={y} r="4" fill="none" stroke={colors[region.id]}/><rect x={x - 77} y={y - 68} width="154" height="39" rx="5"/><text x={x} y={y - 50} textAnchor="middle">{region.label.split(' · ')[0]}</text><text className="surface-flat-count" x={x} y={y - 36} textAnchor="middle">{countFor(region, model.metric)} {metricLabel(model.metric)}</text>
        </g>;
      })}
    </svg>
    <div className="surface-flat-zoom" aria-label="등각 지형 확대"><button onClick={() => setZoom(value => Math.max(.75, value / 1.25))} aria-label="등각 지형 축소">−</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom(value => Math.min(2.5, value * 1.25))} aria-label="등각 지형 확대">+</button></div>
  </div>;
}

export function TerrainSurface(props: TerrainSurfaceProps) {
  const { model, graph, selected, selectedCluster, onNode, onRelation, onRegion, onUnavailable, view } = props;
  const host = useRef<HTMLDivElement>(null), snapshot = useRef<CameraSnapshot | null>(null);
  const initialCamera = useRef({ position: [30, 28, 42] as Position, fov: 42, near: .1, far: 250 });
  const [webgl, setWebgl] = useState(supportsWebGL2), [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null), [query, setQuery] = useState('');
  const portal = useRef<HTMLDivElement | null>(null); portal.current = portalHost;
  const fail = useCallback(() => setWebgl(false), []);
  useEffect(() => { if (!webgl) onUnavailable?.(); }, [webgl, onUnavailable]);
  const renderer = view === '3d' && webgl ? '3d' : '2d';
  useEffect(() => {
    if (renderer !== '2d' || !host.current) return;
    // Do not present a stale WebGL buffer or camera as the active SVG rendering.
    for (const key of ['renderedHeightMin', 'renderedHeightMax', 'renderedPeakPosition', 'renderedVertexCount', 'renderedHeightFingerprint', 'cameraPosition', 'cameraTarget', 'cameraQuaternion']) delete host.current.dataset[key];
    host.current.dataset.cameraReady = 'false';
  }, [renderer]);
  const visibleAnchors = model.evidenceAnchors.filter(anchor => !query || `${anchor.title} ${anchor.nodeId}`.toLowerCase().includes(query.toLowerCase()));
  const paths = useMemo(() => relationPaths(model, graph, selected), [model, graph, selected]);
  const flat = <FlatSurface {...props}/>;
  return <div ref={host} className="terrain-surface" data-testid="terrain-surface" data-renderer={renderer}
    data-height-fingerprint={model.fingerprint} data-grid-columns={model.field.columns} data-grid-rows={model.field.rows} data-grid-point-count={model.field.heights.length}
    data-contribution-node-ids={JSON.stringify(model.contributions.nodeIds)} data-contribution-source-ids={JSON.stringify(model.contributions.sourceIds)} data-contribution-claim-ids={JSON.stringify(model.contributions.claimIds)} data-contribution-source-group-keys={JSON.stringify(model.contributions.sourceGroupKeys)}
    data-surface-node-ids={JSON.stringify(model.evidenceAnchors.map(anchor => anchor.nodeId))} data-surface-relation-ids={JSON.stringify(paths.map(path => path.edge.id))}
    data-surface-anchors={JSON.stringify(model.anchors.map(anchor => ({ id: anchor.nodeId, x: anchor.x, z: anchor.z, height: anchor.height, contributes: anchor.contributes })))}>
    <div className="surface-stage">
      <div className="surface-corner-label"><span/>EVIDENCE TOPOGRAPHY <small>{renderer === '3d' ? '3D RELIEF' : 'ISOMETRIC RELIEF'}</small></div>
      <div ref={setPortalHost} className="surface-label-layer"/>
      {!model.valid ? <p className="surface-empty" role="status">{model.errorMessage || '이 날짜의 지형을 표시할 수 없습니다.'}</p> : renderer === '3d' ? portalHost && <SurfaceBoundary fallback={flat} onError={fail}><Canvas camera={initialCamera.current} dpr={[1, 1.6]} frameloop="demand" gl={{ antialias: true, alpha: false }} onCreated={({ raycaster }) => { raycaster.params.Points.threshold = .22; }}><ContextGuard onLost={fail}/><SurfaceScene {...props} host={host} snapshot={snapshot} portal={portal}/></Canvas></SurfaceBoundary> : flat}
      {model.valid && !model.contributions.nodeIds.length && <p className="surface-empty surface-no-contributions">이 범위에는 선택한 지표의 높이에 기여하는 자료가 없습니다.</p>}
      <div className="surface-stage-caption"><span>{renderer === '3d' ? '드래그 회전 · 스크롤 확대 · 점을 눌러 근거 확인' : '등고선 지도 · 점을 눌러 근거 확인'}</span>{!webgl && <span role="status">3D를 사용할 수 없어 동일 근거의 등각 지도로 표시합니다.</span>}</div>
    </div>
    <div className="surface-region-strip">{model.regions.map(region => <button key={region.id} data-surface-region-id={region.id} aria-pressed={selectedCluster === region.id} onClick={() => onRegion(region.id)}><span style={{ background: colors[region.id] }}/>{region.label.split(' · ')[0]}<b>{countFor(region, model.metric)}</b></button>)}</div>
    <details className="surface-access"><summary><List size={13}/>근거 위치 목록<span>{model.evidenceAnchors.length}</span></summary><label className="surface-list-search"><Search size={13}/><input aria-label="지형 근거 목록 검색" placeholder="원문 제목 또는 주장 검색" value={query} onChange={event => setQuery(event.target.value)}/></label><div className="surface-evidence-list">{visibleAnchors.map(anchor => <button key={anchor.nodeId} data-surface-node-id={anchor.nodeId} data-surface-x={anchor.x} data-surface-z={anchor.z} data-surface-height={anchor.height} aria-pressed={selected === anchor.nodeId} onClick={() => onNode(anchor.nodeId)}><span>{anchor.kind === 'claim' ? '주장' : '원문'}</span><b>{anchor.title}</b><ArrowUpRight size={12}/></button>)}{!visibleAnchors.length && <p>현재 조건에 맞는 근거 위치가 없습니다.</p>}</div>{paths.length > 0 && <div className="surface-relation-list">{paths.map(({ edge }) => <button key={edge.id} data-surface-relation-id={edge.id} onClick={() => onRelation(edge.id)}>{edge.label}<span>{edge.inferred ? '분석 연결' : '출처 귀속'}</span></button>)}</div>}</details>
  </div>;
}

export default TerrainSurface;
