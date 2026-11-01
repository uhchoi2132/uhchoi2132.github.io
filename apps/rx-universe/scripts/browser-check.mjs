import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';
const expect = playwrightExpect.configure({ timeout: 15_000 });

// Run after the production build. Set PREVIEW_URL to reuse an existing server.
const previewUrl = process.env.PREVIEW_URL || 'http://127.0.0.1:4173/rx-universe/';
const output = path.resolve(process.env.BROWSER_ARTIFACT_DIR || 'test-results');
const researchCatalog = JSON.parse(await readFile(new URL('../src/research-data.json', import.meta.url), 'utf8'));
const surveyCatalog = JSON.parse(await readFile(new URL('../research/survey-data.json', import.meta.url), 'utf8'));
const currentDate = researchCatalog.meta.window_end;
assert.match(currentDate, /^\d{4}-\d{2}-\d{2}$/, 'The current horizon must be an explicit ISO date');
// Test expectations calculate the inclusive publication windows independently of src/briefing.ts.
const shiftDay = (day, delta) => {
  const value = new Date(`${day}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + delta);
  return value.toISOString().slice(0, 10);
};
const weeklyStart = shiftDay(currentDate, -6);
const monthlyStart = `${currentDate.slice(0, 7)}-01`;
const catalogClaimCount = researchCatalog.records.reduce((count, record) => count + (record.claims?.length || 1), 0);
const execFileAsync = promisify(execFile);
const researchAtDate = (date, mode = 'known') => researchCatalog.records.filter(row => row.scope === 'in_window'
  && row.published_at && ['page', 'search_index'].includes(row.date_basis)
  && row.published_at >= researchCatalog.meta.window_start
  && row.published_at <= (mode === 'known' ? date : researchCatalog.meta.window_end)
  && (mode === 'known' || (row.event_date ?? row.published_at) <= date));
const claimRows = records => records.flatMap(record => record.claims?.length ? record.claims : [{ ...record.claim, id: `claim:${record.id}` }]);
const sorted = ids => [...ids].sort();
const isEvidenceNode = node => ['Claim', 'Source'].includes(node.ontology_type);
const usableVerification = value => ['manual_report', 'primary_read'].includes(value);
function graphInventory(records) {
  const sources = records.filter(record => record.scope !== 'out_of_window' && usableVerification(record.verification));
  const claims = sources.flatMap(record => claimRows([record]).filter(claim => usableVerification(claim.verification ?? record.verification)));
  return { sources, claims };
}
function assertCompleteGraphInventory(snapshot, records) {
  const expected = graphInventory(records);
  assert.deepEqual(sorted(snapshot.graph.nodes.filter(node => node.ontology_type === 'Source').map(node => node.id)), sorted(expected.sources.map(source => `source:${source.id}`)), 'Every eligible source must have its own graph node; background and blocked sources must stay excluded');
  assert.deepEqual(sorted(snapshot.graph.nodes.filter(node => node.ontology_type === 'Claim').map(node => node.id)), sorted(expected.claims.map(claim => claim.id)), 'All eligible merged claims must have distinct graph nodes');
  for (const claim of expected.claims) {
    const node = snapshot.graph.nodes.find(item => item.id === claim.id);
    assert.ok(node.claim_ids.includes(claim.id), `${claim.id}: claim node must retain its exact provenance`);
    assert.ok(snapshot.graph.relations.some(relation => relation.from === node.id && relation.type === 'documented_by' && relation.to.startsWith('source:')), `${claim.id}: claim must link to its source node`);
  }
}
function graphDistances(graph, start) {
  const distance = new Map([[start, 0]]);
  const queue = [start];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    for (const relation of graph.relations) {
      const neighbor = relation.from === current ? relation.to : relation.to === current ? relation.from : null;
      if (neighbor !== null && !distance.has(neighbor)) { distance.set(neighbor, distance.get(current) + 1); queue.push(neighbor); }
    }
  }
  return distance;
}
function assertNeighborhood(snapshot, fullGraph, focus, hops) {
  const distances = graphDistances(fullGraph, focus);
  const ids = new Set([...distances].filter(([, distance]) => distance <= hops).map(([id]) => id));
  assert.deepEqual(sorted(snapshot.graph.nodes.map(node => node.id)), sorted(ids), `${hops}-hop neighborhood must include exactly the reachable nodes`);
  assert.deepEqual(sorted(snapshot.graph.relations.map(relation => relation.id)), sorted(fullGraph.relations.filter(relation => ids.has(relation.from) && ids.has(relation.to)).map(relation => relation.id)), 'Neighborhood export must preserve actual edges and their direction');
}
const originKey = record => record.origin_key.trim() || record.url;
function groupedSourceIds(records) {
  const groups = new Map();
  for (const record of records) groups.set(originKey(record), [...(groups.get(originKey(record)) ?? []), record.id]);
  return Object.fromEntries([...groups].sort(([a], [b]) => a.localeCompare(b)).map(([key, ids]) => [key, sorted(ids)]));
}
const titles = ['Command Center', '3D Universe', 'Time Machine', 'Evidence Vault', 'Hypothesis War Room', 'Factory Twin', 'Briefing Studio', 'Source Survey', 'Action Items'];
const report = { url: previewUrl, started_at: new Date().toISOString(), checks: [], console_errors: [], page_errors: [], failed_requests: [], screenshots: [], status: 'running' };
let server;
let browser;
let currentPage;
let serverLog = '';
const pendingDiagnostics = new Set();
await mkdir(output, { recursive: true });

function monitor(page, label) {
  page.on('pageerror', error => {
    const entry = { page: label, message: error.message, stack: error.stack, timestamp: new Date().toISOString(), url: page.url(), heading: null };
    report.page_errors.push(entry);
    const pending = page.locator('main h1').textContent({ timeout: 2_000 })
      .then(heading => { entry.heading = heading; })
      .catch(() => { entry.heading = '(unavailable during navigation)'; });
    pendingDiagnostics.add(pending);
    void pending.finally(() => pendingDiagnostics.delete(pending));
  });
  page.on('console', message => {
    if (message.type() === 'error') report.console_errors.push({ page: label, message: message.text(), location: message.location() });
  });
  page.on('requestfailed', request => report.failed_requests.push({ page: label, url: request.url(), error: request.failure()?.errorText }));
}
function navButton(page, title) {
  return page.locator('.sidebar nav button').filter({ hasText: title });
}
async function navigate(page, title, mobile = false) {
  if (mobile) {
    await page.getByRole('button', { name: '메뉴', exact: true }).click();
    await expect(page.locator('.sidebar')).toHaveClass(/\bopen\b/);
  }
  await navButton(page, title).click();
  await expect(page.locator('main h1')).toContainText(title);
  if (mobile) await expect(page.locator('.sidebar')).not.toHaveClass(/\bopen\b/);
}
async function noHorizontalOverflow(page, title) {
  const sizes = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(sizes.page <= sizes.viewport + 1 && sizes.body <= sizes.viewport + 1, `${title}: horizontal overflow ${JSON.stringify(sizes)}`);
}
async function screenshot(page, filename, fullPage = true) {
  await page.screenshot({ path: path.join(output, filename), fullPage, animations: 'disabled', style: '.toast { visibility: hidden !important; }' });
  report.screenshots.push(filename);
}
async function exportSnapshot(page, label, date) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '스냅샷 내보내기', exact: true }).click();
  const download = await pending;
  assert.equal(download.suggestedFilename(), `rx-snapshot-${date}.json`);
  const location = path.join(output, `${label}-${download.suggestedFilename()}`);
  await download.saveAs(location);
  return JSON.parse(await readFile(location, 'utf8'));
}
function assertResearchSnapshot(snapshot, records, date, mode = 'known', eventAsOf = null) {
  assert.equal(snapshot.as_of, eventAsOf ?? date);
  assert.equal(snapshot.selected_knowledge_date, date);
  assert.equal(snapshot.event_as_of, eventAsOf);
  assert.equal(snapshot.known_at, mode === 'known' ? date : researchCatalog.meta.window_end);
  assert.equal(snapshot.collection_status, 'manual_research_snapshot');
  assert.equal(snapshot.automatic_collection_status, 'not_connected');
  assert.equal(snapshot.last_successful_update, null);
  assert.deepEqual(sorted(snapshot.research_records.map(row => row.id)), sorted(records.map(row => row.id)), 'Export must preserve exactly the eligible sources');
  assert.deepEqual(sorted(snapshot.research_claims.map(row => row.id)), sorted(claimRows(records).map(row => row.id)), 'All merged claims must survive export');
  assert.equal(snapshot.research_counts.sourceGroups, Object.keys(groupedSourceIds(records)).length, 'Source-group counts must come from the selected records, not a fixed inventory total');
  assert.equal(snapshot.research_counts.manualReports, records.filter(row => row.verification === 'manual_report').length);
  assert.equal(snapshot.research_counts.archivedOriginals, records.filter(row => row.audit_status === 'archived').length);
  assert.equal(snapshot.research_counts.primaryRead, snapshot.research_counts.archivedOriginals);
  for (const exported of snapshot.research_records) {
    const original = records.find(row => row.id === exported.id);
    for (const field of ['verification', 'audit_status', 'archive_url', 'content_sha256', 'verification_note']) {
      assert.deepEqual(exported[field], original[field], `${exported.id}: export changed ${field}`);
    }
    if (exported.audit_status !== 'archived') {
      assert.equal(exported.archive_url, null, `${exported.id}: unarchived evidence must not claim a preserved original`);
      assert.equal(exported.content_sha256, null, `${exported.id}: unarchived evidence must not claim an original-content hash`);
      assert.notEqual(exported.verification, 'primary_read');
    }
  }
  assert.deepEqual(snapshot.claims, snapshot.research_claims);
  assert.deepEqual(snapshot.entities, snapshot.graph.nodes);
  assert.deepEqual(snapshot.relations, snapshot.graph.relations);
  const nodeIds = new Set(snapshot.graph.nodes.map(node => node.id));
  assert.equal(nodeIds.size, snapshot.graph.nodes.length, 'Graph node IDs must be unique');
  assert.equal(new Set(snapshot.graph.relations.map(relation => relation.id)).size, snapshot.graph.relations.length, 'Graph relation IDs must be unique');
  const sourceIds = new Set(records.map(row => row.id));
  const claimIds = new Set(snapshot.research_claims.map(row => row.id));
  const readable = graphInventory(records);
  const readableSourceIds = new Set(readable.sources.map(source => source.id));
  const readableClaimIds = new Set(readable.claims.map(claim => claim.id));
  for (const node of snapshot.graph.nodes) {
    for (const id of node.source_ids) assert.ok(readableSourceIds.has(id), `Node ${node.id} leaked excluded source ${id}`);
    for (const id of node.claim_ids) assert.ok(readableClaimIds.has(id), `Node ${node.id} leaked excluded claim ${id}`);
  }
  for (const relation of snapshot.graph.relations) {
    assert.ok(nodeIds.has(relation.from) && nodeIds.has(relation.to), `Dangling relation ${relation.id}`);
    for (const id of relation.source_ids) assert.ok(sourceIds.has(id), `Relation ${relation.id} leaked source ${id}`);
    for (const id of relation.claim_ids) assert.ok(claimIds.has(id), `Relation ${relation.id} leaked claim ${id}`);
    for (const id of relation.source_ids) assert.ok(readableSourceIds.has(id), `Relation ${relation.id} used unread source ${id}`);
    for (const id of relation.claim_ids) assert.ok(readableClaimIds.has(id), `Relation ${relation.id} used unread claim ${id}`);
  }
}
async function assertGraphParity(page, snapshot, { flat = false } = {}) {
  const graph = page.locator('.graph-stage .universe-visual');
  const nodeIds = sorted(snapshot.graph.nodes.map(node => node.id));
  const edgeIds = sorted(snapshot.graph.relations.map(relation => relation.id));
  await expect(graph).toHaveCount(1);
  await expect(page.locator('.graph-stage')).toHaveAttribute('data-graph-node-count', String(nodeIds.length));
  await expect(page.locator('.graph-stage')).toHaveAttribute('data-graph-relation-count', String(edgeIds.length));
  await expect(graph).toHaveAttribute('data-node-count', String(nodeIds.length));
  await expect(graph).toHaveAttribute('data-edge-count', String(edgeIds.length));
  assert.deepEqual(sorted(JSON.parse(await graph.getAttribute('data-node-ids'))), nodeIds, 'Renderer and export node IDs differ');
  assert.deepEqual(sorted(JSON.parse(await graph.getAttribute('data-edge-ids'))), edgeIds, 'Renderer and export relation IDs differ');
  if (flat) {
    const svg = graph.locator('svg[role="group"]');
    await expect(svg).toBeVisible();
    assert.deepEqual(sorted(await svg.locator('[data-node-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-node-id')))), nodeIds);
    assert.deepEqual(sorted(await svg.locator('.rx-link[data-edge-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-edge-id')))), edgeIds);
  }
}
async function assertCandidateCount(panel, total, visible) {
  await expect(panel).toHaveAttribute('data-candidate-total', String(total));
  await expect(panel).toHaveAttribute('data-candidate-count', String(visible));
  await expect(panel.locator('[data-candidate-item]')).toHaveCount(visible);
  await expect(panel.locator('.brief-section-title')).toContainText(`표시 ${visible} / 전체 ${total}개 출처 그룹`);
}
async function assertSurveyDatabase(databasePath, surveyInventory) {
  const script = `import json, sqlite3, sys
with sqlite3.connect('file:' + sys.argv[1] + '?mode=ro', uri=True) as db:
    output = {'integrity': db.execute('PRAGMA integrity_check').fetchone()[0], 'foreign_keys': db.execute('PRAGMA foreign_key_check').fetchall()}
    output['ids'] = {table: [row[0] for row in db.execute('SELECT id FROM ' + table + ' ORDER BY id')] for table in ['Sources', 'Claims', 'CrawlRuns', 'CoverageCollections', 'DiscoveryInventory']}
    output['candidates'] = [{'id': row[0], 'source_ids': json.loads(row[1]), 'automatically_verified': row[2], 'raw': json.loads(row[3])} for row in db.execute('SELECT id, source_ids_json, automatically_verified, raw_candidate_json FROM DiscoveryInventory ORDER BY id')]
    output['verified_claims'] = db.execute('SELECT count(*) FROM Claims WHERE independently_verified != 0').fetchone()[0]
    output['survey_counts'] = json.loads(db.execute("SELECT value_json FROM Metadata WHERE key='survey_counts'").fetchone()[0])
    print(json.dumps(output, ensure_ascii=False))`;
  const { stdout } = await execFileAsync('python3', ['-c', script, databasePath], { maxBuffer: 32 * 1024 * 1024 });
  const database = JSON.parse(stdout);
  assert.equal(database.integrity, 'ok');
  assert.deepEqual(database.foreign_keys, []);
  assert.deepEqual(database.ids.Sources, sorted(researchCatalog.records.map(record => record.id)), 'Discovery inventory must not silently add reviewed sources');
  assert.deepEqual(database.ids.Claims, sorted(claimRows(researchCatalog.records).map(claim => claim.id)), 'Discovered URLs must not automatically create claims');
  assert.equal(database.verified_claims, 0, 'Source-attributed statements must not be promoted to independently verified facts');
  for (const [table, key] of [['CrawlRuns', 'runs'], ['CoverageCollections', 'collections'], ['DiscoveryInventory', 'candidates']]) {
    assert.deepEqual(database.ids[table], sorted(surveyInventory[key].map(row => row.id)), `${table} must preserve every survey record`);
    assert.equal(database.survey_counts[key], surveyInventory[key].length);
  }
  for (const candidate of database.candidates) {
    assert.equal(candidate.automatically_verified, 0);
    const original = surveyInventory.candidates.find(row => row.id === candidate.id);
    assert.deepEqual(candidate.source_ids, original.source_ids ?? []);
    assert.deepEqual(candidate.raw, original, 'SQLite must preserve the original discovery status and collection path');
    assert.ok(!Object.hasOwn(candidate.raw, 'claim') && !Object.hasOwn(candidate.raw, 'claims'), 'Discovery rows must remain separate from extracted claims');
  }
}
async function assertSurveyCandidatePage(panel, records, offset = 0) {
  const visible = records.slice(offset, offset + 40);
  await expect(panel.getByTestId('survey-candidate')).toHaveCount(visible.length);
  assert.deepEqual(await panel.getByTestId('survey-candidate').evaluateAll(elements => elements.map(element => element.getAttribute('data-candidate-id'))), visible.map(row => row.id), 'Survey pagination must expose exactly the matching records, without hidden or duplicated rows');
  await expect(panel.locator('.survey-result')).toContainText(records.length.toLocaleString());
}
async function ready() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server && server.exitCode !== null) throw new Error(`Vite preview exited (${server.exitCode}): ${serverLog}`);
    try {
      const response = await fetch(previewUrl, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch { /* Server may still be starting. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Preview did not become ready at ${previewUrl}. ${serverLog}`);
}

try {
  if (!process.env.PREVIEW_URL) {
    server = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    server.on('error', error => { serverLog += `${error.message}\n`; });
    for (const stream of [server.stdout, server.stderr]) stream.on('data', data => { serverLog += data.toString(); });
  }
  await ready();
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
  const page = currentPage = await desktop.newPage();
  page.setDefaultTimeout(15_000);
  monitor(page, 'desktop');
  await page.goto(previewUrl, { waitUntil: 'networkidle' });
  await expect(page.locator('main h1')).toContainText('Command Center');
  await expect(page.locator('.graph-stage canvas, .graph-stage svg[role="group"]')).toHaveCount(1);
  const currentSnapshot = await exportSnapshot(page, 'current', currentDate);
  assert.ok(researchCatalog.records.length > 0, 'The research catalog must contain reviewed sources');
  assert.equal(claimRows(researchCatalog.records).length, catalogClaimCount, 'Every catalog claim must survive the browser-facing inventory');
  await expect(page.getByLabel('정보 기준일', { exact: true })).toHaveValue(currentDate);
  assertResearchSnapshot(currentSnapshot, researchCatalog.records, currentDate);
  assertCompleteGraphInventory(currentSnapshot, researchCatalog.records);
  assert.ok(currentSnapshot.graph.nodes.length > 150, 'The expanded graph must expose source and claim nodes, not just a small curated overview');
  report.graph_metrics = {
    nodes: currentSnapshot.graph.nodes.length, relations: currentSnapshot.graph.relations.length,
    sources: currentSnapshot.graph.nodes.filter(node => node.ontology_type === 'Source').length,
    claims: currentSnapshot.graph.nodes.filter(node => node.ontology_type === 'Claim').length,
    entities: currentSnapshot.graph.nodes.filter(node => !isEvidenceNode(node)).length,
  };
  await assertGraphParity(page, currentSnapshot);
  await expect(page.locator('.profile, .top-avatar, .notification i')).toHaveCount(0);
  const radar = page.locator('.signal-panel .brief-candidates');
  const weeklySourceGroups = Object.keys(groupedSourceIds(researchAtDate(currentDate).filter(row => row.published_at >= weeklyStart))).length;
  await assertCandidateCount(radar, weeklySourceGroups, Math.min(3, weeklySourceGroups));
  if (weeklySourceGroups > 3) {
    await radar.getByRole('button', { name: `후보 ${weeklySourceGroups}개 모두 보기`, exact: true }).click();
    await assertCandidateCount(radar, weeklySourceGroups, weeklySourceGroups);
    await radar.getByRole('button', { name: '후보 접기', exact: true }).click();
    await assertCandidateCount(radar, weeklySourceGroups, 3);
  }
  await screenshot(page, 'desktop-3d-command-center.png');
  report.checks.push('Desktop graph/export share one model; current catalog documents retain every extracted claim, candidate counts match rendered cards, and no fake account or unread badge is shown');

  for (const title of titles) {
    await navigate(page, title);
    await noHorizontalOverflow(page, `Desktop ${title}`);
  }
  report.checks.push('All desktop navigation screens render without horizontal overflow');

  await navigate(page, '3D Universe');
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await assertGraphParity(page, currentSnapshot, { flat: true });
  await page.locator('.filter-tabs').getByRole('button', { name: '조직 · 기업', exact: true }).click();
  const companySnapshot = await exportSnapshot(page, 'filtered-companies', currentDate);
  assertResearchSnapshot(companySnapshot, researchCatalog.records, currentDate);
  assert.equal(companySnapshot.view.filter, 'company');
  assert.ok(companySnapshot.graph.nodes.length > 0 && companySnapshot.graph.nodes.length < currentSnapshot.graph.nodes.length);
  assert.deepEqual(sorted(companySnapshot.graph.nodes.map(node => node.id)), sorted(currentSnapshot.graph.nodes.filter(node => ['organization', 'company'].includes(node.kind)).map(node => node.id)));
  await assertGraphParity(page, companySnapshot, { flat: true });
  await page.getByLabel('검색 주변 연결 포함', { exact: true }).uncheck();
  await page.getByLabel('엔티티 검색', { exact: true }).fill('SAMSUNG');
  const searchedSnapshot = await exportSnapshot(page, 'filtered-search', currentDate);
  assert.equal(searchedSnapshot.view.search, 'SAMSUNG');
  assert.equal(searchedSnapshot.view.exploration.searchContext, false);
  assert.ok(['sds', 'se'].every(id => searchedSnapshot.graph.nodes.some(node => node.id === id)), 'Samsung Electronics and Samsung SDS remain separate searchable nodes');
  assert.ok(searchedSnapshot.graph.nodes.every(node => [node.id, node.title, node.subtitle, node.description, ...(node.aliases ?? [])].join(' ').toLowerCase().includes('samsung')), 'Disabling search context must not leave unrelated neighbors');
  await assertGraphParity(page, searchedSnapshot, { flat: true });
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.locator('.universe-visual')).toHaveAttribute('data-renderer', '3d');
  await expect(page.locator('.graph-stage canvas')).toBeVisible();
  await assertGraphParity(page, searchedSnapshot);
  const searched3dSnapshot = await exportSnapshot(page, 'filtered-search-3d', currentDate);
  assert.deepEqual(searched3dSnapshot.graph, searchedSnapshot.graph, 'Renderer selection must not change the searched graph');
  await page.getByRole('button', { name: '필터 초기화', exact: true }).click();
  await page.getByRole('button', { name: '탐색 초기화', exact: true }).click();
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await assertGraphParity(page, currentSnapshot, { flat: true });
  await screenshot(page, 'desktop-expanded-universe-2d.png');
  report.checks.push('Organization filtering and entity search affect the actual 2D/3D graph and exported graph identically; reset restores every node and relation');

  const entityNodeIds = new Set(currentSnapshot.graph.nodes.filter(node => !isEvidenceNode(node)).map(node => node.id));
  await expect(page.getByLabel('그래프 라벨 표시', { exact: true })).toHaveValue('smart');
  const visibleEntityLabelIds = () => page.locator('.graph-stage svg[role="group"] .rx-node.label-visible').evaluateAll(elements => elements.map(element => element.getAttribute('data-node-id'))).then(ids => sorted(ids.filter(id => entityNodeIds.has(id))));
  const smartLabels = await visibleEntityLabelIds();
  assert.ok(smartLabels.length > 0 && smartLabels.length < entityNodeIds.size, 'Default label LOD should keep a dense graph readable without removing objects');
  await page.getByLabel('그래프 라벨 표시', { exact: true }).selectOption('entities');
  await expect.poll(visibleEntityLabelIds).toEqual(sorted(entityNodeIds));
  const fullLabels = await exportSnapshot(page, 'all-entity-labels', currentDate);
  assert.deepEqual(fullLabels.graph, currentSnapshot.graph, 'Displaying all entity labels must not change the graph projection or exported provenance');
  await assertGraphParity(page, fullLabels, { flat: true });
  await page.getByLabel('그래프 라벨 표시', { exact: true }).selectOption('smart');
  await expect.poll(visibleEntityLabelIds).toEqual(smartLabels);
  report.checks.push('Smart/all-entity label modes change visible labels while preserving every graph node, relation and exported provenance');

  for (const layer of ['entities', 'evidence']) {
    await page.getByLabel('그래프 레이어', { exact: true }).selectOption(layer);
    const layerSnapshot = await exportSnapshot(page, `layer-${layer}`, currentDate);
    assertResearchSnapshot(layerSnapshot, researchCatalog.records, currentDate);
    assert.equal(layerSnapshot.view.exploration.layer, layer);
    const eligible = currentSnapshot.graph.nodes.filter(node => layer === 'evidence' ? isEvidenceNode(node) : !isEvidenceNode(node));
    assert.ok(eligible.length > 0);
    assert.deepEqual(sorted(layerSnapshot.graph.nodes.map(node => node.id)), sorted(eligible.map(node => node.id)), 'Layer selection must expose exactly the chosen object kinds');
    const ids = new Set(eligible.map(node => node.id));
    assert.deepEqual(sorted(layerSnapshot.graph.relations.map(relation => relation.id)), sorted(currentSnapshot.graph.relations.filter(relation => ids.has(relation.from) && ids.has(relation.to)).map(relation => relation.id)));
    await assertGraphParity(page, layerSnapshot, { flat: true });
  }
  await page.getByLabel('그래프 레이어', { exact: true }).selectOption('all');
  await page.getByLabel('관계 유형', { exact: true }).selectOption('documented_by');
  const documented = await exportSnapshot(page, 'documented-by-only', currentDate);
  assertResearchSnapshot(documented, researchCatalog.records, currentDate);
  assert.ok(documented.graph.relations.length > 0);
  assert.deepEqual(sorted(documented.graph.relations.map(relation => relation.id)), sorted(currentSnapshot.graph.relations.filter(relation => relation.type === 'documented_by').map(relation => relation.id)));
  await assertGraphParity(page, documented, { flat: true });
  await page.getByLabel('관계 유형', { exact: true }).selectOption('all');
  await page.getByLabel('연결 분류', { exact: true }).selectOption('analyst_mapping');
  const inferred = await exportSnapshot(page, 'analyst-connections-only', currentDate);
  assertResearchSnapshot(inferred, researchCatalog.records, currentDate);
  assert.ok(inferred.graph.relations.length > 0 && inferred.graph.relations.every(relation => relation.inferred));
  assert.deepEqual(sorted(inferred.graph.relations.map(relation => relation.id)), sorted(currentSnapshot.graph.relations.filter(relation => relation.provenance === 'analyst_mapping').map(relation => relation.id)));
  await assertGraphParity(page, inferred, { flat: true });
  await page.getByRole('button', { name: '탐색 초기화', exact: true }).click();
  report.checks.push('Entity/evidence layers, documented-by relationships and analyst-only connections filter the canonical graph and exported provenance without creating dangling edges');

  await page.getByLabel('검색 주변 연결 포함', { exact: true }).uncheck();
  await page.getByLabel('엔티티 검색', { exact: true }).fill('source:sds-004');
  const exactSourceSearch = await exportSnapshot(page, 'source-search-exact', currentDate);
  assert.deepEqual(exactSourceSearch.graph.nodes.map(node => node.id), ['source:sds-004']);
  await assertGraphParity(page, exactSourceSearch, { flat: true });
  await page.getByLabel('검색 주변 연결 포함', { exact: true }).check();
  const contextSearch = await exportSnapshot(page, 'source-search-context', currentDate);
  assertResearchSnapshot(contextSearch, researchCatalog.records, currentDate);
  assertNeighborhood(contextSearch, currentSnapshot.graph, 'source:sds-004', 1);
  assert.ok(contextSearch.graph.nodes.length > exactSourceSearch.graph.nodes.length, 'Search context must restore actual connected evidence around a precise source match');
  await assertGraphParity(page, contextSearch, { flat: true });
  await page.getByRole('button', { name: '탐색 초기화', exact: true }).click();
  await page.getByLabel('중심 노드', { exact: true }).selectOption('sds');
  await page.getByLabel('탐색 깊이', { exact: true }).selectOption('1');
  const firstHop = await exportSnapshot(page, 'sds-one-hop', currentDate);
  assertNeighborhood(firstHop, currentSnapshot.graph, 'sds', 1);
  assert.equal(firstHop.view.exploration.focusNodeId, 'sds');
  assert.equal(firstHop.view.exploration.hops, 1);
  await assertGraphParity(page, firstHop, { flat: true });
  await page.getByLabel('탐색 깊이', { exact: true }).selectOption('2');
  const secondHop = await exportSnapshot(page, 'sds-two-hops', currentDate);
  assertNeighborhood(secondHop, currentSnapshot.graph, 'sds', 2);
  assert.equal(secondHop.view.exploration.hops, 2);
  assert.ok(secondHop.graph.nodes.length > firstHop.graph.nodes.length, 'Two-hop exploration must reveal additional linked objects, not merely relabel the same view');
  await assertGraphParity(page, secondHop, { flat: true });
  await screenshot(page, 'desktop-universe-two-hop.png');
  await page.getByRole('button', { name: '탐색 초기화', exact: true }).click();
  report.checks.push('Exact source search restores only one-hop context when enabled; one/two-hop focus follows real adjacency and preserves the visible/exported graph');

  const distances = graphDistances(currentSnapshot.graph, 'sds');
  const destination = currentSnapshot.graph.nodes.find(node => node.id === 'se' && distances.get(node.id) >= 2)
    ?? currentSnapshot.graph.nodes.find(node => !isEvidenceNode(node) && distances.get(node.id) >= 2);
  assert.ok(destination, 'The expanded graph must offer a multi-step connected entity path');
  await page.locator('.path-disclosure summary').click();
  await page.getByLabel('경로 시작', { exact: true }).selectOption('sds');
  await page.getByLabel('경로 도착', { exact: true }).selectOption(destination.id);
  await page.getByRole('button', { name: '경로 찾기', exact: true }).click();
  const pathSnapshot = await exportSnapshot(page, 'entity-shortest-path', currentDate);
  assertResearchSnapshot(pathSnapshot, researchCatalog.records, currentDate);
  assert.equal(pathSnapshot.view.exploration.pathFrom, 'sds');
  assert.equal(pathSnapshot.view.exploration.pathTo, destination.id);
  assert.equal(pathSnapshot.graph.nodes.length, distances.get(destination.id) + 1, 'Path view must contain a shortest connection, not the full graph');
  assert.equal(graphDistances(pathSnapshot.graph, 'sds').get(destination.id), distances.get(destination.id), 'Visible path must remain connected using real relations');
  await expect(page.locator('.path-controls')).toContainText('인과관계·실행 순서를 뜻하지 않습니다');
  await assertGraphParity(page, pathSnapshot, { flat: true });
  const pathSvg = page.locator('.graph-stage svg[role="group"]');
  const originalViewBox = await pathSvg.getAttribute('viewBox');
  await page.getByRole('button', { name: '그래프 확대', exact: true }).click();
  await expect(pathSvg).not.toHaveAttribute('viewBox', originalViewBox);
  await page.getByRole('button', { name: '그래프 축소', exact: true }).click();
  await page.getByRole('button', { name: '그래프 화면 맞춤', exact: true }).click();
  await expect(pathSvg).toHaveAttribute('viewBox', originalViewBox);
  await pathSvg.focus();
  await page.keyboard.press('ArrowRight');
  await expect(pathSvg).not.toHaveAttribute('viewBox', originalViewBox);
  await page.keyboard.press('0');
  await expect(pathSvg).toHaveAttribute('viewBox', originalViewBox);
  await assertGraphParity(page, pathSnapshot, { flat: true });
  await screenshot(page, 'desktop-universe-path.png');
  await page.locator(`.graph-stage svg[role="group"] [data-node-id="${destination.id}"]`).focus();
  await page.keyboard.press('Enter');
  await page.locator('.detail-drawer').getByRole('button', { name: '경로 시작으로 지정', exact: true }).click();
  await expect(page.getByLabel('경로 시작', { exact: true })).toHaveValue(destination.id);
  await expect(page.getByLabel('경로 도착', { exact: true })).toHaveValue(destination.id);
  await page.getByRole('button', { name: '경로 찾기', exact: true }).click();
  const synchronizedPath = await exportSnapshot(page, 'drawer-path-dropdown-sync', currentDate);
  assert.equal(synchronizedPath.view.exploration.pathFrom, destination.id, 'Find path must use the endpoint selected in the drawer, not an older dropdown draft');
  assert.equal(synchronizedPath.view.exploration.pathTo, destination.id);
  assert.deepEqual(synchronizedPath.graph.nodes.map(node => node.id), [destination.id]);
  assert.deepEqual(synchronizedPath.graph.relations, []);
  await assertGraphParity(page, synchronizedPath, { flat: true });
  await page.getByRole('button', { name: '탐색 초기화', exact: true }).click();
  await assertGraphParity(page, currentSnapshot, { flat: true });
  report.checks.push('Entity path search displays a shortest real connection with its causal-limit notice; zoom/fit change the camera without changing graph or export data');
  report.checks.push('Changing a path endpoint in the node drawer synchronizes the dropdown draft and survives a subsequent Find path action');

  await page.locator('.graph-stage svg[role="group"] [data-node-id="sds"]').focus();
  await page.keyboard.press('Enter');
  const drawer = page.locator('.detail-drawer');
  await expect(drawer.getByRole('heading', { level: 2 })).toContainText(/삼성SDS|SAMSUNG SDS/);
  await expect(drawer.locator('.research-countline')).toBeVisible();
  assert.ok(await drawer.locator('.research-source-link').count() > 0, 'Samsung SDS drawer must link actual sources');
  await drawer.getByRole('button', { name: 'Evidence Vault 열기', exact: true }).click();
  await expect(page.locator('main h1')).toContainText('Evidence Vault');
  report.checks.push('2D node opens the correct drawer, evidence status and Evidence Vault');

  await navigate(page, '3D Universe');
  // Each relation must open its own provenance, rather than a generic source drawer.
  const relation = currentSnapshot.graph.relations.find(item => item.id === 'sds-orchestrator');
  assert.ok(relation, 'The canonical graph needs an attributed relation');
  assert.deepEqual(relation.source_ids, ['sds-004']);
  const selectedLink = page.locator(`.graph-stage svg[role="group"] .rx-link[data-edge-id="${relation.id}"]`);
  await selectedLink.focus();
  await page.keyboard.press('Enter');
  await expect(drawer).toHaveAttribute('data-relation-id', relation.id);
  assert.deepEqual(sorted(await drawer.locator('.research-source-link[data-source-id]').evaluateAll(elements => [...new Set(elements.map(element => element.getAttribute('data-source-id')))])), sorted(relation.source_ids), 'Relation drawer must show exactly this relation’s sources');
  assert.deepEqual(sorted(await drawer.locator('[data-claim-id]').evaluateAll(elements => [...new Set(elements.map(element => element.getAttribute('data-claim-id')))])), sorted(relation.claim_ids), 'Relation drawer must show exactly this relation’s claims');
  for (const id of relation.source_ids) {
    await expect(drawer.locator(`.research-source-link[data-source-id="${id}"]`)).toHaveAttribute('href', researchCatalog.records.find(record => record.id === id).url);
  }
  await page.getByRole('button', { name: '상세 닫기', exact: true }).click();
  report.checks.push('2D graph matches 3D/export and keyboard relation selection shows exact source and claim provenance');

  for (const nodeId of ['source:media-001', 'claim:sds-012']) {
    const node = currentSnapshot.graph.nodes.find(item => item.id === nodeId);
    assert.ok(node, `Merged source provenance needs the ${nodeId} graph node`);
    await page.locator(`.graph-stage svg[role="group"] [data-node-id="${nodeId}"]`).focus();
    await page.keyboard.press('Enter');
    await expect(drawer).toBeVisible();
    assert.deepEqual(sorted(await drawer.locator('.research-source-link[data-source-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-source-id')))), sorted(node.source_ids), `${nodeId}: drawer must identify the canonical source, including merged claim origins`);
    assert.deepEqual(sorted(await drawer.locator('[data-claim-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-claim-id')))), sorted(node.claim_ids), `${nodeId}: drawer must expose exactly the selected source or claim's provenance`);
    for (const sourceId of node.source_ids) {
      await expect(drawer.locator(`.research-source-link[data-source-id="${sourceId}"]`)).toHaveAttribute('href', researchCatalog.records.find(record => record.id === sourceId).url);
    }
    if (nodeId.startsWith('claim:')) {
      const claim = claimRows(researchCatalog.records).find(item => item.id === nodeId);
      await expect(drawer.locator(`[data-claim-id="${nodeId}"]`)).toContainText(claim.text);
      await drawer.getByRole('button', { name: '주변 1단계 탐색', exact: true }).click();
      await expect(drawer).toHaveCount(0);
      await expect(page.getByLabel('중심 노드', { exact: true })).toHaveValue(nodeId);
      const claimNeighborhood = await exportSnapshot(page, 'claim-drawer-neighborhood', currentDate);
      assertNeighborhood(claimNeighborhood, currentSnapshot.graph, nodeId, 1);
      await assertGraphParity(page, claimNeighborhood, { flat: true });
      await page.getByRole('button', { name: '탐색 초기화', exact: true }).click();
    } else await page.getByRole('button', { name: '상세 닫기', exact: true }).click();
  }
  await page.locator('.graph-stage svg[role="group"] [data-node-id="sds"]').focus();
  await page.keyboard.press('Enter');
  await drawer.getByRole('button', { name: '경로 시작으로 지정', exact: true }).click();
  await expect(drawer).toHaveCount(0);
  const pathStartOnly = await exportSnapshot(page, 'drawer-path-start-only', currentDate);
  assert.equal(pathStartOnly.view.exploration.pathFrom, 'sds');
  assert.ok(!pathStartOnly.view.exploration.pathTo);
  assert.deepEqual(pathStartOnly.graph, currentSnapshot.graph, 'Choosing only a path start must leave destination nodes available for selection');
  await assertGraphParity(page, pathStartOnly, { flat: true });
  await page.locator(`.graph-stage svg[role="group"] [data-node-id="${destination.id}"]`).focus();
  await page.keyboard.press('Enter');
  await drawer.getByRole('button', { name: '경로 도착으로 지정', exact: true }).click();
  const drawerPath = await exportSnapshot(page, 'drawer-selected-path', currentDate);
  assert.equal(drawerPath.view.exploration.pathTo, destination.id);
  assert.equal(drawerPath.graph.nodes.length, distances.get(destination.id) + 1);
  assert.equal(graphDistances(drawerPath.graph, 'sds').get(destination.id), distances.get(destination.id));
  await assertGraphParity(page, drawerPath, { flat: true });
  await page.getByRole('button', { name: '탐색 초기화', exact: true }).click();
  report.checks.push('Drawer path actions keep the full graph available after the first endpoint, then show a connected shortest path after the destination is selected');
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.locator('.universe-visual')).toHaveAttribute('data-renderer', '3d');
  await expect(page.locator('.graph-stage canvas')).toBeVisible();
  await assertGraphParity(page, currentSnapshot);
  await page.getByRole('button', { name: /노드 목록/ }).click();
  const keyboardList = page.getByLabel('그래프 노드와 연결 목록', { exact: true });
  await expect(keyboardList).toBeVisible();
  await keyboardList.locator('[data-list-node-id="claim:sds-012"]').click();
  await expect(drawer.locator('[data-claim-id="claim:sds-012"]')).toBeVisible();
  await expect(drawer.locator('.research-source-link[data-source-id="media-001"]')).toBeVisible();
  await page.getByRole('button', { name: '상세 닫기', exact: true }).click();
  await page.getByRole('button', { name: /노드 목록/ }).click();
  await screenshot(page, 'desktop-expanded-universe-3d.png');
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await assertGraphParity(page, currentSnapshot, { flat: true });
  report.checks.push('Source and merged-claim graph nodes open exact claim text and canonical URLs; drawer neighborhood focus and the 3D keyboard list preserve the same evidence navigation');

  await navigate(page, 'Time Machine');
  await page.getByRole('button', { name: 'As-known-at', exact: true }).click();
  await page.getByLabel('정보 기준일', { exact: true }).fill('2026-09-01');
  const historical = await exportSnapshot(page, 'historical-known', '2026-09-01');
  assertResearchSnapshot(historical, researchAtDate('2026-09-01'), '2026-09-01');
  assertCompleteGraphInventory(historical, researchAtDate('2026-09-01'));
  assert.ok(historical.graph.nodes.length > 0 && historical.graph.relations.length > 0, 'Earlier public evidence must produce an explorable graph');
  assert.ok(!historical.graph.relations.some(relation => ['sds-orchestrator', 'miracom-rcs'].includes(relation.id)), 'Later-published or undated relations must not leak into September replay');
  await assertGraphParity(page, historical, { flat: true });
  await expect(page.getByLabel('사건 기준일 제한', { exact: true })).not.toBeChecked();
  await page.getByLabel('사건 기준일 제한', { exact: true }).check();
  await expect(page.getByLabel('사건 기준일', { exact: true })).toHaveValue(currentDate);
  await page.getByLabel('사건 기준일', { exact: true }).fill('2026-06-30');
  await expect(page.getByLabel('정보 기준일', { exact: true })).toHaveValue('2026-09-01');
  const boundedRows = researchAtDate('2026-09-01').filter(row => row.event_date !== null && row.event_date <= '2026-06-30');
  assert.ok(boundedRows.length > 0 && boundedRows.length < historical.research_records.length, 'The independent event limit must meaningfully narrow the known publication window');
  const boundedHistory = await exportSnapshot(page, 'historical-independent-axes', '2026-09-01');
  assertResearchSnapshot(boundedHistory, boundedRows, '2026-09-01', 'known', '2026-06-30');
  await assertGraphParity(page, boundedHistory, { flat: true });
  await page.getByLabel('사건 기준일 제한', { exact: true }).uncheck();
  await expect(page.getByLabel('사건 기준일', { exact: true })).toHaveCount(0);
  const restoredHistory = await exportSnapshot(page, 'historical-event-limit-off', '2026-09-01');
  assertResearchSnapshot(restoredHistory, researchAtDate('2026-09-01'), '2026-09-01');
  assert.deepEqual(restoredHistory.graph, historical.graph, 'Disabling the separate event axis must restore the original known-at graph');
  await assertGraphParity(page, restoredHistory, { flat: true });
  await page.getByRole('button', { name: 'Retrospective', exact: true }).click();
  const retrospective = await exportSnapshot(page, 'historical-retro', '2026-09-01');
  assertResearchSnapshot(retrospective, researchAtDate('2026-09-01', 'retro'), '2026-09-01', 'retro');
  await assertGraphParity(page, retrospective, { flat: true });
  await page.getByRole('button', { name: 'As-known-at', exact: true }).click();
  for (const title of titles) {
    await navigate(page, title);
    await expect(page.getByLabel('정보 기준일', { exact: true })).toHaveValue('2026-09-01');
    if (title === 'Evidence Vault') await expect(page.locator('.research-card')).toHaveCount(researchAtDate('2026-09-01').length);
  }
  report.checks.push('Known/retrospective graphs match exports; independent September 1 publication and June 30 event limits exclude unknown/later events, and disabling the event limit restores the graph');

  await page.getByLabel('정보 기준일', { exact: true }).fill('2026-03-09');
  await navigate(page, 'Evidence Vault');
  const futurePlan = page.locator('.research-card[data-source-id="mi-015"]');
  await expect(futurePlan).toBeVisible();
  await expect(futurePlan).toContainText('2026-03-11');
  await expect(futurePlan.locator('[data-scheduled-event-date="2026-03-11"]')).toContainText('발표 당시 예정일');
  const planSnapshot = await exportSnapshot(page, 'known-future-plan', '2026-03-09');
  assertResearchSnapshot(planSnapshot, researchAtDate('2026-03-09'), '2026-03-09');
  assert.ok(planSnapshot.research_records.some(row => row.id === 'mi-015'), 'A known March 11 plan must remain visible on its March 9 publication date');
  assert.equal(planSnapshot.research_records.find(row => row.id === 'mi-015').event_date, '2026-03-11');
  await page.getByLabel('정보 기준일', { exact: true }).fill('2025-11-10');
  const novemberPlan = page.locator('.research-card[data-source-id="mi-011"]');
  await expect(novemberPlan).toBeVisible();
  await expect(novemberPlan).toHaveAttribute('data-event-status', 'announced');
  await expect(novemberPlan.getByTestId('announced-event')).toHaveText('예고');
  await expect(novemberPlan.locator('[data-scheduled-event-date="2025-11-21"]')).toContainText('발표 당시 예정일');
  const novemberSnapshot = await exportSnapshot(page, 'known-november-announcement', '2025-11-10');
  assertResearchSnapshot(novemberSnapshot, researchAtDate('2025-11-10'), '2025-11-10');
  assert.equal(novemberSnapshot.research_records.find(row => row.id === 'mi-011').event_date, '2025-11-21');
  report.checks.push('Published future plans retain their event dates; mi-011 appears on 2025-11-10 with an explicit announcement badge for its November 21 plan');

  await page.getByLabel('정보 기준일', { exact: true }).fill(currentDate);
  await navigate(page, 'Command Center');
  await expect(page.locator('.graph-stage svg[role="group"]')).toBeVisible();
  await screenshot(page, 'desktop-command-center.png');

  await navigate(page, 'Evidence Vault');
  const currentRows = researchAtDate(currentDate);
  const undatedRows = researchCatalog.records.filter(row => row.scope === 'undated');
  const backgroundRows = researchCatalog.records.filter(row => row.scope === 'out_of_window');
  await expect(page.locator('.research-card')).toHaveCount(researchCatalog.records.length);
  for (const scope of ['in_window', 'undated', 'out_of_window']) {
    await expect(page.locator(`.research-card[data-source-scope="${scope}"]`)).toHaveCount(researchCatalog.records.filter(row => row.scope === scope).length);
  }
  await expect(page.locator('.research-catalog-summary')).toContainText(String(researchCatalog.records.length));
  await expect(page.getByTestId('source-group-count')).toHaveText(String(Object.keys(groupedSourceIds(researchCatalog.records)).length));
  const manualRows = researchCatalog.records.filter(row => row.verification === 'manual_report');
  const blockedRows = researchCatalog.records.filter(row => row.verification === 'access_blocked');
  await expect(page.locator('.research-card[data-verification="manual_report"][data-audit-status="unarchived"]')).toHaveCount(manualRows.length);
  await expect(page.locator('.research-card[data-verification="access_blocked"][data-audit-status="blocked"]')).toHaveCount(blockedRows.length);
  await expect(page.locator('.research-card[data-verification="primary_read"]')).toHaveCount(0);
  await expect(page.getByTestId('source-audit')).toHaveCount(researchCatalog.records.length);
  assert.ok((await page.getByTestId('source-audit').allTextContents()).every(text => text.includes('보관본 미확보')), 'Every unarchived source must explain the missing reproducible original');
  await page.getByLabel('검증 상태 필터', { exact: true }).selectOption('primary_read');
  await expect(page.locator('.research-card')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '조건에 맞는 공개자료가 없습니다', exact: true })).toBeVisible();
  await page.getByLabel('법인 필터', { exact: true }).selectOption('sds');
  await page.getByLabel('자료 유형 필터', { exact: true }).selectOption('official');
  await page.getByLabel('검증 상태 필터', { exact: true }).selectOption('manual_report');
  const filteredRows = [...currentRows, ...undatedRows, ...backgroundRows].filter(row => row.entity_ids.includes('sds') && row.source_type === 'official' && row.verification === 'manual_report');
  assert.ok(filteredRows.length > 0);
  await expect(page.locator('.research-card')).toHaveCount(filteredRows.length);
  await page.getByRole('button', { name: '초기화', exact: true }).click();
  await page.getByLabel('자료 검색', { exact: true }).fill('2031년까지 10조');
  await expect(page.locator('.research-card[data-source-id="media-003"]')).toBeVisible();
  await page.getByLabel('자료 검색', { exact: true }).fill('');
  const mergedSource = researchCatalog.records.find(record => record.id === 'media-001');
  assert.equal(mergedSource.claims.length, 2);
  assert.ok(mergedSource.entity_ids.includes('task') && mergedSource.entity_ids.includes('partner'), 'Merged entity tags must be preserved');
  const mergedCard = page.locator('.research-card[data-source-id="media-001"]');
  for (const claim of mergedSource.claims) await expect(mergedCard).toContainText(claim.text);
  await page.getByLabel('자료 검색', { exact: true }).fill('플릿 영역');
  await expect(mergedCard).toBeVisible();
  await page.getByLabel('자료 검색', { exact: true }).fill('');
  const tracedSource = page.locator('.research-card[data-source-id="sds-004"]');
  await tracedSource.getByRole('button', { name: '연결 관계 탐색', exact: true }).click();
  await expect(drawer.getByRole('heading', { level: 2 })).toHaveText(researchCatalog.records.find(record => record.id === 'sds-004').title);
  await expect(drawer.locator('.research-source-link[data-source-id="sds-004"]')).toHaveAttribute('href', researchCatalog.records.find(record => record.id === 'sds-004').url);
  await drawer.locator('.drawer-relations').getByRole('button').filter({ hasText: relation.label }).click();
  await expect(drawer).toHaveAttribute('data-relation-id', relation.id);
  assert.deepEqual(sorted(await drawer.locator('[data-claim-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-claim-id')))), sorted(relation.claim_ids));
  await page.getByRole('button', { name: '상세 닫기', exact: true }).click();
  await expect(page.locator('main h1')).toContainText('Evidence Vault');
  report.checks.push('An evidence card opens its source, then navigates to that source’s specific graph relation and claim provenance');
  const jsonResponse = await page.request.get(new URL('data/rx-research.json', previewUrl).href);
  assert.ok(jsonResponse.ok());
  const publicCatalog = await jsonResponse.json();
  assert.deepEqual(publicCatalog.meta, researchCatalog.meta, 'The published catalog must expose the same collection horizon and inventory metadata');
  assert.equal(publicCatalog.records.length, researchCatalog.records.length);
  assert.equal(claimRows(publicCatalog.records).length, catalogClaimCount);
  assert.deepEqual(publicCatalog.records, researchCatalog.records, 'Public download must preserve the current audited source metadata and lineage');
  const databaseResponse = await page.request.get(new URL('data/rx-research.sqlite', previewUrl).href);
  assert.ok(databaseResponse.ok());
  assert.equal((await databaseResponse.body()).subarray(0,16).toString(), 'SQLite format 3\0');
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('main h1')).toContainText('Evidence Vault');
  await expect(page.locator('.research-card')).toHaveCount(researchCatalog.records.length);
  assert.equal(new URL(page.url()).hash, '#evidence');
  await screenshot(page, 'desktop-evidence-vault.png', false);
  report.checks.push('All catalog documents and merged claims preserve scope, lineage and audit status; manual reports stay unarchived and public downloads match the catalog');

  await navigate(page, 'Source Survey');
  const surveyPanel = page.getByTestId('source-survey');
  await expect(surveyPanel).toBeVisible();
  assert.equal(new URL(page.url()).hash, '#survey');
  const surveyResponse = await page.request.get(new URL('data/rx-survey.json', previewUrl).href);
  assert.ok(surveyResponse.ok(), 'The public survey JSON must be downloadable');
  const publicSurvey = await surveyResponse.json();
  assert.deepEqual(publicSurvey, surveyCatalog, 'Public survey download must preserve collection, discovery and execution records');
  const linkedCandidates = publicSurvey.candidates.filter(row => row.source_ids?.length);
  const unlinkedCandidates = publicSurvey.candidates.filter(row => !row.source_ids?.length);
  const sourceIds = new Set(researchCatalog.records.map(record => record.id));
  for (const candidate of publicSurvey.candidates) {
    assert.ok(!Object.hasOwn(candidate, 'claim') && !Object.hasOwn(candidate, 'claims'), 'Discovered URLs are metadata, not extracted claims');
    for (const id of candidate.source_ids ?? []) assert.ok(sourceIds.has(id), `Discovery source link ${id} must resolve to a reviewed catalog record`);
  }
  for (const [testId, count] of [['survey-candidates', publicSurvey.candidates.length], ['survey-linked', linkedCandidates.length], ['survey-unreviewed', unlinkedCandidates.length]]) {
    await expect(surveyPanel.getByTestId(testId).locator('strong')).toHaveText(count.toLocaleString());
  }
  assert.equal(linkedCandidates.length + unlinkedCandidates.length, publicSurvey.candidates.length);
  await expect(surveyPanel).toContainText('전수조사 완료를 의미하지 않습니다');
  await expect(surveyPanel).toContainText('자동 갱신은 연결되어 있지 않습니다');
  await assertSurveyCandidatePage(surveyPanel, publicSurvey.candidates);
  if (publicSurvey.candidates.length > 40) {
    await surveyPanel.locator('.survey-pagination').getByRole('button', { name: '다음', exact: true }).click();
    await assertSurveyCandidatePage(surveyPanel, publicSurvey.candidates, 40);
    await surveyPanel.locator('.survey-pagination').getByRole('button', { name: '이전', exact: true }).click();
    await assertSurveyCandidatePage(surveyPanel, publicSurvey.candidates);
  }
  const failedStatuses = new Set(['blocked', 'error', 'robots_disallowed', 'access_blocked', 'failed', 'budget_exhausted']);
  for (const [status, records] of [
    ['linked', linkedCandidates], ['unreviewed', unlinkedCandidates],
    ['fetched', publicSurvey.candidates.filter(row => row.fetch_status === 'fetched')],
    ['blocked', publicSurvey.candidates.filter(row => failedStatuses.has(row.fetch_status))],
  ]) {
    await page.getByLabel('조사 상태', { exact: true }).selectOption(status);
    await assertSurveyCandidatePage(surveyPanel, records);
    if (!records.length) await expect(surveyPanel.getByText('해당 조건의 조사 기록이 없습니다.', { exact: true })).toBeVisible();
  }
  await page.getByLabel('조사 상태', { exact: true }).selectOption('all');
  const searchCandidate = linkedCandidates[0] ?? publicSurvey.candidates[0];
  assert.ok(searchCandidate, 'The expanded survey must contain actual discovered source URLs');
  await page.getByLabel('조사 대장 검색', { exact: true }).fill(searchCandidate.id);
  const searchMatches = publicSurvey.candidates.filter(row => JSON.stringify(row).toLocaleLowerCase().includes(searchCandidate.id.toLocaleLowerCase()));
  await assertSurveyCandidatePage(surveyPanel, searchMatches);
  const searchedCandidate = surveyPanel.locator(`[data-candidate-id="${searchCandidate.id}"]`);
  await expect(searchedCandidate.locator('h3 a')).toHaveAttribute('href', searchCandidate.url);
  if (searchCandidate.source_ids?.length) {
    const sourceId = searchCandidate.source_ids[0];
    await searchedCandidate.getByRole('button', { name: `${sourceId} 근거 보기`, exact: true }).click();
    await expect(drawer.locator(`.research-source-link[data-source-id="${sourceId}"]`)).toHaveAttribute('href', researchCatalog.records.find(record => record.id === sourceId).url);
    await page.getByRole('button', { name: '상세 닫기', exact: true }).click();
  }
  await page.getByLabel('조사 대장 검색', { exact: true }).fill('rx-qa-no-matching-discovery-8cd1cb');
  await assertSurveyCandidatePage(surveyPanel, []);
  await page.getByLabel('조사 대장 검색', { exact: true }).fill('');
  await assertSurveyCandidatePage(surveyPanel, publicSurvey.candidates);
  const pendingSurveyDownload = page.waitForEvent('download');
  await surveyPanel.getByRole('link', { name: '조사 대장 JSON', exact: true }).click();
  const surveyDownload = await pendingSurveyDownload;
  assert.equal(surveyDownload.suggestedFilename(), 'rx-survey.json');
  const surveyPath = path.join(output, 'rx-survey.json');
  await surveyDownload.saveAs(surveyPath);
  assert.deepEqual(JSON.parse(await readFile(surveyPath, 'utf8')), publicSurvey);
  const databasePath = path.join(output, 'rx-research.sqlite');
  await writeFile(databasePath, await databaseResponse.body());
  await assertSurveyDatabase(databasePath, publicSurvey);
  const afterSurvey = await exportSnapshot(page, 'after-survey-navigation', currentDate);
  assertResearchSnapshot(afterSurvey, researchCatalog.records, currentDate);
  assert.deepEqual(afterSurvey.research_claims, currentSnapshot.research_claims, 'Survey browsing must not promote or change source claims');
  await screenshot(page, 'desktop-source-survey.png', false);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('main h1')).toContainText('Source Survey');
  assert.equal(new URL(page.url()).hash, '#survey');
  report.survey_metrics = { candidates: publicSurvey.candidates.length, linked: linkedCandidates.length, unlinked: unlinkedCandidates.length, collections: publicSurvey.collections.length, runs: publicSurvey.runs.length };
  report.checks.push('Source Survey totals, search, status filters and 40-row pagination match its public JSON; linked source drawers preserve exact evidence and the survey route reloads');
  report.checks.push('Downloaded SQLite preserves Sources/Claims and all three survey tables; unreviewed discoveries remain metadata with automatic verification disabled and never alter the graph catalog');

  await navigate(page, 'Briefing Studio');
  const briefing = page.getByTestId('period-briefing');
  const periods = [
    { value: 'daily', label: '일간', start: currentDate },
    { value: 'weekly', label: '주간', start: weeklyStart },
    { value: 'monthly', label: '월간', start: monthlyStart },
  ];
  for (const period of periods) {
    await briefing.getByRole('group', { name: '브리핑 기간', exact: true }).getByRole('button', { name: period.label, exact: true }).click();
    const rows = researchAtDate(currentDate).filter(row => row.published_at >= period.start);
    await expect(briefing).toHaveAttribute('data-period', period.value);
    await expect(page.getByTestId('brief-window')).toContainText(period.start);
    await expect(page.getByTestId('brief-window')).toContainText(currentDate);
    await expect(page.getByTestId('brief-new-count')).toHaveText(`${rows.length}건`);
    if (rows.length > 4) await briefing.getByRole('button', { name: `신규 문서 ${rows.length}건 모두 보기`, exact: true }).click();
    assert.deepEqual(sorted(await briefing.locator('[data-brief-source]').evaluateAll(elements => elements.map(element => element.getAttribute('data-brief-source')))), sorted(rows.map(row => row.id)), `${period.value} sources must follow the actual publication window`);
    if (!rows.length) await expect(briefing.getByText('새 공개자료 0건', { exact: true })).toBeVisible();
    const pendingBrief = page.waitForEvent('download');
    await briefing.getByRole('button', { name: '기간 JSON', exact: true }).click();
    const briefDownload = await pendingBrief;
    assert.equal(briefDownload.suggestedFilename(), `rx-briefing-${period.value}-${currentDate}.json`);
    const briefPath = path.join(output, briefDownload.suggestedFilename());
    await briefDownload.saveAs(briefPath);
    const exportedBrief = JSON.parse(await readFile(briefPath, 'utf8'));
    assert.equal(exportedBrief.bounds.start, period.start);
    assert.equal(exportedBrief.bounds.end, currentDate);
    assert.deepEqual(sorted(exportedBrief.withinPeriod.map(row => row.id)), sorted(rows.map(row => row.id)));
    assert.deepEqual(sorted(exportedBrief.claims.map(row => row.id)), sorted(claimRows(rows).map(row => row.id)));
    assert.deepEqual(Object.fromEntries(exportedBrief.groups.map(group => [group.originKey, sorted(group.records.map(row => row.id))])), groupedSourceIds(rows), 'Briefing source groups must preserve the actual lineage members');
    const candidates = exportedBrief.candidates;
    assert.equal(candidates.length, exportedBrief.groups.length, 'Each lineage group contributes one review candidate, not one candidate per reprint');
    const candidatePanel = briefing.locator('.brief-candidates');
    await assertCandidateCount(candidatePanel, candidates.length, Math.min(4, candidates.length));
    assert.deepEqual(sorted(await candidatePanel.locator('[data-candidate-item]').evaluateAll(elements => elements.map(element => element.getAttribute('data-candidate-id')))), sorted(candidates.slice(0, 4).map(candidate => candidate.id)));
    if (candidates.length > 4) {
      await candidatePanel.getByRole('button', { name: `후보 ${candidates.length}개 모두 보기`, exact: true }).click();
      await assertCandidateCount(candidatePanel, candidates.length, candidates.length);
      assert.deepEqual(sorted(await candidatePanel.locator('[data-candidate-item]').evaluateAll(elements => elements.map(element => element.getAttribute('data-candidate-id')))), sorted(candidates.map(candidate => candidate.id)));
      await candidatePanel.getByRole('button', { name: '후보 접기', exact: true }).click();
      await assertCandidateCount(candidatePanel, candidates.length, 4);
    }
    if (period.value === 'weekly') {
      const candidate = candidates[0];
      assert.ok(candidate, 'The reviewed weekly window must contain an explorable candidate');
      assert.equal(candidate.status, 'review_candidate');
      assert.equal(candidate.highImpactVerified, false);
      assert.equal(candidate.counterevidenceStatus, 'source_limitations_only');
      await candidatePanel.locator(`[data-candidate-id="${candidate.id}"]`).getByRole('button', { name: `검토 후보 상세: ${candidate.title}`, exact: true }).click();
      await expect(drawer).toHaveAttribute('data-selection-kind', 'signal');
      await expect(drawer).toHaveAttribute('data-signal-id', candidate.id);
      await expect(drawer.getByRole('heading', { level: 2 })).toHaveText(candidate.title);
      await expect(drawer).toContainText('성립 미확인');
      await expect(drawer.locator('.relation-proof')).toHaveCount(0);
      assert.deepEqual(await drawer.locator('[data-claim-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-claim-id'))), [candidate.claim.id]);
      await expect(drawer.locator('[data-claim-id]')).toContainText(candidate.claim.text);
      assert.deepEqual(sorted(await drawer.locator('.research-source-link').evaluateAll(elements => elements.map(element => element.getAttribute('data-source-id')))), sorted(candidate.relatedSources.map(source => source.id)));
      for (const source of candidate.relatedSources) await expect(drawer.locator(`.research-source-link[data-source-id="${source.id}"]`)).toHaveAttribute('href', source.url);
      await expect(drawer.locator('.signal-detail')).toContainText(candidate.nextCheck);
      const limitationLinks = drawer.locator('.signal-detail [data-counterevidence-source-id]');
      await expect(limitationLinks).toHaveCount(candidate.counterevidence.length);
      for (const [index, limitation] of candidate.counterevidence.entries()) {
        await expect(limitationLinks.nth(index)).toHaveAttribute('data-counterevidence-source-id', limitation.sourceId);
        await expect(limitationLinks.nth(index)).toHaveAttribute('href', limitation.url);
        await expect(limitationLinks.nth(index)).toContainText(limitation.text);
      }
      await screenshot(page, 'desktop-signal-review.png', false);
      await page.getByRole('button', { name: '상세 닫기', exact: true }).click();
      await expect(page.locator('main h1')).toContainText('Briefing Studio');
    }
    assert.equal(exportedBrief.collection_status, 'manual_research_snapshot');
    assert.equal(exportedBrief.correction_detection, 'not_tracked');
  }
  await screenshot(page, 'desktop-monthly-briefing.png', false);
  report.checks.push('Real daily/weekly/monthly windows include zero-news days; lineage groups and candidate totals match exports, and signal detail preserves its exact claim, sources and limitations');

  await navigate(page, 'Hypothesis War Room');
  const workbench = page.getByTestId('hypothesis-workbench');
  await expect(workbench).toBeVisible();
  await expect(workbench.locator('.aw-role-challenge').first()).toBeVisible();
  const reviewCard = workbench.locator('[data-review-evidence]').first();
  const reviewEvidenceId = await reviewCard.getAttribute('data-review-evidence');
  assert.ok(reviewEvidenceId);
  const originalStatement = await reviewCard.locator('.aw-claim').innerText();
  await reviewCard.locator('.aw-review-editor > summary').click();
  await reviewCard.getByRole('button', { name: '개인 검토 저장', exact: true }).click();
  await expect(reviewCard.getByRole('alert')).toHaveText('판단의 근거와 한계를 사유에 입력해 주세요.');
  await expect(reviewCard.getByTestId('review-current')).toHaveCount(0);
  await reviewCard.getByLabel('개인 판단', { exact: true }).selectOption('support');
  await reviewCard.getByLabel('검토 사유', { exact: true }).fill('브라우저 검증: 공식 발표는 방향을 지지하지만 공통 배포 완료를 입증하지 않는다.');
  await reviewCard.getByRole('button', { name: '개인 검토 저장', exact: true }).click();
  await expect(reviewCard.getByTestId('review-current')).toContainText('내 판단: 지지');
  await reviewCard.getByLabel('개인 판단', { exact: true }).selectOption('challenge');
  const revisedReason = '브라우저 검증: 유료 상시 운영과 독립 반증 자료가 부족하므로 추가 확인이 필요하다.';
  await reviewCard.getByLabel('검토 사유', { exact: true }).fill(revisedReason);
  await reviewCard.getByRole('button', { name: '개인 검토 저장', exact: true }).click();
  await expect(reviewCard.getByTestId('review-current')).toContainText(revisedReason);
  await expect(reviewCard.locator('.aw-claim')).toHaveText(originalStatement);
  await workbench.locator('.aw-audit > summary').click();
  await expect(workbench.locator('[data-review-event]')).toHaveCount(2);
  const storedReview = await page.evaluate(() => JSON.parse(localStorage.getItem('rx-personal-reviews-v1')));
  assert.equal(storedReview.scope, 'browser_personal_review');
  assert.equal(storedReview.events.length, 2);
  assert.equal(storedReview.events[1].previous_verdict, 'support');
  assert.equal(storedReview.events[1].verdict, 'challenge');
  assert.ok(storedReview.events.every(event => event.fact_promotion === false && event.actor === 'local_browser_user' && event.as_of === currentDate && event.mode === 'known'));
  const pendingReviews = page.waitForEvent('download');
  await workbench.getByRole('button', { name: '개인 검토 JSON', exact: true }).click();
  const reviewDownload = await pendingReviews;
  const reviewPath = path.join(output, reviewDownload.suggestedFilename());
  await reviewDownload.saveAs(reviewPath);
  assert.deepEqual(JSON.parse(await readFile(reviewPath, 'utf8')).events, storedReview.events);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator(`article[data-review-evidence="${reviewEvidenceId}"]`).getByTestId('review-current')).toContainText(revisedReason);
  await page.getByLabel('정보 기준일', { exact: true }).fill(shiftDay(currentDate, -1));
  await expect(page.getByTestId('review-current')).toHaveCount(0);
  await page.getByLabel('정보 기준일', { exact: true }).fill(currentDate);
  await expect(page.getByTestId('review-current')).toHaveCount(1);
  await navigate(page, 'Time Machine');
  await page.getByRole('button', { name: 'Retrospective', exact: true }).click();
  await navigate(page, 'Hypothesis War Room');
  await expect(page.getByTestId('review-current')).toHaveCount(0);
  await navigate(page, 'Time Machine');
  await page.getByRole('button', { name: 'As-known-at', exact: true }).click();
  await navigate(page, 'Hypothesis War Room');
  await expect(page.getByTestId('review-current')).toHaveCount(1);
  const afterReview = await exportSnapshot(page, 'after-personal-review', currentDate);
  assert.deepEqual(afterReview.research_claims, currentSnapshot.research_claims, 'Personal assessment must not mutate source claims');
  await screenshot(page, 'desktop-hypothesis-review.png', false);
  report.checks.push('War Room exposes challenges, requires reasons, appends personal review history, persists on reload and isolates date/mode without promoting facts');

  await navigate(page, 'Action Items');
  const actionPlan = JSON.parse(await readFile(new URL('../docs/action-items.json', import.meta.url), 'utf8'));
  const reviewLedger = JSON.parse(await readFile(new URL('../docs/review-response.json', import.meta.url), 'utf8'));
  assert.equal(reviewLedger.items.length, 15, 'The response ledger must preserve all 15 reviewed issues');
  await expect(page.locator('[data-review-id]')).toHaveCount(reviewLedger.items.length);
  for (const item of reviewLedger.items) {
    const entry = page.locator(`[data-review-id="${item.id}"]`);
    await expect(entry.locator('summary')).toContainText(`${item.id} · ${item.severity}`);
    await expect(entry.locator('summary b')).toHaveText(item.title);
    await expect(entry.locator('p')).toHaveText(item.response);
    const status = item.status === 'mitigated_pending_archives' ? '등급 조정 · 보관본 미확보' : item.status === 'clarified' ? '전제 정정' : '반영';
    await expect(entry.locator('summary em')).toHaveText(status);
  }
  const pendingArchiveReview = reviewLedger.items.find(item => item.status === 'mitigated_pending_archives');
  assert.ok(pendingArchiveReview, 'Unresolved original archives must remain visible in the review ledger');
  const pendingArchiveEntry = page.locator(`[data-review-id="${pendingArchiveReview.id}"]`);
  await pendingArchiveEntry.locator('summary').click();
  await expect(pendingArchiveEntry.locator('p')).toBeVisible();
  await pendingArchiveEntry.locator('summary').click();
  await expect(page.locator('[data-action-id]')).toHaveCount(actionPlan.items.length);
  for (const item of actionPlan.items) {
    const card = page.locator(`[data-action-id="${item.id}"]`);
    await expect(card).toContainText(item.title);
    for (const criterion of item.acceptance) await expect(card).toContainText(criterion);
  }
  await screenshot(page, 'desktop-action-items.png', false);
  const pendingActions = page.waitForEvent('download');
  await page.getByRole('button', { name: '실행 항목 JSON', exact: true }).click();
  const actionDownload = await pendingActions;
  const actionPath = path.join(output, actionDownload.suggestedFilename());
  await actionDownload.saveAs(actionPath);
  assert.deepEqual(JSON.parse(await readFile(actionPath, 'utf8')), actionPlan);
  report.checks.push('Action Items preserves all 15 review responses and their unresolved archive status, task acceptance criteria and matching JSON artifact');

  const fallbackContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await fallbackContext.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (['webgl', 'webgl2', 'experimental-webgl'].includes(type)) return null;
      return getContext.call(this, type, ...args);
    };
  });
  const fallback = currentPage = await fallbackContext.newPage();
  fallback.setDefaultTimeout(15_000);
  monitor(fallback, 'webgl-unavailable');
  await fallback.goto(previewUrl, { waitUntil: 'networkidle' });
  await expect(fallback.locator('.universe-visual')).toHaveAttribute('data-renderer', '2d');
  await expect(fallback.locator('.graph-stage canvas')).toHaveCount(0);
  await assertGraphParity(fallback, currentSnapshot, { flat: true });
  await fallback.locator(`.graph-stage svg[role="group"] .rx-link[data-edge-id="${relation.id}"]`).focus();
  await fallback.keyboard.press('Enter');
  await expect(fallback.locator('.detail-drawer')).toHaveAttribute('data-relation-id', relation.id);
  await expect(fallback.locator('.detail-drawer .research-source-link[data-source-id="sds-004"]')).toBeVisible();
  await fallback.getByRole('button', { name: '상세 닫기', exact: true }).click();
  await fallback.locator('.graph-stage svg[role="group"] [data-node-id="claim:sds-012"]').focus();
  await fallback.keyboard.press('Enter');
  await expect(fallback.locator('.detail-drawer [data-claim-id="claim:sds-012"]')).toBeVisible();
  await expect(fallback.locator('.detail-drawer .research-source-link[data-source-id="media-001"]')).toBeVisible();
  await screenshot(fallback, 'desktop-webgl-unavailable-2d.png', false);
  report.checks.push('Disabling all WebGL contexts on desktop automatically preserves the expanded 2D graph, exact relation evidence and merged-claim source navigation');

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const mobile = currentPage = await mobileContext.newPage();
  mobile.setDefaultTimeout(15_000);
  monitor(mobile, 'mobile');
  await mobile.goto(previewUrl, { waitUntil: 'networkidle' });
  await expect(mobile.locator('.graph-stage svg[role="group"]')).toBeVisible();
  await expect(mobile.getByRole('button', { name: '2D', exact: true })).toHaveClass(/selected/);
  for (const title of titles) {
    await navigate(mobile, title, true);
    await noHorizontalOverflow(mobile, `Mobile ${title}`);
  }
  await navigate(mobile, '3D Universe', true);
  await mobile.getByLabel('그래프 레이어', { exact: true }).selectOption('evidence');
  const mobileEvidence = await exportSnapshot(mobile, 'mobile-evidence-layer', currentDate);
  assertResearchSnapshot(mobileEvidence, researchCatalog.records, currentDate);
  assert.deepEqual(sorted(mobileEvidence.graph.nodes.map(node => node.id)), sorted(currentSnapshot.graph.nodes.filter(isEvidenceNode).map(node => node.id)));
  await assertGraphParity(mobile, mobileEvidence, { flat: true });
  await noHorizontalOverflow(mobile, 'Mobile evidence-layer controls');
  await screenshot(mobile, 'mobile-universe-evidence-layer.png');
  await mobile.getByRole('button', { name: /노드 목록/ }).click();
  await mobile.getByLabel('그래프 노드와 연결 목록', { exact: true }).locator('[data-list-node-id="source:media-001"]').click();
  await expect(mobile.locator('.detail-drawer .research-source-link[data-source-id="media-001"]')).toBeVisible();
  assert.deepEqual(sorted(await mobile.locator('.detail-drawer [data-claim-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-claim-id')))), sorted(claimRows([researchCatalog.records.find(record => record.id === 'media-001')]).map(claim => claim.id)));
  await mobile.getByRole('button', { name: '상세 닫기', exact: true }).click();
  await mobile.getByRole('button', { name: /노드 목록/ }).click();
  await mobile.getByRole('button', { name: '탐색 초기화', exact: true }).click();
  await mobile.getByLabel('중심 노드', { exact: true }).selectOption('sds');
  await mobile.getByLabel('탐색 깊이', { exact: true }).selectOption('2');
  const mobileNeighbors = await exportSnapshot(mobile, 'mobile-sds-two-hops', currentDate);
  assertNeighborhood(mobileNeighbors, currentSnapshot.graph, 'sds', 2);
  await assertGraphParity(mobile, mobileNeighbors, { flat: true });
  await noHorizontalOverflow(mobile, 'Mobile two-hop exploration');
  await screenshot(mobile, 'mobile-universe-two-hop.png');
  await mobile.getByRole('button', { name: '탐색 초기화', exact: true }).click();
  report.checks.push('Mobile can switch evidence layers, open a merged source with both claims, and explore two-hop neighborhoods with the same exported graph and no overflow');
  await navigate(mobile, 'Source Survey', true);
  const mobileSurvey = mobile.getByTestId('source-survey');
  await assertSurveyCandidatePage(mobileSurvey, publicSurvey.candidates);
  await mobile.getByLabel('조사 상태', { exact: true }).selectOption('unreviewed');
  await assertSurveyCandidatePage(mobileSurvey, unlinkedCandidates);
  await noHorizontalOverflow(mobile, 'Mobile Source Survey unlinked discoveries');
  await screenshot(mobile, 'mobile-source-survey.png', false);
  report.checks.push('Mobile Source Survey preserves discovery pagination and unlinked status filtering without horizontal overflow');
  await navigate(mobile, 'Evidence Vault', true);
  await screenshot(mobile, 'mobile-evidence-vault.png', false);
  await navigate(mobile, 'Command Center', true);
  await assertGraphParity(mobile, currentSnapshot, { flat: true });
  await screenshot(mobile, 'mobile-command-center.png');
  report.checks.push('Mobile defaults to equivalent 2D, all navigation works, menu closes and no screen has horizontal overflow');

  // Aborted requests caused by normal navigation/unmount are not application failures.
  const failedRequests = report.failed_requests.filter(item => !item.error?.includes('ERR_ABORTED'));
  await Promise.allSettled([...pendingDiagnostics]);
  assert.deepEqual(report.page_errors, [], 'Uncaught browser errors');
  assert.deepEqual(report.console_errors, [], 'Browser console errors');
  assert.deepEqual(failedRequests, [], 'Failed browser requests');
  report.checks.push('No uncaught exceptions, console errors or failed non-aborted requests');
  report.status = 'passed';
  console.log(`Browser smoke checks passed (${report.checks.length}). Artifacts: ${output}`);
} catch (error) {
  report.status = 'failed';
  report.failure = error instanceof Error ? error.stack : String(error);
  if (currentPage && !currentPage.isClosed()) await screenshot(currentPage, 'failure.png').catch(() => {});
  console.error(report.failure);
  process.exitCode = 1;
} finally {
  await Promise.allSettled([...pendingDiagnostics]);
  report.finished_at = new Date().toISOString();
  await writeFile(path.join(output, 'browser-report.json'), JSON.stringify(report, null, 2));
  if (serverLog) await writeFile(path.join(output, 'preview-server.log'), serverLog);
  await browser?.close();
  if (server?.pid && server.exitCode === null) {
    try { process.kill(process.platform === 'win32' ? server.pid : -server.pid, 'SIGTERM'); } catch { server.kill('SIGTERM'); }
  }
}
