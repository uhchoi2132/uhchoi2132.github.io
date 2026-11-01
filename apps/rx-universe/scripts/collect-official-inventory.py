#!/usr/bin/env python3
"""Bounded, robots-aware public URL inventory. No automatic claims or archives.

Only metadata and short review excerpts are persisted. DOCX XML is inspected in
memory with ZIP limits; JavaScript and discovered request endpoints are not run.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict, deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import io
import json
from pathlib import Path, PurePosixPath
import re
import threading
import time
from urllib import error, parse, request, robotparser
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
AGENT = 'RXPublicResearchInventory/1.1'
KEYWORDS = ['RX', 'robot', 'robotics', '로봇', '오케스트레이션', 'orchestration', 'physical AI', '피지컬', 'humanoid', '휴머노이드', 'MES', 'RCS', 'MCS', 'AMHS', 'Nexplant', 'Nexphere', 'smart factory', '스마트팩토리', '스마트공장', '자율제조', '자율 제조', '제조 AI', '제조 AX', '제조 자동화', 'digital twin', '디지털 트윈', '디지털트윈', '다크팩토리', 'Rainbow', '레인보우', 'Walden', 'RoboForce', 'Genesis AI', 'Embodied', 'manipulation', 'vision-language-action']
SKIP_PATH = re.compile(r'(?:\.(?:jpg|jpeg|png|gif|svg|webp|mp4|mp3|zip|css|js|woff2?)(?:\?|$)|privacy|cookie|terms-of|login|logout|signup|share=|/tag/|/category/|/author/|/archive/|/comments?(?:/|\?|$)|/(?:rss|feed|atom)(?:/|\?|$)|[?&](?:feed|replytocom)=)', re.I)
ARTICLE_PATH = re.compile(r'(news|press|insight|blog|product|solution|manufactur|robot|event|webinar|research|publication|paper|investor|earnings|report|customer-support|media|\.pdf|\.docx|/dn\d+/|/\d+/?$)', re.I)
DATE = re.compile(r'(?<!\d)(20\d{2})[./-](\d{1,2})[./-](\d{1,2})(?!\d)')
PAGING_KEYS = {'page', 'p', 'pageno', 'pagenum', 'pageindex', 'currentpage', 'pagenumber'}
VOID_TAGS = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}
BLOCK_CLASS = re.compile(r'(?:^|[\s_-])(?:card|item|row|newsbox|articlebox|post)(?:$|[\s_-])', re.I)
NAV_CLASS = re.compile(r'(?:^|[\s_-])(?:nav|gnb|lnb|footer|header|menu|calendar)(?:$|[\s_-])', re.I)
DYNAMIC = re.compile(r'(load\s*more|loadMore|더\s*보기|goPage|movePage|fnPage|paging|pagination|ajax|fetch\s*\()', re.I)
ENDPOINT = re.compile(r'''(?:\burl\s*:\s*|\baction\s*=\s*|fetch\s*\(\s*|\.(?:get|post|getJSON)\s*\(\s*)["']([^"']{1,500})["']''', re.I)
LITERAL_URL = re.compile(r'''["']((?:https?://|/)[^"'<>\s]{1,500})["']''')


def now(): return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
def digest(text): return hashlib.sha256(text.encode()).hexdigest()[:20]
def host(url): return parse.urlsplit(url).netloc.lower().removeprefix('www.')
def canonical(url):
    p = parse.urlsplit(url.strip())
    query = [(k, v) for k, v in parse.parse_qsl(p.query) if not k.lower().startswith('utm_') and k.lower() not in {'fbclid', 'gclid'}]
    path = parse.quote(parse.unquote(p.path or '/'), safe="/!$&'()*+,;=:@-._~")
    return parse.urlunsplit((p.scheme.lower(), p.netloc.lower(), path, parse.urlencode(sorted(query)), ''))
def as_date(value):
    match = DATE.search(value or '')
    if not match: return None
    try: return datetime(*map(int, match.groups())).date().isoformat()
    except ValueError: return None
def keywords(text):
    return [word for word in KEYWORDS if re.search(r'(?<![A-Za-z0-9])' + re.escape(word) + r'(?![A-Za-z0-9])' if word.isascii() else re.escape(word), text, re.I)]
def bounded_text(text, chars=120, words=20):
    return ' '.join(' '.join(text.split()).split(' ')[:words])[:chars].strip()
def excerpt(text):
    pattern = re.compile('|'.join(re.escape(word) for word in KEYWORDS), re.I)
    match = pattern.search(text)
    offset = max(0, match.start() - 45) if match else 0
    return bounded_text(text[offset:], 240, 25)
def is_next_page(current, target, link):
    """Follow observed same-collection pagination, never calendars or general feeds."""
    c, t = parse.urlsplit(current), parse.urlsplit(target)
    if host(current) != host(target) or t.scheme not in {'http', 'https'}: return False
    if re.search(r'/(?:archive|comments?|feed|rss|atom)(?:/|$)|[?&](?:feed|replytocom)=', target, re.I): return False
    base = lambda path: re.sub(r'/page/\d+/?$', '', path).rstrip('/')
    if base(c.path) != base(t.path): return False
    cq, tq = dict(parse.parse_qsl(c.query)), dict(parse.parse_qsl(t.query))
    fixed = lambda q: {k: v for k, v in q.items() if k.lower() not in PAGING_KEYS}
    if fixed(cq) != fixed(tq): return False
    pages = [v for k, v in tq.items() if k.lower() in PAGING_KEYS]
    path_page = re.search(r'/page/(\d+)/?$', t.path)
    numbered = bool(path_page) or bool(pages and all(v.isdigit() and 0 < int(v) <= 1000 for v in pages))
    title = (link.get('text', '') + ' ' + link.get('label', '')).strip()
    signaled = 'next' in link.get('rel', '').lower() or link.get('pagination') or re.search(r'다음|next|[›»]|^\d+$', title, re.I)
    return bool(numbered and signaled and canonical(current) != canonical(target))


class Page(HTMLParser):
    """Retain a link's nearest dated card, not an unrelated page/calendar date."""
    def __init__(self, url):
        super().__init__(convert_charrefs=True)
        self.url, self.links, self.meta, self.text, self.scripts = url, [], {}, [], []
        self.frames, self.anchor, self.title = [], None, ''
        self.inline_scripts, self.handlers, self.forms, self.endpoint_hints = [], [], [], []
        self.dynamic_controls = False
    def hint(self, value, origin):
        for match in ENDPOINT.finditer(value):
            target = match.group(1)
            if target.startswith(('https://', 'http://', '/')):
                self.endpoint_hints.append({'url': canonical(parse.urljoin(self.url, target)), 'found_in': origin, 'method': 'unconfirmed', 'requested': False})
    def handle_starttag(self, tag, attrs):
        a = dict(attrs); context = ' '.join([a.get('class', ''), a.get('id', '')])
        ignored = tag in {'script', 'style', 'noscript'} or any(f['ignored'] for f in self.frames)
        navigation = tag in {'nav', 'header', 'footer'} or bool(NAV_CLASS.search(context)) or any(f['navigation'] for f in self.frames)
        block = {'text': [], 'links': [], 'times': [], 'length': 0} if tag in {'tr', 'li', 'article'} or (tag in {'div', 'section'} and BLOCK_CLASS.search(context)) else None
        frame = {'tag': tag, 'ignored': ignored, 'navigation': navigation, 'block': block, 'heading': tag in {'h1', 'h2', 'h3', 'h4'}, 'pagination': bool(re.search(r'paging|pagination', context, re.I))}
        if tag not in VOID_TAGS: self.frames.append(frame)
        if tag == 'script' and a.get('src'): self.scripts.append(canonical(parse.urljoin(self.url, a['src'])))
        if tag == 'meta': self.meta[a.get('property', a.get('name', '')).lower()] = a.get('content', '')[:500]
        if tag == 'time' and a.get('datetime'):
            self.meta.setdefault('time', a['datetime'])
            for f in self.frames:
                if f['block']: f['block']['times'].append(a['datetime'])
        handler = a.get('onclick', '')
        if handler:
            self.handlers.append(bounded_text(handler, 180, 25)); self.hint(handler, 'onclick')
        if DYNAMIC.search(handler + ' ' + context + ' ' + a.get('aria-label', '')): self.dynamic_controls = True
        if tag == 'form' and a.get('action'):
            self.forms.append({'url': canonical(parse.urljoin(self.url, a['action'])), 'method': a.get('method', 'get').lower(), 'requested': False})
        for key in ['data-url', 'data-api', 'data-endpoint']:
            if a.get(key): self.endpoint_hints.append({'url': canonical(parse.urljoin(self.url, a[key])), 'found_in': key, 'method': 'unconfirmed', 'requested': False})
        if tag == 'a':
            href = a.get('href', '')
            self.anchor = {'url': parse.urljoin(self.url, href), 'text': '', 'heading': '', 'rel': a.get('rel', ''), 'label': a.get('aria-label', ''), 'context': '', 'date': None, 'navigation': navigation, 'pagination': any(f['pagination'] for f in self.frames), 'valid_href': bool(href and not href.startswith(('#', 'javascript:', 'mailto:', 'tel:')))}
            if not self.anchor['valid_href'] and handler:
                literals = [m.group(1) for m in LITERAL_URL.finditer(handler)]
                if literals:
                    self.anchor['url'] = parse.urljoin(self.url, literals[0]); self.anchor['valid_href'] = True
        if tag == 'img' and self.anchor is not None and a.get('alt'):
            self.anchor['label'] += ' ' + a['alt']
    def handle_endtag(self, tag):
        if tag == 'a' and self.anchor is not None:
            link = self.anchor; self.anchor = None
            if link['valid_href']:
                link['text'] = bounded_text(link['heading'] or link['text'])
                for frame in self.frames:
                    if frame['block']: frame['block']['links'].append(link)
                self.links.append(link)
        index = next((i for i in range(len(self.frames) - 1, -1, -1) if self.frames[i]['tag'] == tag), None)
        if index is None: return
        for frame in reversed(self.frames[index:]):
            block = frame['block']
            if not block: continue
            context = ' '.join(block['text'])
            dates = {value for item in block['times'] for value in [as_date(item)] if value}
            if not dates: dates = {as_date(match.group(0)) for match in DATE.finditer(context)}
            date = next(iter(dates)) if len(dates) == 1 else None
            for link in block['links']:
                if not link['context']: link['context'] = bounded_text(context, 300, 35)
                if not link['date'] and date: link['date'] = date
        del self.frames[index:]
    def handle_data(self, data):
        if any(frame['tag'] == 'script' for frame in self.frames):
            if sum(map(len, self.inline_scripts)) < 300_000:
                self.inline_scripts.append(data[:100_000]); self.hint(data[:100_000], 'inline_script')
            if DYNAMIC.search(data): self.dynamic_controls = True
            return
        if any(frame['ignored'] for frame in self.frames): return
        value = ' '.join(data.split())
        if not value: return
        self.text.append(value)
        if any(frame['tag'] == 'title' for frame in self.frames): self.title = bounded_text(self.title + ' ' + value)
        if self.anchor is not None:
            self.anchor['text'] = (self.anchor['text'] + ' ' + value)[:1000]
            if any(frame['heading'] for frame in self.frames): self.anchor['heading'] = (self.anchor['heading'] + ' ' + value)[:240]
        for frame in self.frames:
            block = frame['block']
            if block and block['length'] < 8000:
                block['text'].append(value[:1000]); block['length'] += len(value[:1000])
        if DYNAMIC.search(value): self.dynamic_controls = True


def docx_text(raw):
    """Read only bounded document XML in memory; never extract ZIP paths to disk."""
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entries = archive.infolist()
        if len(entries) > 2000 or sum(item.file_size for item in entries) > 50_000_000: raise ValueError('DOCX ZIP expansion limit')
        if any(item.flag_bits & 1 or PurePosixPath(item.filename).is_absolute() or '..' in PurePosixPath(item.filename).parts for item in entries): raise ValueError('Unsafe or encrypted DOCX ZIP entry')
        item = archive.getinfo('word/document.xml')
        if item.file_size > 4_000_000 or item.file_size > max(1, item.compress_size) * 200: raise ValueError('DOCX XML size/compression limit')
        xml = archive.read(item)
        if b'<!DOCTYPE' in xml.upper() or b'<!ENTITY' in xml.upper(): raise ValueError('DOCX XML declarations are disallowed')
        root = ET.fromstring(xml)
        return ' '.join(element.text or '' for element in root.iter() if element.tag.split('}')[-1] == 't')


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl): return None


class Collector:
    def __init__(self, plan):
        self.plan, self.started, self.robots, self.host_locks = plan, time.monotonic(), {}, {}
        self.lock, self.counts, self.last_request = threading.Lock(), Counter(), {}
        self.deadline = self.started + plan.get('max_seconds', 600)
        self.allowed = lambda url: parse.urlsplit(url).scheme in {'http', 'https'}
    def fetch_raw(self, url, kind='content'):
        if time.monotonic() >= self.deadline: return {'status': 'budget_exhausted', 'http_status': None, 'raw': b'', 'request_attempted': False}
        with self.lock: self.counts[kind + '_requests'] += 1
        req = request.Request(url, headers={'User-Agent': AGENT, 'Accept': 'text/html,application/xhtml+xml,application/xml,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document;q=0.8'})
        limit = self.plan.get('max_response_bytes', 5_000_000)
        try:
            with request.build_opener(NoRedirect).open(req, timeout=min(12, max(1, self.deadline - time.monotonic()))) as response:
                raw = response.read(limit + 1)
                return {'status': 'fetched', 'http_status': response.status, 'url': response.url, 'content_type': response.headers.get('content-type', ''), 'raw': raw[:limit], 'truncated': len(raw) > limit, 'request_attempted': True}
        except error.HTTPError as exc:
            if exc.code in {301, 302, 303, 307, 308} and exc.headers.get('Location'):
                return {'status': 'redirect', 'http_status': exc.code, 'location': canonical(parse.urljoin(url, exc.headers['Location'])), 'raw': b'', 'request_attempted': True}
            return {'status': 'blocked' if exc.code in (401, 403, 429) else 'error', 'http_status': exc.code, 'error': str(exc.reason), 'raw': b'', 'request_attempted': True}
        except Exception as exc: return {'status': 'error', 'http_status': None, 'error': str(exc)[:240], 'raw': b'', 'request_attempted': True}
    def policy(self, url):
        p = parse.urlsplit(url)
        if p.netloc in self.robots: return self.robots[p.netloc]
        robots_url = f'{p.scheme}://{p.netloc}/robots.txt'
        for _ in range(4):
            result = self.fetch_raw(robots_url, 'robots')
            if result['status'] != 'redirect': break
            destination = result['location']
            if not self.allowed(destination) or parse.urlsplit(destination).path != '/robots.txt': break
            robots_url = destination
        if result['status'] == 'fetched':
            robot = robotparser.RobotFileParser(); robot.parse(result['raw'].decode('utf-8', 'replace').splitlines()); self.robots[p.netloc] = robot
        elif result['http_status'] == 404: self.robots[p.netloc] = None
        else: self.robots[p.netloc] = False
        return self.robots[p.netloc]
    def fetch(self, url):
        attempted = False
        for _ in range(6):
            if time.monotonic() >= self.deadline: return {'status': 'budget_exhausted', 'http_status': None, 'raw': b'', 'request_attempted': attempted}
            if not self.allowed(url): return {'status': 'redirect_out_of_scope', 'http_status': None, 'raw': b'', 'request_attempted': attempted}
            p = parse.urlsplit(url)
            with self.lock: host_lock = self.host_locks.setdefault(host(url), threading.Lock())
            with host_lock:
                robot = self.policy(url)
                if robot is False: return {'status': 'blocked', 'http_status': None, 'error': 'robots.txt could not be checked; no content request made', 'raw': b'', 'request_attempted': attempted}
                if robot and not robot.can_fetch(AGENT, url): return {'status': 'robots_disallowed', 'http_status': None, 'raw': b'', 'request_attempted': attempted}
                rate = robot.request_rate(AGENT) if robot else None
                delay = max(self.plan.get('per_host_delay_seconds', .2), (robot.crawl_delay(AGENT) or 0) if robot else 0, rate.seconds / rate.requests if rate and rate.requests else 0)
                wait = max(0, delay - (time.monotonic() - self.last_request.get(host(url), 0)))
                if wait > 30 or time.monotonic() + wait >= self.deadline: return {'status': 'crawl_delay_deferred', 'http_status': None, 'raw': b'', 'request_attempted': attempted}
                if wait: time.sleep(wait)
                result = self.fetch_raw(url); attempted |= result['request_attempted']; self.last_request[host(url)] = time.monotonic()
            if result['status'] == 'redirect': url = result['location']; continue
            result['request_attempted'] = attempted; result['final_url'] = url
            return result
        return {'status': 'redirect_limit', 'http_status': None, 'raw': b'', 'request_attempted': attempted}


def byte_metadata(response):
    raw = response['raw']; complete = not response.get('truncated', False)
    return {'content_sha256': hashlib.sha256(raw).hexdigest() if complete else None, 'observed_bytes_sha256': hashlib.sha256(raw).hexdigest(), 'hash_scope': 'complete_response' if complete else 'truncated_prefix', 'observed_bytes': len(raw), 'archive_status': 'not_archived', 'content_type': response.get('content_type', '')}

def fair_rows(rows, per_host):
    buckets = defaultdict(deque)
    for row in rows: buckets[host(row['url'])].append(row)
    selected, deferred = [], []
    for key in list(buckets):
        while len(buckets[key]) > per_host: deferred.append(buckets[key].pop())
    while buckets:
        for key in list(buckets):
            selected.append(buckets[key].popleft())
            if not buckets[key]: del buckets[key]
    return selected, deferred

def previous_candidates(plan, output):
    prior = {}
    for pattern in plan.get('previous_inventory_globs', ['research/survey/crawl-*.json']):
        for file in sorted(ROOT.glob(pattern)):
            if file.resolve() == output.resolve(): continue
            try: data = json.loads(file.read_text())
            except (OSError, json.JSONDecodeError): continue
            for item in data.get('candidates', []):
                if item.get('fetch_status') == 'fetched' and not any('truncat' in str(note).lower() for note in item.get('notes', [])):
                    prior[canonical(item['url'])] = {**item, 'previous_inventory': str(file.relative_to(ROOT))}
    return prior

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--plan', default=str(ROOT/'research/collection-plan.json')); ap.add_argument('--output', default=str(ROOT/'research/survey/crawl-20261031-expanded.json')); args = ap.parse_args()
    plan = json.loads(Path(args.plan).read_text()); collector = Collector(plan); out = Path(args.output)
    start = now(); run_id = 'official-survey-' + start.replace(':', '').replace('.', '')
    collections, candidates, visited, suppressed = [], {}, set(), Counter()
    all_seeds, explicit_urls = list(plan['collections']), []
    discovery_files = sorted((ROOT/'research').glob('discovery-*.json'))
    for file in discovery_files:
        data = json.loads(file.read_text()); explicit_urls += data.get('urls', []); all_seeds += data.get('collections', [])
    all_seeds = list({canonical(seed['url']): {**seed, 'url': canonical(seed['url'])} for seed in all_seeds}.values())
    seed_urls = {seed['url'] for seed in all_seeds}
    explicit_set = {canonical(item['url'] if isinstance(item, dict) else item) for item in explicit_urls}
    allowed_hosts = {host(url) for url in seed_urls | explicit_set} | set(plan.get('allowed_detail_hosts', []))
    def allowed(url): return parse.urlsplit(url).scheme in {'http', 'https'} and host(url) in allowed_hosts
    collector.allowed = allowed
    prior = previous_candidates(plan, out)
    def add(url, title='', publisher='', collection='', date=None, explicit=False):
        if not allowed(url) or SKIP_PATH.search(url): return
        url = canonical(url)
        if url in seed_urls and not explicit: return
        if not explicit and not ARTICLE_PATH.search(url) and not keywords(title): return
        row = candidates.setdefault(url, {'id': 'discovery:'+digest(url), 'run_id': run_id, 'url': url, 'canonical_url': url, 'title': bounded_text(title), 'publisher': publisher, 'collection_urls': [], 'discovered_at': start, 'published_at': date, 'date_basis': 'collection_card' if date else 'unknown', 'fetch_status': 'discovered', 'http_status': None, 'content_sha256': None, 'matched_keywords': keywords(title), 'relevance': 'unreviewed', 'source_ids': [], 'archive_status': 'not_archived', 'notes': []})
        if collection and collection not in row['collection_urls']: row['collection_urls'].append(collection)
        if not row['title'] and title: row['title'] = bounded_text(title)
        if date and not row['published_at']: row['published_at'], row['date_basis'] = date, 'collection_card'
        if row['published_at'] and not plan['window_start'] <= row['published_at'] <= plan['window_end']: row['relevance'] = 'out_of_window'
    for item in explicit_urls:
        if isinstance(item, dict): add(item['url'], item.get('title', ''), item.get('publisher', ''), date=item.get('published_at'), explicit=True)
        else: add(item, explicit=True)
    queues = defaultdict(deque)
    for seed in all_seeds: queues[host(seed['url'])].append((seed, seed['url'], 0))
    host_turns = deque(queues); host_pages, seed_pages = Counter(), Counter()
    max_pages, max_seed = plan.get('max_collection_pages', 180), plan.get('max_pages_per_collection', 6)
    host_limit = plan.get('max_collection_pages_per_host', 30)
    collection_deadline = min(collector.deadline, collector.started + plan.get('max_collection_seconds', 240))
    while host_turns and len(visited) < max_pages and time.monotonic() < collection_deadline:
        key = host_turns.popleft(); seed, url, depth = queues[key].popleft(); url = canonical(url)
        if queues[key]: host_turns.append(key)
        if url in visited: continue
        if seed_pages[seed['url']] >= seed.get('max_pages', max_seed) or (depth and host_pages[key] >= host_limit): suppressed['collection_host_or_seed_limit'] += 1; continue
        visited.add(url); host_pages[key] += 1; seed_pages[seed['url']] += 1; response = collector.fetch(url)
        record = {'id': 'collection:'+digest(url), 'run_id': run_id, 'url': url, 'publisher': seed.get('publisher', ''), 'label': seed.get('label', ''), 'accessed_at': now(), 'status': response['status'], 'http_status': response['http_status'], 'request_attempted': response.get('request_attempted', False), 'pages_visited': [url], 'discovered_urls': [], 'next_urls': [], 'truncated': response.get('truncated', False), 'notes': []}
        if response.get('error'): record['notes'].append(response['error'])
        if response['status'] == 'fetched':
            raw = response['raw']; record.update(byte_metadata(response)); page = Page(response.get('final_url', url)); text = raw.decode('utf-8', 'replace'); links = []
            if 'xml' in response.get('content_type', '') or text.lstrip().startswith('<?xml'):
                try:
                    if '<!DOCTYPE' in text.upper() or '<!ENTITY' in text.upper(): raise ValueError('XML declarations disallowed')
                    xml = ET.fromstring(text)
                    for item in xml.iter():
                        if item.tag.split('}')[-1] in ('loc', 'link') and item.text and item.text.startswith('http'): links.append({'url': item.text, 'text': '', 'rel': '', 'context': '', 'date': None})
                except (ET.ParseError, ValueError): record['notes'].append('XML parse failed or unsupported declaration')
            else:
                page.feed(text); page.close(); links = page.links
                record['script_urls'] = list(dict.fromkeys(page.scripts))[:40]
                record['observed_title'] = bounded_text(page.title)
                record['request_endpoint_hints'] = list({hint['url']: hint for hint in page.endpoint_hints if allowed(hint['url'])}.values())[:30]
                record['form_hints'] = page.forms[:12]
                record['onclick_hints'] = list(dict.fromkeys(page.handlers))[:20]
            observed_dates = []
            for link in links:
                target = canonical(link['url']); title = link['text'].strip(); published = link.get('date')
                if is_next_page(url, target, link): record['next_urls'].append(target)
                elif 'next' in link.get('rel', '') or re.search(r'다음|next|[›»]', title + link.get('label', ''), re.I): suppressed['non_collection_next_link'] += 1
                if link.get('navigation') or is_next_page(url, target, link): continue
                if target != url:
                    add(target, title, seed.get('publisher', ''), url, published)
                    if target in candidates:
                        record['discovered_urls'].append(target)
                        if published: observed_dates.append(published)
            record['discovered_urls'] = list(dict.fromkeys(record['discovered_urls']))
            record['next_urls'] = list(dict.fromkeys(record['next_urls']))
            record['dated_card_links'] = len(observed_dates)
            record['window_boundary_reached'] = bool(observed_dates and max(observed_dates) < plan['window_start'])
            if record['window_boundary_reached']: record['notes'].append('All dated cards precede the fixed window; older pagination not followed. Undated links still require review.')
            else:
                for target in record['next_urls'][:plan.get('max_next_links_per_page', 4)]:
                    if target not in visited:
                        if key not in host_turns: host_turns.append(key)
                        queues[key].append((seed, target, depth + 1))
            record['pagination_gap'] = bool(page.dynamic_controls and not record['next_urls'] and not record['window_boundary_reached'])
            if record['pagination_gap']: record['notes'].append('Dynamic pagination/request hints observed but no navigable next-page URL was extracted. Scripts/endpoints were not executed; collection coverage remains incomplete.')
            if not record['discovered_urls']: record['notes'].append('No article links extracted; a dynamic or empty collection is possible. Completeness not established.')
        collections.append(record)
        print(json.dumps({'collection': url, 'status': record['status'], 'urls': len(record['discovered_urls']), 'dated': record.get('dated_card_links', 0), 'pagination_gap': record.get('pagination_gap', False)}), flush=True)
    reused = 0
    for row in candidates.values():
        old = prior.get(row['url'])
        date_changed = old and row['published_at'] and row['published_at'] != old.get('published_at')
        if not old or date_changed or row['relevance'] == 'out_of_window': continue
        for field in ['title', 'published_at', 'date_basis', 'matched_keywords', 'relevance', 'content_sha256', 'http_status', 'fetched_at']:
            if old.get(field) is not None: row[field] = old[field]
        row['title'] = bounded_text(row['title']); row['fetch_status'] = 'fetched'; row['fetch_in_current_run'] = False
        row['previous_inventory'] = old['previous_inventory']; row['notes'].append('Prior successful response reused as metadata; not fetched, archived or reverified in this run.'); reused += 1
    pending = [row for row in candidates.values() if row['relevance'] != 'out_of_window' and row['fetch_status'] != 'fetched']
    pending.sort(key=lambda row: (row['url'] not in explicit_set, not bool(row['matched_keywords']), row['published_at'] is None, row['url']))
    ranked, host_deferred = fair_rows(pending, plan.get('max_detail_pages_per_host', 120))
    max_details = plan.get('max_detail_pages', 600); selected = ranked[:max_details]
    def detail(row):
        response = collector.fetch(row['url']); row.update({'fetch_status': response['status'], 'http_status': response['http_status'], 'fetched_at': now(), 'request_attempted': response.get('request_attempted', False), 'fetch_in_current_run': response['status'] == 'fetched'})
        if response.get('error'): row['notes'].append(response['error'])
        if response['status'] != 'fetched': return
        row.update(byte_metadata(response)); raw = response['raw']
        if response.get('truncated'): row['notes'].append('Response byte limit reached; hash describes only the observed prefix and parsing was not attempted.'); row['body_parse_status'] = 'truncated'; return
        content_type = response.get('content_type', '').lower()
        if 'pdf' in content_type or parse.urlsplit(row['url']).path.lower().endswith('.pdf'):
            row['body_parse_status'] = 'pdf_not_parsed'; row['notes'].append('PDF bytes fetched; body not parsed or reviewed.'); return
        if 'wordprocessingml' in content_type or parse.urlsplit(row['url']).path.lower().endswith('.docx'):
            try:
                body = docx_text(raw); row['body_parse_status'] = 'docx_bounded_xml'; row['parsed_text_chars'] = len(body); row['review_excerpt'] = excerpt(body); row['matched_keywords'] = keywords(body)
                row['title'] = row['title'] or bounded_text(parse.unquote(parse.urlsplit(row['url']).path.rsplit('/', 1)[-1]))
            except (ValueError, zipfile.BadZipFile, KeyError, ET.ParseError, RuntimeError) as exc:
                row['body_parse_status'] = 'docx_parse_rejected'; row['notes'].append(str(exc)[:180]); return
        elif 'html' in content_type or raw.lstrip().startswith((b'<html', b'<!DOCTYPE', b'<!doctype')):
            page = Page(response.get('final_url', row['url'])); page.feed(raw.decode('utf-8', 'replace'))
            row['title'] = bounded_text(page.meta.get('og:title') or page.title or row['title'])
            published = next((as_date(page.meta.get(key)) for key in ('article:published_time', 'datepublished', 'date', 'publication_date', 'pubdate') if as_date(page.meta.get(key))), None)
            if published: row['published_at'], row['date_basis'] = published, 'page_metadata'
            body = ' '.join(page.text); row['matched_keywords'] = keywords(body); row['body_parse_status'] = 'html_keywords_only'
        else: row['body_parse_status'] = 'unsupported_content_type'; row['notes'].append('Non-HTML content was not interpreted as article text.'); return
        row['relevance'] = 'candidate' if row['matched_keywords'] else 'no_keyword_match'
        if row['published_at'] and not plan['window_start'] <= row['published_at'] <= plan['window_end']: row['relevance'] = 'out_of_window'
        row['notes'].append('Automated candidate only; keywords may be navigation. No claim, original archive, factual verification or completeness is implied.')
    with ThreadPoolExecutor(max_workers=plan.get('workers', 6)) as pool:
        futures = {pool.submit(detail, row): row for row in selected}
        for future in as_completed(futures):
            try: future.result()
            except Exception as exc:
                row = futures[future]; row['body_parse_status'] = 'parse_error'; row['notes'].append('Parsing failed safely: ' + str(exc)[:160])
    for row in ranked[max_details:] + host_deferred: row['notes'].append('Detail request or host fairness limit reached; discovery metadata only.')
    statuses = Counter(row['fetch_status'] for row in candidates.values())
    gaps = sum(bool(item.get('pagination_gap')) or item['status'] != 'fetched' for item in collections)
    remaining = sum(len(queue) for queue in queues.values())
    incomplete = bool(remaining or host_deferred or len(ranked) > max_details or suppressed['collection_host_or_seed_limit'] or gaps or any(row['fetch_status'] not in {'fetched'} for row in selected) or time.monotonic() >= collector.deadline)
    run = {'id': run_id, 'started_at': start, 'finished_at': now(), 'status': 'completed_with_limits' if incomplete else 'completed', 'window_start': plan['window_start'], 'window_end': plan['window_end'], 'discovery_files': [str(file.relative_to(ROOT)) for file in discovery_files], 'requested_collections': len(all_seeds), 'collection_pages_processed': len(collections), 'collection_requests_attempted': sum(bool(item['request_attempted']) for item in collections), 'collection_pages_fetched': sum(item['status'] == 'fetched' for item in collections), 'collection_pages_pending': remaining, 'collection_gaps': gaps, 'candidates_discovered': len(candidates), 'detail_pages_scheduled': len(selected), 'detail_requests_attempted': sum(bool(row.get('request_attempted')) for row in selected), 'detail_pages_fetched': sum(bool(row.get('fetch_in_current_run')) for row in selected), 'prior_successful_responses_reused': reused, 'detail_host_deferred': len(host_deferred), 'detail_status_counts': dict(statuses), 'network_requests': dict(collector.counts), 'suppressed': dict(suppressed), 'request_budget': {'collection_pages': max_pages, 'detail_pages': max_details, 'per_collection': max_seed, 'collection_per_host': host_limit, 'detail_per_host': plan.get('max_detail_pages_per_host', 120)}, 'time_budget_seconds': plan.get('max_seconds', 600), 'elapsed_seconds': round(time.monotonic() - collector.started, 2), 'truncated': incomplete, 'limitations': ['A completed bounded run is not proof of exhaustive coverage.', 'Script/request endpoint hints are observations, not executed requests or validated pagination.', 'Unknown dates, JavaScript-only pagination and access/robots failures remain review gaps.', 'Complete-response hashes identify observed bytes; no retained original archive or factual verification is claimed.', 'Only bounded titles and at most 25-word/240-character DOCX excerpts are persisted; no article or document body is published.', 'Repeated successful responses are explicitly reused metadata; newly discovered dates trigger refetch.']}
    out.parent.mkdir(parents=True, exist_ok=True); out.write_text(json.dumps({'runs': [run], 'collections': collections, 'candidates': list(candidates.values())}, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(run), flush=True)

if __name__ == '__main__': main()
