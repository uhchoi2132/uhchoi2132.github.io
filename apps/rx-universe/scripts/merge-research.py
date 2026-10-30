#!/usr/bin/env python3
"""Merge reviewed source inventories; preserve dated documents and origin lineage."""
import json
from pathlib import Path
from urllib.parse import urlsplit, parse_qsl, urlencode

ROOT = Path(__file__).resolve().parents[1]
FILES = ['media', 'sds', 'electronics', 'miracom', 'technical']

def canonical_url(url):
    parts = urlsplit(url)
    host = parts.netloc.lower().removeprefix('www.')
    return host + parts.path.rstrip('/') + '?' + urlencode(sorted(parse_qsl(parts.query)))

def quality(row):
    return (row['verification'] == 'primary_read', row['published_at'] is not None, row['date_basis'] == 'page')

records, queries, duplicates, raw_gaps = {}, [], [], []
for name in FILES:
    data = json.loads((ROOT / 'research' / f'{name}.json').read_text())
    raw_gaps.extend({'category': name, 'gap': gap} for gap in data.get('coverage_gaps', []))
    for query in data['queries']:
        if isinstance(query, str):
            query = {'query': query, 'category': name}
        queries.append({**query, 'category': query.get('category') or name, 'id': f'query:{len(queries)+1:04d}', 'research_category': name})
    for row in data['records']:
        key = canonical_url(row['url'])
        if key in records:
            previous = records[key]
            chosen, other = (row, previous) if quality(row) > quality(previous) else (previous, row)
            chosen['duplicate_record_ids'] = sorted(set(chosen.get('duplicate_record_ids', []) + [other['id']] + other.get('duplicate_record_ids', [])))
            if chosen['published_at'] == other['published_at']:
                chosen['limitations'] = list(dict.fromkeys(chosen['limitations'] + other['limitations']))
            records[key] = chosen
            duplicates.append({'kept': chosen['id'], 'merged': other['id'], 'reason': 'Same source URL; www and query order normalized'})
        else:
            records[key] = row

gaps = [
    '공식 뉴스룸·IR, 제조 관계사·파트너, 제품 문서, 특허·논문, 현장 보도를 교차 조사했습니다. 검색 색인 누락·삭제·접근 제한이 있어 모든 공개자료의 완전한 전수 확보를 입증하지 못합니다.',
    'RX에 직접 관련된 자료와 역할 경계 판단에 필요한 제조·로봇 인접 자료를 포함했습니다. 삼성 전체 뉴스·재무·특허·논문을 모두 등록한 목록은 아닙니다.',
    '공식 공시 원문 일부를 확인했으나 DART 전체 공시, 특허 전체 패밀리, 채용 공고 변경 이력, 행사 영상 전체를 전수 검토하지 못했습니다.',
    '공통 RX API/SDK 명세, SDS와 미라콤의 Job/Task 책임 경계, 전체 지원 로봇 호환성 표는 확보하지 못했습니다.',
    '로봇 하드웨어 대금 수령과 RX 소프트웨어 반복매출을 구분합니다. 90일 이상 상시 가동·사람 개입률·복구시간·RX SW ARR를 함께 확인하는 운영 근거는 확보하지 못했습니다.',
    '게시일 미확인 자료와 조사기간 이전 배경은 별도 보관합니다. 조회는 공개 시점의 현재 재구성이며 당시 이 서비스가 실제 관측했다는 뜻은 아닙니다.',
    '출처의 주장을 문서별 핵심 항목으로 선별했습니다. 원문 열람은 독립 검증이나 상용화 확정을 의미하지 않으며, 원출처 그룹 수 역시 주장의 독립 증거 수와 같지 않습니다.',
    '원문 전체 파일·영상은 재배포하지 않습니다. 원문 바이트 해시는 미수집(null)이며 DB의 record_sha256은 메타데이터 해시입니다. 원문 이용은 각 출처의 이용약관·저작권을 따릅니다.',
]
catalog = {
    'meta': {
        'window_start': '2025-10-30', 'window_end': '2026-10-30', 'researched_at': '2026-10-30',
        'snapshot_id': 'rx-research-20261030-v1',
        'coverage_note': '2025-10-30~2026-10-30의 삼성 RX 관련 공개자료를 여러 출처군에서 조사한 수동 스냅샷입니다. 검색·원문 확인·출처 계보·상업화 단계와 미확인 영역을 기록했으며, 누락률이나 전수성은 실측하지 않았습니다.',
        'query_count': len(queries), 'coverage_gaps': gaps, 'detailed_coverage_gaps': raw_gaps,
        'deduplicated_inputs': duplicates,
        'automatic_collection_status': 'not_connected', 'last_successful_automated_update': None,
        'publication_policy': 'Source-attributed research; no automatic promotion to independently verified fact',
        'license_status': 'Original source rights retained; short excerpts, metadata and links only',
        'raw_source_capture': 'Not captured; record hashes are not original source hashes',
    },
    'records': sorted(records.values(), key=lambda row: row['id']), 'queries': queries,
}
(ROOT / 'src/research-data.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'sources': len(records), 'queries': len(queries), 'duplicates': duplicates}, ensure_ascii=False))
