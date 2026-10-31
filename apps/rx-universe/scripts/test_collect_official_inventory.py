"""Offline regression checks; fixtures never enter the published inventory."""
import importlib.util
import io
from pathlib import Path
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('collector', Path(__file__).with_name('collect-official-inventory.py'))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)

class CollectionTests(unittest.TestCase):
    def test_card_and_list_dates_do_not_leak_between_articles(self):
        page = c.Page('https://example.test/news/list')
        page.feed('<ul><li><a href="/news/a">Robot A</a><span>2026.10.20</span></li><li><a href="/news/b">Robot B</a><time datetime="2024-01-02">Jan 2</time></li></ul><div class="news-card"><a href="/news/c"><h3>Robot C</h3></a><span>2026-09-01</span></div><a href="/news/undated">No date</a>')
        self.assertEqual([link['date'] for link in page.links], ['2026-10-20', '2024-01-02', '2026-09-01', None])

    def test_anchor_titles_remain_short_and_headings_win(self):
        page = c.Page('https://example.test/news')
        body = 'full article text ' * 1000
        page.feed(f'<article><a href="/news/a"><h3>Short title</h3>{body}</a></article><a href="/news/b">{body}</a>')
        self.assertEqual(page.links[0]['text'], 'Short title')
        self.assertLessEqual(len(page.links[1]['text']), 120)
        self.assertLessEqual(len(page.links[1]['text'].split()), 20)

    def test_only_observed_collection_pagination_passes(self):
        current = 'https://blog.example.test/category/robot?page=1'
        self.assertTrue(c.is_next_page(current, current.replace('=1', '=2'), {'text': '', 'label': '다음 페이지', 'rel': ''}))
        for target in ['https://blog.example.test/archive/202611', 'https://blog.example.test/feed', 'https://blog.example.test/news/new-article', 'https://other.test/category/robot?page=2']:
            self.assertFalse(c.is_next_page(current, target, {'text': 'Next', 'rel': 'next'}))
        page = c.Page(current)
        page.feed('<a href="?page=2"><img alt="다음" src="next.png"></a>')
        self.assertTrue(c.is_next_page(current, page.links[0]['url'], page.links[0]))

    def test_dynamic_hints_are_observed_without_execution(self):
        page = c.Page('https://example.test/news/list')
        page.feed('<button onclick="goPage(2)">더 보기</button><script>$.ajax({url:"/api/news/list",type:"POST"})</script><form action="/news/search" method="get"></form>')
        self.assertTrue(page.dynamic_controls)
        self.assertEqual(page.endpoint_hints[0]['url'], 'https://example.test/api/news/list')
        self.assertFalse(page.endpoint_hints[0]['requested'])
        self.assertEqual(page.forms[0]['method'], 'get')
        self.assertEqual(page.links, [])

    @staticmethod
    def docx(xml):
        out = io.BytesIO()
        with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive: archive.writestr('word/document.xml', xml)
        return out.getvalue()

    def test_docx_only_parses_bounded_document_xml_and_short_excerpt(self):
        xml = '<w:document xmlns:w="urn:word"><w:p><w:t>Physical AI robot research for manufacturing.</w:t></w:p></w:document>'
        text = c.docx_text(self.docx(xml))
        self.assertIn('Physical AI', text)
        self.assertLessEqual(len(c.excerpt(text * 20).split()), 25)
        self.assertLessEqual(len(c.excerpt(text * 20)), 240)
        with self.assertRaises(ValueError): c.docx_text(self.docx('<!DOCTYPE x [<!ENTITY x "bad">]><x/>'))
        with self.assertRaises(ValueError): c.docx_text(self.docx('<x>' + 'a' * 100000 + '</x>'))

    def test_host_round_robin_and_prefix_hash_are_honest(self):
        rows = [{'url': f'https://a.test/news/{i}'} for i in range(7)] + [{'url': 'https://b.test/news/1'}, {'url': 'https://c.test/news/1'}]
        chosen, deferred = c.fair_rows(rows, 3)
        self.assertEqual([c.host(row['url']) for row in chosen[:3]], ['a.test', 'b.test', 'c.test'])
        self.assertEqual(len(deferred), 4)
        info = c.byte_metadata({'raw': b'prefix', 'truncated': True})
        self.assertIsNone(info['content_sha256'])
        self.assertEqual(info['hash_scope'], 'truncated_prefix')
        self.assertEqual(info['archive_status'], 'not_archived')

    def test_robots_denial_and_redirect_scope_do_not_make_forbidden_requests(self):
        collector = c.Collector({'max_seconds': 10})
        calls = []
        def raw(url, kind='content'):
            calls.append(url)
            return {'status': 'fetched', 'http_status': 200, 'raw': b'User-agent: *\nDisallow: /blocked\n', 'request_attempted': True}
        collector.fetch_raw = raw
        self.assertEqual(collector.fetch('https://example.test/blocked')['status'], 'robots_disallowed')
        self.assertEqual(calls, ['https://example.test/robots.txt'])
        collector = c.Collector({'max_seconds': 10}); collector.allowed = lambda url: c.host(url) == 'example.test'
        collector.robots['example.test'] = None
        collector.fetch_raw = lambda url, kind='content': {'status': 'redirect', 'http_status': 302, 'location': 'https://outside.test/secret', 'raw': b'', 'request_attempted': True}
        self.assertEqual(collector.fetch('https://example.test/news/a')['status'], 'redirect_out_of_scope')

    def test_unicode_and_encoded_seed_urls_deduplicate(self):
        self.assertEqual(c.canonical('https://example.test/tag/로봇'), c.canonical('https://example.test/tag/%EB%A1%9C%EB%B4%87'))

if __name__ == '__main__': unittest.main()
