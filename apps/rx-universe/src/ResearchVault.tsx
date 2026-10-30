/// <reference types="vite/client" />
import React, { useState } from 'react';
import { ArrowDownToLine, ArrowRight, BookOpen, Database, ExternalLink, Filter, Search, ShieldCheck } from 'lucide-react';
import { catalog, RESEARCH_MAX_DATE, getRecordClaims, scheduledEventDate, type ResearchRecord } from './research';
import './research.css';

export const RESEARCH_DATE = RESEARCH_MAX_DATE;
export const companyNames: Record<string, string> = { se: '삼성전자', sds: '삼성SDS', miracom: '미라콤아이앤씨', rainbow: '레인보우로보틱스', nvidia: 'NVIDIA', samsung: '삼성 관계사', partner: '외부 파트너', sdi: '삼성SDI', display: '삼성디스플레이', semco: '삼성전기', shi: '삼성중공업', etech: 'E Tech Group', kt: 'KT', kuka: 'KUKA', sfa: 'SFA', skt: 'SK Telecom' };
export const sourceTypeNames: Record<string, string> = { official: '공식 발표', media: '언론 보도', paper: '논문', patent: '특허', filing: '공시 · IR', video: '공식 영상', product: '제품 문서' };
export const verificationNames: Record<string, string> = { primary_read: '원문 직접 확인', search_only: '검색 결과만 확인', access_blocked: '원문 접근 차단' };
const claimNames: Record<string, string> = { official_statement: '기관이 발표한 주장', media_report: '언론이 보도한 주장', research_result: '연구 결과 보고', inference: '분석 추론' };
export function sourceText(value: unknown): string { return Array.isArray(value) ? value.map(sourceText).filter(Boolean).join(' · ') : value === null || value === undefined ? '' : String(value); }
export function sourceDate(value: unknown): string { return sourceText(value).slice(0, 10) || '미확인'; }
export function isPrimaryRead(record: ResearchRecord) { return record.verification === 'primary_read'; }
function matchesSearch(record: ResearchRecord, search: string) {
  return [record.title, record.publisher, ...getRecordClaims(record).map(claim => claim.text), record.excerpt, ...record.entity_ids.map(id => companyNames[id] || id)].map(sourceText).join(' ').toLowerCase().includes(search.trim().toLowerCase());
}

export function ResearchSourceList({ records, limit = 4, compact = false }: { records: ResearchRecord[]; limit?: number; compact?: boolean }) {
  const recent = [...records].sort((a, b) => sourceText(b.published_at).localeCompare(sourceText(a.published_at))).slice(0, limit);
  return <div className={`research-source-list ${compact ? 'compact' : ''}`}>
    {recent.map(record => <a className="research-source-link" data-source-id={record.id} href={record.url} key={record.id} target="_blank" rel="noreferrer">
      <div><span className={`research-status ${isPrimaryRead(record) ? 'read' : 'pending'}`}>{verificationNames[record.verification]}</span><time>{sourceDate(record.published_at)}</time></div>
      <strong>{record.title}<ExternalLink size={12}/></strong><small>{record.publisher} · {sourceTypeNames[record.source_type]}</small>
      {!compact && getRecordClaims(record).map(claim => <p key={claim.id} data-claim-id={claim.id}>{claim.text}</p>)}
    </a>)}
    {!recent.length && <p className="research-empty-inline">선택 시점에 해당하는 자료가 없습니다.</p>}
  </div>;
}

export function SourceCard({ record, undated = false, background = false, onExploreSource }: { record: ResearchRecord; undated?: boolean; background?: boolean; onExploreSource?: (id: string) => void }) {
  const direct = isPrimaryRead(record);
  const claims = getRecordClaims(record);
  const scheduled = scheduledEventDate(record);
  return <article className={`research-card ${direct ? 'primary-source' : 'discovery-source'}`} data-source-id={record.id} data-source-scope={record.scope} data-verification={record.verification}>
    <div className="research-card-top"><div><span className={`research-status ${direct ? 'read' : 'pending'}`}>{verificationNames[record.verification]}</span><span className="research-type">{sourceTypeNames[record.source_type]}</span>{undated && <span className="research-status pending">날짜 미확인</span>}{background && <span className="research-status background">기간 밖 배경 자료</span>}</div><span className="research-id">{record.id}</span></div>
    <h3><a href={record.url} target="_blank" rel="noreferrer">{record.title}<ExternalLink size={14}/></a></h3>
    <div className="research-publisher">{record.publisher}<span>·</span>{record.entity_ids.map(id => companyNames[id] || id).join(' / ')}</div>
    {claims.map(claim => <div className="research-claim" key={claim.id} data-claim-id={claim.id}><span>{claimNames[claim.kind]} · {verificationNames[claim.verification ?? record.verification]}</span><p>{claim.text}</p></div>)}
    {sourceText(record.excerpt) && <div className="research-excerpt"><span>{direct ? '짧은 원문 발췌' : '발견된 문구 · 원문 재확인 필요'}</span><blockquote>{sourceText(record.excerpt)}</blockquote></div>}
    <dl className="research-dates"><div><dt>게시일</dt><dd>{sourceDate(record.published_at)}</dd></div><div><dt>{scheduled ? '행사 기준일' : '사건일'}</dt><dd>{sourceDate(record.event_date)}</dd></div><div><dt>확인 · 수집일</dt><dd>{sourceDate(record.accessed_at)}</dd></div>{scheduled && <div data-scheduled-event-date={scheduled}><dt>발표 당시 예정일</dt><dd>{sourceDate(scheduled)}</dd></div>}</dl>
    {scheduled && <p className="research-date-warning">예정일은 발표 당시의 계획입니다. 실제 개최·완료 여부와 구분하며, 이 자료는 게시일부터 조회됩니다.</p>}
    {record.date_basis === 'search_index' && <p className="research-date-warning">게시일은 검색 색인 기준입니다. 원문 본문의 날짜를 추가 확인해야 합니다.</p>}
    <p className="research-limits"><b>판단의 한계</b>{sourceText(record.limitations) || '발표 내용과 실제 운영 성과는 별도로 검증해야 합니다.'}</p>
    <details className="research-details"><summary>근거 위치 · 출처 계보</summary><dl><div><dt>사업화 단계</dt><dd>{record.commercialization_stage}</dd></div><div><dt>자료 요약</dt><dd>{record.summary_ko}</dd></div><div><dt>원문 위치</dt><dd>{sourceText(record.evidence_locator) || '원문 재확인 필요'}</dd></div><div><dt>날짜 근거</dt><dd>{record.date_basis === 'page' ? '공개 페이지에 표시된 날짜 · 근거 위치 참조' : record.date_basis === 'search_index' ? '검색 색인 날짜 · 본문 날짜 재확인 필요' : '게시일 확인 불가'}</dd></div><div><dt>원출처 그룹</dt><dd>{record.origin_key}</dd></div><div><dt>원문 URL</dt><dd><a href={record.url} target="_blank" rel="noreferrer">{record.url}</a></dd></div></dl></details>
    {onExploreSource && <button type="button" className="button" onClick={() => onExploreSource(record.id)}>연결 관계 탐색<ArrowRight size={14}/></button>}
  </article>;
}

export default function ResearchVault({ records, discoveries, date, temporal, search, onSearchChange, onSnapshot, onExploreSource }: { records: ResearchRecord[]; discoveries: ResearchRecord[]; date: string; temporal: string; search: string; onSearchChange: (value: string) => void; onSnapshot: () => void; onExploreSource?: (id: string) => void }) {
  const [company, setCompany] = useState('all');
  const [type, setType] = useState('all');
  const [verification, setVerification] = useState('all');
  const currentDiscoveries = date === RESEARCH_DATE ? discoveries : [];
  const currentBackground = date === RESEARCH_DATE ? catalog.records.filter(record => record.scope === 'out_of_window') : [];
  const allAvailable = [...records, ...currentDiscoveries, ...currentBackground];
  const companies = [...new Set(allAvailable.flatMap(record => record.entity_ids))].filter(id => companyNames[id]).sort();
  const accepts = (record: ResearchRecord) => matchesSearch(record, search) && (company === 'all' || record.entity_ids.includes(company)) && (type === 'all' || record.source_type === type) && (verification === 'all' || record.verification === verification);
  const filtered = [...records].filter(accepts).sort((a, b) => sourceText(b.published_at).localeCompare(sourceText(a.published_at)));
  const primary = filtered.filter(isPrimaryRead);
  const discovery = filtered.filter(record => !isPrimaryRead(record));
  const undated = currentDiscoveries.filter(accepts);
  const background = currentBackground.filter(accepts).sort((a,b) => sourceText(b.published_at).localeCompare(sourceText(a.published_at)));
  const total = filtered.length + undated.length + background.length;
  const baseUrl = import.meta.env.BASE_URL;
  const coverageGaps = Array.isArray(catalog.meta.coverage_gaps) ? catalog.meta.coverage_gaps.map(sourceText) : [];
  return <div className="research-vault">
    <section className="panel research-intro"><div><span className="micro">PUBLIC SOURCE RESEARCH</span><h2>공개자료에서 추적 가능한 판단으로</h2><p>2025.10.30–2026.10.30 자료를 조사한 수동 리서치 스냅샷입니다. <b>원문 확인은 발표 내용의 독립 검증을 뜻하지 않습니다.</b> 검색 결과만 확인한 자료는 별도로 표시합니다.</p></div><div className="research-downloads"><a className="button" href={`${baseUrl}data/rx-research.sqlite`} download><Database size={14}/>전체 SQLite DB</a><a className="button" href={`${baseUrl}data/rx-research.json`} download><ArrowDownToLine size={14}/>전체 조사 JSON</a><button className="button primary" onClick={onSnapshot}><ArrowDownToLine size={14}/>현재 시점 내보내기</button></div></section>
    {date === RESEARCH_DATE && <div className="research-catalog-summary" aria-label="전체 조사 목록"><span>전체 조사 목록<strong>{allAvailable.length}<small>건</small></strong></span><span>조사기간 내<strong>{records.length}</strong></span><span>게시일 미확인<strong>{currentDiscoveries.length}</strong></span><span>기간 밖 배경<strong>{currentBackground.length}</strong></span></div>}
    <div className="research-time-note"><ShieldCheck size={14}/><span>{date} 기준 · {temporal === 'known' ? '당시 공개된 자료의 현재 재구성' : '현재 자료로 과거 사건 재평가'} · 수집일은 2026.10.30에 별도 기록합니다. 자동 갱신 미연결.</span></div>
    <section className="panel research-controls" aria-label="자료 필터"><label className="research-search"><Search size={15}/><input aria-label="자료 검색" placeholder="제목, 발행기관, 주장 검색" value={search} onChange={event => onSearchChange(event.target.value)}/></label><label>법인<select aria-label="법인 필터" value={company} onChange={event => setCompany(event.target.value)}><option value="all">전체 법인</option>{companies.map(id => <option key={id} value={id}>{companyNames[id] || id}</option>)}</select></label><label>자료 유형<select aria-label="자료 유형 필터" value={type} onChange={event => setType(event.target.value)}><option value="all">모든 유형</option>{Object.entries(sourceTypeNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>확인 상태<select aria-label="검증 상태 필터" value={verification} onChange={event => setVerification(event.target.value)}><option value="all">모든 확인 상태</option>{Object.entries(verificationNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button className="button" onClick={() => { setCompany('all'); setType('all'); setVerification('all'); onSearchChange(''); }}><Filter size={14}/>초기화</button></section>
    <div className="research-results" role="status"><span>검색 결과 <b>{total}</b>건</span><span>기간 내 {filtered.length} · 날짜 미확인 {undated.length} · 기간 밖 배경 {background.length}</span></div>
    {primary.length > 0 && <section className="research-group" aria-label="원문 직접 확인 자료"><div className="research-group-heading"><BookOpen size={17}/><h2>원문 직접 확인</h2><span>{primary.length}</span></div><div className="research-card-grid">{primary.map(record => <SourceCard record={record} key={record.id} onExploreSource={onExploreSource}/>)}</div></section>}
    {discovery.length > 0 && <section className="research-group" aria-label="추가 원문 확인 필요 자료"><div className="research-group-heading"><Search size={17}/><h2>추가 원문 확인 필요</h2><span>{discovery.length}</span></div><p className="research-group-note">검색 결과 또는 접근 제한으로 발견한 자료입니다. 원문을 읽은 자료와 동일한 근거 강도로 계산하지 않습니다.</p><div className="research-card-grid">{discovery.map(record => <SourceCard record={record} key={record.id} onExploreSource={onExploreSource}/>)}</div></section>}
    {undated.length > 0 && <section className="research-group" aria-label="게시일 미확인 발견 자료"><div className="research-group-heading"><Database size={17}/><h2>게시일 미확인 · 발견 목록</h2><span>{undated.length}</span></div><p className="research-group-note">자료의 공개 날짜를 확인할 수 없어 과거 시점 재현과 날짜별 집계에서 제외합니다. 현재 조사 목록에서만 제공합니다.</p><div className="research-card-grid">{undated.map(record => <SourceCard record={record} key={record.id} onExploreSource={onExploreSource} undated/>)}</div></section>}
    {background.length > 0 && <section className="research-group research-background" aria-label="조사기간 밖 배경 자료"><div className="research-group-heading"><BookOpen size={17}/><h2>조사기간 밖 · 배경 자료</h2><span>{background.length}</span></div><p className="research-group-note">조직·기술의 선행 맥락을 위해 보관한 자료입니다. 최근 1년 자료 수와 과거 시점 조회에 포함하지 않으며, 현재의 전체 조사 목록에서만 별도로 제공합니다.</p><div className="research-card-grid">{background.map(record => <SourceCard record={record} key={record.id} onExploreSource={onExploreSource} background/>)}</div></section>}
    {!total && <div className="empty panel research-empty"><Database size={32}/><h3>조건에 맞는 공개자료가 없습니다</h3><p>자료의 게시일과 사건일, 검색어와 필터를 확인하세요.<br/>설계 seed의 등록 여부와 공개자료의 시간 범위는 별도로 관리합니다.</p></div>}
    <section className="panel research-coverage"><h2>조사 범위와 남은 공백</h2><p>{catalog.meta.coverage_note}</p>{coverageGaps.length > 0 && <ul>{coverageGaps.map((gap,index) => <li key={`${index}-${gap}`}>{gap}</li>)}</ul>}<p>자료 수는 사업 성과나 조사 완전성의 지표가 아닙니다. 서로 다른 발표도 같은 주장의 독립 증거인지는 별도로 검토합니다.</p></section>
    <p className="research-footnote"><ArrowRight size={13}/>전체 DB 다운로드는 현재 선택 날짜의 제한을 적용하지 않습니다. 시점 제한이 필요한 경우 ‘현재 시점 내보내기’를 사용하세요.</p>
  </div>;
}
