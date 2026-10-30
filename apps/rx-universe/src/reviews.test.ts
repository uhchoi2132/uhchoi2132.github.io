import test from 'node:test';
import assert from 'node:assert/strict';
import { appendReview, emptyReviewLog, latestReviews, parseReviewLog, reviewTargetKey, type ReviewTarget } from './reviews.ts';

const target: ReviewTarget = { hypothesis_id: 'platform', evidence_id: 'fixture-evidence', source_ids: ['fixture-source'], claim_ids: ['fixture-claim'], as_of: '2026-09-01', mode: 'known' };
const recordedAt = '2026-10-30T12:00:00.000Z';

test('personal decisions require a reason and cannot carry a verified verdict', () => {
  assert.throws(() => appendReview(emptyReviewLog(), target, 'support', '  ', recordedAt, 'one'), /사유/);
  assert.throws(() => appendReview(emptyReviewLog(), target, 'verified' as never, 'Reason', recordedAt, 'one'));
  assert.throws(() => appendReview(emptyReviewLog(), { ...target, as_of: '2026-02-30' }, 'support', 'Reason', recordedAt, 'one'));
});
test('revision appends history and preserves both prior decision and the research target', () => {
  const before = JSON.stringify(target);
  const first = appendReview(emptyReviewLog(), target, 'support', 'Source supports the bounded statement.', recordedAt, 'one');
  const second = appendReview(first, target, 'challenge', 'Additional limitations change my assessment.', recordedAt, 'two');
  assert.equal(first.events.length, 1);
  assert.equal(second.events.length, 2);
  assert.equal(second.events[1].previous_verdict, 'support');
  assert.equal(second.events[0].verdict, 'support');
  assert.equal(latestReviews(second).get(reviewTargetKey(target))?.verdict, 'challenge');
  assert.equal(JSON.stringify(target), before);
  assert.ok(second.events.every(event => event.fact_promotion === false && event.actor === 'local_browser_user'));
});
test('serialization roundtrip retains decisions and audit history after reload', () => {
  const log = appendReview(emptyReviewLog(), target, 'context', 'Context does not resolve the hypothesis.', recordedAt, 'one');
  const restored = parseReviewLog(JSON.stringify(log));
  assert.equal(restored.invalid, false);
  assert.deepEqual(restored.log, log);
});
test('date and retrospective mode isolate notes from earlier as-known replay', () => {
  const log = appendReview(emptyReviewLog(), target, 'support', 'Date-specific review.', recordedAt, 'one');
  const latest = latestReviews(log);
  assert.equal(latest.get(reviewTargetKey({ ...target, as_of: '2026-08-01' })), undefined);
  assert.equal(latest.get(reviewTargetKey({ ...target, mode: 'retro' })), undefined);
});
test('corrupt storage, duplicate IDs and forged fact promotion are rejected', () => {
  const log = appendReview(emptyReviewLog(), target, 'undecided', 'Evidence is insufficient.', recordedAt, 'one');
  assert.equal(parseReviewLog('not json').invalid, true);
  assert.equal(parseReviewLog(JSON.stringify({ ...log, events: [{ ...log.events[0], fact_promotion: true }] })).invalid, true);
  assert.equal(parseReviewLog(JSON.stringify({ ...log, events: [log.events[0], log.events[0]] })).invalid, true);
  assert.equal(parseReviewLog(JSON.stringify({ ...log, events: [{ ...log.events[0], previous_verdict: 'support' }] })).invalid, true);
  assert.throws(() => appendReview(log, target, 'context', 'Another reason', recordedAt, 'one'));
  assert.deepEqual(parseReviewLog(null), { log: emptyReviewLog(), invalid: false });
});
