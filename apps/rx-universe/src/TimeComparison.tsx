import React, { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Clock3, ExternalLink } from 'lucide-react';
import { catalog, type ResearchMode } from './research';
import type { TemporalComparison } from './temporal-comparison';
import './comparison.css';

interface Props {
  date: string; startDate: string | null; mode: ResearchMode; comparison: TemporalComparison | null;
  onCompare: (before: string, after: string) => void; onClear: () => void;
  onSource: (id: string) => void; onRelation: (id: string) => void;
}
export default function TimeComparison({ date, startDate, mode, comparison, onCompare, onClear, onSource, onRelation }: Props) {
  const [before, setBefore] = useState(startDate || '2026-09-01');
  const [after, setAfter] = useState(date);
  const [limit, setLimit] = useState(40);
  useEffect(() => { setAfter(date); setLimit(40); }, [date]);
  useEffect(() => { if (startDate) setBefore(startDate); }, [startDate]);
  const inputValid = !!before && !!after && before <= after && after <= catalog.meta.window_end && before >= '2025-10-01';
  function download() {
    if (!comparison?.valid) return;
    const blob = new Blob([JSON.stringify({ title: 'Samsung RX · 두 시점 공개정보 비교', comparison }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `rx-comparison-${comparison.before.date}-${comparison.after.date}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="panel time-comparison" data-testid="temporal-comparison">
    <div className="panel-head"><div><Clock3 size={17}/><h2>두 시점 사이에 무엇이 공개됐나</h2></div><span className="tag">PUBLICATION / OBSERVATION</span></div>
    <p className="comparison-intro">동일한 검색·주제 구역·관계 필터로 두 날짜를 비교합니다. 비교 종료일은 아래 지도와 상단 정보 기준일에 적용됩니다.</p>
    <form className="comparison-controls" onSubmit={event => { event.preventDefault(); if (inputValid) { setLimit(40); onCompare(before, after); } }}>
      <label>이전 정보 기준일<input aria-label="비교 시작일" type="date" min="2025-10-01" max={catalog.meta.window_end} value={before} onChange={event => setBefore(event.target.value)}/></label><ArrowRight size={16}/>
      <label>이후 정보 기준일<input aria-label="비교 종료일" type="date" min="2025-10-01" max={catalog.meta.window_end} value={after} onChange={event => setAfter(event.target.value)}/></label>
      <button className="button primary" disabled={!inputValid} type="submit">두 시점 비교</button>
      {comparison && <button className="button" type="button" onClick={onClear}>비교 닫기</button>}
      {comparison?.valid && <button className="button" type="button" onClick={download}><ArrowDownToLine size={14}/>시점 비교 JSON</button>}
    </form>
    {!inputValid && <p className="comparison-error" role="status">조사 범위 안에서 시작일 ≤ 종료일로 선택하세요.</p>}
    {comparison && !comparison.valid && <p className="comparison-error" role="alert">{comparison.errorMessage}</p>}
    {comparison?.valid && <>
      <p className="comparison-period" role="status">{comparison.before.date} → {comparison.after.date} · {mode === 'known' || mode === 'as-known-at' ? 'As-known-at' : 'Retrospective'} · 현재 카탈로그에서 재구성한 공개정보</p>
      <div className="comparison-metrics">
        <div data-testid="comparison-published-count"><span>기간 중 공개 문서</span><b>{comparison.newPublishedSources.length}</b><small>게시일 기준 · 미래 계획 포함</small></div>
        <div data-testid="comparison-observed-count"><span>날짜 미상 신규 관측</span><b>{comparison.undatedObservedSources.length}</b><small>수집일 기준 · 공개일 미확인</small></div>
        <div data-testid="comparison-relations-count"><span>이후 화면에 추가된 연결</span><b>{comparison.newlyVisibleRelations.length}</b><small>관계 발생일·계약 성립 수 아님</small></div>
        <div data-testid="comparison-claims-count"><span>이후 화면에 추가된 주장</span><b>{comparison.newlyVisibleClaimIds.length}</b><small>새 주장 노드 · 내용 수정과 구분</small></div>
      </div>
      <div className="comparison-columns"><section><h3>새 공개 근거 <span>{comparison.newPublishedSources.length}</span></h3><div className="comparison-sources">{comparison.newPublishedSources.map(source => <article key={source.id} data-testid="comparison-source" data-source-id={source.id}><time>{source.published_at}</time><button onClick={() => onSource(source.id)}>{source.title}</button><small>{source.publisher} · {source.verification}</small><a href={source.url} target="_blank" rel="noreferrer" aria-label={`${source.title} 원문`}>원문<ExternalLink size={11}/></a></article>)}{!comparison.newPublishedSources.length && <p>해당 공개일 구간에 추가된 문서가 없습니다.</p>}</div></section>
      <section><h3>새로 보이는 연결 <span>{comparison.newlyVisibleRelations.length}</span></h3><div className="comparison-relations">{comparison.newlyVisibleRelations.slice(0, limit).map(relation => <button key={relation.id} data-testid="comparison-relation" data-relation-id={relation.id} onClick={() => onRelation(relation.id)}><b>{relation.label}</b><span>{comparison.after.graph.nodes.find(node => node.id === relation.from)?.title} → {comparison.after.graph.nodes.find(node => node.id === relation.to)?.title}</span><small>{relation.inferred ? '분석 연결' : '출처 귀속'} · {relation.source_ids.length}개 원문 · {relation.published_at || '게시일 미상'}</small></button>)}{!comparison.newlyVisibleRelations.length && <p>현재 날짜와 필터에서 추가된 연결이 없습니다.</p>}</div>{limit < comparison.newlyVisibleRelations.length && <button className="button" onClick={() => setLimit(limit + 40)}>연결 더 보기</button>}</section></div>
      <details className="comparison-observations"><summary>게시일 미상 관측 자료 {comparison.undatedObservedSources.length}건 · 공개 문서 수와 분리</summary>{comparison.undatedObservedSources.map(source => <p key={source.id} data-testid="comparison-observed-source" data-source-id={source.id}><time>{source.accessed_at.slice(0, 10)}</time><button onClick={() => onSource(source.id)}>{source.title}</button></p>)}</details>
      <p className="comparison-note">이후 화면에서 제외된 노드 {comparison.noLongerVisibleNodes.length}개·연결 {comparison.noLongerVisibleRelations.length}개는 날짜와 필터의 차이입니다. 사업 관계 종료나 주장 철회로 판정하지 않습니다.</p>
      <details className="comparison-limits"><summary>주장 수정·철회·반박 이력 비교는 지원하지 않습니다</summary><p>개별 주장 버전과 정정·철회 이력이 없어 변경 건수를 만들지 않습니다. 가설에 대한 분석가의 반대 연결도 주장의 반증 완료로 집계하지 않습니다.</p>{comparison.semantics.limitations.map(text => <p key={text}>{text}</p>)}</details>
    </>}
  </section>;
}
