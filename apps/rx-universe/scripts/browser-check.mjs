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
const researchAtDate = date => researchCatalog.records.filter(row => row.scope === 'in_window' && row.published_at && row.published_at <= date && (row.event_date ?? row.published_at) <= date);
const titles = ['Command Center', '3D Universe', 'Time Machine', 'Evidence Vault', 'Hypothesis War Room', 'Factory Twin', 'Briefing Studio'];
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
  await page.screenshot({ path: path.join(output, filename), fullPage, animations: 'disabled' });
  report.screenshots.push(filename);
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
  await screenshot(page, 'desktop-3d-command-center.png');
  report.checks.push('Desktop production entry and graph renderer loaded');

  for (const title of titles) {
    await navigate(page, title);
    await noHorizontalOverflow(page, `Desktop ${title}`);
  }
  report.checks.push('All seven desktop navigation screens render');

  await navigate(page, '3D Universe');
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await expect(page.locator('.graph-stage svg[role="group"]')).toBeVisible();
  await page.getByRole('button', { name: 'SAMSUNG SDS 상세 보기', exact: true }).click();
  const drawer = page.locator('.detail-drawer');
  await expect(drawer.getByRole('heading', { name: '삼성SDS', exact: true })).toBeVisible();
  await expect(drawer.locator('.research-countline')).toBeVisible();
  assert.ok(await drawer.locator('.research-source-link').count() > 0, 'Samsung SDS drawer must link actual sources');
  await drawer.getByRole('button', { name: 'Evidence Vault 열기', exact: true }).click();
  await expect(page.locator('main h1')).toContainText('Evidence Vault');
  report.checks.push('2D node opens the correct drawer, evidence status and Evidence Vault');

  await navigate(page, '3D Universe');
  // Keyboard access exercises the same SVG link action as pointer selection.
  const link = page.locator('.graph-stage .rx-link[tabindex="0"]').first();
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(drawer.getByRole('heading', { name: 'Evidence Sources', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '상세 닫기', exact: true }).click();
  report.checks.push('2D connections support keyboard evidence navigation');

  await navigate(page, 'Time Machine');
  await page.getByRole('button', { name: 'As-known-at', exact: true }).click();
  await page.getByLabel('정보 기준일', { exact: true }).fill('2026-09-01');
  await expect(page.locator('.graph-stage')).toContainText('이 시점에 등록된 설계 seed가 없습니다');
  await expect(page.locator('.universe-visual')).toHaveCount(0);
  await page.getByRole('button', { name: 'Retrospective', exact: true }).click();
  await expect(page.locator('.universe-visual')).toHaveCount(0);
  await page.getByRole('button', { name: 'As-known-at', exact: true }).click();
  for (const title of titles) {
    await navigate(page, title);
    await expect(page.getByLabel('정보 기준일', { exact: true })).toHaveValue('2026-09-01');
    await expect(page.locator('.universe-visual, .signal-item, .hypothesis-card, .factory-flow, .question-list button')).toHaveCount(0);
    if (title === 'Evidence Vault') await expect(page.locator('.research-card')).toHaveCount(researchAtDate('2026-09-01').length);
  }
  report.checks.push('2026-09-01 hides future seeds on all screens and in both temporal perspectives');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '스냅샷 내보내기', exact: true }).click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'rx-snapshot-2026-09-01.json');
  const downloadPath = path.join(output, download.suggestedFilename());
  await download.saveAs(downloadPath);
  const snapshot = JSON.parse(await readFile(downloadPath, 'utf8'));
  assert.equal(snapshot.as_of, '2026-09-01');
  assert.equal(snapshot.known_at, '2026-09-01');
  assert.equal(snapshot.collection_status, 'manual_research_snapshot');
  assert.equal(snapshot.automatic_collection_status, 'not_connected');
  assert.deepEqual(snapshot.research_records.map(row => row.id).sort(), researchAtDate('2026-09-01').map(row => row.id).sort(), 'Historical sources leaked or disappeared');
  assert.ok(snapshot.research_records.length > 0, 'Research predating seed registration must remain visible');
  assert.equal(snapshot.last_successful_update, null);
  for (const key of ['entities', 'relations', 'hypotheses', 'signals', 'questions', 'claims', 'evidence', 'watched']) assert.deepEqual(snapshot[key], [], `Historical export leaked ${key}`);
  report.checks.push('Historical JSON contains only eligible sources, no future seeds, and reports automatic collection as disconnected');

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
  await expect(page.locator('.research-catalog-summary')).toContainText('81');
  await page.getByLabel('법인 필터', { exact: true }).selectOption('sds');
  await page.getByLabel('자료 유형 필터', { exact: true }).selectOption('official');
  await page.getByLabel('검증 상태 필터', { exact: true }).selectOption('primary_read');
  const filteredRows = [...currentRows, ...undatedRows, ...backgroundRows].filter(row => row.entity_ids.includes('sds') && row.source_type === 'official' && row.verification === 'primary_read');
  assert.ok(filteredRows.length > 0);
  await expect(page.locator('.research-card')).toHaveCount(filteredRows.length);
  await page.getByRole('button', { name: '초기화', exact: true }).click();
  await page.getByLabel('자료 검색', { exact: true }).fill('2031년까지 10조');
  await expect(page.locator('.research-card[data-source-id="media-003"]')).toBeVisible();
  await page.getByLabel('자료 검색', { exact: true }).fill('');
  const jsonResponse = await page.request.get(new URL('data/rx-research.json', previewUrl).href);
  assert.ok(jsonResponse.ok());
  assert.equal((await jsonResponse.json()).records.length, researchCatalog.records.length);
  const databaseResponse = await page.request.get(new URL('data/rx-research.sqlite', previewUrl).href);
  assert.ok(databaseResponse.ok());
  assert.equal((await databaseResponse.body()).subarray(0,16).toString(), 'SQLite format 3\0');
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('main h1')).toContainText('Evidence Vault');
  await expect(page.locator('.research-card')).toHaveCount(researchCatalog.records.length);
  assert.equal(new URL(page.url()).hash, '#evidence');
  await screenshot(page, 'desktop-evidence-vault.png', false);
  report.checks.push('All 81 evidence records, scope separation, filters/search, deep links and public JSON/SQLite downloads work');

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
  await expect(mobile.locator('.graph-stage svg[role="group"]')).toBeVisible();
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
