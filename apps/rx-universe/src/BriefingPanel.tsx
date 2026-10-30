import React, { useMemo, useState } from 'react';
import { ArrowDownToLine, CalendarDays, ExternalLink, FileText, GitCompareArrows, SearchCheck } from 'lucide-react';
import { briefingFor, periodLabels, stageLabels, type BriefingPeriod, type BriefingResult, type SignalCandidate } from './briefing';
import { getRecordClaims, type ResearchMode, type ResearchRecord } from './research';
import './briefing.css';

const claimLabels: Record<string, string> = { official_statement: '기관 발표', media_report: '언론 보도', research_result: '연구 결과 보고', inference: '분석 · 전망' };
const verificationLabels: Record<string, string> = { primary_read: '원문 직접 확인', search_only: '검색 결과만 확인', access_blocked: '원문 접근 제한' };
function SourceLink({ source, children }: { source: ResearchRecord; children?: React.ReactNode }) {
  return <a href={source.url} target="_blank" rel="noreferrer">{children ?? source.publisher}<ExternalLink size={11}/></a>;
}
function SourceChange({ source }: { source: ResearchRecord }) {
  return <article className="brief-source-change" data-brief-source={source.id}>
    <div className="brief-source-meta"><time dateTime={source.published_at ?? undefined}>{source.published_at ?? '게시일 미확인'}</time><span>{verificationLabels[source.verification]}</span></div>
    <h4><SourceLink source={source}>{source.title}</SourceLink></h4>
    {getRecordClaims(source).map(claim => <p key={claim.id}><span className="brief-claim-kind">{claimLabels[claim.kind]}</span>{claim.text}</p>)}
    <small>사건일 {source.event_date ?? '미확인'}{source.scheduled_event_date ? ` · 예정 사건일 ${source.scheduled_event_date}` : ''} · {source.publisher}</small>
  </article>;
}
export function SignalCandidates({ candidates: providedCandidates, date, mode = 'known', period = 'weekly', limit = 4 }: { candidates?: SignalCandidate[]; date?: string; mode?: ResearchMode; period?: BriefingPeriod; limit?: number }) {
  const candidates = useMemo(() => providedCandidates ?? (date ? briefingFor(date, mode, period).candidates : []), [providedCandidates, date, mode, period]);
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? candidates : candidates.slice(0, limit);
  return <section className="brief-candidates" aria-label="문서 변화 검토 후보">
    <div className="brief-section-title"><SearchCheck size={17}/><h3>문서 변화 검토 후보</h3><span>표시 {visible.length} / 전체 {candidates.length}개 출처 그룹</span></div>
    <p className="brief-explanation">공개문서의 변화를 검토할 후보입니다. 우선순위는 성공 확률이나 검증된 고영향 신호를 뜻하지 않습니다.</p>
    {!visible.length && <p className="brief-empty-small">이 기간에 새로 공개된 문서가 없어 검토 후보를 만들지 않았습니다.</p>}
    <div className="brief-candidate-grid">{visible.map(candidate => <article className="brief-candidate" key={candidate.id} data-candidate-id={candidate.id}>
      <div className="brief-candidate-tags"><span>{candidate.priority === 'review' ? '우선 검토' : '후속 관찰'}</span><span>{stageLabels[candidate.stage]}</span><span>검증 전 후보</span></div>
      <h4>{candidate.claim.text}</h4><p className="brief-priority-reason">{candidate.priorityReason}</p>
      <dl><div><dt>반증 검토 · 원문이 밝힌 한계</dt><dd>{candidate.counterevidence.length ? <ul>{candidate.counterevidence.slice(0, 3).map((item, i) => <li key={`${item.sourceId}-${i}`}><a href={item.url} target="_blank" rel="noreferrer">{item.text}<ExternalLink size={10}/></a></li>)}</ul> : '별도 반증 자료를 확보하지 못했습니다.'}<span className="brief-counter-note">한계 문구는 독립된 반대 증거와 구분합니다. 독립 반증 자료 확인은 남아 있습니다.</span></dd></div><div><dt>다음 확인 지표</dt><dd>{candidate.nextCheck}</dd></div></dl>
      <div className="brief-candidate-source"><SourceLink source={candidate.source}/><time>{candidate.source.published_at}</time><span>{verificationLabels[candidate.source.verification]}</span></div>
      {candidate.relatedSources.length > 1 && <details className="brief-related"><summary>같은 출처 계보의 문서 {candidate.relatedSources.length}건</summary>{candidate.relatedSources.map(source => <div key={source.id}><SourceLink source={source}>{source.title}</SourceLink></div>)}</details>}
    </article>)}</div>
    {candidates.length > limit && <button className="button brief-expand" type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '후보 접기' : `후보 ${candidates.length}개 모두 보기`}</button>}
  </section>;
}
export function RecentChanges({ briefing, limit = 4 }: { briefing: BriefingResult; limit?: number }) {
  return <section className="brief-changes" aria-label="기간 신규 공개자료">
    <div className="brief-section-title"><CalendarDays size={17}/><h3>기간 내 새로 공개된 문서</h3><span>{briefing.withinPeriod.length}건</span></div>
    {briefing.withinPeriod.slice(0, limit).map(source => <SourceChange key={source.id} source={source}/>)}
    {!briefing.withinPeriod.length && <div className="brief-empty" role="status"><b>새 공개자료 0건</b><p>등록된 조사 자료 중 이 기간에 새로 공개된 문서가 없습니다. 신규 0건도 정상적인 브리핑 결과입니다.</p><small>실시간 전수 모니터링 결과가 아닌 수동 조사 목록의 기간별 조회입니다.</small></div>}
  </section>;
}
function downloadBriefing(result: BriefingResult) {
  const url = URL.createObjectURL(new Blob([JSON.stringify({
    title: 'SAMSUNG RX 기간 브리핑', ...result, generated_at: new Date().toISOString(),
    collection_status: 'manual_research_snapshot', correction_detection: 'not_tracked',
    note: '출처 그룹은 독립 사건 수가 아니며 단계별 문서 수는 사업 실적이 아닙니다.',
  }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = `rx-briefing-${result.period}-${result.bounds?.end ?? 'invalid'}.json`;
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function BriefingPanel({ date, mode }: { date: string; mode: ResearchMode }) {
  const [period, setPeriod] = useState<BriefingPeriod>('daily');
  const [showAll, setShowAll] = useState(false);
  const result = useMemo(() => briefingFor(date, mode, period), [date, mode, period]);
  const { bounds } = result;
  if (!bounds) return <div className="panel brief-empty" role="status">올바른 기준일을 선택하면 기간별 브리핑을 볼 수 있습니다.</div>;
  const retrospective = mode === 'retro' || mode === 'retrospective';
  return <div className="period-briefing" data-testid="period-briefing" data-period={period}>
    <div className="briefing-toolbar"><div className="segmented" role="group" aria-label="브리핑 기간">{(['daily', 'weekly', 'monthly'] as const).map(value => <button type="button" key={value} className={value === period ? 'selected' : ''} aria-pressed={value === period} onClick={() => { setPeriod(value); setShowAll(false); }}>{periodLabels[value]}</button>)}</div><div className="brief-export-actions"><button className="button" type="button" onClick={() => downloadBriefing(result)}><ArrowDownToLine size={14}/>기간 JSON</button><button className="button" type="button" onClick={() => window.print()}><FileText size={14}/>인쇄 / PDF</button></div></div>
    <article className="panel period-brief-article">
      <header className="period-brief-header"><span className="micro">RX INTELLIGENCE / {period.toUpperCase()} BRIEFING</span><h2>{periodLabels[period]} 신규 공개자료 <strong data-testid="brief-new-count">{result.withinPeriod.length}건</strong></h2><p className="brief-window" data-testid="brief-window"><time>{bounds.start}</time> — <time>{bounds.end}</time><span>양끝 날짜 포함 · {bounds.days}일</span></p><p className="brief-explanation">{retrospective ? '현재 조사자료로 과거 사건을 재평가합니다. 기간 신규 집계는 해당 기간의 게시일을 기준으로 합니다.' : '선택일까지 공개된 자료만 사용합니다. 발표된 미래 계획은 예정 상태를 유지합니다.'}</p></header>
      <div className="brief-metrics" aria-label="기간 및 누적 집계"><div><span>기간 신규 문서</span><strong>{result.withinPeriod.length}</strong></div><div><span>기간 출처 귀속 주장</span><strong>{result.claims.length}</strong></div><div><span>기간 원출처 그룹</span><strong>{result.groups.length}</strong></div><div><span>{retrospective ? '과거 사건 관련 자료' : '기준일까지 누적 문서'}</span><strong>{result.cumulative.length}</strong></div></div>
      <p className="brief-explanation">원출처 그룹은 재인용을 묶은 자료 계보입니다. 서로 독립적인 사건이나 독립 검증의 개수를 뜻하지 않습니다.</p>
      <section className="brief-comparison" aria-label="이전 동일 길이 기간 비교"><div className="brief-section-title"><GitCompareArrows size={17}/><h3>직전 {bounds.days}일과 비교</h3></div><p>{bounds.previousStart} — {bounds.previousEnd} <b>{result.previousPeriod.length}건</b> → 이번 기간 <b>{result.withinPeriod.length}건</b><span className="brief-delta">문서 수 차이 {result.sourceCountDelta > 0 ? '+' : ''}{result.sourceCountDelta}</span></p><p className="brief-explanation">이번 기간 문서 {result.sourceAdditions.length}건 · 이전 공개자료에 없던 출처 그룹 {result.newOriginGroups.length}개. 수동 목록의 게시일로 비교하며 수집 시점의 추가 탐지·내용 정정·철회 이력은 추적하지 않습니다.</p>{(!result.completePeriodCoverage || !result.completePreviousPeriodCoverage) && <p className="brief-data-warning">비교 기간 일부가 조사 시작일 이전입니다. 두 기간의 자료 수를 같은 조사 범위로 해석할 수 없습니다.</p>}{bounds.clamped && <p className="brief-data-warning">선택일이 조사 범위를 넘어 마지막 조사 기준일 {bounds.end}로 제한했습니다.</p>}</section>
      <section className="brief-stage-section" aria-label="자료의 사업화 단계별 문서 수"><h3>문서에 기록된 사업화 단계</h3><div className="brief-stage-counts">{Object.entries(stageLabels).map(([key, label]) => <span key={key}>{label}<b>{result.stageCounts[key as keyof typeof result.stageCounts]}</b></span>)}</div><p className="brief-explanation">단계별 수치는 문서 분류이며 고객 수·계약 수·매출·가동 실적이 아닙니다. 유료 계약·현장 적용 언급도 개별 원문과 한계를 확인해야 합니다.</p></section>
      <RecentChanges briefing={result} limit={showAll ? result.withinPeriod.length : 4}/>
      {result.withinPeriod.length > 4 && <button className="button brief-expand" type="button" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>{showAll ? '신규 문서 접기' : `신규 문서 ${result.withinPeriod.length}건 모두 보기`}</button>}
      <SignalCandidates key={`${period}-${date}-${mode}`} candidates={result.candidates}/>
      <section className="brief-date-caveats" aria-label="날짜와 정보의 한계"><h3>날짜와 확인 범위</h3><p>기간 내 사건일 미확인 문서 {result.unknownEventDates.length}건은 게시일로 분류했습니다. 사건 발생일을 대신 생성하지 않습니다.</p>{result.laterDisclosures.length > 0 && <p>선택일 이후 공개된 과거 사건 자료 {result.laterDisclosures.length}건은 누적 재평가에만 포함되며 위 기간 신규 집계에서는 제외됩니다.</p>}{result.unknownPublicationDates.length > 0 ? <details><summary>현재 목록의 게시일 미확인 자료 {result.unknownPublicationDates.length}건 · 기간 집계 제외</summary><p>공개 시점을 확정할 수 없어 과거 판단 재현과 기간별 변화에 포함하지 않았습니다.</p>{result.unknownPublicationDates.map(source => <div key={source.id}><SourceLink source={source}>{source.title}</SourceLink></div>)}</details> : <p>게시일 미확인 발견 목록은 현재 조사 시점에서만 별도로 제공합니다.</p>}</section>
      <footer className="brief-operating-note">수동 조사일 {result.observedAt} · 자동 수집·08:00 게시 미연결 · 마지막 자동 성공 업데이트 없음<br/>원문 직접 확인은 발표된 주장의 독립 검증을 의미하지 않습니다. 삼성전자·삼성SDS와 로봇 하드웨어·RX 소프트웨어 실적을 각각 구분합니다.</footer>
    </article>
  </div>;
}
