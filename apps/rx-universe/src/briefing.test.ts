import test from 'node:test';
import assert from 'node:assert/strict';
import { briefingFor, periodBounds, signalCandidatesFor } from './briefing.ts';
import { catalog, type ResearchCatalog, type ResearchRecord } from './research.ts';

const fixture = (id: string, fields: Partial<ResearchRecord> = {}): ResearchRecord => ({
  id, title: `Synthetic ${id}`, url: `https://example.test/${id}`, publisher: 'Synthetic publisher',
  published_at: '2026-10-29', event_date: null, source_type: 'official', verification: 'manual_report',
  scope: 'in_window', entity_ids: ['sds'], origin_key: `origin:${id}`, summary_ko: 'Synthetic chronology fixture',
  excerpt: 'Synthetic', claim: { text: 'Synthetic attributed statement.', kind: 'official_statement' },
  commercialization_stage: 'unknown', limitations: ['Synthetic source limitation'], accessed_at: '2026-10-30',
  date_basis: 'page', evidence_locator: 'Synthetic paragraph', ...fields,
});
const fixtureCatalog = (records: ResearchRecord[]): ResearchCatalog => ({
  meta: { window_start: '2025-10-30', window_end: '2026-10-30', researched_at: '2026-10-30', coverage_note: 'Synthetic fixture', query_count: 0 },
  records, queries: [],
});

test('catalog briefing periods match an independent publication-date inventory', () => {
  const end = catalog.meta.window_end;
  const starts = { daily: end, weekly: new Date(Date.parse(end) - 6 * 86400000).toISOString().slice(0, 10), monthly: end.slice(0, 7) + '-01' };
  for (const period of ['daily', 'weekly', 'monthly'] as const) {
    const result = briefingFor(end, 'known', period);
    const expected = catalog.records.filter(record => record.scope === 'in_window' && record.date_basis !== 'unknown' && record.published_at && record.published_at >= starts[period] && record.published_at >= catalog.meta.window_start && record.published_at <= end);
    assert.deepEqual(result.withinPeriod.map(record => record.id).sort(), expected.map(record => record.id).sort());
    assert.equal(result.groups.length, new Set(expected.map(record => record.origin_key)).size);
    assert.ok(result.candidates.length <= result.groups.length);
    assert.ok(result.cumulative.length >= result.withinPeriod.length);
  }
});

test('inclusive UTC windows use actual equal-length previous periods across month and year boundaries', () => {
  assert.deepEqual(periodBounds('2026-10-30', 'weekly'), {
    start: '2026-10-24', end: '2026-10-30', previousStart: '2026-10-17', previousEnd: '2026-10-23', days: 7, requestedEnd: '2026-10-30', clamped: false,
  });
  assert.deepEqual(periodBounds('2026-10-30', 'monthly'), {
    start: '2026-10-01', end: '2026-10-30', previousStart: '2026-09-01', previousEnd: '2026-09-30', days: 30, requestedEnd: '2026-10-30', clamped: false,
  });
  const newYear = periodBounds('2026-01-02', 'weekly')!;
  assert.equal(newYear.start, '2025-12-27');
  assert.equal(newYear.previousEnd, '2025-12-26');
  const leapDay = periodBounds('2024-02-29', 'monthly')!;
  assert.equal(leapDay.days, 29);
  assert.equal(leapDay.previousStart, '2024-01-03');
  assert.equal(periodBounds('2026-02-30'), null);
  assert.equal(periodBounds('invalid'), null);
  assert.equal(periodBounds('2027-01-01')!.end, catalog.meta.window_end);
});

test('as-known briefing cannot leak later claims or undated discoveries; published future plans stay announcements', () => {
  const source = fixtureCatalog([
    fixture('old', { published_at: '2026-09-01' }),
    fixture('later', { published_at: '2026-10-29', event_date: '2026-08-01', claim: { text: 'LATER DISCLOSURE', kind: 'official_statement' } }),
    fixture('planned', { published_at: '2026-09-01', scheduled_event_date: '2027-01-01', commercialization_stage: 'announcement' }),
    fixture('undated', { published_at: null, date_basis: 'unknown', scope: 'undated' }),
  ]);
  const known = briefingFor('2026-09-01', 'known', 'daily', source);
  assert.deepEqual(known.withinPeriod.map(record => record.id).sort(), ['old', 'planned']);
  assert.equal(known.unknownPublicationDates.length, 0);
  assert.equal(known.stageCounts.announcement, 1);
  assert.ok(!JSON.stringify(known).includes('LATER DISCLOSURE'));
  const retro = briefingFor('2026-09-01', 'retro', 'daily', source);
  assert.deepEqual(retro.laterDisclosures.map(record => record.id), ['later']);
  assert.ok(!retro.withinPeriod.some(record => record.id === 'later'));
  assert.equal(briefingFor('2026-10-30', 'known', 'daily', source).unknownPublicationDates.length, 1);
});

test('multiple claims survive flattening while reprints remain document counts within one origin group', () => {
  const source = fixtureCatalog([
    fixture('a', { origin_key: 'shared', claims: [
      { id: 'one', text: 'Statement one', kind: 'official_statement' },
      { id: 'two', text: 'Statement two', kind: 'inference' },
    ] }), fixture('b', { origin_key: 'shared', source_type: 'media' }),
    fixture('previous', { published_at: '2026-10-22', origin_key: 'shared' }),
  ]);
  const result = briefingFor('2026-10-30', 'known', 'weekly', source);
  assert.equal(result.withinPeriod.length, 2);
  assert.equal(result.claims.length, 3);
  assert.equal(result.groups.length, 1);
  assert.equal(result.newOriginGroups.length, 0);
  assert.equal(result.previousPeriod.length, 1);
  assert.equal(result.sourceCountDelta, 1);
  assert.equal(result.corrections, 'not_tracked');
  assert.equal(result.withdrawals, 'not_tracked');
  assert.ok(result.claims.every(claim => claim.source_url.startsWith('https://example.test/')));
});

test('candidate has bounded attribution, source-linked limits and no automatic high-impact verification', () => {
  const current = briefingFor('2026-10-30', 'known', 'weekly');
  const sds = current.candidates.find(candidate => candidate.relatedSources.some(source => source.id === 'sds-005'))!;
  assert.ok(sds);
  assert.equal(sds.stage, 'pilot');
  assert.equal(sds.status, 'review_candidate');
  assert.equal(sds.highImpactVerified, false);
  assert.ok(sds.counterevidence.some(item => item.text.includes('유료 상시 가동')));
  assert.ok(sds.counterevidence.every(item => item.url && item.sourceId && item.kind === 'source_limitation'));
  assert.equal(sds.counterevidenceStatus, 'source_limitations_only');
  const kai = briefingFor('2026-08-14', 'known', 'daily').candidates.find(candidate => candidate.source.id === 'tech-017')!;
  assert.ok(kai);
  assert.equal(kai.stage, 'paid');
  assert.match(kai.priorityReason, /2024년/);
  assert.match(kai.priorityReason, /SDS RX SW 신규 수주가 아닙니다/);
  assert.ok(kai.counterevidence.some(item => item.text.includes('반복매출')));
  assert.equal(Object.values(current.stageCounts).reduce((a, b) => a + b, 0), current.withinPeriod.length);
});

test('invalid dates fail closed and missing date fields do not generate events or false coverage', () => {
  const source = fixtureCatalog([fixture('unknown-event'), fixture('bad-date', { published_at: '2026-02-30' })]);
  assert.equal(briefingFor('2026-02-30', 'known', 'daily', source).withinPeriod.length, 0);
  assert.equal(briefingFor('2026-10-30', 'known', 'weekly', source).unknownEventDates[0].event_date, null);
  const early = briefingFor(catalog.meta.window_start, 'known', 'weekly', source);
  assert.equal(early.completePreviousPeriodCoverage, false);
  assert.equal(early.completePeriodCoverage, false);
});

test('candidate detail identities cannot collide with entity ids and source grouping does not multiply candidates', () => {
  const records = [
    fixture('sds', { origin_key: 'shared-origin' }),
    fixture('sds-reprint', { origin_key: 'shared-origin', source_type: 'media' }),
    fixture('job'),
  ];
  const candidates = signalCandidatesFor(records);
  assert.equal(candidates.length, 2);
  assert.equal(new Set(candidates.map(candidate => candidate.id)).size, 2);
  assert.ok(candidates.every(candidate => candidate.id !== candidate.source.id && candidate.id.startsWith('candidate:')));
  const sds = candidates.find(candidate => candidate.id === 'candidate:sds')!;
  assert.equal(sds.source, records[0], 'selection retains the source object used by the card');
  assert.equal(sds.claim.verification, 'manual_report', 'a candidate retains the source audit status without promoting it');
  assert.deepEqual(sds.relatedSources.map(source => source.id), ['sds', 'sds-reprint']);
  assert.deepEqual(signalCandidatesFor([...records].reverse()).map(candidate => candidate.id), candidates.map(candidate => candidate.id));
  assert.ok(candidates.every(candidate => candidate.highImpactVerified === false && candidate.counterevidenceStatus === 'source_limitations_only'));
});
