import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { ArrowDownToLine, ArrowUpRight, BookOpen, Check, Clock3, GitCompareArrows, History, MessageSquareText, Save, ShieldCheck } from 'lucide-react';
import { hypothesisAssessments, type HypothesisAssessment, type HypothesisEvidence } from './knowledge';
import { catalog } from './research';
import { appendReview, emptyReviewLog, latestReviews, normalizeReviewMode, parseReviewLog, REVIEW_STORAGE_KEY, reviewTargetKey, type ReviewEvent, type ReviewLog, type ReviewTarget, type ReviewVerdict } from './reviews';
import './analysis.css';

const verdictNames: Record<ReviewVerdict, string> = { undecided: '판단 유보', support: '지지', challenge: '도전 · 반대', context: '맥락' };
const roleNames = { support: '지지 연결', challenge: '도전 연결', context: '맥락 연결' };
const sourceOrigins = new Map(catalog.records.map(record => [record.id, record.origin_key]));
type EvidenceRole = HypothesisEvidence['evidence_role'];
type StorageState = { log: ReviewLog; persistence: 'browser' | 'session' | 'invalid' };

function loadReviews(): StorageState {
  try {
    const result = parseReviewLog(localStorage.getItem(REVIEW_STORAGE_KEY));
    return { log: result.log, persistence: result.invalid ? 'invalid' : 'browser' };
  } catch { return { log: emptyReviewLog(), persistence: 'session' }; }
}
function allEvidence(assessment: HypothesisAssessment): HypothesisEvidence[] {
  return [...assessment.support, ...assessment.challenge, ...assessment.context];
}
function targetFor(hypothesisId: string, evidence: HypothesisEvidence, date: string, mode: string): ReviewTarget {
  return { hypothesis_id: hypothesisId, evidence_id: evidence.id, source_ids: evidence.source_ids, claim_ids: evidence.claim_ids, as_of: date, mode: normalizeReviewMode(mode) };
}
function kstTime(value: string): string {
  return `${new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })} KST`;
}
function ReviewEvidenceCard({ evidence, target, latest, onSave }: {
  evidence: HypothesisEvidence; target: ReviewTarget; latest?: ReviewEvent;
  onSave: (target: ReviewTarget, verdict: ReviewVerdict, reason: string) => string | null;
}) {
  const fieldId = useId();
  const [verdict, setVerdict] = useState<ReviewVerdict>(latest?.verdict ?? 'undecided');
  const [reason, setReason] = useState(latest?.reason ?? '');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => { setVerdict(latest?.verdict ?? 'undecided'); setReason(latest?.reason ?? ''); }, [latest?.id]);
  function submit(event: FormEvent) {
    event.preventDefault();
    const failure = onSave(target, verdict, reason);
    setError(failure ?? '');
    setSaved(!failure);
  }
  return <article className={`aw-evidence aw-role-${evidence.evidence_role}`} data-review-evidence={evidence.id}>
    <div className="aw-evidence-heading"><span className={`aw-role-badge ${evidence.evidence_role}`}>{roleNames[evidence.evidence_role]}</span><span className="aw-source-state">{evidence.verification === 'primary_read' ? '원문 직접 확인' : '원문 추가 확인 필요'}</span></div>
    <p className="aw-claim">{evidence.text}</p>
    <a className="aw-source" href={evidence.url} target="_blank" rel="noreferrer"><BookOpen size={14}/><span>{evidence.publisher} · {evidence.published_at || '게시일 미확인'} · 원문</span><ArrowUpRight size={14}/></a>
    <div className="aw-rationale"><span>분석가의 연결 이유</span><p>{evidence.rationale}</p></div>
    <p className="aw-evidence-limit">출처의 주장과 가설의 연결은 별도입니다. ‘도전’은 직접 반증뿐 아니라 대안 설명·해석의 한계를 포함합니다.</p>
    {latest && <div className="aw-current-review" data-testid="review-current"><div><MessageSquareText size={14}/><b>내 판단: {verdictNames[latest.verdict]}</b><time dateTime={latest.created_at}>{kstTime(latest.created_at)}</time></div><p>{latest.reason}</p></div>}
    <details className="aw-review-editor">
      <summary><MessageSquareText size={14}/>{latest ? '개인 검토 수정' : '개인 검토 작성'}<span>{latest ? '이전 기록 유지' : '사유와 함께 판단 기록'}</span></summary>
      <form onSubmit={submit} noValidate>
        <label htmlFor={`${fieldId}-verdict`}>이 근거가 가설에 미치는 영향<select id={`${fieldId}-verdict`} aria-label="개인 판단" value={verdict} onChange={event => { setVerdict(event.target.value as ReviewVerdict); setSaved(false); }}>{Object.entries(verdictNames).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label htmlFor={`${fieldId}-reason`}>검토 사유 <span>필수 · 근거와 한계</span><textarea id={`${fieldId}-reason`} aria-label="검토 사유" value={reason} onChange={event => { setReason(event.target.value); setError(''); setSaved(false); }} maxLength={2000} required rows={3} placeholder="예: API 표준화 방향은 지지하지만, 그룹 전체의 공통 도입을 입증하지는 않는다." aria-invalid={!!error} aria-describedby={error ? `${fieldId}-error` : undefined}/></label>
        {error && <p className="aw-error" role="alert" id={`${fieldId}-error`}>{error}</p>}
        <div className="aw-save-row"><span>{reason.length.toLocaleString()} / 2,000</span>{saved && <span className="aw-saved" role="status"><Check size={13}/>개인 검토 반영</span>}<button className="button primary" type="submit"><Save size={13}/>개인 검토 저장</button></div>
        <p className="aw-editor-note">개인 메모이며 공동 승인이나 사실 확정이 아닙니다. 수정은 이력에 추가됩니다.</p>
      </form>
    </details>
  </article>;
}

export function HypothesisWorkbench({ date, mode }: { date: string; mode: string }) {
  const replayMode = normalizeReviewMode(mode);
  const assessments = useMemo(() => hypothesisAssessments(date, replayMode), [date, replayMode]);
  const [selectedId, setSelectedId] = useState('platform');
  const [role, setRole] = useState<'all' | EvidenceRole>('all');
  const [storage, setStorage] = useState<StorageState>(loadReviews);
  const [exportStatus, setExportStatus] = useState('');
  const selected = assessments.find(item => item.id === selectedId) ?? assessments[0];
  const current = useMemo(() => latestReviews(storage.log), [storage.log]);
  const visibleTargets = useMemo(() => new Set(assessments.flatMap(assessment => allEvidence(assessment).map(evidence => reviewTargetKey(targetFor(assessment.id, evidence, date, replayMode))))), [assessments, date, replayMode]);
  const visibleHistory = storage.log.events.filter(event => visibleTargets.has(reviewTargetKey(event)));
  const currentReviews = [...current.entries()].filter(([key]) => visibleTargets.has(key)).map(([, event]) => event);

  useEffect(() => {
    function receive(event: StorageEvent) {
      if (event.key !== REVIEW_STORAGE_KEY || storage.persistence !== 'browser') return;
      const result = parseReviewLog(event.newValue);
      if (result.invalid) setStorage(previous => ({ ...previous, persistence: 'invalid' }));
      else setStorage({ log: result.log, persistence: 'browser' });
    }
    window.addEventListener('storage', receive);
    return () => window.removeEventListener('storage', receive);
  }, [storage.persistence]);

  function saveReview(target: ReviewTarget, verdict: ReviewVerdict, reason: string): string | null {
    try {
      let base = storage.log;
      let persistence = storage.persistence;
      if (persistence === 'browser') {
        try {
          const fresh = parseReviewLog(localStorage.getItem(REVIEW_STORAGE_KEY));
          if (fresh.invalid) persistence = 'invalid';
          else base = fresh.log;
        } catch { persistence = 'session'; }
      }
      const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `review-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const log = appendReview(base, target, verdict, reason, new Date().toISOString(), id);
      if (persistence === 'browser') {
        try { localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(log)); } catch { persistence = 'session'; }
      }
      setStorage({ log, persistence });
      setExportStatus('');
      return null;
    } catch (error) { return error instanceof Error ? error.message : '검토를 기록하지 못했습니다.'; }
  }

  function exportReviews() {
    const payload = {
      ...storage.log, events: visibleHistory, exported_at: new Date().toISOString(), as_of: date, mode: replayMode,
      note: '선택 날짜·재현 모드에서 보이는 근거에 대한 개인 검토 이력입니다. 서버 승인·신원 인증·사실 확정 기록이 아닙니다.',
      evidence: assessments.flatMap(assessment => allEvidence(assessment).filter(evidence => current.has(reviewTargetKey(targetFor(assessment.id, evidence, date, replayMode)))).map(evidence => ({ hypothesis_id: assessment.id, evidence_id: evidence.id, source_ids: evidence.source_ids, claim_ids: evidence.claim_ids, url: evidence.url, source_statement: evidence.text, analyst_rationale: evidence.rationale }))),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `rx-personal-reviews-${date}-${replayMode}.json`;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExportStatus(`선택 시점의 개인 검토 이력 ${visibleHistory.length}건을 내보냈습니다.`);
  }

  if (!selected) return <div className="panel aw-empty">선택 시점에 비교할 가설이 없습니다.</div>;
  const evidence = allEvidence(selected);
  const filtered = role === 'all' ? evidence : evidence.filter(item => item.evidence_role === role);
  const originCount = new Set(evidence.flatMap(item => item.source_ids.map(id => sourceOrigins.get(id) || id))).size;
  const selectedHistory = visibleHistory.filter(event => event.hypothesis_id === selected.id);
  return <div className="analysis-workbench" data-testid="hypothesis-workbench">
    <section className="panel aw-intro"><div><span className="micro">HYPOTHESIS WORKBENCH</span><h2>같은 증거, 경쟁하는 설명</h2><p>출처의 주장을 가설에 연결하고, 지지와 도전의 이유를 직접 검토합니다. 연결은 분석가의 해석이며 성공 확률이나 확정 사실이 아닙니다.</p></div><div className="aw-personal"><span><ShieldCheck size={15}/>개인 검토 · 이 브라우저에 저장</span><button className="button" onClick={exportReviews}><ArrowDownToLine size={14}/>개인 검토 JSON</button></div></section>
    <div className="aw-context"><span><Clock3 size={14}/>{date} · {replayMode === 'known' ? '당시 공개 자료 기준' : '현재 근거로 과거 재평가'}</span><span>현재 작성한 개인 메모 · 당시 검토 기록을 재현하는 것은 아닙니다</span></div>
    {storage.persistence !== 'browser' && <p role="alert" className="aw-storage-warning">{storage.persistence === 'invalid' ? '저장된 검토 형식을 읽지 못했습니다. 기존 저장 내용은 덮어쓰지 않으며 새 검토는 현재 세션에만 보관합니다.' : '브라우저 저장을 사용할 수 없어 현재 세션에만 보관합니다.'} 페이지를 닫기 전에 개인 검토 JSON을 내보내세요.</p>}
    {exportStatus && <p className="aw-export-status" role="status">{exportStatus}</p>}
    <div className="aw-hypotheses" aria-label="경쟁 가설 선택">{assessments.map((assessment, index) => <button type="button" className={`aw-hypothesis${assessment.id === selected.id ? ' active' : ''}`} key={assessment.id} aria-pressed={assessment.id === selected.id} onClick={() => { setSelectedId(assessment.id); setRole('all'); }}><span className="aw-hypothesis-number">H0{index + 1}<GitCompareArrows size={16}/></span><strong>{assessment.title}</strong><span className="aw-hypothesis-counts"><span>지지 <b>{assessment.support.length}</b></span><span>도전 <b>{assessment.challenge.length}</b></span><span>맥락 <b>{assessment.context.length}</b></span></span></button>)}</div>
    <section className="panel aw-assessment" aria-label={`${selected.title} 검토`}><div className="aw-assessment-top"><div><span className="micro">ANALYST HYPOTHESIS · 미확정</span><h2>{selected.title}</h2><p>{selected.summary}</p></div><div className="aw-origin-count"><strong>{originCount}</strong><span>연결된 원출처 그룹</span></div></div><div className="aw-next-check"><div><span>결정적 다음 확인</span><p>{selected.next_check}</p></div><div><span>함께 검토할 대안 설명</span><p>{selected.alternative}</p></div></div>{selected.limitations.length > 0 && <details className="aw-limitations"><summary>판단의 한계 · 근거 수를 확률로 읽지 마세요</summary><ul>{selected.limitations.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></details>}</section>
    <div className="aw-evidence-toolbar"><div className="aw-filters" role="group" aria-label="분석가 연결 유형">{([['all', '전체'], ['support', '지지'], ['challenge', '도전'], ['context', '맥락']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={role === value} className={role === value ? 'selected' : ''} onClick={() => setRole(value)}>{label}<span>{value === 'all' ? evidence.length : selected[value].length}</span></button>)}</div><span>분석가 연결 {evidence.length}건 · 내 검토 {currentReviews.filter(event => event.hypothesis_id === selected.id).length}건</span></div>
    {filtered.length ? <div className="aw-evidence-grid">{filtered.map(item => {
      const target = targetFor(selected.id, item, date, replayMode);
      const key = reviewTargetKey(target);
      return <ReviewEvidenceCard key={key} evidence={item} target={target} latest={current.get(key)} onSave={saveReview}/>;
    })}</div> : <div className="panel aw-empty"><BookOpen size={26}/><h3>이 시점에 연결된 {role === 'all' ? '근거' : roleNames[role]}가 없습니다</h3><p>근거가 없다는 사실을 가설의 지지나 반증으로 계산하지 않습니다.</p></div>}
    <details className="panel aw-audit"><summary><History size={16}/>개인 검토 이력<span>{selectedHistory.length}건</span></summary><p className="aw-audit-note">{selected.title} · {date} · 현재 재현 모드의 개인 기록입니다. 인증된 서버 감사 로그가 아니며 브라우저 데이터 삭제 시 사라집니다.</p>{selectedHistory.length ? <ol>{[...selectedHistory].reverse().map(event => <li key={event.id} data-review-event={event.id}><div><b>{event.previous_verdict ? `${verdictNames[event.previous_verdict]} → ` : '첫 검토 · '}{verdictNames[event.verdict]}</b><time dateTime={event.created_at}>{kstTime(event.created_at)}</time></div><p>{event.reason}</p><small>{event.source_ids.join(' · ')} · 개인 검토 · 사실 승격 없음</small></li>)}</ol> : <p className="aw-audit-empty">아직 기록한 개인 검토가 없습니다. 근거 카드에서 사유와 함께 첫 판단을 남기세요.</p>}</details>
  </div>;
}

export default HypothesisWorkbench;
