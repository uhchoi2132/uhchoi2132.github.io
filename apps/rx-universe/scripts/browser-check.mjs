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
async function navigate(page, title, mobile = false, { overview = false } = {}) {
  if (mobile) {
    await page.getByRole('button', { name: '메뉴', exact: true }).click();
    await expect(page.locator('.sidebar')).toHaveClass(/\bopen\b/);
  }
  await navButton(page, title).click();
  await expect(page.locator('main h1')).toContainText(title);
  if (mobile) await expect(page.locator('.sidebar')).not.toHaveClass(/\bopen\b/);
  if (title === '3D Universe' && !overview && await page.getByTestId('terrain-overview').isVisible()) {
    await page.getByRole('button', { name: '전체 관계 지도', exact: true }).click();
    await expect(page.getByTestId('terrain-overview')).toHaveCount(0);
  }
}
async function noHorizontalOverflow(page, title) {
  const sizes = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(sizes.page <= sizes.viewport + 1 && sizes.body <= sizes.viewport + 1, `${title}: horizontal overflow ${JSON.stringify(sizes)}`);
}
async function screenshot(page, filename, fullPage = true) {
  await page.screenshot({ path: path.join(output, filename), fullPage, animations: 'disabled', style: '.toast { visibility: hidden !important; }' });
  report.screenshots.push(filename);
}
async function cameraState(page) {
  const canvas = page.locator('.graph-stage canvas');
  await expect(canvas).toHaveAttribute('data-camera-ready', 'true');
  // OrbitControls updates before the frame snapshot; two frames also let React
  // effects from a changed date/filter settle before testing preservation.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return canvas.evaluate(element => ({
    position: JSON.parse(element.dataset.cameraPosition),
    target: JSON.parse(element.dataset.cameraTarget),
    quaternion: JSON.parse(element.dataset.cameraQuaternion),
  }));
}
function assertCameraPreserved(actual, expected, context) {
  for (const key of ['position', 'target', 'quaternion']) {
    assert.equal(actual[key].length, expected[key].length);
    assert.ok(actual[key].every((value, index) => Math.abs(value - expected[key][index]) < 1e-6), `${context}: camera ${key} changed from ${JSON.stringify(expected[key])} to ${JSON.stringify(actual[key])}`);
  }
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
function assertStableLayout(referenceGraph, candidateGraph, message) {
  const reference = new Map(referenceGraph.nodes.map(node => [node.id, node.position]));
  const common = candidateGraph.nodes.filter(node => reference.has(node.id));
  assert.ok(common.length > 0, 'Stable-layout comparisons require shared graph objects');
  for (const node of common) assert.deepEqual(node.position, reference.get(node.id), `${message}: ${node.id} changed its canonical map position`);
}
async function assertGraphIndexParity(page, snapshot) {
  const expected = sorted(snapshot.graph.nodes.map(node => node.id));
  const actual = await page.locator('.graph-index [data-index-node-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-index-node-id')));
  assert.deepEqual(sorted(actual), expected, 'Object Explorer must list every entity, claim and source in the displayed/exported projection');
}
function clusterProjection(graph, cluster) {
  const nodes = graph.nodes.filter(node => node.cluster === cluster);
  const ids = new Set(nodes.map(node => node.id));
  return { ...graph, nodes, relations: graph.relations.filter(relation => ids.has(relation.from) && ids.has(relation.to)) };
}
function assertTemporalComparison(comparison, beforeGraph, afterGraph, beforeDate, afterDate, constrained = false) {
  assert.equal(comparison.valid, true);
  assert.equal(comparison.mode, 'known');
  assert.equal(comparison.before.date, beforeDate);
  assert.equal(comparison.after.date, afterDate);
  assert.deepEqual(comparison.before.graph, beforeGraph, 'Comparison must use the independently exported earlier snapshot with the same projection');
  assert.deepEqual(comparison.after.graph, afterGraph, 'Comparison must use the independently exported later snapshot with the same projection');
  const subtractIds = (after, before) => {
    const prior = new Set(before);
    return sorted(after.filter(id => !prior.has(id)));
  };
  const beforeNodes = beforeGraph.nodes.map(node => node.id);
  const afterNodes = afterGraph.nodes.map(node => node.id);
  const beforeRelations = beforeGraph.relations.map(relation => relation.id);
  const afterRelations = afterGraph.relations.map(relation => relation.id);
  const beforeClaims = beforeGraph.nodes.filter(node => node.ontology_type === 'Claim').map(node => node.id);
  const afterClaims = afterGraph.nodes.filter(node => node.ontology_type === 'Claim').map(node => node.id);
  assert.deepEqual(sorted(comparison.newlyVisibleNodes.map(node => node.id)), subtractIds(afterNodes, beforeNodes));
  assert.deepEqual(sorted(comparison.noLongerVisibleNodes.map(node => node.id)), subtractIds(beforeNodes, afterNodes));
  assert.deepEqual(sorted(comparison.newlyVisibleRelations.map(relation => relation.id)), subtractIds(afterRelations, beforeRelations));
  assert.deepEqual(sorted(comparison.noLongerVisibleRelations.map(relation => relation.id)), subtractIds(beforeRelations, afterRelations));
  assert.deepEqual(sorted(comparison.newlyVisibleClaimIds), subtractIds(afterClaims, beforeClaims));
  assert.deepEqual(sorted(comparison.noLongerVisibleClaimIds), subtractIds(beforeClaims, afterClaims));
  const sourcesFor = (date, graph) => {
    const provenance = new Set([...graph.nodes, ...graph.relations].flatMap(item => item.source_ids));
    return [...researchAtDate(date), ...researchCatalog.records.filter(row => row.scope === 'undated' && row.accessed_at.slice(0, 10) <= date)]
      .filter(row => !constrained || provenance.has(row.id));
  };
  const beforeSources = sourcesFor(beforeDate, beforeGraph);
  const afterSources = sourcesFor(afterDate, afterGraph);
  assert.deepEqual(sorted(comparison.before.sourceIds), sorted(beforeSources.map(row => row.id)));
  assert.deepEqual(sorted(comparison.after.sourceIds), sorted(afterSources.map(row => row.id)));
  assert.deepEqual(sorted(comparison.newlyVisibleSources.map(row => row.id)), subtractIds(afterSources.map(row => row.id), beforeSources.map(row => row.id)));
  assert.deepEqual(sorted(comparison.noLongerVisibleSources.map(row => row.id)), subtractIds(beforeSources.map(row => row.id), afterSources.map(row => row.id)));
  assert.deepEqual(sorted(comparison.newPublishedSources.map(row => row.id)), sorted(afterSources.filter(row => row.published_at && row.published_at > beforeDate && row.published_at <= afterDate).map(row => row.id)), 'New publication must use publication dates, not ingestion dates or graph additions');
  assert.deepEqual(sorted(comparison.undatedObservedSources.map(row => row.id)), sorted(afterSources.filter(row => row.scope === 'undated' && row.accessed_at.slice(0, 10) > beforeDate && row.accessed_at.slice(0, 10) <= afterDate).map(row => row.id)), 'Undated discoveries must remain separate from newly published documents');
  assert.deepEqual(sorted(comparison.unsupportedHistory), sorted(['claim_versions', 'corrections', 'withdrawals', 'claim_refutations']));
  assert.equal(comparison.history.supported, false);
  for (const key of ['claimVersions', 'corrections', 'withdrawals', 'claimRefutations']) assert.equal(comparison.history[key], null);
  assert.equal(comparison.semantics.sourceScope, constrained ? 'visible_graph_provenance' : 'temporal_catalog');
  assertStableLayout(beforeGraph, afterGraph, 'Two-date comparison');
}
async function assertComparisonPanel(page, comparison, { expandRelations = false } = {}) {
  const panel = page.getByTestId('temporal-comparison');
  await expect(panel).toBeVisible();
  for (const [testId, total] of [
    ['comparison-published-count', comparison.newPublishedSources.length],
    ['comparison-observed-count', comparison.undatedObservedSources.length],
    ['comparison-relations-count', comparison.newlyVisibleRelations.length],
    ['comparison-claims-count', comparison.newlyVisibleClaimIds.length],
  ]) await expect(panel.getByTestId(testId).locator('b')).toHaveText(String(total));
  assert.deepEqual(sorted(await panel.getByTestId('comparison-source').evaluateAll(elements => elements.map(element => element.getAttribute('data-source-id')))), sorted(comparison.newPublishedSources.map(source => source.id)), 'Comparison document cards must match the publication interval');
  assert.deepEqual(sorted(await panel.getByTestId('comparison-observed-source').evaluateAll(elements => elements.map(element => element.getAttribute('data-source-id')))), sorted(comparison.undatedObservedSources.map(source => source.id)), 'Observed undated documents must have their own list');
  const relationRows = panel.getByTestId('comparison-relation');
  const initialCount = Math.min(40, comparison.newlyVisibleRelations.length);
  await expect(relationRows).toHaveCount(initialCount);
  assert.deepEqual(await relationRows.evaluateAll(elements => elements.map(element => element.getAttribute('data-relation-id'))), comparison.newlyVisibleRelations.slice(0, initialCount).map(relation => relation.id));
  if (expandRelations && comparison.newlyVisibleRelations.length > 40) {
    await panel.getByRole('button', { name: '연결 더 보기', exact: true }).click();
    const expandedCount = Math.min(80, comparison.newlyVisibleRelations.length);
    await expect(relationRows).toHaveCount(expandedCount);
    assert.deepEqual(await relationRows.evaluateAll(elements => elements.map(element => element.getAttribute('data-relation-id'))), comparison.newlyVisibleRelations.slice(0, expandedCount).map(relation => relation.id), 'More relations must reveal the next actual comparison IDs');
  }
  await expect(panel.locator('.comparison-limits > summary')).toHaveText('주장 수정·철회·반박 이력 비교는 지원하지 않습니다');
}
function expectedEvolutionCounts(graph, knownAt, { topic, month, cumulative = false, undated = false } = {}) {
  const sourceById = new Map(researchCatalog.records.map(record => [record.id, record]));
  const claimOwner = new Map(researchCatalog.records.flatMap(record => claimRows([record]).map(claim => [claim.id, record])));
  const documents = new Set(), claims = new Set(), origins = new Set(), contributors = new Set();
  for (const node of graph.nodes) {
    if (topic && node.cluster !== topic) continue;
    const isDocument = node.ontology_type === 'Source';
    const isClaim = node.ontology_type === 'Claim';
    if (!isDocument && !isClaim) continue;
    const source = isDocument ? sourceById.get(node.id.replace(/^source:/, '')) : claimOwner.get(node.id);
    assert.ok(source, `Timeline graph object ${node.id} must resolve to its catalog source`);
    if (undated) {
      if (source.scope !== 'undated' || source.accessed_at.slice(0, 10) > knownAt) continue;
    } else {
      if (source.scope !== 'in_window' || !source.published_at || !['page', 'search_index'].includes(source.date_basis)
        || source.published_at < researchCatalog.meta.window_start || source.published_at > knownAt) continue;
      const publishedMonth = source.published_at.slice(0, 7);
      if (month && (cumulative ? publishedMonth > month : publishedMonth !== month)) continue;
    }
    contributors.add(source.id);
    if (isDocument) { documents.add(source.id); origins.add(originKey(source)); }
    else claims.add(node.id);
  }
  return {
    documentCount: documents.size, claimCount: claims.size, sourceGroupCount: origins.size,
    documentIds: sorted(documents), claimIds: sorted(claims), sourceGroupKeys: sorted(origins), contributingSourceIds: sorted(contributors),
  };
}
function assertEvolutionCounts(actual, expected, context) {
  for (const key of ['documentCount', 'claimCount', 'sourceGroupCount']) assert.equal(actual[key], expected[key], `${context}: ${key} must reflect actual visible objects`);
  for (const key of ['documentIds', 'claimIds', 'sourceGroupKeys', 'contributingSourceIds']) assert.deepEqual(sorted(actual[key]), expected[key], `${context}: ${key} must preserve exact provenance`);
}
function assertEvolutionModel(model, graph, knownAt) {
  assert.equal(model.valid, true);
  assert.equal(model.knownAt, knownAt);
  assert.deepEqual(model.window, { from: researchCatalog.meta.window_start, to: knownAt });
  const expectedMonths = [];
  const monthCursor = new Date(`${researchCatalog.meta.window_start.slice(0, 7)}-01T00:00:00Z`);
  while (monthCursor.toISOString().slice(0, 7) <= knownAt.slice(0, 7)) {
    expectedMonths.push(monthCursor.toISOString().slice(0, 7));
    monthCursor.setUTCMonth(monthCursor.getUTCMonth() + 1);
  }
  assert.deepEqual(model.months, expectedMonths, 'The publication matrix must include every month and no future month');
  assert.deepEqual(sorted(model.topics.map(topic => topic.id)), sorted(['electronics', 'sds', 'miracom', 'robotics', 'research']));
  assert.deepEqual(sorted(model.scope.nodeIds), sorted(graph.nodes.map(node => node.id)), 'Timeline scope must retain the selected graph projection');
  for (const key of ['historicalGraphSnapshots', 'claimVersionHistory', 'coverageCompletenessMeasured', 'personalInterestMeasured', 'confidenceMeasured']) assert.equal(model.semantics[key], false, `Timeline must not claim ${key}`);
  const topics = new Set(model.topics.map(topic => topic.id));
  for (const node of graph.nodes) assert.ok(topics.has(node.cluster), 'Every graph topic must have a timeline row');
  for (const topic of model.topics) {
    assert.deepEqual(topic.months.map(bucket => bucket.month), expectedMonths);
    assertEvolutionCounts(topic.published, expectedEvolutionCounts(graph, knownAt, { topic: topic.id }), `${topic.id} published`);
    assertEvolutionCounts(topic.undated, expectedEvolutionCounts(graph, knownAt, { topic: topic.id, undated: true }), `${topic.id} undated`);
    for (const bucket of topic.months) {
      assert.ok(bucket.to <= knownAt && bucket.from >= researchCatalog.meta.window_start, 'Monthly cutoffs must stay within the observed publication horizon');
      assertEvolutionCounts(bucket, expectedEvolutionCounts(graph, knownAt, { topic: topic.id, month: bucket.month }), `${topic.id} ${bucket.month} monthly`);
      assertEvolutionCounts(bucket.cumulative, expectedEvolutionCounts(graph, knownAt, { topic: topic.id, month: bucket.month, cumulative: true }), `${topic.id} ${bucket.month} cumulative`);
    }
  }
  assertEvolutionCounts(model.totals.published, expectedEvolutionCounts(graph, knownAt), 'All published topics');
  assertEvolutionCounts(model.totals.undated, expectedEvolutionCounts(graph, knownAt, { undated: true }), 'All undated topics');
  const publishedIds = new Set(model.topics.flatMap(topic => topic.months.flatMap(bucket => bucket.contributingSourceIds)));
  for (const id of model.totals.undated.contributingSourceIds) assert.ok(!publishedIds.has(id), 'Undated observations must never become monthly publication events');
}
async function assertEvolutionElement(element, expected, context) {
  for (const [attribute, key] of [['data-document-ids', 'documentIds'], ['data-claim-ids', 'claimIds'], ['data-source-group-keys', 'sourceGroupKeys'], ['data-contributing-source-ids', 'contributingSourceIds']]) {
    assert.deepEqual(sorted(JSON.parse(await element.getAttribute(attribute))), expected[key], `${context}: displayed ${key} differs from the publication inventory`);
  }
}
async function assertEvolutionDisplay(page, graph, knownAt, metric, cumulative, { mobile = false, month } = {}) {
  const panel = page.getByTestId('knowledge-evolution');
  await expect(panel).toHaveAttribute('data-known-at', knownAt);
  await expect(panel).toHaveAttribute('data-evolution-metric', metric);
  await expect(panel).toHaveAttribute('data-evolution-mode', cumulative ? 'cumulative' : 'monthly');
  const rows = await panel.locator(mobile ? 'button[data-evolution-mobile-topic]' : 'button[data-evolution-topic]').evaluateAll(elements => elements.map(element => ({
    topic: element.getAttribute('data-evolution-mobile-topic') ?? element.getAttribute('data-evolution-topic'),
    month: element.getAttribute('data-evolution-month'), count: Number(element.getAttribute('data-evolution-count')),
    documentIds: JSON.parse(element.getAttribute('data-document-ids')), claimIds: JSON.parse(element.getAttribute('data-claim-ids')),
    sourceGroupKeys: JSON.parse(element.getAttribute('data-source-group-keys')), contributingSourceIds: JSON.parse(element.getAttribute('data-contributing-source-ids')),
  })));
  const months = [];
  for (let cursor = new Date(`${researchCatalog.meta.window_start.slice(0, 7)}-01T00:00:00Z`); cursor.toISOString().slice(0, 7) <= knownAt.slice(0, 7); cursor.setUTCMonth(cursor.getUTCMonth() + 1)) months.push(cursor.toISOString().slice(0, 7));
  assert.equal(rows.length, 5 * (mobile ? 1 : months.length), 'All five topic rows must survive empty and filtered publication periods');
  assert.equal(new Set(rows.map(row => `${row.topic}:${row.month}`)).size, rows.length, 'Topic/month cells must be unique');
  for (const row of rows) {
    assert.ok(months.includes(row.month), 'Visible month must lie within the current knowledge cutoff');
    if (mobile) assert.equal(row.month, month);
    const expected = expectedEvolutionCounts(graph, knownAt, { topic: row.topic, month: row.month, cumulative });
    assert.equal(row.count, expected[{ documents: 'documentCount', claims: 'claimCount', sourceGroups: 'sourceGroupCount' }[metric]], `${row.topic}/${row.month}: the selected metric must match the actual publication inventory`);
    for (const key of ['documentIds', 'claimIds', 'sourceGroupKeys', 'contributingSourceIds']) assert.deepEqual(sorted(row[key]), expected[key], `${row.topic}/${row.month}: displayed ${key} must agree with visible graph objects`);
  }
}
async function assertEvolutionDetail(page, expected, context) {
  const detail = page.getByTestId('evolution-detail');
  await expect(detail).toBeVisible();
  await assertEvolutionElement(detail, expected, context);
  assert.deepEqual(sorted(await detail.locator('[data-evolution-source-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-evolution-source-id')))), expected.contributingSourceIds, `${context}: every contributing source must remain reachable`);
}
function expectedSurfaceContributions(graph, date, metric, includeUndated = false) {
  const sources = new Map(researchCatalog.records.map(record => [record.id, record]));
  const claims = new Map(researchCatalog.records.flatMap(record => claimRows([record]).map(claim => [claim.id, { record, claim }])));
  const selected = graph.nodes.flatMap(node => {
    const claim = claims.get(node.id);
    const isSource = node.ontology_type === 'Source';
    if (metric === 'claims' ? node.ontology_type !== 'Claim' : !isSource) return [];
    const record = isSource ? sources.get(node.id.replace(/^source:/, '')) : claim?.record;
    assert.ok(record, `Surface contribution ${node.id} must resolve to a catalog source`);
    if (!usableVerification(record.verification) || (claim && !usableVerification(claim.claim.verification ?? record.verification))) return [];
    const dated = record.scope === 'in_window' && record.published_at && ['page', 'search_index'].includes(record.date_basis)
      && record.published_at >= researchCatalog.meta.window_start && record.published_at <= date;
    const undated = includeUndated && record.scope === 'undated' && record.published_at === null && record.accessed_at.slice(0, 10) <= date;
    if (!dated && !undated) return [];
    assert.ok(node.position[0] >= -20 && node.position[0] <= 20 && -node.position[1] >= -14 && -node.position[1] <= 16, 'Current graph fixture evidence must lie inside the fixed terrain bounds');
    return [{ node, record, isSource }];
  });
  const unique = values => sorted(new Set(values));
  return {
    nodeIds: unique(selected.map(item => item.node.id)), sourceIds: unique(selected.map(item => item.record.id)),
    claimIds: unique(selected.filter(item => !item.isSource).map(item => item.node.id)),
    sourceGroupKeys: unique(selected.map(item => originKey(item.record))),
    publishedNodeIds: unique(selected.filter(item => item.record.published_at !== null).map(item => item.node.id)),
    undatedNodeIds: unique(selected.filter(item => item.record.published_at === null).map(item => item.node.id)),
  };
}
function assertSurfaceModel(surface, graph, date, metric = 'claims', includeUndated = false) {
  assert.equal(surface.valid, true);
  assert.equal(surface.knownAt, date);
  assert.equal(surface.metric, metric);
  assert.equal(surface.includeUndated, includeUndated);
  assert.deepEqual(surface.contributions, expectedSurfaceContributions(graph, date, metric, includeUndated), 'Terrain contributions must use only actual visible, published evidence for the selected metric');
  assert.deepEqual(sorted(surface.scope.nodeIds), sorted(graph.nodes.map(node => node.id)));
  assert.deepEqual(sorted(surface.evidenceAnchors.map(anchor => anchor.nodeId)), surface.contributions.nodeIds);
  assert.equal(surface.kernelAnchors.length, metric === 'sourceGroups' ? surface.contributions.sourceGroupKeys.length : surface.contributions.nodeIds.length, 'Each source group gets one kernel even when several republications are visible');
  assert.deepEqual(surface.bounds, { minX: -20, maxX: 20, minZ: -14, maxZ: 16 });
  const { field } = surface;
  assert.equal(field.heights.length, field.columns * field.rows);
  if (field.positions) assert.equal(field.positions.length, field.heights.length * 3);
  if (field.indices) assert.equal(field.indices.length, (field.columns - 1) * (field.rows - 1) * 6);
  assert.ok(field.heights.every(height => Number.isFinite(height) && height >= 0));
  assert.equal(field.maxHeight, Math.max(...field.heights));
  assert.equal(field.minHeight, Math.min(...field.heights));
  if (surface.contributions.nodeIds.length) assert.ok(field.maxHeight > 0 && field.maxHeight > field.minHeight, 'Real evidence must create a non-flat surface');
  else assert.ok(field.heights.every(height => height === 0), 'No selected evidence must produce a flat zero surface');
  if (field.positions) for (let index = 0; index < field.heights.length; index++) assert.equal(field.positions[index * 3 + 1], field.heights[index], 'Actual mesh vertices must use the exported evidence height field');
  for (const anchor of surface.anchors) {
    const node = graph.nodes.find(item => item.id === anchor.nodeId);
    assert.ok(node, 'Terrain must not invent marker identities');
    assert.equal(anchor.x, node.position[0]);
    assert.equal(anchor.z, -node.position[1]);
  }
  for (const key of ['dateNormalization', 'confidenceMeasured', 'sourceGroupsAreIndependentEvidence']) assert.equal(surface.semantics[key], false);
}
function assertSurfaceLayoutStable(before, after, context) {
  assert.deepEqual(before.bounds, after.bounds, `${context}: terrain bounds must remain fixed`);
  assert.equal(before.field.columns, after.field.columns);
  assert.equal(before.field.rows, after.field.rows);
  if (before.field.positions && after.field.positions) for (let index = 0; index < before.field.positions.length; index += 3) {
    assert.equal(before.field.positions[index], after.field.positions[index], `${context}: mesh horizontal x drifted`);
    assert.equal(before.field.positions[index + 2], after.field.positions[index + 2], `${context}: mesh horizontal z drifted`);
  }
  const prior = new Map(before.anchors.map(anchor => [anchor.nodeId, anchor]));
  for (const anchor of after.anchors) if (prior.has(anchor.nodeId)) {
    assert.equal(anchor.x, prior.get(anchor.nodeId).x, `${context}: marker x drifted`);
    assert.equal(anchor.z, prior.get(anchor.nodeId).z, `${context}: marker z drifted`);
  }
}
async function surfaceCamera(page) {
  const surface = page.getByTestId('terrain-surface');
  await expect(surface).toHaveAttribute('data-camera-ready', 'true');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return surface.evaluate(element => ({ position: JSON.parse(element.dataset.cameraPosition), target: JSON.parse(element.dataset.cameraTarget), quaternion: JSON.parse(element.dataset.cameraQuaternion) }));
}
async function assertSurfaceRenderer(page, surface, renderer = '3d') {
  const rendered = page.getByTestId('terrain-surface');
  await expect(rendered).toHaveAttribute('data-renderer', renderer);
  await expect(rendered).toHaveAttribute('data-height-fingerprint', surface.fingerprint);
  for (const [attribute, key] of [['data-contribution-node-ids', 'nodeIds'], ['data-contribution-source-ids', 'sourceIds'], ['data-contribution-claim-ids', 'claimIds'], ['data-contribution-source-group-keys', 'sourceGroupKeys']]) assert.deepEqual(sorted(JSON.parse(await rendered.getAttribute(attribute))), surface.contributions[key], 'Renderer evidence IDs must agree with the exported current terrain');
  assert.deepEqual(JSON.parse(await rendered.getAttribute('data-surface-anchors')), surface.anchors.map(anchor => ({ id: anchor.nodeId, x: anchor.x, z: anchor.z, height: anchor.height, contributes: anchor.contributes })), 'Rendered marker coordinates and heights must match the canonical surface anchors');
  if (renderer === '3d') {
    await expect(rendered.locator('canvas')).toBeVisible();
    await expect(rendered).toHaveAttribute('data-rendered-height-fingerprint', /^float32-fnv1a-[0-9a-f]{8}$/);
    await expect(rendered).toHaveAttribute('data-rendered-vertex-count', String(surface.field.heights.length));
    await expect.poll(async () => Math.abs(Number(await rendered.getAttribute('data-rendered-height-max')) - surface.field.maxHeight) < 1e-5, { message: 'GPU geometry height must match the evidence field within Float32 precision' }).toBe(true);
    await expect.poll(async () => Math.abs(Number(await rendered.getAttribute('data-rendered-height-min')) - surface.field.minHeight) < 1e-5).toBe(true);
  } else {
    await expect(page.getByTestId('terrain-surface-2d')).toBeVisible();
    await expect(rendered.locator('canvas')).toHaveCount(0);
  }
}
async function assertLandscapeChain(page, snapshot, sourceId = 'media-001') {
  const source = researchCatalog.records.find(record => record.id === sourceId);
  const eligibleClaims = claimRows([source]).filter(claim => snapshot.terrain_surface.scope.eligibleNodeIds.includes(claim.id));
  assert.ok(eligibleClaims.length > 0, 'The chain fixture must contain an eligible real claim');
  const access = page.getByTestId('terrain-surface').locator('.surface-access');
  if (await access.getAttribute('open') === null) await access.locator('summary').click();
  const firstClaim = eligibleClaims[0];
  const button = access.locator(`.surface-evidence-list button[data-surface-node-id="${firstClaim.id}"]`);
  await button.focus();
  await page.keyboard.press('Enter');
  await access.locator('summary').click();
  const chain = page.getByTestId('landscape-chain');
  await expect(chain).toHaveAttribute('data-current-source-id', sourceId);
  const ids = JSON.parse(await chain.getAttribute('data-chain-node-ids'));
  assert.deepEqual(sorted(ids), sorted([...eligibleClaims.map(claim => claim.id), `source:${sourceId}`]), 'The chain must consist of this source’s actual eligible claims and its original document');
  assert.equal(ids.at(-1), `source:${sourceId}`);
  while (await chain.getByRole('button', { name: '이전 근거', exact: true }).isEnabled()) await chain.getByRole('button', { name: '이전 근거', exact: true }).click();
  await expect(chain.getByRole('button', { name: '이전 근거', exact: true })).toBeDisabled();
  for (const [index, id] of ids.entries()) {
    const claim = eligibleClaims.find(item => item.id === id);
    await expect(chain).toHaveAttribute('data-current-node-id', id);
    await expect(chain).toHaveAttribute('data-current-claim-id', claim?.id ?? '');
    await expect(chain.locator('h4')).toHaveText(claim?.text ?? source.title);
    await chain.getByRole('button', { name: '근거 상세 펼치기', exact: true }).click();
    await expect(page.getByTestId('landscape-chain-detail')).toHaveAttribute('data-source-id', sourceId);
    await expect(page.getByTestId('landscape-chain-detail')).toHaveAttribute('data-claim-id', claim?.id ?? '');
    await chain.getByRole('button', { name: '근거 상세 접기', exact: true }).click();
    await expect(page.getByTestId('landscape-chain-detail')).toHaveCount(0);
    if (index < ids.length - 1) await chain.getByRole('button', { name: '다음 근거', exact: true }).click();
  }
  await expect(chain.getByRole('button', { name: '다음 근거', exact: true })).toBeDisabled();
  await chain.getByRole('button', { name: '원문 근거 열기', exact: true }).click();
  await expect(page.locator(`.detail-drawer .research-source-link[data-source-id="${sourceId}"]`)).toHaveAttribute('href', source.url);
  await page.getByRole('button', { name: '상세 닫기', exact: true }).click();
}
async function assertTerrainParity(page, snapshot) {
  const terrain = page.getByTestId('terrain-overview');
  await expect(terrain).toBeVisible();
  assert.deepEqual(sorted(JSON.parse(await terrain.getAttribute('data-terrain-node-ids'))), sorted(snapshot.graph.nodes.map(node => node.id)), 'The topic overview must summarize exactly the currently visible graph nodes');
  assert.deepEqual(sorted(JSON.parse(await terrain.getAttribute('data-terrain-relation-ids'))), sorted(snapshot.graph.relations.map(relation => relation.id)), 'The topic overview must summarize exactly the currently visible graph relations');
  const regionButtons = terrain.locator('button[data-region-id]');
  const expectedClusters = [...new Set(snapshot.graph.nodes.map(node => node.cluster))];
  assert.ok(await regionButtons.count() >= expectedClusters.length, 'Every visible cluster must remain reachable by a keyboard-operable region control');
  const allRegionNodeIds = [];
  for (const button of await regionButtons.all()) {
    const id = await button.getAttribute('data-region-id');
    const nodes = snapshot.graph.nodes.filter(node => node.cluster === id);
    const sources = nodes.filter(node => node.ontology_type === 'Source');
    const claims = nodes.filter(node => node.ontology_type === 'Claim');
    const sourceGroups = new Set(sources.map(node => node.origin_key?.trim()).filter(Boolean));
    const representedIds = JSON.parse(await button.getAttribute('data-region-node-ids'));
    assert.deepEqual(sorted(representedIds), sorted(nodes.map(node => node.id)), `${id}: topic region membership must use the graph cluster, not a separate display dataset`);
    await expect(button).toHaveAttribute('data-region-document-count', String(sources.length));
    await expect(button).toHaveAttribute('data-region-claim-count', String(claims.length));
    await expect(button).toHaveAttribute('data-region-source-group-count', String(sourceGroups.size));
    allRegionNodeIds.push(...representedIds);
  }
  assert.deepEqual(sorted(allRegionNodeIds), sorted(snapshot.graph.nodes.map(node => node.id)), 'Topic regions must partition visible graph objects without dropping or duplicating nodes');
}
async function assertGraphParity(page, snapshot, { flat = false } = {}) {
  const graph = page.locator('.graph-stage .universe-visual');
  const nodeIds = sorted(snapshot.graph.nodes.map(node => node.id));
  const edgeIds = sorted(snapshot.graph.relations.map(relation => relation.id));
  await expect(graph).toHaveCount(1);
  await expect(page.locator('.graph-stage')).toHaveAttribute('data-graph-node-count', String(nodeIds.length));
  await expect(page.locator('.graph-stage')).toHaveAttribute('data-graph-relation-count', String(edgeIds.length));
  const displayedPositions = JSON.parse(await page.locator('.graph-stage').getAttribute('data-graph-node-positions'));
  assert.deepEqual(displayedPositions, Object.fromEntries(snapshot.graph.nodes.map(node => [node.id, node.position])), 'Map coordinates must match the exported canonical positions');
  await expect(graph).toHaveAttribute('data-node-count', String(nodeIds.length));
  await expect(graph).toHaveAttribute('data-edge-count', String(edgeIds.length));
  assert.deepEqual(sorted(JSON.parse(await graph.getAttribute('data-node-ids'))), nodeIds, 'Renderer and export node IDs differ');
  assert.deepEqual(sorted(JSON.parse(await graph.getAttribute('data-edge-ids'))), edgeIds, 'Renderer and export relation IDs differ');
  if (flat) {
    const svg = graph.locator('svg[role="group"]');
    await expect(svg).toBeVisible();
    assert.deepEqual(sorted(await svg.locator('[data-node-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-node-id')))), nodeIds);
    const svgPositions = await svg.locator('[data-node-id]').evaluateAll(elements => Object.fromEntries(elements.map(element => [element.getAttribute('data-node-id'), ['x', 'y', 'z'].map(axis => Number(element.getAttribute(`data-layout-${axis}`)))])));
    assert.deepEqual(svgPositions, displayedPositions, '2D node layout coordinates must match the stable graph/export positions');
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

  await page.getByRole('button', { name: '2D', exact: true }).click();
  await navigate(page, '3D Universe', false, { overview: true });
  await assertTerrainParity(page, currentSnapshot);
  await noHorizontalOverflow(page, 'Desktop topic overview');
  await screenshot(page, 'desktop-topic-overview.png', false);
  {
    const currentTerrain = await exportSnapshot(page, 'terrain-current-claims', currentDate);
    assertSurfaceModel(currentTerrain.terrain_surface, currentTerrain.graph, currentDate);
    await assertSurfaceRenderer(page, currentTerrain.terrain_surface);
    const terrain = page.getByTestId('terrain-surface');
    const initialCamera = await surfaceCamera(page);
    await page.getByRole('button', { name: '지형 확대', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await surfaceCamera(page)).position).not.toEqual(initialCamera.position);
    const chosenCamera = await surfaceCamera(page);
    const currentBufferFingerprint = await terrain.getAttribute('data-rendered-height-fingerprint');
    const currentCanvas = await terrain.locator('canvas').screenshot({ path: path.join(output, 'desktop-terrain-current-canvas.png'), animations: 'disabled' });
    report.screenshots.push('desktop-terrain-current-canvas.png');
    await page.getByLabel('지형 기준일', { exact: true }).fill('2026-09-01');
    const pastTerrain = await exportSnapshot(page, 'terrain-september-claims', '2026-09-01');
    assertSurfaceModel(pastTerrain.terrain_surface, pastTerrain.graph, '2026-09-01');
    await assertSurfaceRenderer(page, pastTerrain.terrain_surface);
    assertSurfaceLayoutStable(currentTerrain.terrain_surface, pastTerrain.terrain_surface, 'Historical cutoff');
    assertCameraPreserved(await surfaceCamera(page), chosenCamera, 'Terrain historical cutoff');
    assert.notEqual(pastTerrain.terrain_surface.fingerprint, currentTerrain.terrain_surface.fingerprint);
    assert.notEqual(await terrain.getAttribute('data-rendered-height-fingerprint'), currentBufferFingerprint, 'Actual mesh geometry must change when published evidence accumulates');
    assert.ok(pastTerrain.terrain_surface.field.heights.every((height, index) => height <= currentTerrain.terrain_surface.field.heights[index] + 1e-10), 'Earlier evidence must not become taller through date-dependent normalization');
    const pastCanvas = await terrain.locator('canvas').screenshot({ path: path.join(output, 'desktop-terrain-september-canvas.png'), animations: 'disabled' });
    report.screenshots.push('desktop-terrain-september-canvas.png');
    assert.ok(!currentCanvas.equals(pastCanvas), 'The actual WebGL surface must visibly change across evidence dates');
    await page.getByLabel('지형 기준일', { exact: true }).fill(currentDate);
    const metricModels = { claims: currentTerrain.terrain_surface };
    for (const metric of ['documents', 'sourceGroups']) {
      await page.getByLabel('지형 집계 지표', { exact: true }).selectOption(metric);
      const metricSnapshot = await exportSnapshot(page, `terrain-current-${metric}`, currentDate);
      assertSurfaceModel(metricSnapshot.terrain_surface, metricSnapshot.graph, currentDate, metric);
      await assertSurfaceRenderer(page, metricSnapshot.terrain_surface);
      assertSurfaceLayoutStable(currentTerrain.terrain_surface, metricSnapshot.terrain_surface, `Terrain ${metric} metric`);
      assertCameraPreserved(await surfaceCamera(page), chosenCamera, `Terrain ${metric} metric`);
      metricModels[metric] = metricSnapshot.terrain_surface;
    }
    assert.equal(new Set(Object.values(metricModels).map(model => model.fingerprint)).size, 3, 'Distinct actual evidence metrics must produce distinct field geometry in this catalog');
    await page.getByLabel('지형 집계 지표', { exact: true }).selectOption('claims');
    await page.getByLabel('게시일 미상 관측자료 포함', { exact: true }).check();
    const observedTerrain = await exportSnapshot(page, 'terrain-include-undated', currentDate);
    assertSurfaceModel(observedTerrain.terrain_surface, observedTerrain.graph, currentDate, 'claims', true);
    assert.ok(observedTerrain.terrain_surface.contributions.undatedNodeIds.length > 0);
    assert.ok(currentTerrain.terrain_surface.contributions.undatedNodeIds.length === 0);
    assert.ok(observedTerrain.terrain_surface.field.heights.every((height, index) => height >= currentTerrain.terrain_surface.field.heights[index] - 1e-10));
    await assertSurfaceRenderer(page, observedTerrain.terrain_surface);
    assertCameraPreserved(await surfaceCamera(page), chosenCamera, 'Including undated observations');
    await page.getByLabel('게시일 미상 관측자료 포함', { exact: true }).uncheck();
    await assertSurfaceRenderer(page, currentTerrain.terrain_surface);
    await page.locator('.filter-tabs').getByRole('button', { name: '조직 · 기업', exact: true }).click();
    const emptyTerrain = await exportSnapshot(page, 'terrain-entity-only-flat', currentDate);
    assertSurfaceModel(emptyTerrain.terrain_surface, emptyTerrain.graph, currentDate);
    assert.equal(emptyTerrain.terrain_surface.contributions.nodeIds.length, 0);
    await assertSurfaceRenderer(page, emptyTerrain.terrain_surface);
    assertCameraPreserved(await surfaceCamera(page), chosenCamera, 'Empty evidence filter');
    await page.getByRole('button', { name: '필터 초기화', exact: true }).click();
    await assertSurfaceRenderer(page, currentTerrain.terrain_surface);
    await page.getByRole('button', { name: '지형 시점 초기화', exact: true }).click();
    await expect.poll(async () => (await surfaceCamera(page)).position).not.toEqual(chosenCamera.position);
    await noHorizontalOverflow(page, 'Desktop actual 3D evidence landscape');
    await screenshot(page, 'desktop-3d-evidence-terrain.png', true);
    report.terrain_surface_metrics = { current_date: currentDate, historical_date: '2026-09-01', grid_vertices: currentTerrain.terrain_surface.field.heights.length,
      current_contribution_count: currentTerrain.terrain_surface.contributions.nodeIds.length, historical_contribution_count: pastTerrain.terrain_surface.contributions.nodeIds.length,
      current_max_height: currentTerrain.terrain_surface.field.maxHeight, historical_max_height: pastTerrain.terrain_surface.field.maxHeight,
      rendered_buffer_fingerprint: currentBufferFingerprint, metric_kernel_counts: Object.fromEntries(Object.entries(metricModels).map(([metric, model]) => [metric, model.kernelAnchors.length])) };
    report.checks.push('Actual 3D terrain mesh heights accumulate from dated evidence, change with document/claim/group metrics and explicit undated inclusion, while fixed horizontal coordinates and the user camera survive every change');

    await page.getByRole('button', { name: '이전 월', exact: true }).click();
    const previousMonth = new Date(Date.UTC(Number(currentDate.slice(0, 4)), Number(currentDate.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10);
    await expect(page.getByLabel('지형 기준일', { exact: true })).toHaveValue(previousMonth);
    await page.getByRole('button', { name: '다음 월', exact: true }).click();
    await expect(page.getByLabel('지형 기준일', { exact: true })).toHaveValue(currentDate);
    const dateSlider = page.getByLabel('지형 기준일 슬라이더', { exact: true });
    await dateSlider.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByLabel('지형 기준일', { exact: true })).toHaveValue(shiftDay(currentDate, -1));
    await page.getByLabel('지형 기준일', { exact: true }).fill('2026-07-31');
    await page.getByRole('button', { name: '월별 축적 재생', exact: true }).click();
    await expect(page.getByLabel('지형 기준일', { exact: true })).not.toHaveValue('2026-07-31');
    await page.getByRole('button', { name: '월별 축적 일시정지', exact: true }).click();
    const pausedDate = await page.getByLabel('지형 기준일', { exact: true }).inputValue();
    assert.ok(pausedDate > '2026-07-31' && pausedDate <= currentDate);
    await page.waitForTimeout(1950);
    await expect(page.getByLabel('지형 기준일', { exact: true })).toHaveValue(pausedDate);
    await expect(page.getByRole('button', { name: '월별 축적 재생', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await page.getByLabel('지형 기준일', { exact: true }).fill(currentDate);
    await assertSurfaceRenderer(page, currentTerrain.terrain_surface);
    await assertLandscapeChain(page, currentTerrain);
    await page.getByRole('button', { name: '2D 지형', exact: true }).click();
    await assertSurfaceRenderer(page, currentTerrain.terrain_surface, '2d');
    await page.getByRole('button', { name: '3D 지형', exact: true }).click();
    await assertSurfaceRenderer(page, currentTerrain.terrain_surface);
    report.checks.push('Terrain month navigation, keyboard day slider and play/pause update the real cutoff; evidence next/previous and expand/collapse show exact eligible claims and original source URLs in both display modes');
  }
  {
    await page.getByRole('button', { name: '근거의 시간축', exact: true }).click();
    await expect(page.getByTestId('knowledge-evolution')).toBeVisible();
    await expect(page.locator('button[data-region-id]')).toHaveCount(0);
    const evolutionSnapshot = await exportSnapshot(page, 'knowledge-evolution-current', currentDate);
    assert.deepEqual(evolutionSnapshot.graph, currentSnapshot.graph, 'Opening the time distribution must not change graph membership');
    assertEvolutionModel(evolutionSnapshot.knowledge_evolution, evolutionSnapshot.graph, currentDate);
    for (const cumulative of [false, true]) {
      await page.getByRole('button', { name: cumulative ? '누적 공개 수' : '월별 공개 수', exact: true }).click();
      await expect(page.getByRole('button', { name: cumulative ? '누적 공개 수' : '월별 공개 수', exact: true })).toHaveAttribute('aria-pressed', 'true');
      for (const metric of ['documents', 'claims', 'sourceGroups']) {
        await page.getByLabel('시간 분포 지표', { exact: true }).selectOption(metric);
        await assertEvolutionDisplay(page, evolutionSnapshot.graph, currentDate, metric, cumulative);
      }
    }
    const cumulativeExport = await exportSnapshot(page, 'knowledge-evolution-cumulative', currentDate);
    assert.deepEqual(cumulativeExport.knowledge_evolution, evolutionSnapshot.knowledge_evolution, 'Metric and aggregation controls must not mutate exported evidence');
    await noHorizontalOverflow(page, 'Desktop publication timeline');
    await screenshot(page, 'desktop-knowledge-evolution.png', false);
    report.knowledge_evolution_metrics = {
      known_at: currentDate, months: evolutionSnapshot.knowledge_evolution.months.length,
      topics: evolutionSnapshot.knowledge_evolution.topics.length,
      published: evolutionSnapshot.knowledge_evolution.totals.published,
      undated: evolutionSnapshot.knowledge_evolution.totals.undated,
    };
    report.checks.push('Knowledge timeline independently matches every monthly and cumulative document, claim and source-group ID set; all three metric controls preserve evidence and cumulative groups are distinct unions');

    const undatedTopic = evolutionSnapshot.knowledge_evolution.topics.find(topic => topic.undated.contributingSourceIds.length > 0);
    assert.ok(undatedTopic, 'The catalog must exercise the separate undated observation lane');
    await page.locator(`button[data-evolution-undated="${undatedTopic.id}"]`).click();
    await assertEvolutionDetail(page, expectedEvolutionCounts(evolutionSnapshot.graph, currentDate, { topic: undatedTopic.id, undated: true }), 'Undated observations');
    await expect(page.getByTestId('evolution-open-date')).toHaveCount(0);
    const undatedSourceId = undatedTopic.undated.contributingSourceIds[0];
    const undatedSource = researchCatalog.records.find(record => record.id === undatedSourceId);
    assert.equal(undatedSource.published_at, null);
    await page.locator(`button[data-evolution-source-id="${undatedSourceId}"]`).click();
    await expect(page.locator(`.detail-drawer .research-source-link[data-source-id="${undatedSourceId}"]`)).toHaveAttribute('href', undatedSource.url);
    await page.getByRole('button', { name: '상세 닫기', exact: true }).click();

    await page.getByLabel('엔티티 검색', { exact: true }).fill('source:sds-004');
    const filteredEvolution = await exportSnapshot(page, 'knowledge-evolution-filtered', currentDate);
    assert.ok(filteredEvolution.graph.nodes.length < currentSnapshot.graph.nodes.length);
    assert.ok(filteredEvolution.graph.nodes.some(node => node.id === 'source:sds-004'));
    assertEvolutionModel(filteredEvolution.knowledge_evolution, filteredEvolution.graph, currentDate);
    await assertEvolutionDisplay(page, filteredEvolution.graph, currentDate, 'sourceGroups', true);
    await page.getByRole('button', { name: '필터 초기화', exact: true }).click();
    await page.locator('.filter-tabs').getByRole('button', { name: '조직 · 기업', exact: true }).click();
    const entityEvolution = await exportSnapshot(page, 'knowledge-evolution-entity-only', currentDate);
    assert.ok(entityEvolution.graph.nodes.length > 0);
    assert.ok(entityEvolution.graph.nodes.every(node => !isEvidenceNode(node)));
    assertEvolutionModel(entityEvolution.knowledge_evolution, entityEvolution.graph, currentDate);
    assert.equal(entityEvolution.knowledge_evolution.totals.published.documentCount, 0);
    assert.equal(entityEvolution.knowledge_evolution.totals.published.claimCount, 0);
    await expect(page.getByTestId('evolution-layer-empty')).toBeVisible();
    await assertEvolutionDisplay(page, entityEvolution.graph, currentDate, 'sourceGroups', true);
    await page.getByRole('button', { name: '필터 초기화', exact: true }).click();
    report.checks.push('Timeline undated observations stay outside publication months and open their exact original URL; search and entity-only filters count only visible graph objects, never hidden provenance');

    await page.locator('.filter-tabs').getByRole('button', { name: '주장 · 원문', exact: true }).click();
    await page.getByRole('button', { name: '월별 공개 수', exact: true }).click();
    await page.getByLabel('시간 분포 지표', { exact: true }).selectOption('documents');
    const datedProjection = await exportSnapshot(page, 'knowledge-evolution-evidence-filter', currentDate);
    const announcedPlan = researchCatalog.records.find(record => record.id === 'mi-011');
    assert.equal(announcedPlan.published_at, '2025-10-31');
    assert.equal(announcedPlan.event_date, '2025-11-21');
    const sourceNode = datedProjection.graph.nodes.find(node => node.id === 'source:mi-011');
    assert.ok(sourceNode, 'The future-event fixture must be available by its publication date');
    const publicationMonth = announcedPlan.published_at.slice(0, 7);
    const publicationCell = page.locator(`button[data-evolution-topic="${sourceNode.cluster}"][data-evolution-month="${publicationMonth}"]`);
    await publicationCell.focus();
    await page.keyboard.press('Enter');
    const planMonthExpected = expectedEvolutionCounts(datedProjection.graph, currentDate, { topic: sourceNode.cluster, month: publicationMonth });
    assert.ok(planMonthExpected.documentIds.includes('mi-011'));
    await assertEvolutionDetail(page, planMonthExpected, 'Published future event');
    await page.locator('button[data-evolution-source-id="mi-011"]').click();
    await expect(page.locator('.detail-drawer .research-source-link[data-source-id="mi-011"]')).toHaveAttribute('href', announcedPlan.url);
    await page.getByRole('button', { name: '상세 닫기', exact: true }).click();
    const monthCutoff = await page.getByTestId('evolution-open-date').getAttribute('data-cutoff-date');
    assert.equal(monthCutoff, announcedPlan.published_at, 'Monthly navigation must use the publication month, not the future event date');
    await page.getByTestId('evolution-open-date').click();
    await expect(page.getByLabel('정보 기준일', { exact: true })).toHaveValue(monthCutoff);
    await expect(page.getByTestId('knowledge-evolution')).toHaveCount(0);
    const priorEvolution = await exportSnapshot(page, 'knowledge-evolution-prior-month', monthCutoff);
    assert.equal(priorEvolution.view.filter, 'evidence', 'Opening a historical month must preserve the selected evidence filter');
    assertResearchSnapshot(priorEvolution, researchAtDate(monthCutoff), monthCutoff);
    assert.ok(priorEvolution.research_records.every(record => record.published_at <= monthCutoff));
    assert.equal(priorEvolution.research_records.find(record => record.id === 'mi-011').event_date, '2025-11-21');
    await assertTerrainParity(page, priorEvolution);
    await page.getByRole('button', { name: '근거의 시간축', exact: true }).click();
    assertEvolutionModel(priorEvolution.knowledge_evolution, priorEvolution.graph, monthCutoff);
    await assertEvolutionDisplay(page, priorEvolution.graph, monthCutoff, 'documents', false);
    await expect(page.getByTestId('evolution-open-date')).toHaveAttribute('data-cutoff-date', monthCutoff);
    report.checks.push('Keyboard selection groups a future event by its announcement month; opening that month preserves filters, restores the dated topic map and excludes all later publications and timeline months');
    await page.getByLabel('정보 기준일', { exact: true }).fill(currentDate);
    await page.getByRole('button', { name: '필터 초기화', exact: true }).click();
    await page.getByRole('button', { name: '주제 지도', exact: true }).click();
    await assertTerrainParity(page, currentSnapshot);
  }
  const selectedCluster = 'sds';
  const topicButton = page.getByTestId('terrain-overview').locator(`button[data-region-id="${selectedCluster}"]`);
  await expect(topicButton).toHaveAccessibleName(/구역 탐색/);
  await topicButton.focus();
  const regionRenderStarted = performance.now();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('terrain-overview')).toHaveCount(0);
  await expect(page.locator('.universe-visual')).toHaveAttribute('data-renderer', '2d');
  await expect(page.locator('.graph-stage svg[role="group"] [data-node-id]')).toHaveCount(currentSnapshot.graph.nodes.filter(node => node.cluster === selectedCluster).length);
  const regionRenderMilliseconds = Math.round(performance.now() - regionRenderStarted);
  const clusterSnapshot = await exportSnapshot(page, 'topic-region-sds', currentDate);
  assert.equal(clusterSnapshot.view.exploration.cluster, selectedCluster);
  const clusterNodeIds = new Set(currentSnapshot.graph.nodes.filter(node => node.cluster === selectedCluster).map(node => node.id));
  assert.deepEqual(sorted(clusterSnapshot.graph.nodes.map(node => node.id)), sorted(clusterNodeIds));
  assert.deepEqual(sorted(clusterSnapshot.graph.relations.map(relation => relation.id)), sorted(currentSnapshot.graph.relations.filter(relation => clusterNodeIds.has(relation.from) && clusterNodeIds.has(relation.to)).map(relation => relation.id)));
  assertStableLayout(currentSnapshot.graph, clusterSnapshot.graph, 'Topic region exploration');
  await assertGraphParity(page, clusterSnapshot, { flat: true });
  await assertGraphIndexParity(page, clusterSnapshot);
  const clusterClaim = clusterSnapshot.graph.nodes.find(node => node.ontology_type === 'Claim');
  assert.ok(clusterClaim);
  await page.getByLabel('검색 주변 연결 포함', { exact: true }).uncheck();
  await page.getByLabel('노드 목록 검색', { exact: true }).fill(clusterClaim.id);
  await expect(page.getByLabel('엔티티 검색', { exact: true })).toHaveValue(clusterClaim.id);
  const listSearched = await exportSnapshot(page, 'object-list-shared-search', currentDate);
  const expectedListSearch = clusterSnapshot.graph.nodes.filter(node => [node.id, node.title, node.subtitle, node.description, ...(node.aliases ?? [])].join(' ').toLowerCase().includes(clusterClaim.id.toLowerCase()));
  assert.deepEqual(sorted(listSearched.graph.nodes.map(node => node.id)), sorted(expectedListSearch.map(node => node.id)), 'Object-list search must filter the shared graph projection');
  await assertGraphParity(page, listSearched, { flat: true });
  await assertGraphIndexParity(page, listSearched);
  await page.getByLabel('노드 목록 검색', { exact: true }).fill('');
  await page.getByLabel('검색 주변 연결 포함', { exact: true }).check();
  await assertGraphParity(page, clusterSnapshot, { flat: true });
  await screenshot(page, 'desktop-topic-region-sds.png', false);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: '주제 지형 전체 보기', exact: true }).click();
  await assertTerrainParity(page, currentSnapshot);
  const overviewSnapshot = await exportSnapshot(page, 'topic-overview-export', currentDate);
  assert.deepEqual(overviewSnapshot.graph, currentSnapshot.graph, 'Returning to the topic overview must reset the region restriction and preserve all source/claim objects');
  const fullGraphRenderStarted = performance.now();
  await page.getByRole('button', { name: '전체 관계 지도', exact: true }).click();
  await expect(page.getByTestId('terrain-overview')).toHaveCount(0);
  await expect(page.locator('.universe-visual')).toHaveAttribute('data-renderer', '3d');
  await expect(page.locator('.graph-stage canvas')).toBeVisible();
  await expect(page.locator('.universe-visual')).toHaveAttribute('data-node-count', String(currentSnapshot.graph.nodes.length));
  const fullGraphRenderMilliseconds = Math.round(performance.now() - fullGraphRenderStarted);
  await assertGraphParity(page, currentSnapshot);
  await assertGraphIndexParity(page, currentSnapshot);
  report.terrain_metrics = {
    environment: 'headless Chromium, 1440x1000, reduced motion, SwiftShader',
    preview: process.env.PREVIEW_URL ? 'provided PREVIEW_URL' : 'local production build via Vite preview',
    preview_url: previewUrl,
    measurement: 'Action to visible renderer/DOM readiness; not FPS, GPU completion, or production load testing',
    overview_to_full_graph_3d_ms: fullGraphRenderMilliseconds,
    overview_to_sds_region_2d_ms: regionRenderMilliseconds,
    full_graph_nodes: currentSnapshot.graph.nodes.length, full_graph_relations: currentSnapshot.graph.relations.length,
    region_nodes: clusterSnapshot.graph.nodes.length, region_relations: clusterSnapshot.graph.relations.length,
  };
  const fittedCamera = await cameraState(page);
  await page.getByRole('button', { name: '그래프 확대', exact: true }).click();
  await expect.poll(async () => (await cameraState(page)).position).not.toEqual(fittedCamera.position);
  const userCamera = await cameraState(page);
  await page.locator('.filter-tabs').getByRole('button', { name: '조직 · 기업', exact: true }).click();
  await expect.poll(async () => Number(await page.locator('.universe-visual').getAttribute('data-node-count'))).toBeLessThan(currentSnapshot.graph.nodes.length);
  assertCameraPreserved(await cameraState(page), userCamera, 'Organization filter');
  await page.locator('.filter-tabs').getByRole('button', { name: '전체', exact: true }).click();
  await expect(page.locator('.universe-visual')).toHaveAttribute('data-node-count', String(currentSnapshot.graph.nodes.length));
  assertCameraPreserved(await cameraState(page), userCamera, 'Restoring the full graph');
  await page.getByLabel('정보 기준일', { exact: true }).fill('2026-09-01');
  await expect.poll(async () => Number(await page.locator('.universe-visual').getAttribute('data-node-count'))).toBeLessThan(currentSnapshot.graph.nodes.length);
  assertCameraPreserved(await cameraState(page), userCamera, 'Historical date');
  await page.getByLabel('정보 기준일', { exact: true }).fill(currentDate);
  await expect(page.locator('.universe-visual')).toHaveAttribute('data-node-count', String(currentSnapshot.graph.nodes.length));
  assertCameraPreserved(await cameraState(page), userCamera, 'Restoring the current date');
  await page.getByRole('button', { name: '그래프 화면 맞춤', exact: true }).click();
  await expect.poll(async () => (await cameraState(page)).position).not.toEqual(userCamera.position);
  assertCameraPreserved(await cameraState(page), fittedCamera, 'Explicit fit restores the full-graph view');
  report.checks.push('A user-zoomed 3D camera retains position, orientation and orbit target across type/date changes; explicit fit alone restores the full-graph view');
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await assertGraphParity(page, currentSnapshot, { flat: true });
  report.checks.push('Topic regions use real graph document/claim/source-group counts; keyboard selection produces the same filtered map, object list and export, and overview/full-map navigation restores all objects');

  for (const title of titles) {
    await navigate(page, title);
    await noHorizontalOverflow(page, `Desktop ${title}`);
  }
  report.checks.push('All desktop navigation screens render without horizontal overflow');

  await navigate(page, '3D Universe');
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await assertGraphParity(page, currentSnapshot, { flat: true });
  const fullGraphViewBox = await page.locator('.graph-stage svg[role="group"]').getAttribute('viewBox');
  await page.locator('.filter-tabs').getByRole('button', { name: '조직 · 기업', exact: true }).click();
  const companySnapshot = await exportSnapshot(page, 'filtered-companies', currentDate);
  assertResearchSnapshot(companySnapshot, researchCatalog.records, currentDate);
  assert.equal(companySnapshot.view.filter, 'company');
  assert.ok(companySnapshot.graph.nodes.length > 0 && companySnapshot.graph.nodes.length < currentSnapshot.graph.nodes.length);
  assert.deepEqual(sorted(companySnapshot.graph.nodes.map(node => node.id)), sorted(currentSnapshot.graph.nodes.filter(node => ['organization', 'company'].includes(node.kind)).map(node => node.id)));
  await assertGraphParity(page, companySnapshot, { flat: true });
  assertStableLayout(currentSnapshot.graph, companySnapshot.graph, 'Company filter');
  assert.equal(await page.locator('.graph-stage svg[role="group"]').getAttribute('viewBox'), fullGraphViewBox, 'Changing a filter must preserve the 2D viewport until explicit fit/navigation');
  await assertGraphIndexParity(page, companySnapshot);
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

  for (const layer of ['entities', 'evidence', 'claims', 'sources']) {
    await page.getByLabel('그래프 레이어', { exact: true }).selectOption(layer);
    const layerSnapshot = await exportSnapshot(page, `layer-${layer}`, currentDate);
    assertResearchSnapshot(layerSnapshot, researchCatalog.records, currentDate);
    assert.equal(layerSnapshot.view.exploration.layer, layer);
    const eligible = currentSnapshot.graph.nodes.filter(node => layer === 'claims' ? node.ontology_type === 'Claim' : layer === 'sources' ? node.ontology_type === 'Source' : layer === 'evidence' ? isEvidenceNode(node) : !isEvidenceNode(node));
    assert.ok(eligible.length > 0);
    assert.deepEqual(sorted(layerSnapshot.graph.nodes.map(node => node.id)), sorted(eligible.map(node => node.id)), 'Layer selection must expose exactly the chosen object kinds');
    const ids = new Set(eligible.map(node => node.id));
    assert.deepEqual(sorted(layerSnapshot.graph.relations.map(relation => relation.id)), sorted(currentSnapshot.graph.relations.filter(relation => ids.has(relation.from) && ids.has(relation.to)).map(relation => relation.id)));
    await assertGraphParity(page, layerSnapshot, { flat: true });
    await assertGraphIndexParity(page, layerSnapshot);
    assertStableLayout(currentSnapshot.graph, layerSnapshot.graph, `${layer} layer`);
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
  report.checks.push('Entity/evidence/claim-only/source-only layers, documented-by relationships and analyst-only connections filter the canonical graph and exported provenance without creating dangling edges');

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
  const preservedViewBox = await pathSvg.getAttribute('viewBox');
  await page.getByRole('button', { name: '그래프 화면 맞춤', exact: true }).click();
  await expect(pathSvg).not.toHaveAttribute('viewBox', preservedViewBox);
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
  assertStableLayout(currentSnapshot.graph, historical.graph, 'Historical replay');
  const comparisonPanel = page.getByTestId('temporal-comparison');
  await page.getByLabel('비교 시작일', { exact: true }).fill('2026-09-01');
  await page.getByLabel('비교 종료일', { exact: true }).fill(currentDate);
  await comparisonPanel.getByRole('button', { name: '두 시점 비교', exact: true }).click();
  await expect(page.getByLabel('정보 기준일', { exact: true })).toHaveValue(currentDate);
  const comparisonSnapshot = await exportSnapshot(page, 'two-date-comparison', currentDate);
  assertResearchSnapshot(comparisonSnapshot, researchCatalog.records, currentDate);
  assertTemporalComparison(comparisonSnapshot.comparison, historical.graph, currentSnapshot.graph, '2026-09-01', currentDate);
  report.time_comparison_metrics = { before: '2026-09-01', after: currentDate, before_nodes: historical.graph.nodes.length, after_nodes: currentSnapshot.graph.nodes.length, new_publications: comparisonSnapshot.comparison.newPublishedSources.length, undated_observations: comparisonSnapshot.comparison.undatedObservedSources.length, newly_visible_relations: comparisonSnapshot.comparison.newlyVisibleRelations.length, newly_visible_claims: comparisonSnapshot.comparison.newlyVisibleClaimIds.length };
  await assertGraphParity(page, currentSnapshot, { flat: true });
  await assertComparisonPanel(page, comparisonSnapshot.comparison, { expandRelations: true });
  const comparisonSource = comparisonSnapshot.comparison.newPublishedSources[0];
  assert.ok(comparisonSource, 'The two-date scenario must contain a published source to trace');
  const comparisonSourceCard = comparisonPanel.locator(`[data-testid="comparison-source"][data-source-id="${comparisonSource.id}"]`);
  await expect(comparisonSourceCard.getByRole('link')).toHaveAttribute('href', comparisonSource.url);
  await comparisonSourceCard.getByRole('button').click();
  await expect(drawer.locator(`.research-source-link[data-source-id="${comparisonSource.id}"]`)).toHaveAttribute('href', comparisonSource.url);
  await page.getByRole('button', { name: '상세 닫기', exact: true }).click();
  const comparisonRelation = comparisonSnapshot.comparison.newlyVisibleRelations[0];
  assert.ok(comparisonRelation, 'The two-date scenario must contain an attributable changed connection');
  await comparisonPanel.locator(`[data-testid="comparison-relation"][data-relation-id="${comparisonRelation.id}"]`).click();
  await expect(drawer).toHaveAttribute('data-relation-id', comparisonRelation.id);
  assert.deepEqual(sorted(await drawer.locator('.research-source-link[data-source-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-source-id')))), sorted(comparisonRelation.source_ids));
  await page.getByRole('button', { name: '상세 닫기', exact: true }).click();
  const pendingComparison = page.waitForEvent('download');
  await comparisonPanel.getByRole('button', { name: '시점 비교 JSON', exact: true }).click();
  const comparisonDownload = await pendingComparison;
  assert.equal(comparisonDownload.suggestedFilename(), `rx-comparison-2026-09-01-${currentDate}.json`);
  const comparisonPath = path.join(output, comparisonDownload.suggestedFilename());
  await comparisonDownload.saveAs(comparisonPath);
  assert.deepEqual(JSON.parse(await readFile(comparisonPath, 'utf8')).comparison, comparisonSnapshot.comparison, 'Comparison download and main snapshot must carry the same two-date result');
  await screenshot(page, 'desktop-time-comparison.png', false);
  await page.getByLabel('주제 구역', { exact: true }).selectOption('sds');
  const regionComparison = await exportSnapshot(page, 'two-date-comparison-sds-region', currentDate);
  assertTemporalComparison(regionComparison.comparison, clusterProjection(historical.graph, 'sds'), clusterProjection(currentSnapshot.graph, 'sds'), '2026-09-01', currentDate, true);
  await assertGraphParity(page, regionComparison, { flat: true });
  // Applying new dates resets the card pagination and retains the region filter on both sides.
  await comparisonPanel.getByRole('button', { name: '두 시점 비교', exact: true }).click();
  await assertComparisonPanel(page, regionComparison.comparison);
  await page.getByRole('button', { name: '탐색 초기화', exact: true }).click();
  await page.getByLabel('비교 시작일', { exact: true }).fill(currentDate);
  await comparisonPanel.getByRole('button', { name: '두 시점 비교', exact: true }).click();
  const sameDateComparison = await exportSnapshot(page, 'same-date-comparison', currentDate);
  assertTemporalComparison(sameDateComparison.comparison, currentSnapshot.graph, currentSnapshot.graph, currentDate, currentDate);
  await assertComparisonPanel(page, sameDateComparison.comparison);
  await page.getByLabel('비교 종료일', { exact: true }).fill('2026-09-01');
  await expect(comparisonPanel.getByRole('button', { name: '두 시점 비교', exact: true })).toBeDisabled();
  await expect(comparisonPanel.locator('.comparison-error')).toContainText('시작일 ≤ 종료일');
  await comparisonPanel.getByRole('button', { name: '비교 닫기', exact: true }).click();
  await page.getByLabel('정보 기준일', { exact: true }).fill('2026-09-01');
  const closedComparison = await exportSnapshot(page, 'comparison-closed-restored-history', '2026-09-01');
  assert.equal(closedComparison.comparison, null);
  assert.deepEqual(closedComparison.graph, historical.graph);
  report.checks.push('Two-date comparison matches independent graph ID differences and publication/observation windows, traces source/relation evidence, preserves region filters, exports identical JSON and refuses reversed dates');
  report.checks.push('Same-date comparison reports zero additions and explicitly leaves claim correction, withdrawal and refutation history unsupported');
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
  await fallback.getByRole('button', { name: '상세 닫기', exact: true }).click();
  await navigate(fallback, '3D Universe', false, { overview: true });
  const fallbackTerrain = await exportSnapshot(fallback, 'fallback-terrain-desktop', currentDate);
  assertSurfaceModel(fallbackTerrain.terrain_surface, fallbackTerrain.graph, currentDate);
  await assertSurfaceRenderer(fallback, fallbackTerrain.terrain_surface, '2d');
  await expect(fallback.getByTestId('terrain-surface')).toContainText('3D를 사용할 수 없어 동일 근거의 등각 지도로 표시합니다.');
  await screenshot(fallback, 'desktop-webgl-unavailable-terrain.png', true);
  await fallback.setViewportSize({ width: 390, height: 844 });
  await assertSurfaceRenderer(fallback, fallbackTerrain.terrain_surface, '2d');
  await assertLandscapeChain(fallback, fallbackTerrain);
  await noHorizontalOverflow(fallback, 'Mobile width WebGL-unavailable terrain');
  await screenshot(fallback, 'mobile-webgl-unavailable-terrain.png', true);
  const fallbackTerrainExport = await exportSnapshot(fallback, 'fallback-terrain-mobile', currentDate);
  assert.deepEqual(fallbackTerrainExport.terrain_surface, fallbackTerrain.terrain_surface, 'WebGL failure and mobile width must not alter the evidence surface');
  report.checks.push('WebGL failure uses the same calculated height field in a true 2D terrain at desktop and mobile widths, preserving full source/claim navigation and every exported contribution');

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
  await navigate(mobile, '3D Universe', true, { overview: true });
  await assertTerrainParity(mobile, currentSnapshot);
  await noHorizontalOverflow(mobile, 'Mobile topic overview');
  await screenshot(mobile, 'mobile-topic-overview.png', false);
  {
    const mobileTerrain = await exportSnapshot(mobile, 'mobile-terrain-current', currentDate);
    assertSurfaceModel(mobileTerrain.terrain_surface, mobileTerrain.graph, currentDate);
    await assertSurfaceRenderer(mobile, mobileTerrain.terrain_surface, '3d');
    await expect(mobile.getByRole('button', { name: '3D 지형', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await noHorizontalOverflow(mobile, 'Mobile actual 3D evidence landscape');
    await screenshot(mobile, 'mobile-3d-evidence-terrain.png', true);
    await assertLandscapeChain(mobile, mobileTerrain);
    await mobile.getByRole('button', { name: '2D 지형', exact: true }).click();
    await assertSurfaceRenderer(mobile, mobileTerrain.terrain_surface, '2d');
    const mobileFlat = await exportSnapshot(mobile, 'mobile-terrain-2d', currentDate);
    assert.deepEqual(mobileFlat.terrain_surface, mobileTerrain.terrain_surface, 'Mobile 2D rendering must preserve the exact same height field and evidence');
    await noHorizontalOverflow(mobile, 'Mobile equivalent 2D evidence landscape');
    await screenshot(mobile, 'mobile-2d-evidence-terrain.png', true);
    await mobile.getByRole('button', { name: '3D 지형', exact: true }).click();
    await assertSurfaceRenderer(mobile, mobileTerrain.terrain_surface, '3d');
    report.checks.push('A WebGL-capable mobile opens the real 3D terrain, follows exact claim-to-source chains, and switches to an equivalent 2D height field without dropping evidence or overflowing');
  }
  {
    await mobile.getByRole('button', { name: '근거의 시간축', exact: true }).click();
    const mobileEvolution = await exportSnapshot(mobile, 'mobile-knowledge-evolution', currentDate);
    assert.deepEqual(mobileEvolution.graph, currentSnapshot.graph);
    assertEvolutionModel(mobileEvolution.knowledge_evolution, mobileEvolution.graph, currentDate);
    await expect(mobile.getByLabel('분포 월', { exact: true })).toBeVisible();
    await expect(mobile.locator('.evolution-desktop')).toBeHidden();
    const sampleMonth = mobileEvolution.knowledge_evolution.months.at(-2) ?? currentDate.slice(0, 7);
    await mobile.getByLabel('분포 월', { exact: true }).selectOption(sampleMonth);
    for (const cumulative of [false, true]) {
      await mobile.getByRole('button', { name: cumulative ? '누적 공개 수' : '월별 공개 수', exact: true }).click();
      for (const metric of ['documents', 'claims', 'sourceGroups']) {
        await mobile.getByLabel('시간 분포 지표', { exact: true }).selectOption(metric);
        await assertEvolutionDisplay(mobile, mobileEvolution.graph, currentDate, metric, cumulative, { mobile: true, month: sampleMonth });
      }
    }
    const mobileTopic = mobileEvolution.knowledge_evolution.topics.find(topic => expectedEvolutionCounts(mobileEvolution.graph, currentDate, { topic: topic.id, month: sampleMonth, cumulative: true }).contributingSourceIds.length > 0);
    assert.ok(mobileTopic);
    await mobile.locator(`button[data-evolution-mobile-topic="${mobileTopic.id}"]`).click();
    const mobileExpected = expectedEvolutionCounts(mobileEvolution.graph, currentDate, { topic: mobileTopic.id, month: sampleMonth, cumulative: true });
    await assertEvolutionDetail(mobile, mobileExpected, 'Mobile cumulative topic');
    const mobileSourceId = mobileExpected.contributingSourceIds[0];
    await mobile.locator(`button[data-evolution-source-id="${mobileSourceId}"]`).click();
    await expect(mobile.locator(`.detail-drawer .research-source-link[data-source-id="${mobileSourceId}"]`)).toHaveAttribute('href', researchCatalog.records.find(record => record.id === mobileSourceId).url);
    await mobile.getByRole('button', { name: '상세 닫기', exact: true }).click();
    const mobileMonthExport = await exportSnapshot(mobile, 'mobile-knowledge-evolution-selected-month', currentDate);
    assert.deepEqual(mobileMonthExport.graph, currentSnapshot.graph, 'Selecting a timeline cell only changes its detail, not the global date or graph');
    await expect(mobile.getByLabel('정보 기준일', { exact: true })).toHaveValue(currentDate);
    await noHorizontalOverflow(mobile, 'Mobile publication timeline');
    await screenshot(mobile, 'mobile-knowledge-evolution.png', true);
    await mobile.getByRole('button', { name: '주제 지도', exact: true }).click();
    await assertTerrainParity(mobile, currentSnapshot);
    report.checks.push('Mobile publication timeline preserves every topic/source ID and all three monthly/cumulative metrics, opens exact source drawers and changes only local month selection without horizontal overflow');
  }
  await mobile.getByTestId('terrain-overview').locator('button[data-region-id="miracom"]').click();
  const mobileRegion = await exportSnapshot(mobile, 'mobile-topic-region', currentDate);
  assert.deepEqual(mobileRegion.graph, clusterProjection(currentSnapshot.graph, 'miracom'));
  await assertGraphParity(mobile, mobileRegion, { flat: true });
  await assertGraphIndexParity(mobile, mobileRegion);
  await mobile.getByRole('button', { name: '주제 지형 전체 보기', exact: true }).click();
  await assertTerrainParity(mobile, currentSnapshot);
  await mobile.getByRole('button', { name: '전체 관계 지도', exact: true }).click();
  await assertGraphParity(mobile, currentSnapshot, { flat: true });
  await assertGraphIndexParity(mobile, currentSnapshot);
  report.checks.push('Mobile topic navigation has the same region membership and source/claim counts, opens the equivalent 2D region and returns to every graph object');
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
  await navigate(mobile, 'Time Machine', true);
  await mobile.getByLabel('비교 시작일', { exact: true }).fill('2026-09-01');
  await mobile.getByLabel('비교 종료일', { exact: true }).fill(currentDate);
  await mobile.getByTestId('temporal-comparison').getByRole('button', { name: '두 시점 비교', exact: true }).click();
  const mobileComparison = await exportSnapshot(mobile, 'mobile-time-comparison', currentDate);
  assertTemporalComparison(mobileComparison.comparison, historical.graph, currentSnapshot.graph, '2026-09-01', currentDate);
  await assertComparisonPanel(mobile, mobileComparison.comparison);
  await assertGraphParity(mobile, currentSnapshot, { flat: true });
  await noHorizontalOverflow(mobile, 'Mobile two-date comparison');
  await screenshot(mobile, 'mobile-time-comparison.png', false);
  await mobile.getByTestId('temporal-comparison').getByRole('button', { name: '비교 닫기', exact: true }).click();
  report.checks.push('Mobile compares the same two snapshots with publication/observation separation and retains all sources in its equivalent 2D graph');
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
