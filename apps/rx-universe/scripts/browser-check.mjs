import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';
const expect = playwrightExpect.configure({ timeout: 15_000 });

// Run after the production build. Set PREVIEW_URL to reuse an existing server.
const previewUrl = process.env.PREVIEW_URL || 'http://127.0.0.1:4173/rx-universe/';
const output = path.resolve(process.env.BROWSER_ARTIFACT_DIR || 'test-results');
const researchCatalog = JSON.parse(await readFile(new URL('../src/research-data.json', import.meta.url), 'utf8'));
const researchAtDate = (date, mode = 'known') => researchCatalog.records.filter(row => row.scope === 'in_window'
  && row.published_at && ['page', 'search_index'].includes(row.date_basis)
  && row.published_at >= researchCatalog.meta.window_start
  && row.published_at <= (mode === 'known' ? date : researchCatalog.meta.window_end)
  && (mode === 'known' || (row.event_date ?? row.published_at) <= date));
const claimRows = records => records.flatMap(record => record.claims?.length ? record.claims : [{ ...record.claim, id: `claim:${record.id}` }]);
const sorted = ids => [...ids].sort();
const originKey = record => record.origin_key.trim() || record.url;
function groupedSourceIds(records) {
  const groups = new Map();
  for (const record of records) groups.set(originKey(record), [...(groups.get(originKey(record)) ?? []), record.id]);
  return Object.fromEntries([...groups].sort(([a], [b]) => a.localeCompare(b)).map(([key, ids]) => [key, sorted(ids)]));
}
const titles = ['Command Center', '3D Universe', 'Time Machine', 'Evidence Vault', 'Hypothesis War Room', 'Factory Twin', 'Briefing Studio', 'Action Items'];
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
  const sourceIds = new Set(records.map(row => row.id));
  const claimIds = new Set(snapshot.research_claims.map(row => row.id));
  for (const relation of snapshot.graph.relations) {
    assert.ok(nodeIds.has(relation.from) && nodeIds.has(relation.to), `Dangling relation ${relation.id}`);
    for (const id of relation.source_ids) assert.ok(sourceIds.has(id), `Relation ${relation.id} leaked source ${id}`);
    for (const id of relation.claim_ids) assert.ok(claimIds.has(id), `Relation ${relation.id} leaked claim ${id}`);
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
  const currentSnapshot = await exportSnapshot(page, 'current', '2026-10-30');
  assert.equal(researchCatalog.records.length, 81, 'Reviewed inventory must preserve all 81 sources');
  assert.equal(claimRows(researchCatalog.records).length, 84, 'Merged source inventory must retain all 84 claims');
  assertResearchSnapshot(currentSnapshot, researchCatalog.records, '2026-10-30');
  await assertGraphParity(page, currentSnapshot);
  await expect(page.locator('.profile, .top-avatar, .notification i')).toHaveCount(0);
  const radar = page.locator('.signal-panel .brief-candidates');
  const weeklySourceGroups = Object.keys(groupedSourceIds(researchAtDate('2026-10-30').filter(row => row.published_at >= '2026-10-24'))).length;
  await assertCandidateCount(radar, weeklySourceGroups, Math.min(3, weeklySourceGroups));
  if (weeklySourceGroups > 3) {
    await radar.getByRole('button', { name: `후보 ${weeklySourceGroups}개 모두 보기`, exact: true }).click();
    await assertCandidateCount(radar, weeklySourceGroups, weeklySourceGroups);
    await radar.getByRole('button', { name: '후보 접기', exact: true }).click();
    await assertCandidateCount(radar, weeklySourceGroups, 3);
  }
  await screenshot(page, 'desktop-3d-command-center.png');
  report.checks.push('Desktop graph/export share one model; 81 documents retain 84 claims, candidate counts match rendered cards, and no fake account or unread badge is shown');

  for (const title of titles) {
    await navigate(page, title);
    await noHorizontalOverflow(page, `Desktop ${title}`);
  }
  report.checks.push('All eight desktop navigation screens render without horizontal overflow');

  await navigate(page, '3D Universe');
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await assertGraphParity(page, currentSnapshot, { flat: true });
  await page.locator('.filter-tabs').getByRole('button', { name: '조직 · 기업', exact: true }).click();
  const companySnapshot = await exportSnapshot(page, 'filtered-companies', '2026-10-30');
  assertResearchSnapshot(companySnapshot, researchCatalog.records, '2026-10-30');
  assert.equal(companySnapshot.view.filter, 'company');
  assert.ok(companySnapshot.graph.nodes.length > 0 && companySnapshot.graph.nodes.length < currentSnapshot.graph.nodes.length);
  assert.deepEqual(sorted(companySnapshot.graph.nodes.map(node => node.id)), sorted(currentSnapshot.graph.nodes.filter(node => node.kind === 'organization').map(node => node.id)));
  await assertGraphParity(page, companySnapshot, { flat: true });
  await page.getByLabel('엔티티 검색', { exact: true }).fill('SAMSUNG');
  const searchedSnapshot = await exportSnapshot(page, 'filtered-search', '2026-10-30');
  assert.equal(searchedSnapshot.view.search, 'SAMSUNG');
  assert.deepEqual(sorted(searchedSnapshot.graph.nodes.map(node => node.id)), ['sds', 'se']);
  await assertGraphParity(page, searchedSnapshot, { flat: true });
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.locator('.universe-visual')).toHaveAttribute('data-renderer', '3d');
  await expect(page.locator('.graph-stage canvas')).toBeVisible();
  await assertGraphParity(page, searchedSnapshot);
  const searched3dSnapshot = await exportSnapshot(page, 'filtered-search-3d', '2026-10-30');
  assert.deepEqual(searched3dSnapshot.graph, searchedSnapshot.graph, 'Renderer selection must not change the searched graph');
  await page.getByRole('button', { name: '필터 초기화', exact: true }).click();
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await assertGraphParity(page, currentSnapshot, { flat: true });
  report.checks.push('Organization filtering and entity search affect the actual 2D/3D graph and exported graph identically; reset restores every node and relation');
  await page.locator('.graph-stage svg[role="group"] [data-node-id="sds"]').click();
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

  await navigate(page, 'Time Machine');
  await page.getByRole('button', { name: 'As-known-at', exact: true }).click();
  await page.getByLabel('정보 기준일', { exact: true }).fill('2026-09-01');
  const historical = await exportSnapshot(page, 'historical-known', '2026-09-01');
  assertResearchSnapshot(historical, researchAtDate('2026-09-01'), '2026-09-01');
  assert.ok(historical.graph.nodes.length > 0 && historical.graph.relations.length > 0, 'Earlier public evidence must produce an explorable graph');
  assert.ok(!historical.graph.relations.some(relation => ['sds-orchestrator', 'miracom-rcs'].includes(relation.id)), 'Later-published or undated relations must not leak into September replay');
  await assertGraphParity(page, historical, { flat: true });
  await expect(page.getByLabel('사건 기준일 제한', { exact: true })).not.toBeChecked();
  await page.getByLabel('사건 기준일 제한', { exact: true }).check();
  await expect(page.getByLabel('사건 기준일', { exact: true })).toHaveValue('2026-10-30');
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

  await page.getByLabel('정보 기준일', { exact: true }).fill('2026-10-30');
  await navigate(page, 'Command Center');
  await expect(page.locator('.graph-stage svg[role="group"]')).toBeVisible();
  await screenshot(page, 'desktop-command-center.png');

  await navigate(page, 'Evidence Vault');
  const currentRows = researchAtDate('2026-10-30');
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
  assert.equal(publicCatalog.records.length, researchCatalog.records.length);
  assert.equal(claimRows(publicCatalog.records).length, 84);
  assert.deepEqual(publicCatalog.records, researchCatalog.records, 'Public download must preserve the current audited source metadata and lineage');
  const databaseResponse = await page.request.get(new URL('data/rx-research.sqlite', previewUrl).href);
  assert.ok(databaseResponse.ok());
  assert.equal((await databaseResponse.body()).subarray(0,16).toString(), 'SQLite format 3\0');
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('main h1')).toContainText('Evidence Vault');
  await expect(page.locator('.research-card')).toHaveCount(researchCatalog.records.length);
  assert.equal(new URL(page.url()).hash, '#evidence');
  await screenshot(page, 'desktop-evidence-vault.png', false);
  report.checks.push('All 81 documents and 84 merged claims preserve scope, lineage and audit status; manual reports stay unarchived and public downloads match the catalog');

  await navigate(page, 'Briefing Studio');
  const briefing = page.getByTestId('period-briefing');
  const periods = [
    { value: 'daily', label: '일간', start: '2026-10-30' },
    { value: 'weekly', label: '주간', start: '2026-10-24' },
    { value: 'monthly', label: '월간', start: '2026-10-01' },
  ];
  for (const period of periods) {
    await briefing.getByRole('group', { name: '브리핑 기간', exact: true }).getByRole('button', { name: period.label, exact: true }).click();
    const rows = researchAtDate('2026-10-30').filter(row => row.published_at >= period.start);
    await expect(briefing).toHaveAttribute('data-period', period.value);
    await expect(page.getByTestId('brief-window')).toContainText(period.start);
    await expect(page.getByTestId('brief-window')).toContainText('2026-10-30');
    await expect(page.getByTestId('brief-new-count')).toHaveText(`${rows.length}건`);
    if (rows.length > 4) await briefing.getByRole('button', { name: `신규 문서 ${rows.length}건 모두 보기`, exact: true }).click();
    assert.deepEqual(sorted(await briefing.locator('[data-brief-source]').evaluateAll(elements => elements.map(element => element.getAttribute('data-brief-source')))), sorted(rows.map(row => row.id)), `${period.value} sources must follow the actual publication window`);
    if (!rows.length) await expect(briefing.getByText('새 공개자료 0건', { exact: true })).toBeVisible();
    const pendingBrief = page.waitForEvent('download');
    await briefing.getByRole('button', { name: '기간 JSON', exact: true }).click();
    const briefDownload = await pendingBrief;
    assert.equal(briefDownload.suggestedFilename(), `rx-briefing-${period.value}-2026-10-30.json`);
    const briefPath = path.join(output, briefDownload.suggestedFilename());
    await briefDownload.saveAs(briefPath);
    const exportedBrief = JSON.parse(await readFile(briefPath, 'utf8'));
    assert.equal(exportedBrief.bounds.start, period.start);
    assert.equal(exportedBrief.bounds.end, '2026-10-30');
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
  assert.ok(storedReview.events.every(event => event.fact_promotion === false && event.actor === 'local_browser_user' && event.as_of === '2026-10-30' && event.mode === 'known'));
  const pendingReviews = page.waitForEvent('download');
  await workbench.getByRole('button', { name: '개인 검토 JSON', exact: true }).click();
  const reviewDownload = await pendingReviews;
  const reviewPath = path.join(output, reviewDownload.suggestedFilename());
  await reviewDownload.saveAs(reviewPath);
  assert.deepEqual(JSON.parse(await readFile(reviewPath, 'utf8')).events, storedReview.events);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator(`article[data-review-evidence="${reviewEvidenceId}"]`).getByTestId('review-current')).toContainText(revisedReason);
  await page.getByLabel('정보 기준일', { exact: true }).fill('2026-10-29');
  await expect(page.getByTestId('review-current')).toHaveCount(0);
  await page.getByLabel('정보 기준일', { exact: true }).fill('2026-10-30');
  await expect(page.getByTestId('review-current')).toHaveCount(1);
  await navigate(page, 'Time Machine');
  await page.getByRole('button', { name: 'Retrospective', exact: true }).click();
  await navigate(page, 'Hypothesis War Room');
  await expect(page.getByTestId('review-current')).toHaveCount(0);
  await navigate(page, 'Time Machine');
  await page.getByRole('button', { name: 'As-known-at', exact: true }).click();
  await navigate(page, 'Hypothesis War Room');
  await expect(page.getByTestId('review-current')).toHaveCount(1);
  const afterReview = await exportSnapshot(page, 'after-personal-review', '2026-10-30');
  assert.deepEqual(afterReview.research_claims, currentSnapshot.research_claims, 'Personal assessment must not mutate source claims');
  await screenshot(page, 'desktop-hypothesis-review.png', false);
  report.checks.push('War Room exposes challenges, requires reasons, appends personal review history, persists on reload and isolates date/mode without promoting facts');

  await navigate(page, 'Action Items');
  const actionPlan = JSON.parse(await readFile(new URL('../docs/action-items.json', import.meta.url), 'utf8'));
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
  report.checks.push('Action Items displays the reviewable tasks, acceptance criteria and matching JSON artifact');

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
  await screenshot(fallback, 'desktop-webgl-unavailable-2d.png', false);
  report.checks.push('Disabling all WebGL contexts on desktop automatically preserves the same 2D graph and relation evidence action');

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
