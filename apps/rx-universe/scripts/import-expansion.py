#!/usr/bin/env python3
"""Import explicitly reviewed survey expansions. Discovered URLs never generate Claims.

Writes a reproducible expanded raw inventory, metadata, graph bindings and survey
inventory only after all source/claim/date/lineage validation succeeds. Canonical
source and extracted-claim remaps are reported without fabricating relationships.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re
import runpy
from datetime import date

ROOT = Path(__file__).resolve().parents[1]
MERGE = runpy.run_path(str(ROOT / 'scripts/merge-research.py'), run_name='rx_import_merge')
DB = runpy.run_path(str(ROOT / 'scripts/build-db.py'), run_name='rx_import_validation')
canonical_url = MERGE['canonical_url']
merge_inventories = MERGE['merge_inventories']
record_claims = MERGE['record_claims']
# Explicit same-identity aliases reviewed against the existing ontology, not fuzzy co-mention matching.
ENTITY_ID_ALIASES = {'gumi-ai-dc': 'gumi-data-center', 'samsungena': 'samsung-ea', 'rfm': 'robot-foundation-model', 'samsung-venture-investment': 'samsung-venture'}


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def key_id(prefix, value):
    return f'{prefix}:{hashlib.sha256(value.encode()).hexdigest()[:16]}'


def load(path, default=None):
    return json.loads(path.read_text()) if path.exists() else default


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name('.' + path.name + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def sanitize_discovery_title(row, source=None):
    row = dict(row)
    title = row.get('title')
    if isinstance(title, str) and not (source and title == source['title'] and row.get('discovery_method') == 'reviewed_catalog'):
        normalized = ' '.join(title.split())
        limited = ' '.join(normalized.split()[:20])[:120]
        if limited != title or row.get('title_truncated'):
            row['title_truncated'] = True
            row['title_original_length'] = row.get('title_original_length', len(title))
            row['title_policy'] = 'Discovery anchor text limited to 120 characters and 20 words; full anchor body is not retained'
        row['title'] = limited
    if 'observations' in row:
        row['observations'] = [sanitize_discovery_title(item, source) for item in row['observations']]
    return row


def merge_survey(inputs, source_rows):
    groups = {key: {} for key in ('runs', 'collections')}
    observations = {}
    source_by_url = {canonical_url(row['url']): row for row in source_rows}
    for data in inputs:
        for group in groups:
            for row in data.get(group, []):
                # Collection rows are observations, not unique article counts.
                row = dict(row)
                if group == 'collections':
                    original_id = row.get('original_id', row['id'])
                    row['original_id'] = original_id
                    row['id'] = key_id('collection-observation', f"{row.get('run_id', 'manual')}:{original_id}")
                groups[group][row['id']] = row
        for candidate in data.get('candidates', []):
            if 'claim' in candidate or 'claims' in candidate:
                raise ValueError('Discovery inventory cannot contain claims')
            for raw in candidate.get('observations', [candidate]):
                key = canonical_url(raw['url'])
                row = sanitize_discovery_title(raw, source_by_url.get(key))
                observations.setdefault(key, {})[canonical(row)] = row
    # Reviewed catalog entries stay discoverable even when a crawler could not reach their collections.
    for key, source in source_by_url.items():
        row = {'id': key_id('catalog-observation', source['id']), 'url': source['url'], 'title': source['title'],
               'publisher': source['publisher'], 'discovered_at': source['accessed_at'], 'published_at': source['published_at'],
               'date_basis': source['date_basis'], 'fetch_status': 'discovered', 'relevance': 'unreviewed',
               'discovery_method': 'reviewed_catalog', 'source_ids': [source['id']], 'collection_urls': [],
               'notes': ['Reviewed catalog reference; does not imply an automated fetch, archive or independent verification.']}
        observations.setdefault(key, {})[canonical(row)] = row
    candidates = []
    priority = {'fetched': 5, 'blocked': 4, 'error': 3, 'robots_disallowed': 3, 'budget_exhausted': 2, 'discovered': 1}
    for key, unique in observations.items():
        rows = sorted(unique.values(), key=lambda row: (row.get('discovered_at', ''), row.get('id', ''), canonical(row)))
        representative = max(rows, key=lambda row: (priority.get(row.get('fetch_status'), 0), row.get('discovered_at', '')))
        merged = dict(representative)
        source = source_by_url.get(key)
        dates = sorted({row['published_at'] for row in rows if row.get('published_at')})
        merged.update({'id': key_id('candidate', key), 'canonical_url': key,
                       'run_ids': sorted({row['run_id'] for row in rows if row.get('run_id')}),
                       'collection_urls': sorted({url for row in rows for url in row.get('collection_urls', [])}),
                       'source_ids': [source['id']] if source else [],
                       'observations': rows, 'observation_count': len(rows),
                       'fetch_status_semantics': 'Best observed fetch status across retained observations; never factual verification',
                       'matched_keywords': sorted({word for row in rows for word in row.get('matched_keywords', [])})})
        if source:
            merged.update({'title': source['title'], 'publisher': source['publisher'], 'published_at': source['published_at'],
                           'date_basis': source['date_basis'], 'title_date_basis': 'reviewed_catalog'})
        elif len(dates) > 1:
            merged.update({'published_at': None, 'date_basis': 'unknown', 'date_conflicts': dates})
        elif dates:
            dated = next(row for row in reversed(rows) if row.get('published_at') == dates[0])
            merged.update({'published_at': dates[0], 'date_basis': dated.get('date_basis', 'unknown')})
        candidates.append(merged)
    return {**{key: sorted(rows.values(), key=lambda row: row['id']) for key, rows in groups.items()},
            'candidates': sorted(candidates, key=lambda row: row['canonical_url'])}


def manual_coverage(name, data, day):
    if not data.get('coverage'):
        return {'runs': [], 'collections': [], 'candidates': []}
    run_id = f'manual:{day}:{name}'
    result = {'runs': [{'id': run_id, 'status': 'manual_review', 'started_at': day, 'finished_at': day,
                        'method': 'manual_source_survey', 'automatic_claim_creation': False}], 'collections': [], 'candidates': []}
    for index, coverage in enumerate(data['coverage']):
        url = coverage.get('collection_url') or coverage.get('url')
        if not url:
            raise ValueError(f'{name}.coverage[{index}]: collection_url required')
        row = {**coverage, 'id': key_id('collection', f'{run_id}:{url}:{index}'), 'run_id': run_id, 'url': url}
        row.setdefault('status', 'reviewed')
        result['collections'].append(row)
        for discovered in coverage.get('discovered_urls', []):
            target = discovered.get('url') if isinstance(discovered, dict) else discovered
            if not isinstance(target, str):
                raise ValueError(f'{name}.coverage.discovered_urls: URLs required')
            result['candidates'].append({'id': key_id('candidate', f'{run_id}:{canonical_url(target)}'), 'run_id': run_id,
                'url': target, 'canonical_url': canonical_url(target), 'title': None, 'publisher': coverage.get('publisher'),
                'discovered_at': coverage.get('accessed_at', day), 'published_at': None, 'date_basis': 'unknown',
                'fetch_status': 'discovered', 'relevance': 'unreviewed', 'collection_urls': [url],
                'source_ids': [], 'notes': ['Manual collection inventory; discovery itself creates no extracted claim.']})
    # Multiple collection pages may discover one URL in the same manual run.
    by_id = {}
    for row in result['candidates']:
        if row['id'] in by_id:
            row['collection_urls'] = sorted(set(row['collection_urls'] + by_id[row['id']]['collection_urls']))
        by_id[row['id']] = row
    result['candidates'] = list(by_id.values())
    return result


def import_expansions(root=ROOT, paths=None, observed_at='2026-10-31', survey_paths=None, dry_run=False):
    date.fromisoformat(observed_at)
    research = root / 'research'
    paths = paths or sorted(research.glob('expansion-*.json'))
    inputs = [(path.stem, load(path)) for path in paths]
    if not inputs:
        raise ValueError('No reviewed expansion inventories supplied')
    previous = load(research / 'expanded.json', {'records': [], 'queries': []})
    baseline = [(name, load(research / f'{name}.json')) for name in MERGE['FILES']]
    expanded_rows = {row['id']: row for row in previous['records']}
    queries = {canonical(row): row for row in previous.get('queries', [])}
    raw_relations = {}
    old_graph = load(root / 'src/knowledge-expansion.json', {'entities': [], 'relations': []})
    for relation in old_graph['relations']:
        raw_relations[relation['id']] = relation
    coverage_inputs = []
    lineage_updates = {canonical(row): row for row in load(research / 'lineage-updates.json', [])}
    for name, data in inputs:
        if not isinstance(data, dict) or not isinstance(data.get('records'), list):
            raise ValueError(f'{name}: explicit reviewed records array required')
        for row in data['records']:
            if row['id'] in expanded_rows:
                old = expanded_rows[row['id']]
                if canonical_url(old['url']) != canonical_url(row['url']):
                    raise ValueError(f"Source ID points to different URLs: {row['id']}")
                if canonical(old) != canonical(row):
                    row = MERGE['merge_record'](old, row)
                    row['duplicate_record_ids'] = [item for item in row.get('duplicate_record_ids', []) if item != row['id']]
            expanded_rows[row['id']] = row
        for query in data.get('queries', []):
            query = {'query': query, 'category': name} if isinstance(query, str) else query
            queries[canonical(query)] = query
        for relation in data.get('relations', []):
            relation = dict(relation)
            relation['from'] = ENTITY_ID_ALIASES.get(relation['from'], relation['from'])
            relation['to'] = ENTITY_ID_ALIASES.get(relation['to'], relation['to'])
            if relation['id'] in raw_relations and canonical(raw_relations[relation['id']]) != canonical(relation):
                # Stored relation has canonical claim remaps; use this reviewed raw binding on rerun.
                previous_relation = raw_relations[relation['id']]
                if any(previous_relation.get(field) != relation.get(field) for field in ('from', 'to', 'type', 'label')):
                    correction = relation.get('reviewed_correction', {})
                    approved = (correction.get('previous_type') == previous_relation.get('type') and
                                correction.get('previous_claim_id') == previous_relation.get('claim_id') and
                                isinstance(correction.get('reason'), str) and correction['reason'].strip() and
                                all(previous_relation.get(field) == relation.get(field) for field in ('from', 'to')))
                    if not approved:
                        raise ValueError(f"Conflicting graph relation ID: {relation['id']}; explicit reviewed_correction required")
                    date.fromisoformat(correction.get('reviewed_at', ''))
            raw_relations[relation['id']] = relation
        for update in data.get('lineage_updates', []):
            lineage_updates[canonical(update)] = update
        coverage_inputs.append(manual_coverage(name, data, observed_at))
    expanded = {'records': list(expanded_rows.values()), 'queries': list(queries.values())}
    inventories = baseline + [('expanded', expanded)]
    merged, merged_queries, duplicates, gaps = merge_inventories(inventories)
    records = sorted(merged.values(), key=lambda row: row['id'])
    MERGE['apply_lineage_updates'](records, list(lineage_updates.values()))
    source_remap = {source_id: row['id'] for row in records for source_id in sorted(MERGE['record_ids'](row))}
    claim_remap = {}
    for _, inventory in inventories:
        for row in inventory['records']:
            target = merged[canonical_url(row['url'])]
            for claim in record_claims(row):
                key = (claim['kind'], ' '.join(claim['text'].split()))
                match = next(candidate for candidate in target['claims'] if (candidate['kind'], ' '.join(candidate['text'].split())) == key)
                claim_remap[claim['id']] = match['id']
    # The validator fails closed for date collisions and unexplained shared-event candidates.
    meta = {'window_start': '2025-10-30', 'window_end': observed_at, 'researched_at': observed_at,
            'snapshot_id': f'rx-research-{observed_at.replace("-", "")}-survey',
            'coverage_note': f'2025-10-30~{observed_at} 공개자료의 출처군·목록·검색 범위를 기록한 조사 스냅샷입니다. 실제 열람 자료와 자동 발견 후보를 분리하며, 웹 전체 완전성이나 누락률을 입증한 목록은 아닙니다.',
            'query_count': len(merged_queries), 'expansion_files': [path.name for path in paths],
            'source_id_remap': source_remap, 'claim_id_remap': claim_remap,
            'deduplicated_inputs': duplicates, 'detailed_coverage_gaps': gaps,
            'discovery_policy': 'Collection/discovery metadata never creates Claims or automatically verifies Sources'}
    catalog = {'meta': meta, 'records': records, 'queries': merged_queries}
    DB['validate'](catalog)
    claims = {claim['id']: (source, claim) for source in records for claim in source['claims']}
    entities = {item['id']: item for item in old_graph['entities']}
    relations = []
    valid_types = {'Company','Organization','Product','Robot','Technology','Factory','Project','Contract','Event','Paper','Patent','Keyword','Hypothesis','Question'}
    for raw in raw_relations.values():
        row = dict(raw)
        if row.get('status') not in {'reported', 'planned', 'research', 'hypothesis', 'undated_current'}:
            raise ValueError(f"Invalid graph relation status: {row['id']} {row.get('status')}")
        row['from'] = ENTITY_ID_ALIASES.get(row['from'], row['from'])
        row['to'] = ENTITY_ID_ALIASES.get(row['to'], row['to'])
        claim_id = claim_remap.get(row['claim_id'], row['claim_id'])
        if claim_id not in claims:
            raise ValueError(f"Graph relation refers to unknown extracted claim: {row['id']} {claim_id}")
        source, claim = claims[claim_id]
        if source['verification'] not in {'manual_report', 'primary_read'} or claim.get('verification', source['verification']) not in {'manual_report','primary_read'}:
            raise ValueError(f"Unreviewed source cannot create graph assertion: {row['id']}")
        row['claim_id'] = claim_id
        for endpoint in ('from', 'to'):
            entity_id = row[endpoint]
            title, kind = row.get(f'{endpoint}_title'), row.get(f'{endpoint}_ontology_type')
            if title is None or kind is None:
                if entity_id not in entities:
                    raise ValueError(f"Graph endpoint metadata missing: {row['id']} {entity_id}")
                continue
            if kind not in valid_types:
                raise ValueError(f'Unknown graph ontology type: {kind}')
            text = '\n'.join([source['title'], source['summary_ko'], claim['text']]).casefold()
            aliases = [title] if title.casefold() in text else []
            cluster = 'sds' if source['id'].startswith(('sds-', 'x-sds-')) else 'miracom' if source['id'].startswith(('mi-', 'x-mi-')) else 'electronics' if source['id'].startswith(('se-', 'x-se-')) else 'robotics'
            if entity_id in entities:
                if entities[entity_id]['ontology_type'] != kind:
                    raise ValueError(f'Conflicting ontology type for expanded entity: {entity_id}')
                aliases = sorted(set(entities[entity_id].get('aliases', []) + aliases))
            entities[entity_id] = {'id': entity_id, 'title': title, 'ontology_type': kind, 'aliases': aliases, 'cluster': cluster}
        relations.append(row)
    graph = {'entities': sorted(entities.values(), key=lambda row: row['id']), 'relations': sorted(relations, key=lambda row: row['id']), 'entity_id_remap': ENTITY_ID_ALIASES}
    survey_inputs = [load(research / 'survey-data.json', {})] + coverage_inputs
    for path in survey_paths or sorted((research / 'survey').glob('*.json')):
        survey_inputs.append(load(path))
    survey = merge_survey(survey_inputs, records)
    DB['validate_survey'](survey, {row['id'] for row in records})
    result = {'sources': len(records), 'claims': len(claims), 'queries': len(merged_queries), 'relations': len(relations),
              'expanded_raw_records': len(expanded['records']), 'survey': {key: len(survey[key]) for key in survey},
              'source_id_remap': source_remap, 'claim_id_remap': claim_remap}
    if not dry_run:
        write(research / 'expanded.json', expanded)
        write(research / 'lineage-updates.json', list(lineage_updates.values()))
        write(research / 'snapshot-meta.json', meta)
        write(root / 'src/knowledge-expansion.json', graph)
        write(research / 'survey-data.json', survey)
        # Reuse the standard builder so later regeneration preserves all baseline provenance metadata.
        final_catalog = MERGE['build_catalog'](research)
        DB['validate'](final_catalog)
        write(root / 'src/research-data.json', final_catalog)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--input', type=Path, action='append')
    parser.add_argument('--survey', type=Path, action='append')
    parser.add_argument('--observed-at', default='2026-10-31')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    print(json.dumps(import_expansions(args.root, args.input, args.observed_at, args.survey, args.dry_run), ensure_ascii=False))
