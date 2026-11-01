import { surveyCounts } from './survey';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { researchAt, researchCounts, researchClaims, getRecordClaims, scheduledEventDate, isArchivedOriginal, catalog, type ResearchRecord, type ResearchCatalog } from './research.ts';

// Synthetic chronology fixtures: never mixed into the public research catalog.
const record = (id: string, overrides: Partial<ResearchRecord> = {}): ResearchRecord => ({
  id, title: `Synthetic fixture ${id}`, url: `https://example.test/${id}`, publisher: 'Synthetic publisher',
  published_at: '2026-08-01', event_date: '2026-07-15', source_type: 'official', verification: 'manual_report',
  audit_status: 'unarchived', archive_url: null, content_sha256: null, verification_note: 'Synthetic manual-reading report without archived source bytes',
  scope: 'in_window', entity_ids: ['sds'], origin_key: id, summary_ko: '시간 재현 테스트용 합성 자료', excerpt: 'Synthetic excerpt.',
  claim: { text: 'Synthetic test statement, not a real Samsung event.', kind: 'official_statement' },
  commercialization_stage: 'unassessed', limitations: ['Synthetic test data'], accessed_at: '2026-10-30',
  date_basis: 'page', evidence_locator: 'Synthetic test paragraph', ...overrides,
});
const fixtureCatalog = (records: ResearchRecord[]): ResearchCatalog => ({
  meta: { window_start: '2025-10-30', window_end: '2026-10-30', researched_at: '2026-10-30', coverage_note: 'Synthetic fixture', query_count: 0 },
  records, queries: [],
});

test('as-known replay includes announced future plans but excludes later disclosures and undated pages', () => {
  const input = fixtureCatalog([
    record('known'),
    record('late-disclosure', { published_at: '2026-10-01', event_date: '2026-07-01' }),
    record('future-event', { event_date: '2026-10-20' }),
    record('undated', { published_at: null, event_date: null, date_basis: 'unknown', scope: 'undated' }),
    record('search-result', { verification: 'search_only', date_basis: 'search_index' }),
  ]);
  assert.deepEqual(researchAt('2026-09-01', 'known', input).map(item => item.id), ['known', 'future-event', 'search-result']);
  assert.equal(researchAt('2026-09-01', 'known', input).find(row => row.id === 'search-result')?.verification, 'search_only');
  assert.deepEqual(researchAt('2026-09-01', 'known', input, { occurredOnly: true }).map(row => row.id), ['known', 'search-result']);
});
test('actual March, June and October announcements are known from publication without redating events', () => {
  for (const [id, published, scheduled] of [['mi-015', '2026-03-09', '2026-03-11'], ['tech-012', '2026-06-04', '2026-06-22'], ['mi-011', '2025-10-31', '2025-11-21']]) {
    const current = catalog.records.find(row => row.id === id)!;
    assert.ok(current, `Missing regression record ${id}`);
    assert.equal(current.published_at, published);
    assert.equal(current.event_date, scheduled);
    assert.equal(scheduledEventDate(current), scheduled);
    assert.ok(researchAt(published).some(row => row.id === id), `${id}: publicly announced plan must be visible`);
    assert.ok(!researchAt(published, 'known', catalog, { occurredOnly: true }).some(row => row.id === id));
    const previousDay = new Date(Date.parse(published) - 86400000).toISOString().slice(0, 10);
    assert.ok(!researchAt(previousDay).some(row => row.id === id), `${id}: announcement must not leak before publication`);
  }
});
test('mi-011 remains known on November 10 before its announced webinar date', () => {
  assert.ok(researchAt('2025-11-10').some(row => row.id === 'mi-011'));
  assert.ok(!researchAt('2025-11-10', 'known', catalog, { eventAsOf: '2025-11-10' }).some(row => row.id === 'mi-011'));
});
test('publication cutoff and optional strict event cutoff are independent', () => {
  const input = fixtureCatalog([
    record('announced', { published_at: '2026-03-09', event_date: '2026-03-11' }),
    record('unknown-event', { published_at: '2026-03-09', event_date: null }),
    record('later-publication', { published_at: '2026-03-12', event_date: '2026-03-01' }),
  ]);
  assert.deepEqual(researchAt('2026-03-10', 'known', input).map(row => row.id), ['announced', 'unknown-event']);
  assert.deepEqual(researchAt('2026-03-10', 'known', input, { eventAsOf: '2026-03-11' }).map(row => row.id), ['announced']);
  assert.deepEqual(researchAt('2026-03-10', 'known', input, { eventAsOf: '2026-03-10' }), []);
  for (const invalid of ['', '2026-02-30', 'invalid']) assert.deepEqual(researchAt('2026-03-10', 'known', input, { eventAsOf: invalid }), []);
});
test('retrospective replay admits later disclosure only for an explicitly earlier event', () => {
  const input = fixtureCatalog([
    record('late-disclosure', { published_at: '2026-10-01', event_date: '2026-07-01' }),
    record('unknown-event', { published_at: '2026-10-01', event_date: null }),
  ]);
  assert.deepEqual(researchAt('2026-09-01', 'retro', input).map(item => item.id), ['late-disclosure']);
});
test('invalid calendar dates fail closed and future selection cannot move the research horizon', () => {
  const input = fixtureCatalog([record('future-source', { published_at: '2026-11-01' }), record('known')]);
  for (const invalid of ['not-a-date', '2026-02-30', '2026-9-1', '']) assert.deepEqual(researchAt(invalid, 'known', input), []);
  assert.deepEqual(researchAt('2027-01-01', 'known', input).map(item => item.id), ['known']);
});
test('ten republications retain ten attributions but form one shared source group', () => {
  const rows = Array.from({ length: 10 }, (_, i) => record(`copy-${i}`, { origin_key: 'same-original', verification: i === 0 ? 'manual_report' : 'search_only' }));
  const counts = researchCounts(rows);
  assert.equal(counts.total, 10);
  assert.equal(counts.claims, 10);
  assert.equal(counts.sourceGroups, 1);
  assert.equal(counts.manualReports, 1);
  assert.equal(counts.archivedOriginals, 0);
  assert.equal(counts.primaryRead, 0);
  assert.equal(counts.searchOnly, 9);
});
test('duplicate documents retain distinct claims and entity tags without multiplying source count', () => {
  assert.equal(new Set(catalog.records.map(row => row.id)).size, catalog.records.length);
  const merged = catalog.records.find(row => row.id === 'media-001')!;
  assert.ok(merged.entity_ids.includes('task') && merged.entity_ids.includes('partner'));
  const claims = getRecordClaims(merged);
  assert.ok(claims.some(claim => claim.id === 'claim:media-001'));
  assert.ok(claims.some(claim => claim.id === 'claim:sds-012' && claim.text.includes('인텔리전스와 플릿')));
  const flattened = researchClaims([merged]);
  assert.equal(flattened.length, claims.length);
  assert.ok(flattened.every(claim => claim.source_id === 'media-001' && claim.source_url === merged.url));
  assert.equal(new Set(researchClaims().map(claim => claim.id)).size, researchClaims().length);
  assert.equal(researchCounts().claims, researchClaims().length);
  assert.equal(researchCounts([merged]).total, 1);
  assert.equal(researchCounts([merged]).claims, claims.length);
});
test('current catalog retains provenance fields and cannot promote an attribution to verification', () => {
  for (const row of catalog.records) {
    assert.ok(row.origin_key && row.url && row.evidence_locator);
    assert.ok(['primary_read', 'manual_report', 'search_only', 'access_blocked'].includes(row.verification));
    if (row.verification !== 'primary_read') assert.ok(row.limitations.length > 0);
  }
});

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const builder = join(projectRoot, 'scripts/build-db.py');
function runBuilder(data: ResearchCatalog, args: string[] = []) {
  const directory = mkdtempSync(join(tmpdir(), 'rx-research-test-'));
  const input = join(directory, 'input.json');
  writeFileSync(input, JSON.stringify(data));
  const result = spawnSync('python3', [builder, '--input', input, '--out-dir', directory, ...args], { encoding: 'utf8' });
  return { directory, input, result };
}

test('SQLite export preserves linked attribution, immutable source rows and hash semantics; rebuild is idempotent', () => {
  const first = record('first');
  first.claims = [
    { id: 'claim:first', ...first.claim, origin_record_id: 'first' },
    { id: 'claim:merged-extraction', text: 'Another distinct attributed statement.', kind: 'media_report', origin_record_id: 'merged-extraction', verification: 'search_only', limitations: ['Original extraction was search-only'], evidence_locator: 'Search result excerpt' },
  ];
  const fixture = fixtureCatalog([first, record('second', { origin_key: 'first' })]);
  const { directory, input, result } = runBuilder(fixture);
  try {
    assert.equal(result.status, 0, result.stderr);
    const dbPath = join(directory, 'rx-research.sqlite');
    const firstBytes = readFileSync(dbPath);
    const inspection = spawnSync('python3', ['-c', `
import json, sqlite3, sys
c=sqlite3.connect(sys.argv[1]);c.execute('PRAGMA foreign_keys=ON')
assert c.execute('SELECT count(*) FROM Sources').fetchone()[0] == 2
assert c.execute('SELECT count(*) FROM Claims WHERE editorial_status="source_attributed_not_independently_verified" AND independently_verified=0').fetchone()[0] == 3
assert c.execute('SELECT count(DISTINCT origin_key) FROM Sources').fetchone()[0] == 1
assert c.execute('SELECT count(*) FROM Claims WHERE source_id="first"').fetchone()[0] == 2
assert c.execute('SELECT verification FROM Claims WHERE id="claim:merged-extraction"').fetchone()[0] == 'search_only'
assert c.execute('SELECT count(*) FROM Sources WHERE length(record_sha256)=64 AND captured_source_sha256 IS NULL').fetchone()[0] == 2
assert c.execute('PRAGMA foreign_key_check').fetchall() == []
for sql in ['UPDATE Sources SET title="changed"', 'DELETE FROM Sources', 'UPDATE Claims SET claim_text="changed"', 'DELETE FROM Claims']:
 try:
  c.execute(sql)
  raise AssertionError('Immutable row mutation was accepted')
 except sqlite3.IntegrityError: pass
print('ok')
`, dbPath], { encoding: 'utf8' });
    assert.equal(inspection.status, 0, inspection.stderr);
    const rebuilt = spawnSync('python3', [builder, '--input', input, '--out-dir', directory], { encoding: 'utf8' });
    assert.equal(rebuilt.status, 0, rebuilt.stderr);
    assert.deepEqual(readFileSync(dbPath), firstBytes);
    assert.deepEqual(JSON.parse(readFileSync(join(directory, 'rx-research.json'), 'utf8')), fixture);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('builder rejects duplicate IDs, invented dates, future publications and per-URL overquoting', () => {
  const badInputs = [
    fixtureCatalog([record('same'), record('same')]),
    fixtureCatalog([record('invalid-date', { published_at: '2026-02-30' })]),
    fixtureCatalog([record('future-date', { published_at: '2026-11-01' })]),
    fixtureCatalog([record('a', { excerpt: 'word '.repeat(13), url: 'https://example.test/shared' }), record('b', { excerpt: 'word '.repeat(13), url: 'https://example.test/shared#fragment' })]),
    fixtureCatalog([record('no-date-basis', { date_basis: 'unknown' })]),
    fixtureCatalog([record('empty-claims', { claims: [] })]),
    fixtureCatalog([record('first', { claims: [{ id: 'same-claim-id', text: 'Synthetic test statement, not a real Samsung event.', kind: 'official_statement' }] }), record('second', { claims: [{ id: 'same-claim-id', text: 'Synthetic test statement, not a real Samsung event.', kind: 'official_statement' }] })]),
  ];
  for (const fixture of badInputs) {
    const { directory, result } = runBuilder(fixture, ['--validate-only']);
    try { assert.notEqual(result.status, 0, 'Invalid research input should be rejected'); }
    finally { rmSync(directory, { recursive: true, force: true }); }
  }
});

test('merge algorithm preserves distinct claims and union tags while collapsing repeated extraction text', () => {
  const first = record('alpha', { entity_ids: ['sds'], url: 'https://example.test/same' });
  const second = record('beta', { entity_ids: ['task', 'partner'], url: 'https://www.example.test/same', claim: { text: 'A second, distinct platform architecture claim.', kind: 'official_statement' }, verification: 'search_only' });
  const duplicate = record('gamma', { entity_ids: ['robot'], url: 'https://example.test/same#part' });
  const fixture = JSON.stringify([['first', { records: [first], queries: [] }], ['second', { records: [second, duplicate], queries: [] }]]);
  const result = spawnSync('python3', ['-c', `
import importlib.util, json, sys
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('merge_research', sys.argv[1]); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
rows, queries, duplicates, gaps=module.merge_inventories(json.loads(sys.argv[2]))
print(json.dumps(list(rows.values())))
`, join(projectRoot, 'scripts/merge-research.py'), fixture], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  const rows = JSON.parse(result.stdout) as ResearchRecord[];
  assert.equal(rows.length, 1);
  assert.equal(getRecordClaims(rows[0]).length, 2);
  assert.deepEqual(new Set(rows[0].entity_ids), new Set(['sds', 'task', 'partner', 'robot']));
  assert.ok(getRecordClaims(rows[0]).some(claim => claim.id === 'claim:beta' && claim.verification === 'search_only'));
  assert.equal(rows[0].claim.text, first.claim.text);
});

test('archive evidence is mandatory for primary_read and never inferred from a manual report', () => {
  const manual = record('manual', { previous_verification: 'primary_read' });
  assert.equal(isArchivedOriginal(manual), false);
  assert.equal(researchCounts([manual]).manualReports, 1);
  const archived = record('archived', { verification: 'primary_read', audit_status: 'archived', archive_url: 'https://example.test/archive.bin', content_sha256: 'a'.repeat(64), verification_note: 'Synthetic archive metadata fixture; no live original verified' });
  assert.equal(isArchivedOriginal(archived), true);
  assert.equal(researchCounts([manual, archived]).archivedOriginals, 1);
  const valid = runBuilder(fixtureCatalog([manual, archived]));
  try { assert.equal(valid.result.status, 0, valid.result.stderr); }
  finally { rmSync(valid.directory, { recursive: true, force: true }); }
  for (const invalid of [record('false-primary', { verification: 'primary_read' }), { ...archived, content_sha256: 'not-a-hash' }, { ...archived, archive_url: 'javascript:alert(1)' }, { ...manual, claims: [{ id: 'claim:manual', ...manual.claim, verification: 'primary_read' as const }] }]) {
    const result = runBuilder(fixtureCatalog([invalid]), ['--validate-only']);
    try { assert.notEqual(result.result.status, 0, 'Unarchived or malformed archive must not be classified primary_read'); }
    finally { rmSync(result.directory, { recursive: true, force: true }); }
  }
});

function review(otherId: string, decision: 'shared_origin' | 'distinct_origin', reason?: string) {
  return { reviewed_at: '2026-10-30', decision, basis: decision === 'shared_origin' ? 'same_company_event' as const : 'distinct_report' as const, related_record_ids: decision === 'shared_origin' ? [otherId] : [], source_urls: ['https://example.test/original'], rationale: 'Synthetic review of the specific announcement and source relationship', exceptions: reason ? [{ with_record_id: otherId, reason }] : [] };
}
test('same-day media/official overlap requires reviewed shared grouping or a distinct-report exception', () => {
  const official = record('official');
  const media = record('media', { source_type: 'media' });
  const unreviewed = runBuilder(fixtureCatalog([official, media]), ['--validate-only']);
  try { assert.notEqual(unreviewed.result.status, 0); assert.match(unreviewed.result.stderr, /unreviewed_lineage_collision/); }
  finally { rmSync(unreviewed.directory, { recursive: true, force: true }); }
  for (const rows of [
    [{ ...official, origin_key: 'same-event', lineage_review: review('media', 'shared_origin') }, { ...media, origin_key: 'same-event', lineage_review: review('official', 'shared_origin') }],
    [{ ...official, lineage_review: review('media', 'distinct_origin', 'Same date and robot tag, but one concerns an exhibition and the other a quarterly result') }, media],
  ]) {
    const result = runBuilder(fixtureCatalog(rows));
    try { assert.equal(result.result.status, 0, result.result.stderr); }
    finally { rmSync(result.directory, { recursive: true, force: true }); }
  }
});
test('same-URL date disagreements fail closed, including null, unless an explicit reviewed resolution is retained', () => {
  const source = record('left');
  const inputs = [
    { ...record('right'), published_at: '2026-08-02' },
    { ...record('right'), published_at: null, date_basis: 'unknown', scope: 'undated' },
    { ...record('right'), event_date: '2026-07-16' },
    { ...record('right'), event_date: null },
  ];
  for (const incoming of inputs) {
    const result = spawnSync('python3', ['-c', `
import importlib.util,json,sys
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('rx_merge',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
a,b=json.loads(sys.argv[2]);m.merge_record(a,b)
`, join(projectRoot, 'scripts/merge-research.py'), JSON.stringify([source, incoming])], { encoding: 'utf8', timeout: 10000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /merge_date_conflict/);
  }
  const incoming = { ...record('right'), published_at: null, date_basis: 'unknown', scope: 'undated' };
  const resolved = { ...source, merge_date_resolutions: [{ with_record_id: 'right', field: 'published_at', resolved_value: source.published_at, date_basis: 'page', reviewed_at: '2026-10-30', reason: 'Explicit fixture resolution based on an identified original publication date' }] };
  const result = spawnSync('python3', ['-c', `
import importlib.util,json,sys
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('rx_merge',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
a,b=json.loads(sys.argv[2]);print(json.dumps(m.merge_record(a,b)))
`, join(projectRoot, 'scripts/merge-research.py'), JSON.stringify([resolved, incoming])], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  const merged = JSON.parse(result.stdout);
  assert.equal(merged.published_at, source.published_at);
  assert.equal(merged.merge_conflicts.length, 1);
  assert.equal(merged.merge_conflicts[0].inputs[1].value, null);
  assert.ok(merged.merge_conflicts[0].resolution.reason);
});

test('discovery status counts remain separate from reviewed sources and extracted claims', () => {
  const counts = surveyCounts({ runs: [{ id: 'run', status: 'partial' }], collections: [
    { id: 'ok', publisher: 'Test', status: 'fetched' }, { id: 'blocked', publisher: 'Test', status: 'robots_disallowed' },
  ], candidates: [
    { id: 'candidate', url: 'https://example.test/unreviewed', fetch_status: 'fetched', source_ids: [] },
    { id: 'linked', url: 'https://example.test/reviewed', fetch_status: 'fetched', source_ids: ['first'] },
    { id: 'blocked', url: 'https://example.test/blocked', fetch_status: 'blocked', source_ids: [] },
  ] });
  assert.equal(counts.candidates, 3);
  assert.equal(counts.fetchedCandidates, 2);
  assert.equal(counts.reviewedCandidates, 1);
  assert.equal(counts.unreviewedCandidates, 2);
  assert.equal(counts.linkedSources, 1);
  assert.equal(counts.collectionsFailed, 1);
  assert.equal('claims' in counts, false);
});

test('SQLite survey inventory preserves raw crawl lineage without automatically creating claims', () => {
  const { directory, input } = runBuilder(fixtureCatalog([record('first', { relevance: 'direct_rx' })]));
  try {
    const surveyPath = join(directory, 'survey.json');
    const survey = {
      runs: [{ id: 'run', status: 'partial', request_budget: 10, limits: ['Synthetic budget failure'] }],
      collections: [{ id: 'collection', run_id: 'run', url: 'https://example.test/news', publisher: 'Test', status: 'fetched', pages_visited: ['https://example.test/news'], discovered_urls: ['https://example.test/candidate'] }],
      candidates: [{ id: 'candidate', run_id: 'run', url: 'https://example.test/candidate', fetch_status: 'fetched', source_ids: [], content_sha256: 'a'.repeat(64), notes: ['Fetched candidate has not been reviewed'] }],
    };
    writeFileSync(surveyPath, JSON.stringify(survey));
    const built = spawnSync('python3', [builder, '--input', input, '--out-dir', directory, '--survey', surveyPath], { encoding: 'utf8' });
    assert.equal(built.status, 0, built.stderr);
    const check = spawnSync('python3', ['-c', `
import sqlite3,json,sys
c=sqlite3.connect(sys.argv[1])
assert c.execute('select count(*) from Sources').fetchone()[0]==1
assert c.execute('select count(*) from Claims').fetchone()[0]==1
assert c.execute('select count(*) from CrawlRuns').fetchone()[0]==1
assert c.execute('select count(*) from CoverageCollections').fetchone()[0]==1
assert c.execute('select count(*) from DiscoveryInventory where automatically_verified=0').fetchone()[0]==1
assert c.execute('select relevance from Sources').fetchone()[0]=='direct_rx'
raw=json.loads(c.execute('select raw_candidate_json from DiscoveryInventory').fetchone()[0])
assert raw['source_ids']==[] and raw['notes']==['Fetched candidate has not been reviewed']
assert c.execute('PRAGMA foreign_key_check').fetchall()==[]
`, join(directory, 'rx-research.sqlite')], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr);
    assert.deepEqual(JSON.parse(readFileSync(join(directory, 'rx-survey.json'), 'utf8')), survey);
    writeFileSync(surveyPath, JSON.stringify({ ...survey, candidates: [{ ...survey.candidates[0], claims: [{ text: 'Invented automatic assertion' }] }] }));
    const rejected = spawnSync('python3', [builder, '--input', input, '--out-dir', directory, '--survey', surveyPath], { encoding: 'utf8' });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /candidates cannot contain claims/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('reviewed expansion import deduplicates URLs and preserves claims, remaps graph bindings, and rejects date conflicts atomically', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rx-expansion-test-'));
  try {
    mkdirSync(join(directory, 'research')); mkdirSync(join(directory, 'src'));
    for (const name of ['media', 'sds', 'electronics', 'miracom', 'technical']) writeFileSync(join(directory, 'research', `${name}.json`), JSON.stringify({ records: [], queries: [] }));
    const first = record('first');
    const second = record('second', { url: first.url, entity_ids: ['sds', 'mes'], claim: { kind: 'official_statement', text: 'Second distinct synthetic statement about MES.' } });
    const third = record('third', { url: first.url });
    const expansion = { records: [first, second, third], queries: [], relations: [{ id: 'fixture-edge', from: 'sds', to: 'mes', type: 'mentions', label: 'Synthetic binding', claim_id: 'claim:third', status: 'reported', rationale: 'Explicitly reviewed synthetic source attribution, not real-world knowledge.', from_title: 'Samsung SDS', to_title: 'MES', from_ontology_type: 'Company', to_ontology_type: 'Technology' }], coverage: [] };
    const path = join(directory, 'research', 'expansion-fixture.json');
    writeFileSync(path, JSON.stringify(expansion));
    const importer = join(projectRoot, 'scripts/import-expansion.py');
    const run = () => spawnSync('python3', [importer, '--root', directory, '--input', path], { encoding: 'utf8' });
    const initial = run();
    assert.equal(initial.status, 0, initial.stderr);
    const imported = JSON.parse(readFileSync(join(directory, 'src/research-data.json'), 'utf8')) as ResearchCatalog;
    assert.equal(imported.records.length, 1);
    assert.equal(getRecordClaims(imported.records[0]).length, 2);
    assert.ok(imported.records[0].entity_ids.includes('mes'));
    const bindings = JSON.parse(readFileSync(join(directory, 'src/knowledge-expansion.json'), 'utf8'));
    assert.equal(bindings.relations[0].claim_id, 'claim:first', 'duplicate identical extraction remaps to preserved claim');
    assert.equal(JSON.parse(initial.stdout).source_id_remap.second, 'first');
    const bytes = readFileSync(join(directory, 'src/research-data.json'));
    assert.equal(run().status, 0);
    assert.deepEqual(readFileSync(join(directory, 'src/research-data.json')), bytes, 'reimport is deterministic');
    writeFileSync(path, JSON.stringify({ ...expansion, records: [first, { ...second, published_at: null, date_basis: 'unknown', scope: 'undated' }] }));
    const invalid = run();
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /merge_date_conflict/);
    assert.deepEqual(readFileSync(join(directory, 'src/research-data.json')), bytes, 'failed import does not replace reviewed catalog');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('survey canonical URLs merge repeated crawl runs while preserving collection observations and bounded anchor text', () => {
  const importer = join(projectRoot, 'scripts/import-expansion.py');
  const check = spawnSync('python3', ['-c', `
import runpy,json,sys
m=runpy.run_path(sys.argv[1],run_name='survey_test')
long_title='Headline '+('article body paragraph '*200)
a={'runs':[{'id':'run1','status':'completed'}],'collections':[{'id':'same-collection-url','run_id':'run1','url':'https://example.test/news','publisher':'Test','status':'fetched'}],'candidates':[{'id':'first','run_id':'run1','url':'https://www.example.test/story?utm_source=one','title':long_title,'discovered_at':'2026-10-30','published_at':'2026-10-01','date_basis':'page','fetch_status':'fetched','collection_urls':['https://example.test/news']}]}
b={'runs':[{'id':'run2','status':'partial'}],'collections':[{'id':'same-collection-url','run_id':'run2','url':'https://example.test/news','publisher':'Test','status':'blocked'}],'candidates':[{'id':'second','run_id':'run2','url':'https://example.test/story','title':'Short headline','discovered_at':'2026-10-31','published_at':'2026-10-02','date_basis':'collection','fetch_status':'blocked','collection_urls':['https://example.test/archive']}]}
s=m['merge_survey']([a,b],[])
assert len(s['collections'])==2 and {r['original_id'] for r in s['collections']}=={'same-collection-url'}
assert len(s['candidates'])==1
c=s['candidates'][0]
assert c['run_ids']==['run1','run2'] and len(c['observations'])==2
assert c['source_ids']==[] and c['fetch_status']=='fetched'
assert c['published_at'] is None and c['date_basis']=='unknown' and len(c['date_conflicts'])==2
assert c['title_truncated'] and len(c['title'])<=120 and len(c['title'].split())<=20
assert all(len(r.get('title',''))<=120 and len(r.get('title','').split())<=20 for r in c['observations'])
assert long_title not in json.dumps(s)
assert m['merge_survey']([s,a,b],[])==s
print('ok')
`, importer], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
});

test('explicit planned dates survive ingestion without becoming actual event dates', () => {
  const announced = record('scheduled', { event_date: null, scheduled_event_date: '2026-09-08', published_at: '2026-09-01' });
  const undated = record('undated-schedule', { event_date: null, published_at: null, scheduled_event_date: '2026-05-28', scope: 'undated', date_basis: 'unknown' });
  const { directory, result } = runBuilder(fixtureCatalog([announced, undated]));
  try {
    assert.equal(result.status, 0, result.stderr);
    const exported = JSON.parse(readFileSync(join(directory, 'rx-research.json'), 'utf8')) as ResearchCatalog;
    assert.equal(exported.records[0].event_date, null);
    assert.equal(exported.records[0].scheduled_event_date, '2026-09-08');
    assert.equal(exported.records[1].scheduled_event_date, '2026-05-28');
    assert.equal(scheduledEventDate(announced), '2026-09-08');
    assert.deepEqual(researchAt('2026-09-01', 'known', exported).map(row => row.id), ['scheduled']);
    assert.deepEqual(researchAt('2026-09-30', 'known', exported, { eventAsOf: '2026-09-30' }), []);
    const merger = join(projectRoot, 'scripts/merge-research.py');
    const normalized = spawnSync('python3', ['-c', "import runpy,json,sys;m=runpy.run_path(sys.argv[1]);print(json.dumps(m['normalized_record'](json.load(open(sys.argv[2]))['records'][1])))", merger, join(directory, 'input.json')], { encoding: 'utf8', timeout: 10000 });
    assert.equal(normalized.status, 0, normalized.stderr);
    assert.equal(JSON.parse(normalized.stdout).scheduled_event_date, '2026-05-28');
    assert.equal(JSON.parse(normalized.stdout).event_date, null);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
