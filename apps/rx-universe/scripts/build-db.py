#!/usr/bin/env python3
"""Build a portable research SQLite snapshot. No external Python packages needed.

This database is an export snapshot, not production PostgreSQL. Imported Sources
and Claims have immutable UPDATE/DELETE guards. Re-running builds a new atomic
snapshot; the versioned input JSON/Git history preserves earlier imports.
record_sha256 hashes normalized record JSON, NEVER original source HTML.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import sqlite3
import tempfile
from datetime import date, datetime
from urllib.parse import urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[1]
validate_lineage = runpy.run_path(str(ROOT / 'scripts/merge-research.py'), run_name='rx_merge_validation')['validate_lineage']
SOURCE_TYPES = {'official', 'media', 'paper', 'patent', 'filing', 'video', 'product'}
VERIFICATIONS = {'primary_read', 'manual_report', 'search_only', 'access_blocked'}
CLAIM_KINDS = {'official_statement', 'media_report', 'research_result', 'inference'}
DATE_BASES = {'page', 'search_index', 'unknown'}
EDITORIAL_STATUS = 'source_attributed_not_independently_verified'
ENTITY_NAMES = {
    'se': ('Samsung Electronics', 'Company'), 'sds': ('Samsung SDS', 'Company'),
    'miracom': ('Miracom', 'Company'), 'mes': ('Manufacturing Execution System', 'Technology'),
    'job': ('Job Orchestration', 'Technology'), 'task': ('Task Graph', 'Technology'),
    'scheduling': ('Scheduling', 'Technology'), 'dispatch': ('Dispatch', 'Technology'),
    'rcs': ('Robot Control System', 'Technology'), 'robot': ('Robot Fleet', 'Robot'),
    'kpi': ('Operational KPI', 'KPI'), 'factory': ('Manufacturing Site', 'Factory'),
    'platform': ('Shared Platform', 'Hypothesis'), 'vertical': ('Vertical Integration', 'Hypothesis'),
    'distributed': ('Distributed SI', 'Hypothesis'), 'api': ('Common API', 'Technology'),
    'partner': ('External Partners', 'Organization'), 'evidence': ('Evidence Sources', 'Source'),
    'rainbow': ('Rainbow Robotics', 'Company'), 'nvidia': ('NVIDIA', 'Company'),
    'sdi': ('Samsung SDI', 'Company'), 'display': ('Samsung Display', 'Company'),
    'semco': ('Samsung Electro-Mechanics', 'Company'), 'shi': ('Samsung Heavy Industries', 'Company'),
    'etech': ('E Tech Group', 'Company'), 'kt': ('KT', 'Company'), 'kuka': ('KUKA', 'Company'),
    'sfa': ('SFA', 'Company'), 'skt': ('SK Telecom', 'Company'),
    'se-future-robotics': ('Samsung Electronics Future Robotics Organization', 'Organization'),
    'se-rx': ('Samsung Electronics RX Organization', 'Organization'),
    'shi-rx': ('Samsung Heavy Industries RX Center', 'Organization'),
    'investment': ('Investment', 'Investment'), 'research': ('Robotics Research', 'Technology'),
    'contract': ('Contract', 'Contract'),
}


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def sha256(value: str | bytes) -> str:
    return hashlib.sha256(value.encode('utf-8') if isinstance(value, str) else value).hexdigest()


def day(value: object, field: str) -> date:
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        raise ValueError(f'{field}: expected YYYY-MM-DD, got {value!r}')
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        raise ValueError(f'{field}: invalid calendar date {value!r}') from error


def accessed_day(value: object, field: str) -> date:
    if not isinstance(value, str):
        raise ValueError(f'{field}: expected an ISO date/timestamp')
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        return day(value, field)
    try:
        timestamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if timestamp.tzinfo is None:
            raise ValueError('timestamp timezone required')
        return timestamp.date()
    except ValueError as error:
        raise ValueError(f'{field}: invalid ISO timestamp {value!r}') from error


def required_text(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f'{field}: nonempty string required')
    return value


def validate_audit(record: dict, label: str) -> None:
    verification = record.get('verification')
    audit_status = record.get('audit_status')
    required_text(record.get('verification_note'), f'{label}.verification_note')
    if record.get('previous_verification') is not None and record['previous_verification'] not in VERIFICATIONS:
        raise ValueError(f'{label}.previous_verification: invalid status')
    if 'archive_url' not in record or 'content_sha256' not in record:
        raise ValueError(f'{label}: explicitly record archive_url/content_sha256, null when unavailable')
    archive_url, content_hash = record['archive_url'], record['content_sha256']
    if verification == 'primary_read':
        if audit_status != 'archived' or not isinstance(archive_url, str):
            raise ValueError(f'{label}: primary_read requires an archived original URL and content hash')
        parsed = urlsplit(archive_url)
        if parsed.scheme not in {'http', 'https'} or not parsed.netloc or parsed.username or parsed.password:
            raise ValueError(f'{label}.archive_url: public HTTP(S) archive URL required')
        if not isinstance(content_hash, str) or not re.fullmatch(r'[a-fA-F0-9]{64}', content_hash):
            raise ValueError(f'{label}.content_sha256: SHA-256 of archived source bytes required')
    else:
        expected_status = 'blocked' if verification == 'access_blocked' else 'unarchived'
        if audit_status != expected_status or archive_url is not None or content_hash is not None:
            raise ValueError(f'{label}: {verification} requires audit_status={expected_status}, archive_url=null and content_sha256=null')


def record_claims(record: dict) -> list[dict]:
    """Compatibility adapter; source dedup is separate from claim preservation."""
    return record.get('claims') or [{
        **record['claim'], 'id': f"claim:{record['id']}", 'origin_record_id': record['id'],
        'verification': record['verification'], 'evidence_locator': record['evidence_locator'],
        'limitations': record['limitations'],
    }]


def validate(data: dict) -> dict:
    if not isinstance(data, dict) or not isinstance(data.get('meta'), dict):
        raise ValueError('Root must contain meta, records and queries')
    meta = data['meta']
    start = day(meta.get('window_start'), 'meta.window_start')
    end = day(meta.get('window_end'), 'meta.window_end')
    researched = day(meta.get('researched_at'), 'meta.researched_at')
    if start > end or end > researched:
        raise ValueError('Research window must be ordered and not extend beyond researched_at')
    required_text(meta.get('coverage_note'), 'meta.coverage_note')
    records, queries = data.get('records'), data.get('queries')
    if not isinstance(records, list) or not isinstance(queries, list):
        raise ValueError('records and queries must be arrays')
    if type(meta.get('query_count')) is not int or meta['query_count'] != len(queries):
        raise ValueError('meta.query_count must equal the number of recorded queries')
    ids: set[str] = set()
    claim_ids: set[str] = set()
    excerpts_by_url: dict[str, int] = {}
    query_ids: set[str] = set()
    for index, query in enumerate(queries):
        if not isinstance(query, dict):
            raise ValueError(f'queries[{index}]: object required')
        required_text(query.get('query'), f'queries[{index}].query')
        required_text(query.get('category'), f'queries[{index}].category')
        if 'id' in query:
            query_id = required_text(query['id'], f'queries[{index}].id')
            if query_id in query_ids:
                raise ValueError(f'Duplicate query id: {query_id}')
            query_ids.add(query_id)
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            raise ValueError(f'records[{index}]: object required')
        label = f'records[{index}]'
        for field in ('id', 'title', 'url', 'publisher', 'origin_key', 'summary_ko', 'commercialization_stage', 'evidence_locator'):
            required_text(record.get(field), f'{label}.{field}')
        if record['id'] in ids:
            raise ValueError(f'Duplicate source id: {record["id"]}')
        ids.add(record['id'])
        parts = urlsplit(record['url'])
        if parts.scheme not in {'https', 'http'} or not parts.netloc or parts.username or parts.password:
            raise ValueError(f'{label}.url: public HTTP(S) URL without credentials required')
        normalized_url = urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path.rstrip('/'), parts.query, ''))
        excerpt = record.get('excerpt')
        if not isinstance(excerpt, str):
            raise ValueError(f'{label}.excerpt: string required; use empty string when no excerpt was read')
        excerpts_by_url[normalized_url] = excerpts_by_url.get(normalized_url, 0) + len(excerpt.split())
        if excerpts_by_url[normalized_url] > 25:
            raise ValueError(f'Excerpt budget exceeds 25 whitespace-delimited words for source URL: {record["url"]}')
        if record.get('source_type') not in SOURCE_TYPES or record.get('verification') not in VERIFICATIONS:
            raise ValueError(f'{label}: invalid source_type or verification')
        validate_audit(record, label)
        if record.get('relevance') is not None and record['relevance'] not in {'direct_rx', 'manufacturing_adjacent', 'component_ecosystem'}:
            raise ValueError(f'{label}.relevance: invalid reviewed-source scope')
        if record.get('date_basis') not in DATE_BASES:
            raise ValueError(f'{label}.date_basis: expected page|search_index|unknown')
        published_value, event_value = record.get('published_at'), record.get('event_date')
        published = day(published_value, f'{label}.published_at') if published_value is not None else None
        if event_value is not None:
            day(event_value, f'{label}.event_date')
        scheduled = record.get('scheduled_event_date')
        if scheduled is not None:
            day(scheduled, f'{label}.scheduled_event_date')
            # An explicitly announced schedule is not an actual occurrence date.
            # Undated event notices may preserve a schedule with event_date=NULL.
        accessed = accessed_day(record.get('accessed_at'), f'{label}.accessed_at')
        if accessed > researched:
            raise ValueError(f'{label}: accessed_at cannot be later than researched_at')
        if published and (published > end or published > accessed):
            raise ValueError(f'{label}: source publication is in the future of the research window/access date')
        expected_scope = 'undated' if published is None else 'in_window' if start <= published <= end else 'out_of_window'
        if record.get('scope') != expected_scope:
            raise ValueError(f'{label}.scope: expected {expected_scope!r} from published_at and research window')
        if published is None and record['date_basis'] != 'unknown':
            raise ValueError(f'{label}: undated source requires date_basis=unknown')
        if published is not None and record['date_basis'] == 'unknown':
            raise ValueError(f'{label}: do not assign a publication date without a known date basis')
        if record['date_basis'] == 'search_index' and record['verification'] == 'primary_read':
            # Reading a page does not prove its date, so preserve that distinction.
            pass
        entity_ids = record.get('entity_ids')
        if not isinstance(entity_ids, list) or any(not isinstance(item, str) or not item.strip() for item in entity_ids):
            raise ValueError(f'{label}.entity_ids: array of nonempty strings required')
        if len(set(entity_ids)) != len(entity_ids):
            raise ValueError(f'{label}.entity_ids: duplicate entity IDs')
        limitations = record.get('limitations')
        if not isinstance(limitations, list) or any(not isinstance(item, str) or not item.strip() for item in limitations):
            raise ValueError(f'{label}.limitations: array of nonempty strings required')
        if record['verification'] != 'primary_read' and not limitations:
            raise ValueError(f'{label}: search-only/blocked sources require explicit limitations')
        claim = record.get('claim')
        if not isinstance(claim, dict) or claim.get('kind') not in CLAIM_KINDS:
            raise ValueError(f'{label}.claim: attributed claim text and valid kind required')
        required_text(claim.get('text'), f'{label}.claim.text')
        if 'claims' in record and (not isinstance(record['claims'], list) or not record['claims']):
            raise ValueError(f'{label}.claims: nonempty array required when supplied')
        seen_texts = set()
        for extracted in record_claims(record):
            if not isinstance(extracted, dict):
                raise ValueError(f'{label}.claims: object entries required')
            claim_id = required_text(extracted.get('id'), f'{label}.claims.id')
            if claim_id in claim_ids:
                raise ValueError(f'Duplicate claim id: {claim_id}')
            claim_ids.add(claim_id)
            required_text(extracted.get('text'), f'{label}.claims.text')
            if extracted.get('kind') not in CLAIM_KINDS:
                raise ValueError(f'{label}.claims.kind: invalid attribution kind')
            key = (extracted['kind'], ' '.join(extracted['text'].split()))
            if key in seen_texts:
                raise ValueError(f'{label}.claims: duplicate extracted claim text/kind')
            seen_texts.add(key)
            if extracted.get('verification', record['verification']) == 'primary_read' and record['verification'] != 'primary_read':
                raise ValueError(f'{label}.claims: primary_read extraction requires archived parent source')
            if extracted.get('verification', record['verification']) not in VERIFICATIONS:
                raise ValueError(f'{label}.claims.verification: invalid status')
            limits = extracted.get('limitations', record['limitations'])
            if not isinstance(limits, list) or any(not isinstance(item, str) or not item.strip() for item in limits):
                raise ValueError(f'{label}.claims.limitations: array of nonempty strings required')
            if extracted.get('verification', record['verification']) != 'primary_read' and not limits:
                raise ValueError(f'{label}.claims: unverified extraction requires limitations')
        if (claim['kind'], ' '.join(claim['text'].split())) not in seen_texts:
            raise ValueError(f'{label}: legacy claim must be preserved in claims array')
    validate_lineage(records)
    return data


SCHEMA = '''
PRAGMA foreign_keys=ON;
CREATE TABLE Metadata(key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
CREATE TABLE Entities(id TEXT PRIMARY KEY, canonical_name TEXT NOT NULL, entity_type TEXT NOT NULL, description TEXT NOT NULL);
CREATE TABLE Sources(
 id TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL, publisher TEXT NOT NULL,
 published_at TEXT, event_date TEXT, scheduled_event_date TEXT, source_type TEXT NOT NULL,
 verification TEXT NOT NULL CHECK(verification IN ('primary_read','manual_report','search_only','access_blocked')),
 scope TEXT NOT NULL CHECK(scope IN ('in_window','undated','out_of_window')),
 origin_key TEXT NOT NULL, summary_ko TEXT NOT NULL, excerpt TEXT NOT NULL,
 commercialization_stage TEXT NOT NULL, limitations_json TEXT NOT NULL,
 accessed_at TEXT NOT NULL, source_date_basis TEXT NOT NULL CHECK(source_date_basis IN ('page','search_index','unknown')),
 evidence_locator TEXT NOT NULL, record_sha256 TEXT NOT NULL CHECK(length(record_sha256)=64),
 captured_source_sha256 TEXT CHECK(captured_source_sha256 IS NULL),
 raw_record_json TEXT NOT NULL,
 audit_status TEXT NOT NULL CHECK(audit_status IN ('unarchived','archived','blocked')),
 archive_url TEXT, content_sha256 TEXT, verification_note TEXT NOT NULL, previous_verification TEXT,
 event_key TEXT, utterance_key TEXT, lineage_review_json TEXT, lineage_reviews_json TEXT NOT NULL,
 merge_conflicts_json TEXT NOT NULL, merge_date_resolutions_json TEXT NOT NULL,
 relevance TEXT CHECK(relevance IS NULL OR relevance IN ('direct_rx','manufacturing_adjacent','component_ecosystem')),
 origin_history_json TEXT NOT NULL
);
CREATE TABLE Claims(
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES Sources(id), claim_text TEXT NOT NULL,
 claim_kind TEXT NOT NULL CHECK(claim_kind IN ('official_statement','media_report','research_result','inference')),
 editorial_status TEXT NOT NULL CHECK(editorial_status='source_attributed_not_independently_verified'),
 event_date TEXT, published_at TEXT, ingested_at TEXT NOT NULL,
 independently_verified INTEGER NOT NULL DEFAULT 0 CHECK(independently_verified=0),
 scheduled_event_date TEXT, origin_record_id TEXT,
 verification TEXT NOT NULL CHECK(verification IN ('primary_read','manual_report','search_only','access_blocked')),
 evidence_locator TEXT NOT NULL, limitations_json TEXT NOT NULL
);
CREATE TABLE SourceEntities(
 source_id TEXT NOT NULL REFERENCES Sources(id), entity_id TEXT NOT NULL REFERENCES Entities(id),
 PRIMARY KEY(source_id,entity_id)
);
CREATE TABLE Queries(id TEXT PRIMARY KEY, query_text TEXT NOT NULL, category TEXT NOT NULL, raw_query_json TEXT NOT NULL);
CREATE TABLE CrawlRuns(
 id TEXT PRIMARY KEY, started_at TEXT, finished_at TEXT, status TEXT NOT NULL,
 raw_run_json TEXT NOT NULL, record_sha256 TEXT NOT NULL
);
CREATE TABLE CoverageCollections(
 id TEXT PRIMARY KEY, run_id TEXT REFERENCES CrawlRuns(id), url TEXT NOT NULL, publisher TEXT NOT NULL,
 status TEXT NOT NULL, accessed_at TEXT, discovered_urls_json TEXT NOT NULL, reviewed_urls_json TEXT NOT NULL,
 raw_collection_json TEXT NOT NULL, record_sha256 TEXT NOT NULL
);
CREATE TABLE DiscoveryInventory(
 id TEXT PRIMARY KEY, run_id TEXT REFERENCES CrawlRuns(id), url TEXT NOT NULL, canonical_url TEXT NOT NULL,
 title TEXT, publisher TEXT, discovered_at TEXT, published_at TEXT, source_date_basis TEXT,
 fetch_status TEXT NOT NULL, relevance TEXT NOT NULL, source_ids_json TEXT NOT NULL,
 content_sha256 TEXT, raw_candidate_json TEXT NOT NULL, record_sha256 TEXT NOT NULL,
 automatically_verified INTEGER NOT NULL DEFAULT 0 CHECK(automatically_verified=0),
 run_ids_json TEXT NOT NULL, collection_urls_json TEXT NOT NULL, observations_json TEXT NOT NULL, observation_count INTEGER NOT NULL
);
CREATE INDEX discovery_url_idx ON DiscoveryInventory(canonical_url);
CREATE INDEX discovery_status_idx ON DiscoveryInventory(fetch_status,relevance);
CREATE INDEX collections_run_idx ON CoverageCollections(run_id);
CREATE INDEX sources_publication_idx ON Sources(published_at);
CREATE INDEX sources_event_idx ON Sources(event_date);
CREATE INDEX sources_origin_idx ON Sources(origin_key);
CREATE INDEX sources_verification_idx ON Sources(verification,scope);
CREATE INDEX source_entities_entity_idx ON SourceEntities(entity_id);
CREATE INDEX claims_source_idx ON Claims(source_id);
CREATE TRIGGER immutable_sources_update BEFORE UPDATE ON Sources BEGIN SELECT RAISE(ABORT,'Imported Sources are immutable; create a new versioned snapshot'); END;
CREATE TRIGGER immutable_sources_delete BEFORE DELETE ON Sources BEGIN SELECT RAISE(ABORT,'Imported Sources are immutable; create a new versioned snapshot'); END;
CREATE TRIGGER immutable_claims_update BEFORE UPDATE ON Claims BEGIN SELECT RAISE(ABORT,'Imported Claims are immutable; create a new versioned snapshot'); END;
CREATE TRIGGER immutable_claims_delete BEFORE DELETE ON Claims BEGIN SELECT RAISE(ABORT,'Imported Claims are immutable; create a new versioned snapshot'); END;
'''


def validate_survey(data: dict, source_ids: set[str]) -> dict:
    if not isinstance(data, dict):
        raise ValueError('survey must be an object')
    ids = {}
    for group in ('runs', 'collections', 'candidates'):
        rows = data.get(group, [])
        if not isinstance(rows, list):
            raise ValueError(f'survey.{group} must be an array')
        ids[group] = set()
        for row in rows:
            if not isinstance(row, dict):
                raise ValueError(f'survey.{group}: object required')
            row_id = required_text(row.get('id'), f'survey.{group}.id')
            if row_id in ids[group]:
                raise ValueError(f'survey.{group}: duplicate id {row_id}')
            ids[group].add(row_id)
    for group in ('collections', 'candidates'):
        for row in data.get(group, []):
            if row.get('run_id') and row['run_id'] not in ids['runs']:
                raise ValueError(f"survey.{group}: unknown run {row['run_id']}")
            url = row.get('url') or row.get('collection_url')
            parts = urlsplit(required_text(url, f'survey.{group}.url'))
            if parts.scheme not in {'https', 'http'} or not parts.netloc or parts.username or parts.password:
                raise ValueError(f'survey.{group}: public URL required')
    for row in data.get('runs', []):
        required_text(row.get('status'), 'survey.runs.status')
    for row in data.get('collections', []):
        required_text(row.get('publisher'), 'survey.collections.publisher')
        required_text(row.get('status'), 'survey.collections.status')
    for row in data.get('candidates', []):
        if any(run_id not in ids['runs'] for run_id in row.get('run_ids', [])):
            raise ValueError('discovery candidate run_ids must resolve to retained CrawlRuns')
        if 'claim' in row or 'claims' in row:
            raise ValueError('discovery candidates cannot contain claims; review into Sources explicitly')
        source_links = row.get('source_ids', [])
        if not isinstance(source_links, list) or any(source_id not in source_ids for source_id in source_links):
            raise ValueError('discovery candidate source_ids must resolve to reviewed Sources')
        if row.get('published_at') is not None:
            day(row['published_at'], 'survey.candidates.published_at')
        if row.get('content_sha256') is not None and not re.fullmatch(r'[a-fA-F0-9]{64}', row['content_sha256']):
            raise ValueError('discovery content_sha256 must be a response-byte hash or null')
    return {**data, **{key: data.get(key, []) for key in ('collections', 'candidates', 'runs')}}


def build(source: Path, out_dir: Path, survey_path: Path | None = None) -> dict:
    raw = source.read_bytes()
    data = validate(json.loads(raw))
    if survey_path is None and source.resolve() == (ROOT / 'src/research-data.json').resolve():
        survey_path = ROOT / 'research/survey-data.json'
    survey = validate_survey(json.loads(survey_path.read_bytes()) if survey_path and survey_path.exists() else {}, {row['id'] for row in data['records']})
    survey_raw = (json.dumps(survey, ensure_ascii=False, indent=2) + '\n').encode()
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / 'rx-research.sqlite'
    fd, temporary_name = tempfile.mkstemp(prefix='.rx-research-', suffix='.sqlite', dir=out_dir)
    os.close(fd)
    temporary = Path(temporary_name)
    try:
        with sqlite3.connect(temporary) as db:
            db.executescript(SCHEMA)
            metadata = {**data['meta'], 'schema_version': '1.3', 'source_json_sha256': sha256(raw),
                        'storage_kind': 'portable_sqlite_snapshot', 'claim_editorial_status': EDITORIAL_STATUS,
                        'record_hash_semantics': 'SHA-256 of canonical record JSON, not original HTML or source bytes',
                        'captured_source_hash_semantics': 'NULL: this builder does not fetch original source bytes',
                        'archive_hash_semantics': 'content_sha256 is the supplied archive-byte SHA-256; record_sha256 hashes JSON metadata. Builder checks archive metadata format, not remote bytes.',
                        'source_group_semantics': 'Reviewed shared-source/event groups, not independently corroborating evidence',
                        'history_policy': 'Immutable imported rows in each exported snapshot; input JSON versions tracked in Git',
                        'survey_json_sha256': sha256(survey_raw), 'survey_counts': {key: len(survey[key]) for key in ('runs','collections','candidates')},
                        'discovery_policy': 'Discovered/fetched URLs are unreviewed inventory; never create Claims or factual verification automatically'}
            db.executemany('INSERT INTO Metadata VALUES(?,?)', [(key, canonical(value)) for key, value in sorted(metadata.items())])
            entity_names = dict(ENTITY_NAMES)
            graph_inventory = ROOT / 'src/knowledge-expansion.json'
            if graph_inventory.exists():
                entity_names.update({row['id']: (row['title'], row['ontology_type']) for row in json.loads(graph_inventory.read_bytes()).get('entities', [])})
            all_entities = sorted({entity_id for record in data['records'] for entity_id in record['entity_ids']})
            for entity_id in all_entities:
                name, kind = entity_names.get(entity_id, (entity_id, 'Unresolved'))
                db.execute('INSERT INTO Entities VALUES(?,?,?,?)', (entity_id, name, kind, 'Research indexing entity; inclusion does not establish a business relationship'))
            for record in sorted(data['records'], key=lambda item: item['id']):
                normalized_record = canonical(record)
                source_values = (
                    record['id'], record['title'], record['url'], record['publisher'], record['published_at'], record['event_date'], record.get('scheduled_event_date'),
                    record['source_type'], record['verification'], record['scope'], record['origin_key'], record['summary_ko'],
                    record['excerpt'], record['commercialization_stage'], canonical(record['limitations']), record['accessed_at'],
                    record['date_basis'], record['evidence_locator'], sha256(normalized_record), None, normalized_record,
                    record['audit_status'], record['archive_url'], record['content_sha256'], record['verification_note'], record.get('previous_verification'),
                    record.get('event_key'), record.get('utterance_key'), canonical(record['lineage_review']) if record.get('lineage_review') else None,
                    canonical(record.get('lineage_reviews', [])), canonical(record.get('merge_conflicts', [])), canonical(record.get('merge_date_resolutions', [])), record.get('relevance'), canonical(record.get('origin_history', [])),
                )
                db.execute(f'INSERT INTO Sources VALUES({",".join("?" for _ in source_values)})', source_values)
                for claim in record_claims(record):
                    db.execute('INSERT INTO Claims VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', (
                        claim['id'], record['id'], claim['text'], claim['kind'], EDITORIAL_STATUS,
                        record['event_date'], record['published_at'], record['accessed_at'], 0,
                        record.get('scheduled_event_date'), claim.get('origin_record_id'),
                        claim.get('verification', record['verification']), claim.get('evidence_locator', record['evidence_locator']),
                        canonical(claim.get('limitations', record['limitations'])),
                    ))
                db.executemany('INSERT INTO SourceEntities VALUES(?,?)', [(record['id'], entity_id) for entity_id in sorted(record['entity_ids'])])
            for index, query in enumerate(data['queries']):
                db.execute('INSERT INTO Queries VALUES(?,?,?,?)', (str(query.get('id', f'query:{index + 1:04d}')), query['query'], query['category'], canonical(query)))
            for row in survey['runs']:
                db.execute('INSERT INTO CrawlRuns VALUES(?,?,?,?,?,?)', (row['id'], row.get('started_at'), row.get('finished_at'), row['status'], canonical(row), sha256(canonical(row))))
            for row in survey['collections']:
                db.execute('INSERT INTO CoverageCollections VALUES(?,?,?,?,?,?,?,?,?,?)', (
                    row['id'], row.get('run_id'), row.get('url') or row['collection_url'], row['publisher'], row['status'], row.get('accessed_at'),
                    canonical(row.get('discovered_urls', [])), canonical(row.get('reviewed_urls', [])), canonical(row), sha256(canonical(row))))
            for row in survey['candidates']:
                db.execute('INSERT INTO DiscoveryInventory VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', (
                    row['id'], row.get('run_id'), row['url'], row.get('canonical_url') or row['url'], row.get('title'), row.get('publisher'),
                    row.get('discovered_at'), row.get('published_at'), row.get('date_basis'), row.get('fetch_status', 'discovered'), row.get('relevance', 'unreviewed'),
                    canonical(row.get('source_ids', [])), row.get('content_sha256'), canonical(row), sha256(canonical(row)), 0,
                    canonical(row.get('run_ids', [row['run_id']] if row.get('run_id') else [])), canonical(row.get('collection_urls', [])),
                    canonical(row.get('observations', [row])), row.get('observation_count', len(row.get('observations', [row])))))
            problems = db.execute('PRAGMA foreign_key_check').fetchall()
            if problems:
                raise ValueError(f'Foreign key validation failed: {problems}')
            if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise ValueError('SQLite integrity check failed')
            db.commit()
        # Publish both exports only after the database has passed all checks.
        json_target = out_dir / 'rx-research.json'
        json_temporary = out_dir / '.rx-research.json.tmp'
        json_temporary.write_bytes(raw)
        os.replace(temporary, target)
        os.replace(json_temporary, json_target)
        survey_temporary = out_dir / '.rx-survey.json.tmp'
        survey_temporary.write_bytes(survey_raw)
        os.replace(survey_temporary, out_dir / 'rx-survey.json')
    finally:
        temporary.unlink(missing_ok=True)
    return {'database': str(target), 'json': str(out_dir / 'rx-research.json'), 'sources': len(data['records']),
            'claims': sum(len(record_claims(record)) for record in data['records']), 'source_groups': len({record['origin_key'] for record in data['records']}),
            'queries': len(data['queries']), 'source_json_sha256': sha256(raw), 'survey': {key: len(survey[key]) for key in ('runs','collections','candidates')}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=ROOT / 'src/research-data.json')
    parser.add_argument('--out-dir', type=Path, default=ROOT / 'public/data')
    parser.add_argument('--survey', type=Path)
    parser.add_argument('--validate-only', action='store_true')
    args = parser.parse_args()
    if args.validate_only:
        loaded = validate(json.loads(args.input.read_bytes()))
        print(json.dumps({'valid': True, 'sources': len(loaded['records']), 'queries': len(loaded['queries'])}))
    else:
        print(json.dumps(build(args.input, args.out_dir, args.survey), ensure_ascii=False))
