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
import sqlite3
import tempfile
from datetime import date, datetime
from urllib.parse import urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[1]
SOURCE_TYPES = {'official', 'media', 'paper', 'patent', 'filing', 'video', 'product'}
VERIFICATIONS = {'primary_read', 'search_only', 'access_blocked'}
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
        if record.get('date_basis') not in DATE_BASES:
            raise ValueError(f'{label}.date_basis: expected page|search_index|unknown')
        published_value, event_value = record.get('published_at'), record.get('event_date')
        published = day(published_value, f'{label}.published_at') if published_value is not None else None
        if event_value is not None:
            day(event_value, f'{label}.event_date')
        scheduled = record.get('scheduled_event_date')
        if scheduled is not None:
            day(scheduled, f'{label}.scheduled_event_date')
            if not published_value or scheduled != event_value or scheduled <= published_value:
                raise ValueError(f'{label}: scheduled_event_date must preserve a future event_date after publication')
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
            if extracted.get('verification', record['verification']) not in VERIFICATIONS:
                raise ValueError(f'{label}.claims.verification: invalid status')
            limits = extracted.get('limitations', record['limitations'])
            if not isinstance(limits, list) or any(not isinstance(item, str) or not item.strip() for item in limits):
                raise ValueError(f'{label}.claims.limitations: array of nonempty strings required')
            if extracted.get('verification', record['verification']) != 'primary_read' and not limits:
                raise ValueError(f'{label}.claims: unverified extraction requires limitations')
        if (claim['kind'], ' '.join(claim['text'].split())) not in seen_texts:
            raise ValueError(f'{label}: legacy claim must be preserved in claims array')
    return data


SCHEMA = '''
PRAGMA foreign_keys=ON;
CREATE TABLE Metadata(key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
CREATE TABLE Entities(id TEXT PRIMARY KEY, canonical_name TEXT NOT NULL, entity_type TEXT NOT NULL, description TEXT NOT NULL);
CREATE TABLE Sources(
 id TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL, publisher TEXT NOT NULL,
 published_at TEXT, event_date TEXT, scheduled_event_date TEXT, source_type TEXT NOT NULL,
 verification TEXT NOT NULL CHECK(verification IN ('primary_read','search_only','access_blocked')),
 scope TEXT NOT NULL CHECK(scope IN ('in_window','undated','out_of_window')),
 origin_key TEXT NOT NULL, summary_ko TEXT NOT NULL, excerpt TEXT NOT NULL,
 commercialization_stage TEXT NOT NULL, limitations_json TEXT NOT NULL,
 accessed_at TEXT NOT NULL, source_date_basis TEXT NOT NULL CHECK(source_date_basis IN ('page','search_index','unknown')),
 evidence_locator TEXT NOT NULL, record_sha256 TEXT NOT NULL CHECK(length(record_sha256)=64),
 captured_source_sha256 TEXT CHECK(captured_source_sha256 IS NULL),
 raw_record_json TEXT NOT NULL
);
CREATE TABLE Claims(
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES Sources(id), claim_text TEXT NOT NULL,
 claim_kind TEXT NOT NULL CHECK(claim_kind IN ('official_statement','media_report','research_result','inference')),
 editorial_status TEXT NOT NULL CHECK(editorial_status='source_attributed_not_independently_verified'),
 event_date TEXT, published_at TEXT, ingested_at TEXT NOT NULL,
 independently_verified INTEGER NOT NULL DEFAULT 0 CHECK(independently_verified=0),
 scheduled_event_date TEXT, origin_record_id TEXT,
 verification TEXT NOT NULL CHECK(verification IN ('primary_read','search_only','access_blocked')),
 evidence_locator TEXT NOT NULL, limitations_json TEXT NOT NULL
);
CREATE TABLE SourceEntities(
 source_id TEXT NOT NULL REFERENCES Sources(id), entity_id TEXT NOT NULL REFERENCES Entities(id),
 PRIMARY KEY(source_id,entity_id)
);
CREATE TABLE Queries(id TEXT PRIMARY KEY, query_text TEXT NOT NULL, category TEXT NOT NULL, raw_query_json TEXT NOT NULL);
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


def build(source: Path, out_dir: Path) -> dict:
    raw = source.read_bytes()
    data = validate(json.loads(raw))
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / 'rx-research.sqlite'
    fd, temporary_name = tempfile.mkstemp(prefix='.rx-research-', suffix='.sqlite', dir=out_dir)
    os.close(fd)
    temporary = Path(temporary_name)
    try:
        with sqlite3.connect(temporary) as db:
            db.executescript(SCHEMA)
            metadata = {**data['meta'], 'schema_version': '1.1', 'source_json_sha256': sha256(raw),
                        'storage_kind': 'portable_sqlite_snapshot', 'claim_editorial_status': EDITORIAL_STATUS,
                        'record_hash_semantics': 'SHA-256 of canonical record JSON, not original HTML or source bytes',
                        'captured_source_hash_semantics': 'NULL: original source bytes were not captured by this builder',
                        'history_policy': 'Immutable imported rows in each exported snapshot; input JSON versions tracked in Git'}
            db.executemany('INSERT INTO Metadata VALUES(?,?)', [(key, canonical(value)) for key, value in sorted(metadata.items())])
            all_entities = sorted({entity_id for record in data['records'] for entity_id in record['entity_ids']})
            for entity_id in all_entities:
                name, kind = ENTITY_NAMES.get(entity_id, (entity_id, 'Unresolved'))
                db.execute('INSERT INTO Entities VALUES(?,?,?,?)', (entity_id, name, kind, 'Research indexing entity; inclusion does not establish a business relationship'))
            for record in sorted(data['records'], key=lambda item: item['id']):
                normalized_record = canonical(record)
                db.execute('''INSERT INTO Sources VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''', (
                    record['id'], record['title'], record['url'], record['publisher'], record['published_at'], record['event_date'], record.get('scheduled_event_date'),
                    record['source_type'], record['verification'], record['scope'], record['origin_key'], record['summary_ko'],
                    record['excerpt'], record['commercialization_stage'], canonical(record['limitations']), record['accessed_at'],
                    record['date_basis'], record['evidence_locator'], sha256(normalized_record), None, normalized_record,
                ))
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
    finally:
        temporary.unlink(missing_ok=True)
    return {'database': str(target), 'json': str(out_dir / 'rx-research.json'), 'sources': len(data['records']),
            'claims': sum(len(record_claims(record)) for record in data['records']), 'independent_origins': len({record['origin_key'] for record in data['records']}),
            'queries': len(data['queries']), 'source_json_sha256': sha256(raw)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=ROOT / 'src/research-data.json')
    parser.add_argument('--out-dir', type=Path, default=ROOT / 'public/data')
    parser.add_argument('--validate-only', action='store_true')
    args = parser.parse_args()
    if args.validate_only:
        loaded = validate(json.loads(args.input.read_bytes()))
        print(json.dumps({'valid': True, 'sources': len(loaded['records']), 'queries': len(loaded['queries'])}))
    else:
        print(json.dumps(build(args.input, args.out_dir), ensure_ascii=False))
