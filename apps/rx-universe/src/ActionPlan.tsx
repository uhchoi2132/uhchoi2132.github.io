import React from 'react';
import { ArrowDownToLine, CheckCircle2, Circle, ListChecks } from 'lucide-react';
import plan from '../docs/action-items.json';
import './improvements.css';

export default function ActionPlan() {
  const completed = plan.items.filter(item => String(item.status) === 'completed').length;
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'rx-action-items.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="action-plan">
    <section className="panel improvement-intro"><div><span className="micro">CONTINUOUS IMPROVEMENT / ITERATION 01</span><h2>검증 가능한 작업으로 개선합니다</h2><p>발견한 결함, 인수 기준, 후속 작업을 기록합니다. 자료 조회에서 관계 근거와 판단 기록까지 연결하는 첫 개선 차수입니다.</p></div><button className="button" onClick={download}><ArrowDownToLine size={14}/>실행 항목 JSON</button></section>
    <div className="action-summary"><ListChecks size={18}/><span>전체 {plan.items.length}개 · 완료 {completed}개 · 진행·계획 {plan.items.length - completed}개</span><small>기준: {plan.updated_at} · v{plan.version}</small></div>
    <div className="action-grid">{plan.items.map(item => <article className="panel action-card" key={item.id} data-action-id={item.id}>
      <div className="action-meta"><span>{item.id} · {item.priority}</span><span className={String(item.status) === 'completed' ? 'action-done' : 'action-pending'}>{String(item.status) === 'completed' ? <CheckCircle2 size={14}/> : <Circle size={14}/>} {String(item.status) === 'completed' ? '완료' : item.status === 'in_progress' ? '진행 중' : '후속 계획'}</span></div>
      <h3>{item.title}</h3><ul>{item.acceptance.map(criterion => <li key={criterion}>{criterion}</li>)}</ul><p className="action-dependencies">선행 작업: {item.dependencies.join(', ') || '없음'}</p>
    </article>)}</div>
    <section className="panel improvement-intro"><div><h2>검증 기록</h2><p>단위 테스트 {plan.validation.unit_tests_passed}개 · 브라우저 시나리오 {plan.validation.browser_scenarios_passed}개 통과. <a href={plan.validation.run_url} target="_blank" rel="noreferrer">기능 인수 검증 결과 ↗</a></p><p>배포 전 데이터·시간·관계·브리핑 테스트와 데스크톱·모바일 브라우저 검증을 실행합니다. 서버 공동 검토, 자동 수집과 AI 모델은 후속 계획 항목입니다.</p><a href="https://github.com/uhchoi2132/uhchoi2132.github.io/actions/workflows/rx-universe.yml" target="_blank" rel="noreferrer">공개 빌드·브라우저 검증 이력 ↗</a></div></section>
  </div>;
}
