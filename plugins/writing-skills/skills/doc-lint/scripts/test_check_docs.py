# /// script
# requires-python = ">=3.11"
# dependencies = ["markdown-it-py==3.0.0"]
# ///
"""Focused, offline tests. Fixtures live beside this script, never in /tmp."""

from __future__ import annotations

from contextlib import redirect_stdout, redirect_stderr
import io
import json
from pathlib import Path
import shutil
import socket
import sys
import unittest
from unittest.mock import Mock, patch
import uuid

sys.dont_write_bytecode = True
import check_docs as checker


class DocumentTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parent / (".fixtures-" + uuid.uuid4().hex)
        self.root.mkdir()
        self.addCleanup(shutil.rmtree, self.root)

    def write(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def report(self, text, **kwargs):
        path = self.write("README.md", text)
        return checker.run([path], self.root, **kwargs)

    def codes(self, report):
        return [f["code"] for f in report["findings"]]

    def test_fenced_inline_indented_code_and_comments_excluded(self):
        report = self.report(
            "```md\n[bad](missing.md)\n#Bad\n```\n"
            "~~~\n<https://hidden.example>\n~~~\n"
            "`[bad](missing.md)` and ``[bad](missing.md)``\n\n"
            "    [bad](missing.md)\n\n"
            "<!-- [bad](missing.md) -->\n"
            "[real](https://example.com)\n")
        self.assertEqual([], report["findings"])
        self.assertEqual(["https://example.com"], [r["url"] for r in report["urls"]])

    def test_frontmatter_preserves_line_numbers(self):
        report = self.report("---\nurl: https://hidden.example\nnote: '[x](bad.md)'\n---\n[x](bad.md)\n")
        self.assertEqual(["path-missing"], self.codes(report))
        self.assertEqual(5, report["findings"][0]["line"])
        self.assertEqual([], report["urls"])

    def test_frontmatter_unclosed_and_bom(self):
        self.assertEqual(["frontmatter-unclosed"], self.codes(self.report("---\ntitle: x\n")))
        self.assertEqual([], self.report("\ufeff---\ntitle: x\n...\n# Title\n")["findings"])

    def test_relative_unicode_encoded_paths_and_anchors(self):
        self.write("資料/導入 計画.md", "# はじめに\n\n## Café\n")
        report = self.report(
            "[unicode](資料/導入%20計画.md#はじめに)\n"
            "[encoded](%E8%B3%87%E6%96%99/%E5%B0%8E%E5%85%A5%20%E8%A8%88%E7%94%BB.md#caf%C3%A9)\n"
            "[query](資料/導入%20計画.md?view=1#はじめに)\n")
        self.assertEqual([], report["findings"])

    def test_reference_full_collapsed_shortcut_and_image(self):
        self.write("ok.md", "# Target\n")
        self.write("image.png", "not an actual PNG")
        report = self.report(
            "[full][ target ]\n[collapsed][]\n[shortcut]\n![image][pic]\n\n"
            "[target]: ok.md#target\n[collapsed]: ok.md\n[shortcut]: ok.md\n[pic]: image.png\n"
            "[unused]: https://unused.example\n")
        self.assertEqual([], report["findings"])
        self.assertEqual([], report["urls"])

    def test_undefined_reference_candidates_not_code_or_prose(self):
        report = self.report("[full][missing]\n[collapsed][]\n"
                             "`[full][hidden]`\n[ordinary prose]\n")
        self.assertEqual(["reference-undefined", "reference-undefined"], self.codes(report))
        self.assertEqual(["missing", "collapsed"], [f["target"] for f in report["findings"]])

    def test_missing_paths_anchors_and_self_reference(self):
        report = self.report("# Title\n[x](#title)\n[x](#wrong)\n"
                             "[missing](nothing.md)\n![missing](nothing.png)\n")
        self.assertEqual(["anchor-missing", "path-missing", "path-missing"], self.codes(report))

    def test_heading_levels_setext_empty_and_spacing(self):
        report = self.report("Title\n=====\n\n### Jump\n\n#\n\n#No-space\n\n```\n#Ignored\n```\n")
        self.assertCountEqual(["heading-jump", "heading-empty", "heading-spacing"], self.codes(report))

    def test_duplicate_heading_anchors_and_suffix_collisions(self):
        path = self.write("README.md", "# Foo\n# Foo\n# Foo-1\n# Foo\n"
                          "[a](#foo-1-1)\n[b](#foo-2)\n")
        doc = checker.parse_document(path)
        self.assertEqual({"foo", "foo-1", "foo-1-1", "foo-2"}, doc.anchors)
        report = checker.run([path], self.root)
        self.assertEqual(["heading-duplicate", "heading-duplicate"], self.codes(report))

    def test_explicit_html_ids_and_duplicates(self):
        report = self.report('# Heading\n<a id="custom"></a>\n<div id="custom"></div>\n'
                             '<a name="legacy"></a>\n<a id="heading"></a>\n'
                             '[a](#custom)\n[b](#legacy)\n')
        self.assertEqual(["anchor-duplicate", "anchor-duplicate"], self.codes(report))

    def test_tables_valid_escaped_and_invalid_width(self):
        report = self.report("| A | B |\n| --- | :---: |\n| x\\|y | `z` |\n| a |\n| a | b | c |\n")
        self.assertEqual(["table-width", "table-width"], self.codes(report))
        self.assertEqual([4, 5], [f["line"] for f in report["findings"]])

    def test_table_separator_candidate_and_code_exclusion(self):
        report = self.report("| A | B |\n| --- | : |\n\n```\n| A | B |\n| --- | : |\n```\n")
        self.assertEqual(["table-separator"], self.codes(report))

    def test_unclosed_fence_and_link_candidates(self):
        self.assertEqual(["fence-unclosed"], self.codes(self.report("```md\n[x](missing)\n")))
        self.assertEqual(["link-unclosed"], self.codes(self.report("[x](missing\n")))
        self.assertEqual([], self.codes(self.report("> ```md\n> hidden\n> ```\n")))

    def test_root_bounds_and_symlink(self):
        outside = self.write("outside.md", "# Outside\n")
        folder = self.root / "docs"
        folder.mkdir()
        (folder / "escape.md").symlink_to(outside)
        path = self.write("docs/README.md", "[parent](../outside.md)\n[sym](escape.md)\n")
        report = checker.run([path], folder)
        self.assertEqual(["path-outside-root", "path-outside-root"], self.codes(report))
        self.assertEqual(["input-outside-root"], self.codes(checker.run([outside], folder)))

    def test_site_root_and_non_markdown_anchor_skipped(self):
        self.write("image.svg", '<svg id="x"/>')
        report = self.report("[root](/docs/start)\n[svg](image.svg#x)\n[mail](mailto:a@example.com)\n")
        self.assertEqual(["root-link-skipped", "anchor-skipped", "link-skipped"], self.codes(report))

    def test_invalid_encoding_missing_input_and_empty_directory(self):
        path = self.root / "bad.md"
        path.write_bytes(b"\xff")
        self.assertEqual(["input-read-error"], self.codes(checker.run([path], self.root)))
        self.assertEqual(["input-missing"], self.codes(checker.run([self.root / "missing"], self.root)))
        (self.root / "empty").mkdir()
        self.assertEqual(["input-empty"], self.codes(checker.run([self.root / "empty"], self.root)))

    def test_offline_never_requests_and_deduplicates(self):
        with patch.object(checker, "request_public") as request:
            report = self.report("[a](https://example.com)\n[b](https://example.com)\n")
        request.assert_not_called()
        self.assertEqual("skipped", report["urls"][0]["state"])
        self.assertEqual(2, len(report["urls"][0]["sources"]))

    def test_network_limit_and_explicit_error(self):
        with patch.object(checker, "check_url", return_value={
                "url": "https://a.example", "state": "error", "status": None,
                "method": "HEAD", "final_url": None, "error": "TimeoutError: timeout"}) as check:
            report = self.report("[a](https://a.example)\n[b](https://b.example)\n",
                                 network=True, max_urls=1)
        self.assertEqual(1, check.call_count)
        self.assertEqual(["error", "skipped"], [r["state"] for r in report["urls"]])
        self.assertEqual(1, report["summary"]["network_errors"])

    def test_json_exit_codes_and_inputs_unchanged(self):
        path = self.write("README.md", "# Title\n[a](https://example.com)\n")
        before = path.read_bytes()
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(0, checker.main([str(path), "--json"]))
        self.assertEqual("offline", json.loads(out.getvalue())["mode"])
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            self.assertEqual(1, checker.main([str(path), "--strict"]))
            self.assertEqual(1, checker.main([str(self.root / "missing.md")]))
            with self.assertRaises(SystemExit) as exc:
                checker.main([str(path), "--timeout", "0"])
        self.assertEqual(2, exc.exception.code)
        self.assertEqual(before, path.read_bytes())

    def test_directory_scan_and_multiline_links(self):
        self.write("README.md", "[target](\nsub/target.md#target\n)\n")
        self.write("sub/target.md", "# Target\n")
        self.write("ignored.txt", "[bad](missing)")
        report = checker.run([self.root], self.root)
        self.assertEqual([], report["findings"])
        self.assertEqual(2, report["summary"]["files"])


class NetworkTests(unittest.TestCase):
    def test_block_authenticated_query_local_and_nonstandard_port(self):
        for url in ("http://localhost/a", "http://a.local/a", "http://a.internal/a",
                    "https://user:password@example.com", "https://example.com?token=x",
                    "https://example.com:8443"):
            with self.subTest(url=url), patch.object(socket, "getaddrinfo") as dns:
                result = checker.check_url(url)
                self.assertEqual("blocked", result["state"])
                dns.assert_not_called()

    def test_private_and_mixed_dns_rejected(self):
        for ips in (["127.0.0.1"], ["::1"], ["10.0.0.1"], ["169.254.169.254"],
                    ["93.184.216.34", "192.168.1.1"], ["::ffff:127.0.0.1"]):
            addresses = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 80)) for ip in ips]
            with self.subTest(ips=ips), patch.object(socket, "getaddrinfo", return_value=addresses):
                self.assertEqual("blocked", checker.check_url("http://example.com")["state"])

    def test_dns_timeout_tls_errors_reported(self):
        for error in (socket.gaierror("DNS unavailable"), TimeoutError("timeout"),
                      OSError("TLS certificate verification failed")):
            with self.subTest(error=error), patch.object(checker, "request_public", side_effect=error):
                result = checker.check_url("https://example.com")
                self.assertEqual("error", result["state"])
                self.assertIn(type(error).__name__, result["error"])

    def test_head_get_fallback_and_http_errors(self):
        with patch.object(checker, "request_public", side_effect=[(405, None), (200, None)]) as request:
            result = checker.check_url("https://example.com#anchor")
        self.assertEqual("ok", result["state"])
        self.assertEqual("GET", result["method"])
        self.assertEqual("https://example.com", request.call_args.args[0])
        for status in (401, 403, 404, 429, 500):
            with patch.object(checker, "request_public", return_value=(status, None)):
                result = checker.check_url("https://example.com")
                self.assertEqual("error", result["state"])
                self.assertEqual(status, result["status"])

    def test_redirect_rechecks_and_limit(self):
        with patch.object(checker, "request_public",
                          side_effect=[(302, "http://localhost/"), checker.BlockedURL("local")]) as request:
            self.assertEqual("blocked", checker.check_url("https://example.com")["state"])
            self.assertEqual("http://localhost/", request.call_args.args[0])
        with patch.object(checker, "request_public", return_value=(302, "/loop")) as request:
            result = checker.check_url("https://example.com")
        self.assertEqual("error", result["state"])
        self.assertEqual(6, request.call_count)
        with patch.object(checker, "request_public", return_value=(302, None)):
            self.assertEqual("error", checker.check_url("https://example.com")["state"])

    def test_validated_ip_pinned_and_no_auth_proxy_or_body(self):
        connection = Mock()
        connection.getresponse.return_value.status = 200
        connection.getresponse.return_value.getheader.return_value = None
        with patch.object(checker, "public_endpoint", return_value=("example.com", 443, "93.184.216.34")), \
                patch.object(checker.http.client, "HTTPSConnection", return_value=connection) as cls, \
                patch.object(socket, "create_connection") as connect:
            self.assertEqual((200, None), checker.request_public("https://example.com/path#x", "HEAD", 15))
            connection._create_connection(("example.com", 443), 15)
        cls.assert_called_once_with("example.com", 443, timeout=15)
        connect.assert_called_once_with(("93.184.216.34", 443), 15, None)
        connection.request.assert_called_once_with(
            "HEAD", "/path", headers={"User-Agent": "doc-lint/1.0"})
        connection.getresponse.return_value.read.assert_not_called()
        connection.close.assert_called_once()


if __name__ == "__main__":
    unittest.main(verbosity=2)
