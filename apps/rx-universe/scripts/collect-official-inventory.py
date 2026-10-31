#!/usr/bin/env python3
"""Enumerate public official collections without promoting fetched pages to claims.

Stores links, dates, status and observed-byte hashes, never full article text.
Limits are recorded in the output; reaching one is not survey completion.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import threading
import time
from urllib import error, parse, request, robotparser
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
AGENT = 'RXPublicResearchInventory/1.0'
KEYWORDS = ['RX', 'robot', 'robotics', '로봇', '오케스트레이션', 'orchestration', 'physical AI', '피지컬', 'humanoid', '휴머노이드', 'MES', 'RCS', 'MCS', 'AMHS', 'Nexplant', 'Nexphere', 'smart factory', '스마트팩토리', '스마트공장', '자율제조', '자율 제조', '제조 AI', '제조 AX', '제조 자동화', 'digital twin', '디지털 트윈', '디지털트윈', '다크팩토리', 'Rainbow', '레인보우', 'Walden', 'RoboForce', 'Genesis AI', 'Embodied', 'manipulation', 'vision-language-action']
SKIP_PATH = re.compile(r'(?:\.(?:jpg|jpeg|png|gif|svg|webp|mp4|mp3|zip|css|js|woff2?)(?:\?|$)|privacy|cookie|terms-of|login|logout|signup|share=|/tag/|/category/|/author/)', re.I)
ARTICLE_PATH = re.compile(r'(news|press|insight|blog|product|solution|manufactur|robot|event|webinar|research|publication|paper|investor|earnings|report|customer-support|media|\.pdf|/dn\d+/)', re.I)
DATE = re.compile(r'\b(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\b')

def now(): return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
def digest(text): return hashlib.sha256(text.encode()).hexdigest()[:20]
def canonical(url):
    p = parse.urlsplit(url)
    query = [(k, v) for k, v in parse.parse_qsl(p.query) if not k.lower().startswith('utm_') and k.lower() not in {'fbclid', 'gclid'}]
    return parse.urlunsplit((p.scheme.lower(), p.netloc.lower(), p.path or '/', parse.urlencode(sorted(query)), ''))
def as_date(value):
    match = DATE.search(value or '')
    if not match: return None
    try: return datetime(*map(int, match.groups())).date().isoformat()
    except ValueError: return None
def keywords(text):
    found = []
    for word in KEYWORDS:
        expression = r'(?<![A-Za-z0-9])' + re.escape(word) + r'(?![A-Za-z0-9])' if word.isascii() else re.escape(word)
        if re.search(expression, text, re.I): found.append(word)
    return found

class Page(HTMLParser):
    def __init__(self, url):
        super().__init__(convert_charrefs=True)
        self.url, self.links, self.meta, self.text, self.scripts = url, [], {}, [], []
        self.anchor = None
        self.row = None
        self.ignore = 0
        self.title = ''
        self.in_title = False
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in {'script', 'style', 'noscript'}:
            self.ignore += 1
            if tag == 'script' and a.get('src'): self.scripts.append(parse.urljoin(self.url, a['src']))
        if tag == 'title': self.in_title = True
        if tag == 'meta': self.meta[a.get('property', a.get('name', '')).lower()] = a.get('content', '')
        if tag == 'tr': self.row = {'text': [], 'links': []}
        if tag == 'time' and a.get('datetime') and not self.meta.get('time'): self.meta['time'] = a['datetime']
        if tag == 'a' and a.get('href'):
            self.anchor = {'url': parse.urljoin(self.url, a['href']), 'text': '', 'rel': a.get('rel', ''), 'context': ''}
        if tag == 'link' and a.get('href') and ('rss' in a.get('type', '') or 'atom' in a.get('type', '')):
            self.links.append({'url': parse.urljoin(self.url, a['href']), 'text': 'RSS feed', 'rel': 'feed', 'context': ''})
    def handle_endtag(self, tag):
        if tag in {'script', 'style', 'noscript'}: self.ignore = max(0, self.ignore - 1)
        if tag == 'title': self.in_title = False
        if tag == 'a' and self.anchor:
            if self.row is not None: self.row['links'].append(self.anchor)
            self.links.append(self.anchor); self.anchor = None
        if tag == 'tr' and self.row:
            text = ' '.join(self.row['text'])
            for link in self.row['links']: link['context'] = text
            self.row = None
    def handle_data(self, data):
        if self.ignore: return
        value = ' '.join(data.split())
        if not value: return
        self.text.append(value)
        if self.in_title: self.title += value
        if self.anchor is not None: self.anchor['text'] += ' ' + value
        if self.row is not None: self.row['text'].append(value)

class Collector:
    def __init__(self, plan):
        self.plan, self.started, self.robots, self.host_locks = plan, time.monotonic(), {}, {}
        self.lock = threading.Lock()
        self.deadline = self.started + plan.get('max_seconds', 600)
    def fetch_raw(self, url):
        req = request.Request(url, headers={'User-Agent': AGENT, 'Accept': 'text/html,application/xhtml+xml,application/xml,application/json,application/pdf;q=0.8'})
        try:
            with request.urlopen(req, timeout=12) as response:
                raw = response.read(3_000_001)
                return {'status': 'fetched', 'http_status': response.status, 'url': response.url, 'content_type': response.headers.get('content-type', ''), 'raw': raw[:3_000_000], 'truncated': len(raw) > 3_000_000}
        except error.HTTPError as exc: return {'status': 'blocked' if exc.code in (401,403,429) else 'error', 'http_status': exc.code, 'error': str(exc.reason), 'raw': b''}
        except Exception as exc: return {'status': 'error', 'http_status': None, 'error': str(exc)[:240], 'raw': b''}
    def fetch(self, url):
        if time.monotonic() >= self.deadline: return {'status': 'budget_exhausted', 'http_status': None, 'raw': b''}
        p = parse.urlsplit(url)
        with self.lock: host_lock = self.host_locks.setdefault(p.netloc, threading.Lock())
        with host_lock:
            if time.monotonic() >= self.deadline: return {'status': 'budget_exhausted', 'http_status': None, 'raw': b''}
            if p.netloc not in self.robots:
                raw = self.fetch_raw(f'{p.scheme}://{p.netloc}/robots.txt')
                if raw['status'] == 'fetched':
                    robot = robotparser.RobotFileParser(); robot.parse(raw['raw'].decode('utf-8', 'replace').splitlines()); self.robots[p.netloc] = robot
                elif raw['http_status'] == 404: self.robots[p.netloc] = None
                else: self.robots[p.netloc] = False
            robot = self.robots[p.netloc]
            if robot is False: return {'status': 'blocked', 'http_status': None, 'error': 'robots.txt could not be checked; no content request made', 'raw': b''}
            if robot and not robot.can_fetch(AGENT, url): return {'status': 'robots_disallowed', 'http_status': None, 'raw': b''}
            result = self.fetch_raw(url)
            time.sleep(.12)
            return result

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--plan', default=str(ROOT/'research/collection-plan.json')); ap.add_argument('--output', default=str(ROOT/'research/survey/crawl-20261031.json')); args = ap.parse_args()
    plan = json.loads(Path(args.plan).read_text()); collector = Collector(plan)
    start = now(); run_id = 'official-survey-' + start.replace(':','').replace('.','')
    collections, candidates, visited = [], {}, set()
    all_seeds = list(plan['collections'])
    explicit_urls = []
    for file in sorted((ROOT/'research').glob('discovery-*.json')):
        data = json.loads(file.read_text()); explicit_urls += data.get('urls', []); all_seeds += data.get('collections', [])
    all_seeds = list({canonical(s['url']): s for s in all_seeds}.values())
    allowed_hosts = {parse.urlsplit(s['url']).netloc.removeprefix('www.') for s in all_seeds}
    def allowed(url):
        p = parse.urlsplit(url)
        return p.scheme in ('http','https') and p.netloc.removeprefix('www.') in allowed_hosts
    def add(url, title='', publisher='', collection='', date=None):
        if not allowed(url) or SKIP_PATH.search(url): return
        url = canonical(url)
        if url in {canonical(s['url']) for s in all_seeds}: return
        if not ARTICLE_PATH.search(url) and not keywords(title): return
        row = candidates.setdefault(url, {'id':'discovery:'+digest(url), 'run_id':run_id, 'url':url,'canonical_url':url,'title':title.strip(),'publisher':publisher,'collection_urls':[], 'discovered_at':start,'published_at':date,'date_basis':'collection' if date else 'unknown','fetch_status':'discovered','http_status':None,'content_sha256':None,'matched_keywords':keywords(title),'relevance':'unreviewed','source_ids':[],'notes':[]})
        if collection and collection not in row['collection_urls']: row['collection_urls'].append(collection)
        if not row['title'] and title: row['title'] = title.strip()
        if date and not row['published_at']: row['published_at'], row['date_basis'] = date, 'collection'
        if row['published_at'] and not (plan['window_start'] <= row['published_at'] <= plan['window_end']): row['relevance']='out_of_window'
    for url in explicit_urls:
        if isinstance(url,dict): add(url['url'],url.get('title',''),url.get('publisher',''),date=url.get('published_at'))
        else: add(url)
    queue = [(seed,seed['url'],0) for seed in all_seeds]
    max_pages = plan.get('max_collection_pages',100)
    while queue and len(visited)<max_pages and time.monotonic()<collector.deadline:
        seed,url,depth=queue.pop(0); url=canonical(url)
        if url in visited:continue
        visited.add(url); response=collector.fetch(url)
        record={'id':'collection:'+digest(url),'run_id':run_id,'url':url,'publisher':seed.get('publisher',''),'label':seed.get('label',''),'accessed_at':now(),'status':response['status'],'http_status':response['http_status'],'pages_visited':[url],'discovered_urls':[],'next_urls':[],'truncated':response.get('truncated',False),'notes':[]}
        if response.get('error'): record['notes'].append(response['error'])
        if response['status']=='fetched':
            raw=response['raw']; page=Page(url); text=raw.decode('utf-8','replace'); links=[]
            if 'xml' in response.get('content_type','') or text.lstrip().startswith('<?xml'):
                try:
                    xml=ET.fromstring(text)
                    for item in xml.iter():
                        if item.tag.split('}')[-1] in ('loc','link') and item.text and item.text.startswith('http'): links.append({'url':item.text,'text':'','rel':'','context':''})
                except ET.ParseError:record['notes'].append('XML parse failed')
            else:
                page.feed(text);links=page.links
                record['script_urls']=page.scripts[:40]
                record['observed_title']=page.title
                record['content_sha256']=hashlib.sha256(raw).hexdigest()
            for link in links:
                target=canonical(link['url']); title=link['text'].strip(); published=as_date(link['context'])
                if allowed(target) and ('next' in link['rel'] or link['rel']=='feed' or title in ['다음','Next','다음 페이지','›','»']):
                    record['next_urls'].append(target)
                    if depth<25:queue.append((seed,target,depth+1))
                    else:record['truncated']=True
                if target!=url:
                    add(target,title,seed.get('publisher',''),url,published)
                    if target in candidates:record['discovered_urls'].append(target)
            record['discovered_urls']=list(dict.fromkeys(record['discovered_urls']))
            if not record['discovered_urls']:record['notes'].append('No article links extracted; dynamic rendering or an empty collection is possible. Completeness not established.')
        collections.append(record)
        print(json.dumps({'collection':url,'status':record['status'],'urls':len(record['discovered_urls'])}),flush=True)
    explicit_set={canonical(u['url'] if isinstance(u,dict) else u) for u in explicit_urls}
    ranked=sorted(candidates.values(),key=lambda r:(r['relevance']=='out_of_window',not bool(r['matched_keywords']),r['url'] not in explicit_set,r['published_at'] is None,r['url']))
    eligible=[row for row in ranked if row['relevance']!='out_of_window']
    max_details=plan.get('max_detail_pages',360)
    def detail(row):
        response=collector.fetch(row['url']);row['fetch_status']=response['status'];row['http_status']=response['http_status'];row['fetched_at']=now()
        if response.get('error'):row['notes'].append(response['error'])
        if response['status']!='fetched':return
        raw=response['raw'];row['content_sha256']=hashlib.sha256(raw).hexdigest()
        if response.get('truncated'):row['notes'].append('Response exceeded 3 MB; parsing was truncated.')
        if 'pdf' in response.get('content_type',''):
            row['notes'].append('PDF bytes fetched; body not parsed or reviewed.');return
        page=Page(row['url']);page.feed(raw.decode('utf-8','replace'))
        row['title']=page.meta.get('og:title') or page.title or row['title']
        date=next((as_date(page.meta.get(k)) for k in ('article:published_time','datepublished','date','publication_date','pubdate','time') if as_date(page.meta.get(k))),None)
        if date:row['published_at'],row['date_basis']=date,'page'
        row['matched_keywords']=keywords(' '.join(page.text));row['relevance']='candidate' if row['matched_keywords'] else 'no_keyword_match'
        if row['published_at'] and not plan['window_start']<=row['published_at']<=plan['window_end']:row['relevance']='out_of_window'
        row['notes'].append('Automated keyword candidate only; navigation text may match. No claim, source verification or original archive is implied.')
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures=[pool.submit(detail,row) for row in eligible[:max_details]]
        for future in as_completed(futures):future.result()
    for row in eligible[max_details:]:row['notes'].append('Detail request budget reached; discovery metadata only.')
    incomplete=bool(queue) or len(eligible)>max_details or time.monotonic()>=collector.deadline
    run={'id':run_id,'started_at':start,'finished_at':now(),'status':'completed_with_limits' if incomplete else 'completed','window_start':plan['window_start'],'window_end':plan['window_end'],'requested_collections':len(all_seeds),'collection_pages_fetched':sum(c['status']=='fetched' for c in collections),'candidates_discovered':len(candidates),'detail_pages_fetched':sum(c['fetch_status']=='fetched' for c in candidates.values()),'request_budget':{'collection_pages':max_pages,'detail_pages':max_details},'time_budget_seconds':plan.get('max_seconds',600),'truncated':incomplete,'limitations':['A completed run is not proof of exhaustive coverage.','JavaScript-only pagination, blocked pages, inaccessible robots policies and absent dates remain explicit gaps.','Hashes identify fetched bytes; no original archive or factual verification is claimed.','Automated keywords can match navigation; every candidate requires relevance and claim review.']}
    out=Path(args.output);out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps({'runs':[run],'collections':collections,'candidates':list(candidates.values())},ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(run),flush=True)

if __name__=='__main__':main()
