#!/usr/bin/env python3
"""Merge reviewed source inventories; preserve dated documents and origin lineage."""
import json
from datetime import date
from itertools import combinations
from pathlib import Path
from urllib.parse import urlsplit, parse_qsl, urlencode, quote
import re

ROOT = Path(__file__).resolve().parents[1]
FILES = ['media', 'sds', 'electronics', 'miracom', 'technical']

def canonical_url(url):
    parts = urlsplit(url)
    host = parts.netloc.lower().removeprefix('www.')
    path = quote(parts.path, safe="/%:@!$&'()*+,;=-._~")
    path = re.sub(r'%[a-fA-F0-9]{2}', lambda match: match.group().upper(), path)
    query = [(key, value) for key, value in parse_qsl(parts.query) if not key.lower().startswith('utm_') and key.lower() not in {'fbclid', 'gclid'}]
    return host + path.rstrip('/') + '?' + urlencode(sorted(query))

def quality(row):
    return ({'primary_read': 3, 'manual_report': 2, 'search_only': 1, 'access_blocked': 0}.get(row['verification'], -1), row['published_at'] is not None, row['date_basis'] == 'page')

def record_ids(row):
    return {row['id'], *row.get('duplicate_record_ids', [])}

def lineage_reviews(row):
    reviews = list(row.get('lineage_reviews', []))
    if row.get('lineage_review'):
        reviews.append({'source_record_id': row['id'], **row['lineage_review']})
    return list({json.dumps(review, sort_keys=True): review for review in reviews}.values())

def validate_lineage(rows):
    """Candidate collisions require review; shared entities never imply shared evidence."""
    known_ids = set().union(*(record_ids(row) for row in rows)) if rows else set()
    for row in rows:
        for review in lineage_reviews(row):
            if review.get('decision') not in {'shared_origin', 'distinct_origin', 'unresolved'}:
                raise ValueError(f"lineage_review_invalid: {row['id']} decision")
            if review.get('basis') not in {'same_document', 'same_company_event', 'republication', 'distinct_original_work', 'distinct_report', 'unresolved'}:
                raise ValueError(f"lineage_review_invalid: {row['id']} basis")
            if not isinstance(review.get('rationale'), str) or not review['rationale'].strip():
                raise ValueError(f"lineage_review_invalid: {row['id']} requires rationale")
            date.fromisoformat(review.get('reviewed_at', ''))
            for field in ('related_record_ids', 'source_urls', 'exceptions'):
                if not isinstance(review.get(field), list):
                    raise ValueError(f"lineage_review_invalid: {row['id']} {field} must be array")
            if any(not isinstance(item, str) or item not in known_ids for item in review['related_record_ids']):
                raise ValueError(f"lineage_review_invalid: {row['id']} unknown related record ID")
            if review.get('review_method') is not None and review['review_method'] not in {'source_text_review', 'inventory_evidence_review', 'metadata_only'}:
                raise ValueError(f"lineage_review_invalid: {row['id']} review_method")
            for url in review['source_urls'] + ([review['document_origin_url']] if review.get('document_origin_url') else []):
                if not isinstance(url, str):
                    raise ValueError(f"lineage_review_invalid: {row['id']} source URL must be string")
                parsed = urlsplit(url)
                if parsed.scheme not in {'http', 'https'} or not parsed.netloc or parsed.username or parsed.password:
                    raise ValueError(f"lineage_review_invalid: {row['id']} source URL")
            for exception in review['exceptions']:
                if not isinstance(exception, dict) or exception.get('with_record_id') not in known_ids or not isinstance(exception.get('reason'), str) or not exception['reason'].strip():
                    raise ValueError(f"lineage_review_invalid: {row['id']} empty distinct-report exception")
    resolved = []
    for left, right in combinations(rows, 2):
        if not left.get('published_at') or left['published_at'] != right.get('published_at'):
            continue
        if {left.get('source_type'), right.get('source_type')} != {'media', 'official'}:
            continue
        overlap = sorted(set(left.get('entity_ids', [])) & set(right.get('entity_ids', [])))
        if not overlap:
            continue
        left_reviews, right_reviews = lineage_reviews(left), lineage_reviews(right)
        same_group = left.get('origin_key') == right.get('origin_key')
        def linked(reviews, other):
            return any(review['decision'] == 'shared_origin' and set(review['related_record_ids']) & record_ids(other) for review in reviews)
        def exception(reviews, other):
            return next((entry['reason'] for review in reviews if review['decision'] != 'unresolved' for entry in review['exceptions'] if entry['with_record_id'] in record_ids(other)), None)
        reason = exception(left_reviews, right) or exception(right_reviews, left)
        if same_group and linked(left_reviews, right) and linked(right_reviews, left):
            decision = 'reviewed_shared_origin'
        elif not same_group and reason:
            decision = 'reviewed_distinct_report'
        else:
            raise ValueError(f"unreviewed_lineage_collision: {left['id']} / {right['id']} published={left['published_at']} entities={overlap}; record shared origin review or a reasoned distinct-report exception")
        resolved.append({'record_ids': [left['id'], right['id']], 'published_at': left['published_at'], 'overlap_entities': overlap, 'decision': decision, 'exception_reason': reason})
    return resolved

def resolve_date_conflict(previous, incoming, field):
    left, right = previous.get(field), incoming.get(field)
    if left == right:
        return None
    resolutions = []
    for owner, other in ((previous, incoming), (incoming, previous)):
        for entry in owner.get('merge_date_resolutions', []):
            if entry.get('field') == field and entry.get('with_record_id') in record_ids(other):
                if not isinstance(entry.get('reason'), str) or not entry['reason'].strip():
                    raise ValueError(f"merge_date_conflict: {field} resolution requires reason")
                date.fromisoformat(entry.get('reviewed_at', ''))
                if 'resolved_value' not in entry or entry['resolved_value'] not in (left, right):
                    raise ValueError(f"merge_date_conflict: {field} resolved_value must be one of the explicitly reviewed inputs")
                if field == 'published_at' and entry['resolved_value'] is not None and entry.get('date_basis') not in {'page', 'search_index'}:
                    raise ValueError('merge_date_conflict: publication resolution requires date_basis')
                resolutions.append({'review_record_id': owner['id'], **entry})
    if not resolutions or len({entry['resolved_value'] for entry in resolutions}) != 1:
        raise ValueError(f"merge_date_conflict: {previous['id']} / {incoming['id']} {field} values={left!r},{right!r}; null is unknown, not permission to select another date silently")
    return {'field': field, 'inputs': [{'record_id': previous['id'], 'value': left}, {'record_id': incoming['id'], 'value': right}], 'resolved_value': resolutions[0]['resolved_value'], 'resolution': resolutions[0]}

def record_claims(row):
    candidates = row.get('claims') or [{
        **row['claim'], 'id': f"claim:{row['id']}", 'origin_record_id': row['id'],
        'verification': row['verification'], 'evidence_locator': row['evidence_locator'],
        'limitations': list(row['limitations']),
    }]
    return [dict(claim) for claim in candidates]

def distinct_claims(*groups):
    result, seen = [], set()
    for group in groups:
        for claim in group:
            key = (claim['kind'], ' '.join(claim['text'].split()))
            if key not in seen:
                seen.add(key)
                result.append(claim)
    return result

def normalized_record(row):
    row = dict(row)
    row['claims'] = distinct_claims(record_claims(row))
    explicit_schedule = row.get('scheduled_event_date')
    published, event = row.get('published_at'), row.get('event_date')
    if explicit_schedule is not None:
        date.fromisoformat(explicit_schedule)
        row['scheduled_event_date'] = explicit_schedule
    elif published and event and event > published:
        row['scheduled_event_date'] = event
    return row

def merge_record(previous, incoming):
    conflicts = [conflict for field in ('published_at', 'event_date', 'scheduled_event_date') if (conflict := resolve_date_conflict(previous, incoming, field))]
    chosen, other = (incoming, previous) if quality(incoming) > quality(previous) else (previous, incoming)
    merged = dict(chosen)
    merged['lineage_reviews'] = lineage_reviews(chosen) + lineage_reviews(other)
    merged['merge_date_resolutions'] = list(chosen.get('merge_date_resolutions', [])) + list(other.get('merge_date_resolutions', []))
    merged['merge_conflicts'] = list(chosen.get('merge_conflicts', [])) + list(other.get('merge_conflicts', [])) + conflicts
    for conflict in conflicts:
        merged[conflict['field']] = conflict['resolved_value']
        if conflict['field'] == 'published_at':
            merged['date_basis'] = conflict['resolution'].get('date_basis', 'unknown') if conflict['resolved_value'] else 'unknown'
            merged['scope'] = next(row['scope'] for row in (chosen, other) if row.get('published_at') == conflict['resolved_value'])
    merged['claims'] = distinct_claims(record_claims(chosen), record_claims(other))
    merged['entity_ids'] = list(dict.fromkeys(chosen['entity_ids'] + other['entity_ids']))
    merged['duplicate_record_ids'] = sorted(set(chosen.get('duplicate_record_ids', []) + [other['id']] + other.get('duplicate_record_ids', [])))
    # Preserve claim-specific limitations even when source-date interpretations differ.
    merged['limitations'] = list(dict.fromkeys(chosen['limitations'] + other['limitations']))
    return normalized_record(merged)

def merge_inventories(inventories):
    records, queries, duplicates, raw_gaps = {}, [], [], []
    for name, data in inventories:
        raw_gaps.extend({'category': name, 'gap': gap} for gap in data.get('coverage_gaps', []))
        for query in data['queries']:
            if isinstance(query, str):
                query = {'query': query, 'category': name}
            queries.append({**query, 'category': query.get('category') or name, 'id': f'query:{len(queries)+1:04d}', 'research_category': name})
        for raw_row in data['records']:
            row = normalized_record(raw_row)
            key = canonical_url(row['url'])
            if key in records:
                previous = records[key]
                merged = merge_record(previous, row)
                other = row if merged['id'] == previous['id'] else previous
                records[key] = merged
                duplicates.append({'kept': merged['id'], 'merged': other['id'], 'reason': 'Same source URL; distinct claims and entity tags preserved'})
            else:
                records[key] = row
    return records, queries, duplicates, raw_gaps

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

def apply_lineage_updates(rows, updates):
    by_id = {identifier: row for row in rows for identifier in record_ids(row)}
    for update in updates:
        identifier = update.get('record_id')
        if identifier not in by_id or not isinstance(update.get('review'), dict):
            raise ValueError(f'Invalid explicit lineage update: {identifier}')
        row = by_id[identifier]
        new_origin = update.get('origin_key')
        if new_origin is not None and new_origin != row['origin_key']:
            if not isinstance(new_origin, str) or not new_origin.strip() or update['review'].get('decision') != 'shared_origin':
                raise ValueError(f'Origin group changes require an explicit shared-source review: {identifier}')
            row.setdefault('origin_history', []).append({'origin_key': row['origin_key'], 'changed_at': update['review'].get('reviewed_at'), 'reason': update['review'].get('rationale')})
            row['origin_key'] = new_origin
        review = {'source_record_id': identifier, **update['review']}
        reviews = row.setdefault('lineage_reviews', [])
        if review not in reviews:
            reviews.append(review)
    return rows

def build_catalog(input_dir=ROOT / 'research'):
    names = FILES + (['expanded'] if (input_dir / 'expanded.json').exists() else [])
    inventories = [(name, json.loads((input_dir / f'{name}.json').read_text())) for name in names]
    snapshot_meta = json.loads((input_dir / 'snapshot-meta.json').read_text()) if (input_dir / 'snapshot-meta.json').exists() else {}
    records, queries, duplicates, raw_gaps = merge_inventories(inventories)
    updates_path = input_dir / 'lineage-updates.json'
    if updates_path.exists():
        apply_lineage_updates(list(records.values()), json.loads(updates_path.read_text()))
    lineage_lint = validate_lineage(list(records.values()))
    return {
        'meta': {
            'window_start': '2025-10-30', 'window_end': '2026-10-30', 'researched_at': '2026-10-30',
            'snapshot_id': 'rx-research-20261030-v3',
            'coverage_note': '2025-10-30~2026-10-30의 삼성 RX 관련 공개자료를 여러 출처군에서 조사한 수동 스냅샷입니다. 검색·원문 확인·출처 계보·상업화 단계와 미확인 영역을 기록했으며, 누락률이나 전수성은 실측하지 않았습니다.',
            'query_count': len(queries), 'coverage_gaps': gaps, 'detailed_coverage_gaps': raw_gaps,
            'deduplicated_inputs': duplicates, 'lineage_lint': lineage_lint,
            'source_group_semantics': 'Reviewed shared-source/event groups; not a count of independent evidence',
            'merge_date_policy': 'Conflicting dates, including null vs date, fail unless an explicit reviewed resolution is retained',
            'automatic_collection_status': 'not_connected', 'last_successful_automated_update': None,
            'publication_policy': 'Source-attributed research; no automatic promotion to independently verified fact',
            'license_status': 'Original source rights retained; short excerpts, metadata and links only',
            'raw_source_capture': 'Not captured; record hashes are not original source hashes',
            **snapshot_meta,
        },
        'records': sorted(records.values(), key=lambda row: row['id']), 'queries': queries,
    }

if __name__ == '__main__':
    catalog = build_catalog()
    (ROOT / 'src/research-data.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'sources': len(catalog['records']), 'claims': sum(len(row['claims']) for row in catalog['records']), 'queries': len(catalog['queries']), 'duplicates': catalog['meta']['deduplicated_inputs']}, ensure_ascii=False))
