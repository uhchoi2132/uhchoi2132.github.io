import type { KnowledgeCluster, KnowledgeGraph, KnowledgeNode } from './knowledge';
import { sourceCluster } from './knowledge';
import { CLUSTER_CENTERS, CLUSTER_LABELS, layerPosition, type Position } from './knowledge-ontology';
import { knowledgeEvolution, type EvolutionExclusionReason, type KnowledgeEvolutionError } from './knowledge-evolution';
import { catalog, getRecordClaims, type ResearchCatalog, type ResearchRecord } from './research';

export type TerrainMetric = 'documents' | 'claims' | 'sourceGroups';
export interface TerrainSurfaceOptions {
  metric?: TerrainMetric;
  includeUndated?: boolean;
  /** Grid vertex counts, clamped to 2..128 and 2..96. */
  columns?: number;
  rows?: number;
}
export const TERRAIN_BOUNDS = Object.freeze({ minX: -20, maxX: 20, minZ: -14, maxZ: 16 });
export const TERRAIN_KERNEL_SIGMA = .85;
export const TERRAIN_HEIGHT_SCALE = 1.65;
export const TERRAIN_CONTOUR_STEP = .35;

export interface SurfaceEvidenceCounts {
  documentCount: number;
  claimCount: number;
  sourceGroupCount: number;
  documentIds: string[];
  claimIds: string[];
  sourceGroupKeys: string[];
}
export interface TerrainAnchor {
  nodeId: string;
  sourceId?: string;
  claimId?: string;
  cluster: KnowledgeCluster;
  kind: KnowledgeNode['kind'];
  title: string;
  x: number;
  z: number;
  height: number;
  originalPosition: Position;
  /** Eligible evidence across either layer; false for entities or excluded evidence. */
  eligible: boolean;
  /** Actually contributes to this metric's surface. */
  contributes: boolean;
}
export interface TerrainKernelAnchor {
  id: string;
  x: number;
  z: number;
  /** Only currently eligible, visible members. No hidden canonical representative ID. */
  nodeIds: string[];
  sourceIds: string[];
  claimIds: string[];
  sourceGroupKey?: string;
}
export interface TerrainSurfaceRegion extends SurfaceEvidenceCounts {
  id: KnowledgeCluster;
  label: string;
  x: number;
  z: number;
  height: number;
  metricCount: number;
  contributingNodeIds: string[];
}
export type TerrainExclusionReason = EvolutionExclusionReason | 'undated_disabled' | 'unusable_source' | 'unusable_claim' | 'invalid_position' | 'outside_fixed_bounds' | 'metric_not_selected' | 'missing_source_group';
export interface TerrainSurface {
  valid: boolean;
  error: KnowledgeEvolutionError | 'invalid_options' | null;
  errorMessage: string | null;
  knownAt: string;
  metric: TerrainMetric;
  includeUndated: boolean;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  field: {
    columns: number;
    rows: number;
    /** Row-major (increasing z, then x), flattened x,height,z triples. */
    positions: number[];
    heights: number[];
    /** Counterclockwise triangle vertices viewed from above. */
    indices: number[];
    minHeight: number;
    maxHeight: number;
  };
  contours: { level: number; segments: number[] }[];
  /** Exact visible graph positions projected onto the same surface, never invented nodes. */
  anchors: TerrainAnchor[];
  evidenceAnchors: TerrainAnchor[];
  kernelAnchors: TerrainKernelAnchor[];
  regions: TerrainSurfaceRegion[];
  /** All temporally eligible visible Source/Claim counts, independent of selected metric. */
  counts: SurfaceEvidenceCounts;
  contributions: {
    nodeIds: string[];
    sourceIds: string[];
    claimIds: string[];
    sourceGroupKeys: string[];
    publishedNodeIds: string[];
    undatedNodeIds: string[];
  };
  scope: { nodeIds: string[]; eligibleNodeIds: string[]; noncontributingNodeIds: string[] };
  exclusions: { nodeId: string; sourceId?: string; reason: TerrainExclusionReason }[];
  /** Noncryptographic checksum of grid geometry/heights, not of original evidence. */
  fingerprint: string;
  semantics: {
    kind: 'visible_evidence_density';
    formula: string;
    sigma: number;
    heightScale: number;
    contourStep: number;
    dateNormalization: false;
    confidenceMeasured: false;
    sourceGroupsAreIndependentEvidence: false;
    coordinateMapping: string;
    limitations: string[];
  };
}

const clusters = Object.keys(CLUSTER_LABELS) as KnowledgeCluster[];
const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();
const worldZ = (graphY: number): number => graphY === 0 ? 0 : -graphY;
const readable = (value: string): boolean => value === 'manual_report' || value === 'primary_read';
const inside = (x: number, z: number): boolean => x >= TERRAIN_BOUNDS.minX && x <= TERRAIN_BOUNDS.maxX && z >= TERRAIN_BOUNDS.minZ && z <= TERRAIN_BOUNDS.maxZ;
const validPosition = (position: Position): boolean => Array.isArray(position) && position.length === 3 && position.every(Number.isFinite);
interface EligibleEvidence { node: KnowledgeNode; record: ResearchRecord; claimId?: string }
function evidenceCounts(evidence: EligibleEvidence[]): SurfaceEvidenceCounts {
  const documentIds = sorted(evidence.filter(item => !item.claimId).map(item => item.record.id));
  const claimIds = sorted(evidence.flatMap(item => item.claimId ? [item.claimId] : []));
  const sourceGroupKeys = sorted(evidence.filter(item => !item.claimId).map(item => item.record.origin_key.trim()).filter(Boolean));
  return { documentIds, claimIds, sourceGroupKeys, documentCount: documentIds.length, claimCount: claimIds.length, sourceGroupCount: sourceGroupKeys.length };
}

/**
 * An origin always occupies one fixed catalog-layout location. Selecting an
 * additional republication can reveal its evidence marker but cannot move or
 * duplicate the origin's kernel. Only the coordinates are exported: the hidden
 * representative's identity, title and future publication are never exposed.
 */
function groupPositions(source: ResearchCatalog): Map<string, { x: number; z: number }> {
  const positions = new Map<string, Position>();
  for (const cluster of clusters) {
    const records = source.records.filter(record => sourceCluster(record) === cluster).sort((a, b) => a.id.localeCompare(b.id));
    records.forEach((record, index) => positions.set(record.id, layerPosition(cluster, 'sources', index, records.length)));
  }
  const groups = new Map<string, { x: number; z: number }>();
  for (const record of [...source.records].sort((a, b) => a.id.localeCompare(b.id))) {
    const key = record.origin_key.trim();
    if (!key || groups.has(key)) continue;
    const position = positions.get(record.id)!;
    groups.set(key, { x: position[0], z: worldZ(position[1]) });
  }
  return groups;
}

/** Continuous analytical height, using only the serialized contributing kernels. */
export function evaluateTerrainHeight(kernels: readonly TerrainKernelAnchor[], x: number, z: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
  let density = 0;
  const denominator = 2 * TERRAIN_KERNEL_SIGMA * TERRAIN_KERNEL_SIGMA;
  for (const point of kernels) density += Math.exp(-((x - point.x) ** 2 + (z - point.z) ** 2) / denominator);
  return TERRAIN_HEIGHT_SCALE * Math.log1p(density);
}

/** Bilinear sample of the exact rendered grid; out-of-bounds coordinates return 0. */
export function sampleTerrainHeight(surface: TerrainSurface, x: number, z: number): number {
  const { bounds, field } = surface;
  if (!Number.isFinite(x) || !Number.isFinite(z) || x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) return 0;
  const u = (x - bounds.minX) / (bounds.maxX - bounds.minX) * (field.columns - 1);
  const v = (z - bounds.minZ) / (bounds.maxZ - bounds.minZ) * (field.rows - 1);
  const left = Math.min(Math.floor(u), field.columns - 2);
  const top = Math.min(Math.floor(v), field.rows - 2);
  const a = field.heights[top * field.columns + left];
  const b = field.heights[top * field.columns + left + 1];
  const c = field.heights[(top + 1) * field.columns + left];
  const d = field.heights[(top + 1) * field.columns + left + 1];
  const dx = u - left, dz = v - top;
  return (a * (1 - dx) + b * dx) * (1 - dz) + (c * (1 - dx) + d * dx) * dz;
}

/** Marching squares at fixed elevations. Ambiguous saddle cells use their center value. */
function contourLines(field: TerrainSurface['field']): TerrainSurface['contours'] {
  const contours: TerrainSurface['contours'] = [];
  const edgeCorners = [[0, 1], [1, 2], [2, 3], [3, 0]] as const;
  for (let n = 1; n * TERRAIN_CONTOUR_STEP <= field.maxHeight; n++) {
    const level = Number((n * TERRAIN_CONTOUR_STEP).toFixed(10));
    const segments: number[] = [];
    for (let row = 0; row < field.rows - 1; row++) for (let col = 0; col < field.columns - 1; col++) {
      const indices = [row * field.columns + col, row * field.columns + col + 1, (row + 1) * field.columns + col + 1, (row + 1) * field.columns + col];
      const h = indices.map(index => field.heights[index]);
      const hits: { edge: number; x: number; z: number }[] = [];
      edgeCorners.forEach(([a, b], edge) => {
        if ((h[a] >= level) === (h[b] >= level)) return;
        const t = (level - h[a]) / (h[b] - h[a]);
        const ai = indices[a] * 3, bi = indices[b] * 3;
        hits.push({ edge, x: field.positions[ai] + t * (field.positions[bi] - field.positions[ai]), z: field.positions[ai + 2] + t * (field.positions[bi + 2] - field.positions[ai + 2]) });
      });
      const segment = (a: number, b: number) => segments.push(hits[a].x, level, hits[a].z, hits[b].x, level, hits[b].z);
      if (hits.length === 2) segment(0, 1);
      else if (hits.length === 4) {
        // h0/h2 are the same sign. Pair around the corners opposite the center sign.
        if ((h.reduce((sum, value) => sum + value, 0) / 4 >= level) === (h[0] >= level)) { segment(0, 1); segment(2, 3); }
        else { segment(0, 3); segment(1, 2); }
      }
    }
    if (segments.length) contours.push({ level, segments });
  }
  return contours;
}

function fieldFingerprint(field: TerrainSurface['field']): string {
  let hash = 2166136261;
  const value = JSON.stringify([TERRAIN_BOUNDS, field.columns, field.rows, field.heights]);
  for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * Pure fixed-domain evidence topography. All kernels are nonnegative and use
 * absolute constants, so adding eligible evidence never lowers any height.
 * Entities/relationships create no hills. No per-date/region max normalization,
 * terrain noise, synthetic peak, source fetch, model mutation or force layout.
 */
export function terrainSurface(graph: KnowledgeGraph, knownAt: string, options: TerrainSurfaceOptions = {}, source: ResearchCatalog = catalog): TerrainSurface {
  const metric = options.metric ?? 'documents';
  const includeUndated = options.includeUndated ?? false;
  const invalidOptions = !['documents', 'claims', 'sourceGroups'].includes(metric) || typeof includeUndated !== 'boolean' ||
    (options.columns !== undefined && !Number.isFinite(options.columns)) || (options.rows !== undefined && !Number.isFinite(options.rows));
  const columns = Math.max(2, Math.min(128, Math.floor(Number.isFinite(options.columns) ? options.columns! : 80)));
  const rows = Math.max(2, Math.min(96, Math.floor(Number.isFinite(options.rows) ? options.rows! : 64)));
  const evolution = knowledgeEvolution(graph, knownAt, source);
  const error = invalidOptions ? 'invalid_options' : evolution.error;
  const exclusions: TerrainSurface['exclusions'] = [...evolution.exclusions];
  const originalNodes = new Map<string, KnowledgeNode>();
  const conflictingPositionIds = new Set<string>();
  for (const node of graph.nodes) {
    const previous = originalNodes.get(node.id);
    if (previous && JSON.stringify(previous.position) !== JSON.stringify(node.position)) conflictingPositionIds.add(node.id);
    originalNodes.set(node.id, node);
  }
  const nodes = [...originalNodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  const sourceMap = new Map(source.records.map(record => [record.id, record]));
  const claimMap = new Map(source.records.flatMap(record => getRecordClaims(record).map(claim => [claim.id, { record, claim }] as const)));
  const acceptedDocuments = new Set(evolution.scope.documentIds);
  const acceptedClaims = new Set(evolution.scope.claimIds);
  const eligible: EligibleEvidence[] = [];
  if (!error) for (const node of nodes) {
    const isSource = node.ontology_type === 'Source';
    const isClaim = node.ontology_type === 'Claim';
    if (!isSource && !isClaim) continue;
    const claim = isClaim ? claimMap.get(node.id) : undefined;
    const record = isSource ? sourceMap.get(node.id.replace(/^source:/, '')) : claim?.record;
    if (!record || !(isSource ? acceptedDocuments.has(record.id) : acceptedClaims.has(node.id))) continue;
    const exclude = (reason: TerrainExclusionReason) => exclusions.push({ nodeId: node.id, sourceId: record.id, reason });
    if (conflictingPositionIds.has(node.id)) { exclude('conflicting_node_identity'); continue; }
    if (!validPosition(node.position)) { exclude('invalid_position'); continue; }
    if (!inside(node.position[0], -node.position[1])) { exclude('outside_fixed_bounds'); continue; }
    if (!readable(record.verification)) { exclude('unusable_source'); continue; }
    if (claim && !readable(claim.claim.verification ?? record.verification)) { exclude('unusable_claim'); continue; }
    if (record.published_at === null && !includeUndated) { exclude('undated_disabled'); continue; }
    eligible.push({ node, record, claimId: isClaim ? node.id : undefined });
  }
  const selected = eligible.filter(item => {
    const selectedLayer = metric === 'claims' ? !!item.claimId : !item.claimId;
    if (!selectedLayer) { exclusions.push({ nodeId: item.node.id, sourceId: item.record.id, reason: 'metric_not_selected' }); return false; }
    if (metric === 'sourceGroups' && !item.record.origin_key.trim()) { exclusions.push({ nodeId: item.node.id, sourceId: item.record.id, reason: 'missing_source_group' }); return false; }
    return true;
  });
  const kernelAnchors: TerrainKernelAnchor[] = [];
  if (metric === 'sourceGroups') {
    const origins = groupPositions(source);
    for (const key of sorted(selected.map(item => item.record.origin_key.trim()))) {
      const members = selected.filter(item => item.record.origin_key.trim() === key);
      kernelAnchors.push({ id: `origin:${key}`, ...origins.get(key)!, sourceGroupKey: key,
        nodeIds: sorted(members.map(item => item.node.id)), sourceIds: sorted(members.map(item => item.record.id)), claimIds: [] });
    }
  } else for (const item of selected) kernelAnchors.push({
    id: item.node.id, x: item.node.position[0], z: worldZ(item.node.position[1]),
    nodeIds: [item.node.id], sourceIds: [item.record.id], claimIds: item.claimId ? [item.claimId] : [],
  });
  const field: TerrainSurface['field'] = { columns, rows, positions: [], heights: [], indices: [], minHeight: 0, maxHeight: 0 };
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const x = TERRAIN_BOUNDS.minX + col / (columns - 1) * (TERRAIN_BOUNDS.maxX - TERRAIN_BOUNDS.minX);
    const z = TERRAIN_BOUNDS.minZ + row / (rows - 1) * (TERRAIN_BOUNDS.maxZ - TERRAIN_BOUNDS.minZ);
    const height = evaluateTerrainHeight(kernelAnchors, x, z);
    field.positions.push(x, height, z); field.heights.push(height);
    if (col < columns - 1 && row < rows - 1) {
      const a = row * columns + col, b = a + 1, c = a + columns, d = c + 1;
      field.indices.push(a, c, b, b, c, d);
    }
  }
  field.minHeight = Math.min(...field.heights); field.maxHeight = Math.max(...field.heights);
  const eligibleMap = new Map(eligible.map(item => [item.node.id, item]));
  const selectedIds = new Set(selected.map(item => item.node.id));
  const surface: TerrainSurface = {
    valid: error === null, error, errorMessage: invalidOptions ? '유효한 지형 지표·격자 옵션을 선택하세요.' : evolution.errorMessage,
    knownAt, metric, includeUndated, bounds: { ...TERRAIN_BOUNDS }, field, contours: contourLines(field),
    anchors: [], evidenceAnchors: [], kernelAnchors, regions: [], counts: evidenceCounts(eligible),
    contributions: { nodeIds: sorted(selectedIds), sourceIds: sorted(selected.map(item => item.record.id)),
      claimIds: sorted(selected.flatMap(item => item.claimId ? [item.claimId] : [])), sourceGroupKeys: sorted(selected.map(item => item.record.origin_key.trim()).filter(Boolean)),
      publishedNodeIds: sorted(selected.filter(item => item.record.published_at !== null).map(item => item.node.id)),
      undatedNodeIds: sorted(selected.filter(item => item.record.published_at === null).map(item => item.node.id)) },
    scope: { nodeIds: sorted(graph.nodes.map(node => node.id)), eligibleNodeIds: sorted(eligible.map(item => item.node.id)), noncontributingNodeIds: sorted(nodes.filter(node => !selectedIds.has(node.id)).map(node => node.id)) },
    exclusions: exclusions.sort((a, b) => a.nodeId.localeCompare(b.nodeId) || a.reason.localeCompare(b.reason)),
    fingerprint: fieldFingerprint(field),
    semantics: {
      kind: 'visible_evidence_density', formula: 'h(x,z) = 1.65 × ln(1 + Σ exp(-((x-xᵢ)²+(z-zᵢ)²)/(2×0.85²)))',
      sigma: TERRAIN_KERNEL_SIGMA, heightScale: TERRAIN_HEIGHT_SCALE, contourStep: TERRAIN_CONTOUR_STEP,
      dateNormalization: false, confidenceMeasured: false, sourceGroupsAreIndependentEvidence: false,
      coordinateMapping: 'x = graph.position[0]; z = -graph.position[1]; y = sampled height',
      limitations: [
        '높이는 현재 보이는 적격 문서·주장·출처군의 공간 밀도를 고정 로그식으로 나타냅니다. 신뢰도·사실 확률·사업 성공·독립 확증의 강도를 측정하지 않습니다.',
        '현재 그래프 선택과 공개 기준일을 함께 적용합니다. 자료가 추가될 때 높이가 낮아지지 않지만 필터·레이어·지표 변경으로 자료가 빠지면 낮아질 수 있습니다.',
        '공개일은 원출처 카탈로그 기준이며 사건일·작성일·정정 이력이 아닙니다. 미상 자료는 명시적으로 켠 경우에만 관측일을 적용하여 포함합니다.',
        '출처군 지표는 origin당 단일 고정 커널을 사용합니다. 전체 카탈로그에서 정한 기하학적 위치는 숨은 문서의 공개·집계·표시를 뜻하지 않습니다.',
        '지역별 출처군은 겹칠 수 있으므로 지역 합계를 독립 근거 개수로 더할 수 없습니다. 숨은 Source 노드는 주장 출처 연결만으로 문서 집계에 복원되지 않습니다.',
        '지형 좌표와 경사는 탐색을 위한 분석 배치입니다. 실제 지리·기업 권력·인과·지식의 확실성·완전성을 뜻하지 않습니다.',
        'fingerprint는 격자 높이의 비암호 비교값입니다. 원문 바이트 해시·증거 보존·진위 검증을 대신하지 않습니다.',
      ],
    },
  };
  surface.anchors = nodes.filter(node => validPosition(node.position) && inside(node.position[0], -node.position[1]) && !conflictingPositionIds.has(node.id)).map(node => {
    const item = eligibleMap.get(node.id);
    return { nodeId: node.id, ...(item ? { sourceId: item.record.id } : {}), ...(item?.claimId ? { claimId: item.claimId } : {}), cluster: node.cluster, kind: node.kind, title: node.title,
      x: node.position[0], z: worldZ(node.position[1]), height: sampleTerrainHeight(surface, node.position[0], worldZ(node.position[1])),
      originalPosition: [...node.position] as Position, eligible: !!item, contributes: selectedIds.has(node.id) };
  });
  surface.evidenceAnchors = surface.anchors.filter(anchor => anchor.contributes);
  surface.regions = clusters.map(id => {
    const regionCounts = evidenceCounts(eligible.filter(item => item.node.cluster === id));
    const x = CLUSTER_CENTERS[id][0], z = worldZ(CLUSTER_CENTERS[id][1]);
    return { id, label: CLUSTER_LABELS[id], x, z, height: sampleTerrainHeight(surface, x, z), ...regionCounts,
      metricCount: metric === 'documents' ? regionCounts.documentCount : metric === 'claims' ? regionCounts.claimCount : regionCounts.sourceGroupCount,
      contributingNodeIds: sorted(selected.filter(item => item.node.cluster === id).map(item => item.node.id)) };
  });
  return surface;
}

/** A drawn terrain connection and its detail must share the same eligible proof. */
export function surfaceRelations(surface: TerrainSurface, graph: KnowledgeGraph) {
  const eligible = surface.anchors.filter(anchor => anchor.eligible);
  const anchors = new Set(eligible.map(anchor => anchor.nodeId));
  const sourceIds = new Set(eligible.flatMap(anchor => anchor.sourceId ? [anchor.sourceId] : []));
  const claimIds = new Set(eligible.flatMap(anchor => anchor.claimId ? [anchor.claimId] : []));
  return graph.relations.filter(relation => anchors.has(relation.from) && anchors.has(relation.to)
    && relation.source_ids.length > 0 && relation.source_ids.every(id => sourceIds.has(id))
    && relation.claim_ids.every(id => claimIds.has(id))
    && (relation.published_at ? relation.published_at <= surface.knownAt : surface.includeUndated && relation.observed_at.slice(0, 10) <= surface.knownAt));
}
