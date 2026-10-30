import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { researchAt, researchCounts, catalog, type ResearchRecord, type ResearchCatalog } from './research.ts';

// Synthetic chronology fixtures: never mixed into the public research catalog.
const record = (id: string, overrides: Partial<ResearchRecord> = {}): ResearchRecord => ({
  id, title: `Synthetic fixture ${id}`, url: `https://example.test/${id}`, publisher: 'Synthetic publisher',
  published_at: '2026-08-01', event_date: '2026-07-15', source_type: 'official', verification: 'primary_read',
  scope: 'in_window', entity_ids: ['sds'], origin_key: id, summary_ko: '시간 재현 테스트용 합성 자료', excerpt: 'Synthetic excerpt.',
  claim: { text: 'Synthetic test statement, not a real Samsung event.', kind: 'official_statement' },
  commercialization_stage: 'unassessed', limitations: ['Synthetic test data'], accessed_at: '2026-10-30',
  date_basis: 'page', evidence_locator: 'Synthetic test paragraph', ...overrides,
});
const fixtureCatalog = (records: ResearchRecord[]): ResearchCatalog => ({
  meta: { window_start: '2025-10-30', window_end: '2026-10-30', researched_at: '2026-10-30', coverage_note: 'Synthetic fixture', query_count: 0 },
  records, queries: [],
});

test('as-known replay excludes later disclosures, future events and undated discovery pages', () => {
  const input = fixtureCatalog([
    record('known'),
    record('late-disclosure', { published_at: '2026-10-01', event_date: '2026-07-01' }),
    record('future-event', { event_date: '2026-10-20' }),
    record('undated', { published_at: null, event_date: null, date_basis: 'unknown', scope: 'undated' }),
    record('search-result', { verification: 'search_only', date_basis: 'search_index' }),
  ]);
  assert.deepEqual(researchAt('2026-09-01', 'known', input).map(item => item.id), ['known', 'search-result']);
  assert.equal(researchAt('2026-09-01', 'known', input)[1].verification, 'search_only');
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
test('ten republications are ten attributed claims but one independent origin', () => {
  const rows = Array.from({ length: 10 }, (_, i) => record(`copy-${i}`, { origin_key: 'same-original', verification: i === 0 ? 'primary_read' : 'search_only' }));
  const counts = researchCounts(rows);
  assert.equal(counts.total, 10);
  assert.equal(counts.claims, 10);
  assert.equal(counts.independentOrigins, 1);
  assert.equal(counts.primaryRead, 1);
  assert.equal(counts.searchOnly, 9);
});
test('current catalog retains provenance fields and cannot promote an attribution to verification', () => {
  for (const row of catalog.records) {
    assert.ok(row.origin_key && row.url && row.evidence_locator);
    assert.ok(['primary_read', 'search_only', 'access_blocked'].includes(row.verification));
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
  const fixture = fixtureCatalog([record('first'), record('second', { origin_key: 'first' })]);
  const { directory, input, result } = runBuilder(fixture);
  try {
    assert.equal(result.status, 0, result.stderr);
    const dbPath = join(directory, 'rx-research.sqlite');
    const firstBytes = readFileSync(dbPath);
    const inspection = spawnSync('python3', ['-c', `
import json, sqlite3, sys
c=sqlite3.connect(sys.argv[1]);c.execute('PRAGMA foreign_keys=ON')
assert c.execute('SELECT count(*) FROM Sources').fetchone()[0] == 2
assert c.execute('SELECT count(*) FROM Claims WHERE editorial_status="source_attributed_not_independently_verified" AND independently_verified=0').fetchone()[0] == 2
assert c.execute('SELECT count(DISTINCT origin_key) FROM Sources').fetchone()[0] == 1
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
  ];
  for (const fixture of badInputs) {
    const { directory, result } = runBuilder(fixture, ['--validate-only']);
    try { assert.notEqual(result.status, 0, 'Invalid research input should be rejected'); }
    finally { rmSync(directory, { recursive: true, force: true }); }
  }
});
