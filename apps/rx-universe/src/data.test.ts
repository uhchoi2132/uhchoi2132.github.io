import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleAt, independentEvidence, createSnapshot, entities, relations, claims, evidence, signals } from './data.ts';

// Synthetic fixtures for temporal invariants only. Never imported into the UI.
const fixtures = [
  { id: 'public-before', event_time: '2026-08-01', published_at: '2026-08-02', ingested_at: '2026-08-03' },
  { id: 'late-disclosure', event_time: '2026-08-10', published_at: '2026-09-10', ingested_at: '2026-09-11' },
  { id: 'future-event', event_time: '2026-10-01', published_at: '2026-08-20', ingested_at: '2026-08-20' },
  { id: 'cutoff-day', event_time: '2026-09-01T12:00:00Z', published_at: '2026-09-01T21:00:00Z', ingested_at: '2026-09-02' },
];
test('2026-09-01 excludes later disclosures and future events, including the cutoff day', () => {
  assert.deepEqual(visibleAt(fixtures, '2026-09-01').map(item => item.id), ['public-before', 'cutoff-day']);
});
test('retrospective view reveals later evidence about earlier events without admitting future events', () => {
  assert.deepEqual(visibleAt(fixtures, { as_of: '2026-09-01', known_at: '2026-09-01', mode: 'retrospective', retrospective_known_at: '2026-10-28' }).map(item => item.id), ['public-before', 'late-disclosure', 'cutoff-day']);
});
test('system-ingestion replay differs explicitly from publicly-known replay', () => {
  assert.deepEqual(visibleAt(fixtures, { as_of: '2026-09-01', known_at: '2026-09-01', require_ingested: true }).map(item => item.id), ['public-before']);
});
test('a later retraction does not leak into an earlier knowledge snapshot', () => {
  const corrected = [{ id: 'old-claim', event_time: '2026-08-01', published_at: '2026-08-02', valid_to: '2026-08-15', invalidated_at: '2026-09-10' }];
  assert.equal(visibleAt(corrected, '2026-09-01').length, 1);
  assert.equal(visibleAt(corrected, { as_of: '2026-09-01', known_at: '2026-09-20' }).length, 0);
});
test('ten republications count as one independent original source', () => {
  const copies = Array.from({ length: 10 }, (_, index) => ({ id: `copy-${index}`, origin_id: 'original-report' }));
  assert.equal(independentEvidence(copies).length, 1);
  assert.equal(independentEvidence([...copies, { id: 'independent-report', origin_id: 'second-origin' }]).length, 2);
});
test('seed graph never invents collected evidence or verified claims', () => {
  assert.equal(claims.length, 0);
  assert.equal(evidence.length, 0);
  assert.ok(relations.every(item => item.inferred && item.evidence_ids.length === 0));
  assert.ok(signals.every(item => item.status === 'watching' && item.source === null && item.impact_level === 'unassessed'));
  assert.notEqual(entities.find(item => item.id === 'se')?.id, entities.find(item => item.id === 'sds')?.id);
});
test('snapshot removes future seed nodes and dangling relations; zero news is a valid snapshot', () => {
  const past = createSnapshot({ as_of: '2026-09-01', known_at: '2026-09-01' });
  assert.equal(past.entities.length, 0);
  assert.equal(past.relations.length, 0);
  assert.equal(past.claims.length, 0);
  assert.equal(past.last_successful_update, null);
  const current = createSnapshot();
  const ids = new Set(current.entities.map(item => item.id));
  assert.ok(current.relations.every(item => ids.has(item.from) && ids.has(item.to)));
});
test('invalid dates, missing provenance and ambiguous retrospective cutoff fail explicitly', () => {
  assert.throws(() => visibleAt(fixtures, 'invalid'));
  assert.throws(() => independentEvidence([{ id: 'bad', origin_id: '' }]));
  assert.throws(() => visibleAt(fixtures, { as_of: '2026-09-01', known_at: '2026-09-01', mode: 'retrospective' }));
});
