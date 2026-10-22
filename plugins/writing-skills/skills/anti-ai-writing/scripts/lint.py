#!/usr/bin/env python3
"""Dependency-free prose checks for Python 3.10+. See ../NOTICE for design credits."""

from __future__ import annotations

import argparse
from bisect import bisect_right
from dataclasses import asdict, dataclass
import json
from pathlib import Path
import re
import sys


@dataclass(frozen=True)
class Rule:
    id: str
    pattern: str
    severity: str
    message: str


@dataclass(frozen=True)
class Finding:
    rule: str
    severity: str
    line: int
    column: int
    message: str
    excerpt: str


RULES_PATH = Path(__file__).with_name("rules.json")
SEVERITIES = ("info", "warning", "error")


def load_rule_groups(path: Path = RULES_PATH) -> dict[str, tuple[Rule, ...]]:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError(f"Could not load rule data from {path}: {error}") from error
    if not isinstance(document, dict) or document.get("schemaVersion") != 2:
        raise ValueError(f"{path}: schemaVersion must be 2")
    groups = document.get("rules")
    if not isinstance(groups, dict) or set(groups) != {"common", "ja", "en"}:
        raise ValueError(f"{path}: rules must contain exactly common, ja, and en")

    loaded: dict[str, tuple[Rule, ...]] = {}
    seen: set[str] = set()
    for language in ("common", "ja", "en"):
        items = groups[language]
        if not isinstance(items, list):
            raise ValueError(f"{path}: rules.{language} must be an array")
        rules: list[Rule] = []
        for item in items:
            if not isinstance(item, dict):
                raise ValueError(f"{path}: each rule must be an object")
            rule_id = item.get("id")
            severity = item.get("severity")
            message = item.get("message")
            pattern = item.get("pattern")
            terms = item.get("terms")
            if not isinstance(rule_id, str) or not rule_id.startswith(f"{language}."):
                raise ValueError(f"{path}: invalid rule ID for {language}")
            if rule_id in seen:
                raise ValueError(f"{path}: duplicate rule ID {rule_id}")
            if severity not in SEVERITIES:
                raise ValueError(f"{path}: {rule_id} severity must be info, warning, or error")
            if not isinstance(message, str) or not message:
                raise ValueError(f"{path}: {rule_id} must have a message")
            if (pattern is None) == (terms is None):
                raise ValueError(f"{path}: {rule_id} must have exactly one of pattern or terms")
            if terms is not None:
                if (
                    not isinstance(terms, list)
                    or not terms
                    or not all(isinstance(term, str) and term for term in terms)
                ):
                    raise ValueError(f"{path}: {rule_id} terms must be non-empty strings")
                pattern = "|".join(re.escape(term) for term in terms)
            if not isinstance(pattern, str) or not pattern:
                raise ValueError(f"{path}: {rule_id} pattern must be non-empty text")
            try:
                re.compile(pattern, re.I if language == "en" else 0)
            except re.error as error:
                raise ValueError(f"{path}: invalid pattern for {rule_id}: {error}") from error
            seen.add(rule_id)
            rules.append(Rule(rule_id, pattern, severity, message))
        loaded[language] = tuple(rules)
    return loaded


RULE_LOAD_ERROR: ValueError | None = None
try:
    RULE_GROUPS = load_rule_groups()
except ValueError as error:
    RULE_LOAD_ERROR = error
    RULE_GROUPS = {"common": (), "ja": (), "en": ()}
COMMON_RULES = RULE_GROUPS["common"]
JAPANESE_RULES = RULE_GROUPS["ja"]
ENGLISH_RULES = RULE_GROUPS["en"]

BLOCK_PREFIX = r" {0,3}(?:(?:> ?|[-+*] |\d+[.)] ) {0,3})*"
MARKDOWN_TOKEN = re.compile(
    r"(?m)(?P<nonprose_line>^(?: {4}|\t)[^\n]*|^ {0,3}\[(?!\^)[^\]\n]+\]:[^\n]*)"
    rf"|^{BLOCK_PREFIX}(?P<fence>`{{3,}}|~{{3,}})(?P<info>[^\n]*)$"
    r"|<!--|(?P<ticks>`+)"
)
PARAGRAPH = re.compile(r"\S[\s\S]*?(?=\n[ \t\r]*\n|\Z)")
JAPANESE_SENTENCE = re.compile(r"[^。！？!?]+(?:[。！？!?]+|$)")
ENGLISH_SENTENCE = re.compile(r".+?(?:[.!?](?=\s|$)|$)", re.DOTALL)
JAPANESE_ENDING = re.compile(r"(です|ます|だろう|でしょう|である|だ)$")
JAPANESE_CONNECTIVE = re.compile(r"(?:さらに|また|したがって|そのため)[、,]")
ENGLISH_CONNECTIVE = re.compile(r"(?:furthermore|moreover|additionally|therefore)\b", re.I)
ENGLISH_WORD = re.compile(r"[a-z]+(?:['’][a-z]+)?", re.I)
PROSE_PREFIX = re.compile(rf"^{BLOCK_PREFIX}(?:#{{1,6}}[ \t]+)?")


def mask_markdown(text: str) -> str:
    """Mask non-prose with spaces, preserving source line and column offsets."""
    chars = list(text)

    def blank(start: int, end: int) -> None:
        for index in range(start, end):
            if chars[index] not in "\r\n":
                chars[index] = " "

    frontmatter = re.match(
        r"\A---[ \t]*\r?\n(?:[^\n]*\n)*?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)", text
    )
    cursor = 0
    if frontmatter:
        blank(0, frontmatter.end())
        cursor = frontmatter.end()

    # Consume whole spans so fence/comment markers inside code cannot affect prose.
    while match := MARKDOWN_TOKEN.search(text, cursor):
        start = match.start()
        end = match.end()
        fence = match.group("fence")
        if fence and not (fence[0] == "`" and "`" in match.group("info")):
            closing = re.compile(
                rf"(?m)^{BLOCK_PREFIX}{re.escape(fence[0])}{{{len(fence)},}}[ \t\r]*$"
            ).search(text, end)
            end = closing.end() if closing else len(text)
        elif match.group() == "<!--":
            closing_index = text.find("-->", end)
            end = closing_index + 3 if closing_index != -1 else len(text)
        elif match.group("nonprose_line") is None:
            ticks = match.group("ticks") or fence
            assert ticks is not None
            if fence:
                start = match.start("fence")
                end = start + len(fence)
            closing = re.compile(rf"(?<!`)`{{{len(ticks)}}}(?!`)").search(text, end)
            paragraph_end = re.search(r"\n[ \t\r]*\n", text[end:])
            if closing is None or (
                paragraph_end is not None and closing.start() >= end + paragraph_end.start()
            ):
                cursor = end
                continue
            end = closing.end()
        blank(start, end)
        cursor = end

    # Keep link labels, but mask destinations (including balanced URL parentheses).
    masked = "".join(chars)
    for match in re.finditer(r"!?\[[^\]\n]*\]\(", masked):
        depth = 1
        cursor = match.end()
        while cursor < len(masked) and masked[cursor] not in "\r\n":
            char = masked[cursor]
            if char == "\\":
                cursor += 2
                continue
            if char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
                if depth == 0:
                    blank(match.end() - 1, cursor + 1)
                    break
            cursor += 1
    for match in re.finditer(r"(?<=\])\[[^\]\n]*\]", masked):
        blank(match.start(), match.end())
    for match in re.finditer(r"https?://[^\s<>。！？「」]+", masked, re.I):
        blank(match.start(), match.end())
    return "".join(chars)


def lint(text: str, language: str) -> list[Finding]:
    if RULE_LOAD_ERROR is not None:
        raise RULE_LOAD_ERROR
    if language not in ("ja", "en", "both"):
        raise ValueError(f"Unsupported language: {language}")

    masked = mask_markdown(text)
    starts = [0] + [match.end() for match in re.finditer("\n", text)]
    lines = text.split("\n")
    findings: list[Finding] = []

    def add(offset: int, rule: str, severity: str, message: str) -> None:
        line = bisect_right(starts, offset)
        column = offset - starts[line - 1] + 1
        excerpt_start = max(0, column - 41)
        excerpt = lines[line - 1][excerpt_start : excerpt_start + 160].rstrip("\r")
        findings.append(Finding(rule, severity, line, column, message, excerpt))

    rules = list(COMMON_RULES)
    if language in ("ja", "both"):
        rules.extend(JAPANESE_RULES)
    if language in ("en", "both"):
        rules.extend(ENGLISH_RULES)
    for rule in rules:
        flags = re.I if rule.id.startswith("en.") else 0
        for match in re.finditer(rule.pattern, masked, flags):
            add(match.start(), rule.id, rule.severity, rule.message)

    languages = ("ja", "en") if language == "both" else (language,)
    for paragraph in PARAGRAPH.finditer(masked):
        for current_language in languages:
            sentence_pattern = JAPANESE_SENTENCE if current_language == "ja" else ENGLISH_SENTENCE
            previous_key = ""
            run = 0
            connectors = 0
            for sentence in sentence_pattern.finditer(paragraph.group()):
                raw = sentence.group()
                leading = len(raw) - len(raw.lstrip())
                prefix = PROSE_PREFIX.match(raw[leading:])
                leading += prefix.end() if prefix else 0
                prose = raw[leading:].strip()
                offset = paragraph.start() + sentence.start() + leading
                if current_language == "ja":
                    ending = JAPANESE_ENDING.search(prose.rstrip("。！？!?」』）)]\"' \t\r\n"))
                    key = ending.group() if ending else ""
                    connective = JAPANESE_CONNECTIVE.match(prose)
                    repeated_rule = "ja.repeated-ending"
                    repeated_message = "同じ語尾が3文以上続いている。文体を保ちながら構文を変える。"
                    connective_message = "文頭の接続詞が同じ段落に2回以上ある。不要なものを削る。"
                else:
                    words = ENGLISH_WORD.findall(prose)
                    key = " ".join(words[:2]).casefold() if len(words) >= 2 else ""
                    connective = ENGLISH_CONNECTIVE.match(prose)
                    repeated_rule = "en.repeated-opening"
                    repeated_message = "Three sentences start with the same two words. Recast the structure."
                    connective_message = "Multiple sentence-opening connectors in one paragraph. Remove filler."
                run = run + 1 if key and key == previous_key else 1
                previous_key = key
                if key and run == 3:
                    add(offset, repeated_rule, "warning", repeated_message)
                if connective:
                    connectors += 1
                    if connectors == 2:
                        add(
                            offset,
                            f"{current_language}.connective-overuse",
                            "warning",
                            connective_message,
                        )

    return sorted(findings, key=lambda finding: (finding.line, finding.column, finding.rule))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Review Japanese/English prose using only Python's stdlib.")
    parser.add_argument("file", help="UTF-8 text/Markdown file, or - for stdin")
    parser.add_argument("--language", choices=("ja", "en", "both"), required=True)
    parser.add_argument("--json", action="store_true", help="Output structured findings")
    args = parser.parse_args(argv)
    try:
        data = sys.stdin.buffer.read() if args.file == "-" else Path(args.file).read_bytes()
        text = data.decode("utf-8-sig")
        findings = lint(text, args.language)
    except (OSError, UnicodeError, ValueError) as error:
        parser.exit(2, f"error: {args.file}: {error}\n")

    if args.json:
        print(json.dumps(
            {"file": args.file, "language": args.language, "findings": [asdict(item) for item in findings]},
            ensure_ascii=False,
            indent=2,
        ))
    else:
        for item in findings:
            print(
                f"{args.file}:{item.line}:{item.column}: "
                f"{item.severity}: {item.rule}: {item.message}"
            )
            print(f"  {item.excerpt}")
        print(f"{len(findings)} finding(s). Review in context; this is not an AI-authorship score.")
    return 1 if any(item.severity != "info" for item in findings) else 0


if __name__ == "__main__":
    # Windows pipes default to the ANSI code page, which cannot encode characters such as an em dash.
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8")
    sys.exit(main())
