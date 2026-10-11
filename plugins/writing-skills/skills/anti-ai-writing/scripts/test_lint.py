"""Run: python3 -m unittest discover -s <skill-directory>/scripts -p 'test_*.py'."""

import ast
from contextlib import redirect_stdout
from io import StringIO
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

import lint


SCRIPT = Path(lint.__file__).resolve()
SKILL = SCRIPT.parent.parent


def rule_ids(text: str, language: str = "ja") -> list[str]:
    return [item.rule for item in lint.lint(text, language)]


class RuleTests(unittest.TestCase):
    def test_each_phrase_rule(self):
        examples = {
            "common.em-dash": ("both", "A—B"),
            "ja.line-ending-colon": ("ja", "要素：\nテスト"),
            "ja.warning-word": ("ja", "このDBを正本として扱う。"),
            "en.boilerplate": ("en", "In today's fast-paced world, teams need time."),
            "en.cliche": ("en", "We delve into the results."),
            "en.inflated": ("en", "This is groundbreaking."),
            "en.not-only": ("en", "It is not just quick but also inexpensive."),
        }
        rules = lint.COMMON_RULES + lint.JAPANESE_RULES + lint.ENGLISH_RULES
        self.assertEqual(set(examples), {rule.id for rule in rules})
        for rule, (language, text) in examples.items():
            with self.subTest(rule=rule):
                self.assertIn(rule, rule_ids(text, language))

    def test_english_case_and_contractions(self):
        for text in (
            "IN CONCLUSION, ship it.",
            "It is important to note the limit.",
            "It's important to note the limit.",
            "It’s worth noting the limit.",
        ):
            with self.subTest(text=text):
                self.assertIn("en.boilerplate", rule_ids(text, "en"))

    def test_english_word_boundaries(self):
        self.assertEqual([], rule_ids("The counterrevolutionary returned.", "en"))

    def test_language_isolation(self):
        text = "日本語の製品です。 It is groundbreaking."
        self.assertEqual([], rule_ids(text, "ja"))
        self.assertEqual(["en.inflated"], rule_ids(text, "en"))
        self.assertEqual(["en.inflated"], rule_ids(text, "both"))
        self.assertEqual(["common.em-dash"], rule_ids("A—B", "both"))

    def test_invalid_language(self):
        with self.assertRaises(ValueError):
            lint.lint("text", "auto")

    def test_natural_prose(self):
        samples = (
            ("ja", "昨日、検索用の索引を追加した。応答は800msから120msに短縮。更新時の負荷は来週測る。"),
            ("en", "We added an index yesterday. Queries now take 120ms instead of 800ms. Write costs remain untested."),
            ("both", ""),
        )
        for language, text in samples:
            with self.subTest(language=language):
                self.assertEqual([], rule_ids(text, language))

    def test_warning_terms_are_loaded_from_rule_data(self):
        document = json.loads(lint.RULES_PATH.read_text(encoding="utf-8"))
        warning = next(item for item in document["rules"]["ja"] if item["id"] == "ja.warning-word")
        self.assertIn("正本", warning["terms"])
        self.assertEqual("warning", warning["severity"])
        self.assertEqual(["ja.warning-word"], rule_ids("記録の正本は台帳です。"))

    def test_findings_include_configured_severity(self):
        findings = lint.lint("A—B。記録の正本です。", "ja")
        self.assertEqual(
            [("common.em-dash", "error"), ("ja.warning-word", "warning")],
            [(item.rule, item.severity) for item in findings],
        )

    def test_japanese_horizontal_bar_is_forbidden_but_prolonged_sound_mark_is_not(self):
        self.assertEqual(["common.em-dash"], rule_ids("前半―後半"))
        self.assertEqual([], rule_ids("サーバー"))

    def test_japanese_line_ending_colons(self):
        for text in ("項目：\n本文", "項目:\n本文", "項目：  \n本文", "項目:"):
            with self.subTest(text=text):
                self.assertEqual(["ja.line-ending-colon"], rule_ids(text))
        for text in ("項目： 本文", "項目: 本文"):
            with self.subTest(text=text):
                self.assertEqual([], rule_ids(text))

    def test_japanese_repeated_ending_threshold(self):
        self.assertNotIn("ja.repeated-ending", rule_ids("対象です。予定です。"))
        text = "対象です。\n予定です。\n必要です。\n同様です。"
        matches = [item for item in lint.lint(text, "ja") if item.rule == "ja.repeated-ending"]
        self.assertEqual([(3, 1)], [(item.line, item.column) for item in matches])

    def test_japanese_repetition_resets(self):
        for text in ("対象です。予定です。\n\n必要です。", "対象です。実行します。予定です。"):
            self.assertNotIn("ja.repeated-ending", rule_ids(text))

    def test_english_repeated_opening(self):
        text = "We can read it. We can test it. We can ship it. We can monitor it."
        self.assertEqual(1, rule_ids(text, "en").count("en.repeated-opening"))
        for text in (
            "We can read it. We can test it.",
            "We can read it. We can test it.\n\nWe can ship it.",
            "We can read it. They can test it. We can ship it.",
        ):
            self.assertNotIn("en.repeated-opening", rule_ids(text, "en"))

    def test_connective_thresholds(self):
        samples = (
            ("ja", "また、対象を絞る。", "さらに、数値を測る。", "ja.connective-overuse"),
            ("en", "Furthermore, we measured it. ", "Moreover, we tested it.", "en.connective-overuse"),
        )
        for language, first, second, rule in samples:
            with self.subTest(language=language):
                self.assertNotIn(rule, rule_ids(first, language))
                self.assertIn(rule, rule_ids(first + second, language))
                self.assertNotIn(rule, rule_ids(first + "\n\n" + second, language))


class MarkdownTests(unittest.TestCase):
    def test_excluded_spans(self):
        samples = (
            "```text\n革新的 — groundbreaking\n```",
            "~~~text\n革新的 — groundbreaking\n~~~",
            "````\n```\n革新的 — groundbreaking\n```\n````",
            "> ```text\n> 革新的 — groundbreaking\n> ```",
            "- ```text\n  革新的 — groundbreaking\n  ```",
            "`正本 — groundbreaking`",
            "``正本 ` — groundbreaking``",
            "```正本 ` — groundbreaking```",
            "`正本\n— groundbreaking`",
            "<!-- 正本 — groundbreaking -->",
            "<!--\n```\n正本 — groundbreaking\n-->",
            "    正本 — groundbreaking",
            "\t正本 — groundbreaking",
            "---\ntitle: 正本 — groundbreaking\n---",
            "---\ntitle: 正本 — groundbreaking\n...",
            "[資料](https://example.com/正本/groundbreaking_(x) \"—\")",
            "https://example.com/正本/groundbreaking",
            "[資料][正本]\n\n[正本]: https://example.com/groundbreaking",
        )
        for text in samples:
            with self.subTest(text=text):
                self.assertEqual([], rule_ids(text, "both"))

    def test_visible_prose_after_exclusions(self):
        samples = (
            "`example` 正本",
            "``example`` 正本",
            "<!-- note --> 正本",
            "    <!-- code\n正本",
            "```\n<!--\n```\n正本",
            "`<!--` 正本",
            "<!--\n```\n-->\n正本",
            "[資料](https://example.com) 正本",
            "https://example.com。正本",
        )
        for text in samples:
            with self.subTest(text=text):
                self.assertEqual(["ja.warning-word"], rule_ids(text))

    def test_visible_markdown_text(self):
        for text in ("# 正本", "- 正本", "> 正本", "[正本](https://example.com)", "[^1]: 正本"):
            with self.subTest(text=text):
                self.assertEqual(["ja.warning-word"], rule_ids(text))

    def test_mismatched_and_unclosed_fences(self):
        for text in ("````\n```\n正本", "```\n~~~\n正本", "```\n正本"):
            self.assertEqual([], rule_ids(text))

    def test_unclosed_inline_code_and_frontmatter_do_not_hide_prose(self):
        for text in ("`正本", "---\n正本", "`code\n\n正本 `"):
            self.assertEqual(["ja.warning-word"], rule_ids(text))

    def test_coordinates_survive_masking_and_crlf(self):
        text = "---\r\ntitle: ignored\r\n---\r\n`code` 正本\r\n"
        masked = lint.mask_markdown(text)
        self.assertEqual(len(text), len(masked))
        self.assertEqual(
            [i for i, char in enumerate(text) if char in "\r\n"],
            [i for i, char in enumerate(masked) if char in "\r\n"],
        )
        findings = lint.lint(text, "ja")
        self.assertEqual(1, len(findings))
        self.assertEqual((4, 8), (findings[0].line, findings[0].column))
        self.assertEqual("`code` 正本", findings[0].excerpt)


class CliTests(unittest.TestCase):
    def run_cli(self, *args: str, data: bytes = b"", cwd: str | None = None):
        return subprocess.run(
            [sys.executable, "-I", "-S", str(SCRIPT), *args],
            input=data,
            capture_output=True,
            cwd=cwd,
            check=False,
        )

    def test_stdin_json_and_exit_codes(self):
        clean = self.run_cli("--language", "en", "-", "--json", data=b"We measured latency.")
        self.assertEqual(0, clean.returncode, clean.stderr)
        self.assertEqual({"file": "-", "language": "en", "findings": []}, json.loads(clean.stdout))
        result = self.run_cli("--language", "both", "-", "--json", data="正本 — groundbreaking".encode())
        self.assertEqual(1, result.returncode, result.stderr)
        self.assertEqual(b"", result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(3, len(report["findings"]))
        self.assertEqual(
            {"rule", "severity", "line", "column", "message", "excerpt"},
            set(report["findings"][0]),
        )
        self.assertEqual([1, 4, 6], [item["column"] for item in report["findings"]])

    def test_file_bom_arbitrary_cwd_and_no_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "draft with spaces.md"
            content = "\ufeff正本".encode()
            path.write_bytes(content)
            result = self.run_cli("--language", "ja", str(path), cwd=directory)
            self.assertEqual(1, result.returncode, result.stderr)
            self.assertIn(f"{path}:1:1: warning: ja.warning-word:".encode(), result.stdout)
            self.assertEqual(content, path.read_bytes())

    def test_input_errors(self):
        with tempfile.TemporaryDirectory() as directory:
            for path in (Path(directory), Path(directory) / "missing.md"):
                with self.subTest(path=path):
                    result = self.run_cli("--language", "ja", str(path), "--json")
                    self.assertEqual(2, result.returncode)
                    self.assertEqual(b"", result.stdout)
                    self.assertIn(b"error:", result.stderr)
                    self.assertNotIn(b"Traceback", result.stderr)
        invalid = self.run_cli("--language", "ja", "-", data=b"\xff")
        self.assertEqual(2, invalid.returncode)
        self.assertIn(b"error:", invalid.stderr)

    def test_language_is_required_and_validated(self):
        for args in (("-",), ("--language", "auto", "-")):
            self.assertEqual(2, self.run_cli(*args).returncode)

    def test_help(self):
        result = self.run_cli("--help")
        self.assertEqual(0, result.returncode)
        self.assertIn(b"--language", result.stdout)

    def test_info_findings_do_not_fail_the_command(self):
        original = lint.JAPANESE_RULES
        self.addCleanup(setattr, lint, "JAPANESE_RULES", original)
        lint.JAPANESE_RULES = (lint.Rule("ja.info-test", "参考", "info", "参考情報"),)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "draft.txt"
            path.write_text("参考", encoding="utf-8")
            with redirect_stdout(StringIO()):
                self.assertEqual(0, lint.main(["--language", "ja", str(path)]))


class PackagingTests(unittest.TestCase):
    def test_runtime_imports_are_standard_library_only(self):
        tree = ast.parse(SCRIPT.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                modules = [alias.name.split(".")[0] for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                self.assertEqual(0, node.level)
                modules = [(node.module or "").split(".")[0]]
            else:
                continue
            for module in modules:
                self.assertIn(module, sys.stdlib_module_names)

    def test_rule_data_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "rules.json"
            path.write_text('{"schemaVersion": 2, "rules": {}}', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "exactly common, ja, and en"):
                lint.load_rule_groups(path)

    def test_rule_severity_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "rules.json"
            path.write_text(json.dumps({
                "schemaVersion": 2,
                "rules": {
                    "common": [{
                        "id": "common.test", "severity": "fatal",
                        "terms": ["x"], "message": "test",
                    }],
                    "ja": [],
                    "en": [],
                },
            }), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "severity must be info, warning, or error"):
                lint.load_rule_groups(path)

    def test_documented_rules_and_reference_links(self):
        documents = [SKILL / "SKILL.md", *sorted((SKILL / "references").glob("*.md"))]
        documentation = "\n".join(path.read_text(encoding="utf-8") for path in documents)
        for rule in lint.COMMON_RULES + lint.JAPANESE_RULES + lint.ENGLISH_RULES:
            self.assertIn(f"`{rule.id}`", documentation)
        for rule in (
            "ja.repeated-ending", "ja.connective-overuse",
            "en.repeated-opening", "en.connective-overuse",
        ):
            self.assertIn(f"`{rule}`", documentation)
        for path in documents:
            for target in re.findall(r"\]\((\.[^)\s]+)\)", path.read_text(encoding="utf-8")):
                self.assertTrue((path.parent / target).exists(), f"{path}: {target}")


if __name__ == "__main__":
    unittest.main()
