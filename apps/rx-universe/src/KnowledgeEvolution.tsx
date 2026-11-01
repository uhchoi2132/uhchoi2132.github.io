import { useId, useMemo, useState } from 'react';
import { ArrowRight, CalendarDays, FileText, Layers3 } from 'lucide-react';
import type { KnowledgeCluster, KnowledgeGraph } from './knowledge';
import { knowledgeEvolution, type EvolutionCounts } from './knowledge-evolution';
import { catalog } from './research';
import './evolution.css';

export interface KnowledgeEvolutionProps {
  graph: KnowledgeGraph;
  knownAt: string;
  onSource: (id: string) => void;
  onOpenDate: (date: string) => void;
}

type Metric = 'documents' | 'claims' | 'sourceGroups';
const metricLabels: Record<Metric, string> = { documents: '문서', claims: '주장', sourceGroups: '출처군' };
const metricFields = { documents: 'documentCount', claims: 'claimCount', sourceGroups: 'sourceGroupCount' } as const;
const emptyCounts: EvolutionCounts = { documentCount: 0, claimCount: 0, sourceGroupCount: 0, documentIds: [], claimIds: [], sourceGroupKeys: [], contributingSourceIds: [] };
const format = (value: number) => value.toLocaleString('ko-KR');
const ids = (counts: EvolutionCounts) => ({
  'data-document-ids': JSON.stringify(counts.documentIds),
  'data-claim-ids': JSON.stringify(counts.claimIds),
  'data-source-group-keys': JSON.stringify(counts.sourceGroupKeys),
  'data-contributing-source-ids': JSON.stringify(counts.contributingSourceIds),
});

export function KnowledgeEvolution({ graph, knownAt, onSource, onOpenDate }: KnowledgeEvolutionProps) {
  const model = useMemo(() => knowledgeEvolution(graph, knownAt), [graph, knownAt]);
  const id = useId().replace(/:/g, '');
  const [metric, setMetric] = useState<Metric>('documents');
  const [cumulative, setCumulative] = useState(false);
  const [selection, setSelection] = useState<{ topic: KnowledgeCluster; month: string; undated: boolean }>({ topic: 'electronics', month: '', undated: false });
  const month = model.months.includes(selection.month) ? selection.month : model.months.at(-1) ?? '';
  const topic = model.topics.find(item => item.id === selection.topic) ?? model.topics[0];
  const monthData = topic?.months.find(item => item.month === month);
  const selected = selection.undated ? topic?.undated ?? emptyCounts : (cumulative ? monthData?.cumulative : monthData) ?? emptyCounts;
  const maxCount = Math.max(1, ...model.topics.flatMap(item => item.months.map(bucket => (cumulative ? bucket.cumulative : bucket)[metricFields[metric]])));
  const modeLabel = cumulative ? '누적' : '월별';
  const records = useMemo(() => new Map(catalog.records.map(record => [record.id, record])), []);
  const sourceNodes = useMemo(() => new Map(graph.nodes.filter(node => node.ontology_type === 'Source').map(node => [node.id.replace(/^source:/, ''), node])), [graph]);
  const sources = selected.contributingSourceIds.map(sourceId => {
    const record = records.get(sourceId);
    const node = sourceNodes.get(sourceId);
    return { id: sourceId, title: record?.title ?? node?.title ?? sourceId, publisher: record?.publisher ?? '등록 원문', date: record ? record.published_at : node?.published_at ?? null };
  }).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.title.localeCompare(b.title, 'ko'));
  const choose = (topicId: KnowledgeCluster, monthId: string, undated = false) => setSelection({ topic: topicId, month: monthId, undated });
  const cutoff = monthData?.to && monthData.to <= knownAt ? monthData.to : null;
  const heat = (value: number) => value === 0 ? 0 : Math.max(1, Math.ceil(value / maxCount * 4));
  const range = monthData ? `${cumulative ? model.window.from : monthData.from} — ${monthData.to}` : '';

  return <section className="knowledge-evolution" data-testid="knowledge-evolution" aria-labelledby={`${id}-title`}
    data-known-at={knownAt} data-evolution-metric={metric} data-evolution-mode={cumulative ? 'cumulative' : 'monthly'}>
    <header className="evolution-heading">
      <div><p className="evolution-eyebrow"><CalendarDays size={12}/>PUBLICATION TIMELINE</p><h2 id={`${id}-title`}>공개자료의 시간 흐름</h2><p>현재 선택한 그래프의 자료를 게시일에 따라 살펴봅니다.</p></div>
      <div className="evolution-controls">
        <label className="evolution-metric-label"><span>집계 지표</span><select aria-label="시간 분포 지표" value={metric} onChange={event => setMetric(event.target.value as Metric)}><option value="documents">문서</option><option value="claims">주장</option><option value="sourceGroups">출처군</option></select></label>
        <div className="evolution-mode" role="group" aria-label="시간 분포 집계 방식"><button aria-label="월별 공개 수" aria-pressed={!cumulative} onClick={() => setCumulative(false)}>월별</button><button aria-label="누적 공개 수" aria-pressed={cumulative} onClick={() => setCumulative(true)}>누적</button></div>
      </div>
    </header>

    {!model.valid ? <p className="evolution-invalid" role="status">{model.errorMessage || '유효한 조회 날짜를 선택해 주세요.'}</p> : <>
      <div className="evolution-chart-meta"><span>{model.window.from} — {model.window.to}<small>{modeLabel} {metricLabels[metric]} 수</small></span><span className="evolution-heat-key">적음 <i/><i/><i/><i/> 많음</span></div>
      {!graph.nodes.some(node => node.ontology_type === 'Source' || node.ontology_type === 'Claim') && <p className="evolution-layer-notice" data-testid="evolution-layer-empty" role="status">현재 보기에는 집계할 문서·주장이 표시되지 않습니다. 전체 또는 원문·주장 레이어를 선택해 공개 시점을 살펴보세요. 이 수치가 근거의 부재를 뜻하지는 않습니다.</p>}
      {model.scope.documentIds.length === 0 && model.scope.claimIds.length > 0 && <p className="evolution-layer-notice" data-testid="evolution-claims-only">현재는 주장만 표시되어 문서·출처군 수가 0입니다. 지표를 ‘주장’으로 바꾸면 분포를 볼 수 있으며, 아래에서 연결 원문도 확인할 수 있습니다.</p>}
      <div className="evolution-desktop">
        <table className="evolution-matrix"><caption>주제별 {modeLabel} 공개 {metricLabels[metric]} 수. 숫자를 선택하면 연결 원문을 확인합니다.</caption><colgroup><col className="evolution-topic-column"/>{model.months.map(value => <col key={value}/>)}</colgroup>
          <thead><tr><th scope="col">주제 구역</th>{model.months.map(value => <th scope="col" key={value} className={month === value && !selection.undated ? 'is-active-month' : ''}>{value.slice(2).replace('-', '.')}</th>)}</tr></thead>
          <tbody>{model.topics.map(item => <tr key={item.id}><th scope="row"><span>{item.label.split(' · ')[0]}</span><small>{item.label.split(' · ').slice(1).join(' · ')}</small></th>{item.months.map(bucket => {
            const counts = cumulative ? bucket.cumulative : bucket;
            const value = counts[metricFields[metric]];
            const active = topic?.id === item.id && month === bucket.month && !selection.undated;
            return <td key={bucket.month}><button className={`evolution-cell heat-${heat(value)}${active ? ' is-selected' : ''}`} aria-pressed={active}
              aria-label={`${item.label} ${bucket.month} ${modeLabel} ${metricLabels[metric]} ${value}건`}
              data-evolution-topic={item.id} data-evolution-month={bucket.month} data-evolution-count={value} {...ids(counts)}
              onClick={() => choose(item.id, bucket.month)}>{format(value)}</button></td>;
          })}</tr>)}</tbody>
        </table>
      </div>

      <div className="evolution-mobile">
        <label className="evolution-month-label">살펴볼 월<select aria-label="분포 월" value={month} onChange={event => choose(topic?.id ?? 'electronics', event.target.value)}>{model.months.map(value => <option key={value} value={value}>{value.replace('-', '년 ')}월</option>)}</select></label>
        <div className="evolution-topic-cards">{model.topics.map(item => {
          const bucket = item.months.find(value => value.month === month);
          const counts = (cumulative ? bucket?.cumulative : bucket) ?? emptyCounts;
          const value = counts[metricFields[metric]];
          return <button key={item.id} className={topic?.id === item.id && !selection.undated ? 'is-selected' : ''}
            aria-label={`${item.label} ${month} ${modeLabel} ${metricLabels[metric]} ${value}건`}
            aria-pressed={topic?.id === item.id && !selection.undated} data-evolution-mobile-topic={item.id} data-evolution-month={month} data-evolution-count={value} {...ids(counts)}
            onClick={() => choose(item.id, month)}><span><b>{item.label.split(' · ')[0]}</b><small>{item.label.split(' · ').slice(1).join(' · ')}</small></span><span className="evolution-mobile-count">{format(value)}<small>{metricLabels[metric]}</small></span><ArrowRight size={13}/></button>;
        })}</div>
      </div>

      <p className="evolution-zero-note">0은 선택한 지표·기간에 집계된 등록 자료가 없다는 뜻이며, 실제 활동이 없었다는 뜻은 아닙니다.</p>
      <div className="evolution-undated"><div><Layers3 size={13}/><span>게시일 미상<small>월별·누적 집계에서 분리</small></span></div><div className="evolution-undated-topics">{model.topics.map(item => <button key={item.id} className={selection.undated && topic?.id === item.id ? 'is-selected' : ''}
        aria-label={`${item.label} 게시일 미상 ${metricLabels[metric]} ${item.undated[metricFields[metric]]}건`}
        aria-pressed={selection.undated && topic?.id === item.id} data-evolution-undated={item.id} data-evolution-count={item.undated[metricFields[metric]]} {...ids(item.undated)}
        onClick={() => choose(item.id, month, true)}><span>{item.label.split(' · ')[0]}</span><b>{format(item.undated[metricFields[metric]])}</b></button>)}</div></div>

      <section className="evolution-detail" data-testid="evolution-detail" data-evolution-topic={topic?.id} data-evolution-month={selection.undated ? 'undated' : month} {...ids(selected)} aria-labelledby={`${id}-detail-title`}>
        <div className="evolution-detail-heading"><div><p>{selection.undated ? '게시일 미상 · 현재 관측 자료' : `${range} · ${modeLabel}`}</p><h3 id={`${id}-detail-title`}>{topic?.label ?? '주제 구역'}<span>연결 원문 {format(sources.length)}건</span></h3></div>
          {!selection.undated && cutoff && <button className="evolution-date-button" data-testid="evolution-open-date" data-cutoff-date={cutoff} onClick={() => onOpenDate(cutoff)}><CalendarDays size={13}/>이 날짜의 지형 보기<ArrowRight size={13}/></button>}
        </div>
        <p className="evolution-detail-guide">문서 수는 현재 표시된 문서만 셉니다. 주장만 표시한 경우에도 연결 원문을 확인할 수 있습니다.</p>
        <div className="evolution-source-list">{sources.map(source => <button key={source.id} className="evolution-source" data-evolution-source-id={source.id} onClick={() => onSource(source.id)}>
          <FileText size={15}/><span><b>{source.title}</b><small>{source.publisher}<span>·</span>{source.date ?? '게시일 미상'}<span className="evolution-source-kind">{selected.documentIds.includes(source.id) ? '표시 문서' : '주장 연결 원문'}</span></small></span><ArrowRight size={13}/>
        </button>)}{!sources.length && <p className="evolution-source-empty">이 구간과 연결된 등록 원문이 없습니다. 다른 월이나 주제를 선택해 보세요.</p>}</div>
      </section>
      <footer className="evolution-footnote"><p>색의 진하기는 선택한 지표의 자료 수입니다. 출처군은 같은 발표·원작을 묶은 수로, 독립 검증 횟수가 아닙니다.</p><p>이 화면은 현재 선택한 그래프의 게시일 분포입니다. 과거 관심도·확신도·주장 수정 이력이나 당시 저장된 스냅샷을 재현하지 않습니다.</p></footer>
    </>}
  </section>;
}

export default KnowledgeEvolution;
