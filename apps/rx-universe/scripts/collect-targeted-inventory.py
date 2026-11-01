#!/usr/bin/env python3
"""Inspect four official list views, then follow only observed public read-only list requests.

Only actual list forms/AJAX configurations are replayed, including explicitly
observed POST search/list forms. No JS execution, guessed routes, or claims. Route diagnostics are short code metadata.
"""
from __future__ import annotations
import argparse
from collections import Counter
import importlib.util
import json
from pathlib import Path
import re
import time
from urllib import parse, request, error

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('inventory', Path(__file__).with_name('collect-official-inventory.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
TARGETS = [
    ('Miracom insights', 'https://miracom-inc.com/kr/customer-support/insight-reports/dn6'),
    ('Miracom M-FOCUS', 'https://miracom-inc.com/kr/customer-support/miracom-focus/dn14'),
    ('Miracom library', 'https://miracom-inc.com/kr/customer-support/library/dn5'),
    ('Samsung SDI news', 'https://www.samsungsdi.co.kr/sdi-now/sdi-news/list.html'),
]
PAGE_NAMES = {'page', 'p', 'pageno', 'pagenum', 'pageindex', 'currentpage', 'pagenumber', 'curpage', 'currentpageno', 'cpage', 'page_no', 'current_page', 'page_num'}
READ_ONLY_LIST_PATHS = {'/user/Board/comm_notice.do', '/user/Board/comm_notice_more.do', '/sdi-now/sdi-news/list.html', '/sdi-now/sdi-news/list/ajax.html', '/kr/customer-support/insight-reports/dn6', '/kr/customer-support/miracom-focus/dn14', '/kr/customer-support/library/dn5'}
SECRET = re.compile(r'token|csrf|password|session|authorization', re.I)


def object_at(text, offset):
    """Bounded brace scanner for diagnostics; never executes a script."""
    depth, quote, escaped = 0, '', False
    for index in range(offset, min(len(text), offset + 16000)):
        char = text[index]
        if quote:
            if escaped: escaped = False
            elif char == '\\': escaped = True
            elif char == quote: quote = ''
            continue
        if char in '\'"`': quote = char; continue
        if char == '{': depth += 1
        if char == '}':
            depth -= 1
            if not depth: return text[offset:index + 1]
    return ''


def ajax_hints(text, url):
    hints = []
    for match in re.finditer(r'(?:\$|jQuery)\s*\.\s*ajax\s*\(\s*(\{)', text):
        body = object_at(text, match.start(1))
        endpoint = re.search(r'\burl\s*:\s*[\'"]([^\'"<>]+)[\'"]', body)
        if not endpoint: continue
        method = re.search(r'\b(?:type|method)\s*:\s*[\'"](GET|POST|PUT|PATCH|DELETE)[\'"]', body, re.I)
        form = re.search(r'(?:\$|jQuery)\([\'"]#([\w-]+)[\'"]\)\s*\.\s*serialize\s*\(', body)
        hints.append({'url': base.canonical(parse.urljoin(url, endpoint.group(1))), 'method': method.group(1).upper() if method else 'GET_DEFAULT', 'serialized_form_id': form.group(1) if form else None, 'basis': 'observed jQuery.ajax configuration; absent method uses documented GET default', 'requested': False})
    return hints


class InspectPage(base.Page):
    def __init__(self, url):
        super().__init__(url)
        self.form_definitions, self.current_form, self.unlinked_cards = [], None, []
        self.sdi_detail_template = None
    def handle_starttag(self, tag, attrs):
        attrs = list(attrs); values = dict(attrs)
        if tag == 'form':
            self.current_form = {'id': values.get('id', values.get('name', '')), 'url': base.canonical(parse.urljoin(self.url, values.get('action') or self.url)), 'method': values.get('method', 'GET').upper(), 'fields': {}}
            self.form_definitions.append(self.current_form)
        if tag == 'input' and self.current_form and values.get('name') and not SECRET.search(values['name']):
            kind = values.get('type', 'text').lower()
            if kind not in {'submit', 'button', 'file', 'password'} and (kind not in {'radio', 'checkbox'} or 'checked' in values):
                self.current_form['fields'][values['name']] = values.get('value', '')[:100]
        if tag == 'a' and self.sdi_detail_template:
            invocation = values.get('onclick', '') + ' ' + values.get('href', '')
            match = re.search(r'fnDetailForm\s*\(\s*(\d+)\s*\)', invocation)
            if match: attrs = [(key, value) for key, value in attrs if key != 'href'] + [('href', self.sdi_detail_template.format(id=match.group(1)))]
        super().handle_starttag(tag, attrs)
    def handle_endtag(self, tag):
        for frame in reversed(self.frames):
            if frame['tag'] != tag: continue
            block = frame['block']
            if block and not block['links'] and not frame['navigation']:
                text = ' '.join(block['text']); date = base.as_date(text)
                if date: self.unlinked_cards.append({'text': base.bounded_text(text), 'date': date, 'url': None, 'review_status': 'unlinked_card_only'})
            break
        super().handle_endtag(tag)
        if tag == 'form': self.current_form = None


def sdi_template(text, url):
    match = re.search(r'function\s+fnDetailForm\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*(\{)', text)
    if not match: return None
    body = object_at(text, match.start(2)); variable = re.escape(match.group(1))
    prefix = re.search(r'[\'"]([^\'"\n]*)[\'"]\s*\+\s*' + variable + r'\s*\+\s*[\'"]\.html[\'"]', body)
    if prefix: return parse.urljoin(url, prefix.group(1) + '{id}.html')
    if re.search(variable + r'\s*\+\s*[\'"]\.html[\'"]', body): return parse.urljoin(url, '{id}.html')
    return None


def parse_page(raw, url):
    text = raw.decode('utf-8', 'replace')
    if text.lstrip().startswith(('{', '[')):
        try:
            payload = json.loads(text); fragments = []
            def html_fragments(value, depth=0):
                if depth > 5: return
                if isinstance(value, str) and re.search(r'<(?:a|li|div|tr)\b', value, re.I): fragments.append(value)
                elif isinstance(value, dict):
                    for item in value.values(): html_fragments(item, depth + 1)
                elif isinstance(value, list):
                    for item in value[:200]: html_fragments(item, depth + 1)
            html_fragments(payload)
            if fragments: text = '\n'.join(fragments)
        except json.JSONDecodeError: pass
    page = InspectPage(url)
    if base.host(url) == 'samsungsdi.co.kr': page.sdi_detail_template = sdi_template(text, url)
    page.feed(text); page.close()
    return page, text


def routes_for(page, text):
    same = lambda endpoint: base.host(endpoint) == base.host(page.url)
    routes = []
    for form in page.form_definitions:
        # Only this list's form; exclude the site's global search GET form.
        if form['method'] in {'GET', 'POST'} and same(form['url']) and (parse.urlsplit(form['url']).path == parse.urlsplit(page.url).path or parse.urlsplit(form['url']).path in READ_ONLY_LIST_PATHS):
            fields = form['fields']; key = next((name for name in fields if name.lower() in PAGE_NAMES), None)
            if key: routes.append({**form, 'page_field': key, 'basis': 'observed read-only list form, its HTTP method and page input'})
    for ajax in ajax_hints(text, page.url):
        if ajax['method'] not in {'GET', 'GET_DEFAULT', 'POST'} or not same(ajax['url']) or parse.urlsplit(ajax['url']).path not in READ_ONLY_LIST_PATHS: continue
        form = next((item for item in page.form_definitions if item['id'] == ajax['serialized_form_id']), None)
        if not form: continue
        key = next((name for name in form['fields'] if name.lower() in PAGE_NAMES), None)
        if key: routes.append({'url': ajax['url'], 'method': 'POST' if ajax['method'] == 'POST' else 'GET', 'fields': form['fields'], 'page_field': key, 'basis': 'observed read-only ajax list endpoint, method and serialized form'})
    return routes


def post_list(collector, url, fields):
    # Caller only supplies forms/configurations parsed from a known official list.
    empty = {'http_status': None, 'raw': b'', 'request_attempted': False}
    if not collector.allowed(url) or parse.urlsplit(url).path not in READ_ONLY_LIST_PATHS:
        return {**empty, 'status': 'unapproved_post_route'}
    if time.monotonic() >= collector.deadline: return {**empty, 'status': 'budget_exhausted'}
    robot = collector.policy(url)
    if robot is False: return {**empty, 'status': 'blocked', 'error': 'robots policy unavailable'}
    if robot and not robot.can_fetch(base.AGENT, url): return {**empty, 'status': 'robots_disallowed'}
    rate = robot.request_rate(base.AGENT) if robot else None
    delay = max(.4, (robot.crawl_delay(base.AGENT) or 0) if robot else 0, rate.seconds / rate.requests if rate and rate.requests else 0)
    wait = max(0, delay - (time.monotonic() - collector.last_request.get(base.host(url), 0)))
    if wait > 30 or time.monotonic() + wait >= collector.deadline: return {**empty, 'status': 'crawl_delay_deferred'}
    if wait: time.sleep(wait)
    data = parse.urlencode({key: value for key, value in fields.items() if not SECRET.search(key)}).encode()
    req = request.Request(url, data=data, headers={'User-Agent': base.AGENT, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'text/html,application/json'})
    collector.counts['content_requests'] += 1; collector.counts['observed_list_post_requests'] += 1
    try:
        with request.build_opener(base.NoRedirect).open(req, timeout=12) as response:
            raw = response.read(3_000_001)
            return {'status': 'fetched', 'http_status': response.status, 'raw': raw[:3_000_000], 'truncated': len(raw) > 3_000_000, 'request_attempted': True, 'content_type': response.headers.get('content-type', ''), 'final_url': url}
    except error.HTTPError as exc:
        return {**empty, 'status': 'post_redirect_review' if 300 <= exc.code < 400 else 'blocked' if exc.code in {401, 403, 429} else 'error', 'http_status': exc.code, 'request_attempted': True, 'error': str(exc.reason)[:150]}
    except Exception as exc: return {**empty, 'status': 'error', 'request_attempted': True, 'error': str(exc)[:150]}
    finally: collector.last_request[base.host(url)] = time.monotonic()


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--output', default='research/survey/crawl-20261101-targeted.json'); args = parser.parse_args()
    collector = base.Collector({'max_seconds': 300, 'max_response_bytes': 3_000_000, 'per_host_delay_seconds': .4})
    collector.allowed = lambda url: parse.urlsplit(url).scheme in {'http', 'https'} and base.host(url) in {'miracom-inc.com', 'samsungsdi.co.kr'}
    start = base.now(); run_id = 'targeted-public-list-' + start.replace(':', '').replace('.', '')
    collections, candidates, script_diagnostics = [], {}, []
    max_pages, max_requests = 12, 40
    request_count = 0
    def collect(label, url, parent=None, method='GET', fields=None):
        nonlocal request_count
        request_count += 1; response = post_list(collector, url, fields or {}) if method == 'POST' else collector.fetch(url)
        record = {'id': 'collection:' + base.digest(url + json.dumps(fields or {}, sort_keys=True)), 'run_id': run_id, 'url': url, 'label': label, 'publisher': label, 'accessed_at': base.now(), 'status': response['status'], 'http_status': response['http_status'], 'request_attempted': response.get('request_attempted', False), 'pages_visited': [url], 'discovered_urls': [], 'next_urls': [], 'notes': [], 'parent_collection': parent, 'request_method': method, 'request_fields': fields or {}}
        if response.get('error'): record['notes'].append(response['error'])
        collections.append(record)
        if response['status'] != 'fetched' or response.get('truncated'):
            record['notes'].append('Response unavailable or truncated; no pagination derived.'); return record, None, ''
        record.update(base.byte_metadata(response)); page, text = parse_page(response['raw'], response.get('final_url', url))
        record['observed_list_forms'] = [{**form, 'fields': {key: value for key, value in form['fields'].items() if not SECRET.search(key)}} for form in page.form_definitions]
        record['ajax_configuration_hints'] = ajax_hints(text, page.url)
        record['script_urls'] = [value for value in page.scripts if collector.allowed(value)][:12]
        record['sdi_detail_template_verified'] = bool(page.sdi_detail_template)
        record['unlinked_card_samples'] = page.unlinked_cards[:20]
        dates = []
        for link in page.links:
            target = base.canonical(link['url'])
            if link.get('navigation') or not collector.allowed(target) or base.SKIP_PATH.search(target) or target == base.canonical(page.url): continue
            if not (re.search(r'/dn\d+/[^/?]+|/sdi-news/\d+\.html|/upload/.*\.pdf', target, re.I)): continue
            date = link.get('date')
            if date: dates.append(date)
            row = candidates.setdefault(target, {'id': 'discovery:' + base.digest(target), 'run_id': run_id, 'url': target, 'canonical_url': target, 'title': base.bounded_text(link['text']), 'publisher': label, 'collection_urls': [], 'discovered_at': start, 'published_at': date, 'date_basis': 'collection_card' if date else 'unknown', 'fetch_status': 'discovered', 'http_status': None, 'content_sha256': None, 'matched_keywords': base.keywords(link['text']), 'relevance': 'unreviewed', 'source_ids': [], 'archive_status': 'not_archived', 'notes': ['Official list metadata only; article bodies and claims have not been verified.']})
            row['collection_urls'].append(url)
            if date and not '2025-10-30' <= date <= '2026-10-31': row['relevance'] = 'out_of_window'
            record['discovered_urls'].append(target)
        record['discovered_urls'] = sorted(set(record['discovered_urls']))
        record['dated_card_links'] = len(dates)
        record['window_boundary_reached'] = bool(dates and max(dates) < '2025-10-30')
        record['pagination_gap'] = True
        return record, page, text
    for label, initial in TARGETS:
        if request_count >= max_requests or time.monotonic() >= collector.deadline: break
        initial_record, page, text = collect(label, initial)
        if not page: continue
        routes = routes_for(page, text); initial_record['verified_list_routes'] = routes
        if not routes:
            initial_record['notes'].append('No observed read-only pagination route with a page field was established. Unknown endpoints were not requested.')
            # One documented same-host paging helper can explain hidden route construction.
            scripts = [url for url in page.scripts if collector.allowed(url) and re.search(r'jqueryPaging|common_tobe', url, re.I)]
            for script_url in scripts[:1]:
                if any(item['url'] == script_url for item in script_diagnostics): continue
                request_count += 1; result = collector.fetch(script_url)
                diagnostic = {'url': script_url, 'status': result['status'], 'http_status': result['http_status'], 'notes': ['Public JavaScript inspected as text only, never executed.']}
                if result['status'] == 'fetched':
                    script_text = result['raw'].decode('utf-8', 'replace'); diagnostic.update(base.byte_metadata(result)); diagnostic['ajax_configuration_hints'] = ajax_hints(script_text, script_url)
                    diagnostic['pagination_code_hints'] = [base.bounded_text(match.group(0), 200, 25) for match in re.finditer(r'.{0,50}(?:pageIndex|pageNo|goPage|fnPage|\.submit\(|method\s*[:=]|comm_notice).{0,120}', script_text, re.I)][:15]
                script_diagnostics.append(diagnostic)
            continue
        route = routes[0]
        try: current = int(route['fields'].get(route['page_field'], '1') or '1')
        except ValueError:
            initial_record['notes'].append('Observed page field was not numeric; no replay attempted.'); continue
        fingerprints = {tuple(initial_record['discovered_urls'])} if initial_record['discovered_urls'] else set()
        for number in range(current + 1, current + max_pages):
            if request_count >= max_requests or time.monotonic() >= collector.deadline: break
            if initial_record['window_boundary_reached']: break
            query = dict(parse.parse_qsl(parse.urlsplit(route['url']).query)); query.update(route['fields']); query[route['page_field']] = str(number)
            p = parse.urlsplit(route['url']); target = parse.urlunsplit((p.scheme, p.netloc, p.path, parse.urlencode(query) if route['method'] == 'GET' else p.query, ''))
            record, next_page, _ = collect(label, target, initial, route['method'], query if route['method'] == 'POST' else None)
            record['route_basis'] = route['basis']; record['requested_page_number'] = number
            if not next_page: break
            fingerprint = tuple(record['discovered_urls'])
            if not fingerprint:
                record['notes'].append('No resolvable article URLs on this response; pagination coverage remains unproven.'); break
            if fingerprint in fingerprints:
                record['notes'].append('List response repeated a prior page; server may ignore the page parameter. Stopped without claiming pagination success.'); break
            fingerprints.add(fingerprint)
            record['pagination_gap'] = False
            if record['window_boundary_reached']:
                initial_record['pagination_gap'] = False; initial_record['notes'].append('Observed list pages reached a dated card boundary before 2025-10-30.'); break
        else: initial_record['notes'].append('Per-collection page limit reached; coverage remains bounded.')
    run = {'id': run_id, 'started_at': start, 'finished_at': base.now(), 'status': 'completed_with_limits', 'window_start': '2025-10-30', 'window_end': '2026-10-31', 'requested_collections': len(TARGETS), 'collection_pages_processed': len(collections), 'collection_pages_fetched': sum(item['status'] == 'fetched' for item in collections), 'candidates_discovered': len(candidates), 'detail_pages_fetched': 0, 'request_budget': {'total_content_requests': max_requests, 'pages_per_collection': max_pages}, 'content_fetch_calls': request_count, 'network_requests': dict(collector.counts), 'elapsed_seconds': round(time.monotonic() - collector.started, 2), 'time_budget_seconds': 300, 'truncated': True, 'limitations': ['Only observed official list forms/ajax methods are replayed; POST is restricted to explicit read-only list routes and public form fields.', 'No authentication, JavaScript execution, robots bypass, document archive or automatic claims.', 'Repeated/empty pages stop traversal; unresolved routes remain explicit gaps.', 'List titles are capped at 120 characters/20 words. No article full text is persisted.']}
    output = Path(args.output); output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({'runs': [run], 'collections': collections, 'candidates': list(candidates.values()), 'script_diagnostics': script_diagnostics}, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(run), flush=True)

if __name__ == '__main__': main()
