# /// script
# requires-python = ">=3.11"
# dependencies = ["markdown-it-py==3.0.0"]
# ///
"""Report-only Markdown checks. Network access is opt-in and public-only."""

from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import asdict, dataclass, field
from html.parser import HTMLParser
import http.client
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import sys
import unicodedata
from urllib.parse import unquote, urljoin, urlsplit, urlunsplit

from markdown_it import MarkdownIt


@dataclass
class Finding:
    file: str
    line: int
    code: str
    severity: str
    message: str
    target: str | None = None


@dataclass
class Document:
    path: Path
    anchors: set[str] = field(default_factory=set)
    links: list[tuple[int, str]] = field(default_factory=list)
    findings: list[Finding] = field(default_factory=list)

    def add(self, line: int, code: str, severity: str, message: str,
            target: str | None = None) -> None:
        self.findings.append(Finding(str(self.path), line, code, severity, message, target))


def slug(text: str) -> str:
    """GitHub-like, not a promise of renderer-specific anchor equivalence."""
    return "".join(c for c in text.lower()
                   if c in "_- " or unicodedata.category(c)[0] in "LN").replace(" ", "-")


def inline_text(tokens: list) -> str:
    return "".join(t.content if t.type in ("text", "code_inline") else
                   inline_text(t.children or []) if t.type == "image" else
                   " " if t.type in ("softbreak", "hardbreak") else ""
                   for t in tokens)


class IDs(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.ids: list[str] = []

    def handle_starttag(self, tag: str, attrs: list) -> None:
        for name, value in attrs:
            if value and (name == "id" or (tag == "a" and name == "name")):
                self.ids.append(value)


def table_cells(line: str) -> list[str]:
    # A pipe in a code span still needs escaping in GFM tables.
    parts = re.split(r"(?<!\\)(?:\\\\)*\|", line.strip())
    if parts and not parts[0].strip():
        parts.pop(0)
    if parts and not parts[-1].strip():
        parts.pop()
    return parts


def parse_document(path: Path) -> Document:
    doc = Document(path)
    text = path.read_text(encoding="utf-8-sig")
    lines = text.splitlines()
    if lines and lines[0] == "---":
        end = next((i for i in range(1, len(lines)) if lines[i] in ("---", "...")), None)
        if end is None:
            doc.add(1, "frontmatter-unclosed", "error", "YAML frontmatter の終端がありません。")
            return doc
        lines[:end + 1] = [""] * (end + 1)
    md = MarkdownIt("commonmark").enable("table")
    env: dict = {}
    tokens = md.parse("\n".join(lines), env)
    excluded: set[int] = set()
    heading_counts: Counter = Counter()
    previous_level = 0
    explicit: list[tuple[int, str]] = []
    for index, token in enumerate(tokens):
        if token.type in ("fence", "code_block", "html_block") and token.map:
            excluded.update(range(*token.map))
        if token.type == "fence" and token.map:
            last = lines[token.map[1] - 1] if token.map[1] else ""
            # Closing fences may be indented or nested in blockquotes/lists.
            closing = re.sub(r"^\s*(?:>\s*)*", "", last)
            if (token.map[1] - token.map[0] < 2 or
                    not re.fullmatch(r" {0,3}" + re.escape(token.markup[0]) +
                                     "{" + str(len(token.markup)) + r",}\s*", closing)):
                doc.add(token.map[0] + 1, "fence-unclosed", "warning",
                        "閉じていない fenced code block の可能性があります。")
        if token.type == "heading_open":
            level = int(token.tag[1:])
            line = token.map[0] + 1
            if previous_level and level > previous_level + 1:
                doc.add(line, "heading-jump", "warning", "見出しレベルが飛んでいます。")
            previous_level = level
            heading = tokens[index + 1]
            base = slug(inline_text(heading.children or []))
            anchor = base
            suffix = 0
            while anchor in doc.anchors:
                suffix += 1
                anchor = f"{base}-{suffix}"
            if heading_counts[base]:
                doc.add(line, "heading-duplicate", "warning",
                        f"同名見出し。自動 anchor は #{anchor} として検査します。")
            heading_counts[base] += 1
            doc.anchors.add(anchor)
            if not inline_text(heading.children or []).strip():
                doc.add(line, "heading-empty", "warning", "空の見出しです。")
        if token.type == "table_open" and token.map:
            start, end = token.map
            width = len(table_cells(lines[start]))
            for number in range(start + 2, end):
                if len(table_cells(lines[number])) != width:
                    doc.add(number + 1, "table-width", "warning",
                            "表の列数がヘッダーと一致しません（GFM は補完・切捨てします）。")
        if token.type in ("html_block", "inline"):
            html_tokens = [token] if token.type == "html_block" else token.children or []
            for child in html_tokens:
                if child.type in ("html_inline", "html_block"):
                    parser = IDs()
                    parser.feed(child.content)
                    explicit.extend((token.map[0] + 1, value) for value in parser.ids)
        if token.type != "inline":
            continue
        line = token.map[0] + 1
        for child in token.children or []:
            if child.type == "link_open":
                doc.links.append((line, child.attrGet("href")))
            elif child.type == "image":
                doc.links.append((line, child.attrGet("src")))
        # Undefined references remain text under CommonMark; identify explicit
        # full/collapsed reference candidates, never shortcut [ordinary prose].
        visible = "".join(child.content if child.type == "text" else "\n"
                          for child in token.children or [])
        for match in re.finditer(r"!?\[([^\]\n]+)\]\[([^\]\n]*)\]", visible):
            label = match[2] or match[1]
            normalized = " ".join(label.split()).upper()
            if normalized not in env.get("references", {}):
                doc.add(line, "reference-undefined", "warning",
                        "未定義の reference link 候補です。", label)
        if re.search(r"!?\[[^\]\n]+\]\([^)\n]*$", visible):
            doc.add(line, "link-unclosed", "warning", "閉じていない link 構文の候補です。")
    for line, anchor in explicit:
        if anchor in doc.anchors:
            doc.add(line, "anchor-duplicate", "error", "明示 anchor が重複しています。", anchor)
        doc.anchors.add(anchor)
    for number, line in enumerate(lines):
        if number in excluded:
            continue
        if re.match(r" {0,3}#{1,6}[^#\s]", line):
            doc.add(number + 1, "heading-spacing", "warning",
                    "# の後に空白がなく、CommonMark では見出しになりません。")
        if (number + 1 < len(lines) and "|" in line and
                re.fullmatch(r"[ |:\-]+", lines[number + 1]) and
                "|" in lines[number + 1] and
                not all(re.fullmatch(r"\s*:?-+:?\s*", c)
                        for c in table_cells(lines[number + 1]))):
            doc.add(number + 2, "table-separator", "warning", "表の区切り行の候補が不正です。")
    return doc


def within(path: Path, root: Path) -> bool:
    return path.is_relative_to(root)


def static_link(doc: Document, line: int, target: str, root: Path,
                cache: dict[Path, Document]) -> str | None:
    try:
        parsed = urlsplit(target)
    except ValueError:
        doc.add(line, "link-invalid", "error", "URL を解析できません。", target)
        return None
    if parsed.scheme in ("http", "https") or parsed.netloc:
        return "https:" + target if target.startswith("//") else target
    if parsed.scheme:
        doc.add(line, "link-skipped", "info", "HTTP / relative link 以外は対象外です。", target)
        return None
    path_text = unquote(parsed.path)
    if "\x00" in path_text:
        doc.add(line, "path-invalid", "error", "パスに NUL が含まれています。", target)
        return None
    if path_text.startswith("/"):
        doc.add(line, "root-link-skipped", "warning",
                "サイトルート相対 link は公開サイトの設定が必要なため未検査です。", target)
        return None
    destination = (doc.path.parent / path_text).resolve() if path_text else doc.path
    if not within(destination, root):
        doc.add(line, "path-outside-root", "warning", "--root の外は読み取りません。", target)
        return None
    if not destination.exists():
        doc.add(line, "path-missing", "error", "参照先が存在しません。", target)
    elif parsed.fragment:
        if destination.suffix.lower() != ".md" or not destination.is_file():
            doc.add(line, "anchor-skipped", "info", "Markdown 以外の anchor は未検査です。", target)
        else:
            try:
                if destination not in cache:
                    cache[destination] = parse_document(destination)
                if unquote(parsed.fragment) not in cache[destination].anchors:
                    doc.add(line, "anchor-missing", "error", "参照先に anchor がありません。", target)
            except (OSError, UnicodeError) as exc:
                doc.add(line, "target-read-error", "error", f"参照先を読めません: {type(exc).__name__}", target)
    return None


class BlockedURL(ValueError):
    pass


def public_endpoint(url: str) -> tuple[str, int, str]:
    parsed = urlsplit(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise BlockedURL("HTTP(S) の絶対 URL ではありません")
    if parsed.username is not None or parsed.password is not None or parsed.query:
        raise BlockedURL("認証情報または query を含む URL は送信しません")
    host = parsed.hostname.encode("idna").decode("ascii").lower()
    if host.rstrip(".") == "localhost" or host.rstrip(".").endswith((".localhost", ".local", ".internal")):
        raise BlockedURL("localhost / local host は対象外です")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    if port not in (80, 443):
        raise BlockedURL("80 / 443 以外の port は対象外です")
    addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    ips = [entry[4][0] for entry in addresses]
    if not ips or any(not ipaddress.ip_address(ip).is_global for ip in ips):
        raise BlockedURL("非 public IP を含む host は対象外です")
    return host, port, ips[0]


def request_public(url: str, method: str, timeout: float) -> tuple[int, str | None]:
    host, port, ip = public_endpoint(url)
    parsed = urlsplit(url)
    cls = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
    connection = cls(host, port, timeout=timeout)
    # Pin the validated IP; HTTPS still verifies the original hostname (SNI).
    connection._create_connection = lambda address, timeout, source_address=None: socket.create_connection(
        (ip, port), timeout, source_address)
    try:
        connection.request(method, parsed.path or "/", headers={"User-Agent": "doc-lint/1.0"})
        response = connection.getresponse()
        return response.status, response.getheader("Location")
    finally:
        connection.close()


def check_url(url: str, timeout: float = 15) -> dict:
    result = {"url": url, "state": "error", "status": None, "method": "HEAD",
              "final_url": None, "error": None}
    current = urlunsplit(urlsplit(url)._replace(fragment=""))
    method = "HEAD"
    try:
        for _ in range(6):
            status, location = request_public(current, method, timeout)
            result.update(status=status, method=method, final_url=current)
            if status in (301, 302, 303, 307, 308):
                if not location:
                    raise ValueError("redirect に Location がありません")
                current = urljoin(current, location)
                continue
            if status in (405, 501) and method == "HEAD":
                method = "GET"
                status, location = request_public(current, method, timeout)
                result.update(status=status, method=method)
                if status in (301, 302, 303, 307, 308):
                    if not location:
                        raise ValueError("redirect に Location がありません")
                    current = urljoin(current, location)
                    continue
            result["state"] = "ok" if 200 <= status < 300 else "error"
            if result["state"] == "error":
                result["error"] = f"HTTP {status}（削除・認証・一時制限などの区別はしません）"
            return result
        raise ValueError("redirect 上限 (5) を超えました")
    except BlockedURL as exc:
        result.update(state="blocked", error=str(exc))
    except (OSError, ValueError, http.client.HTTPException) as exc:
        result.update(state="error", error=f"{type(exc).__name__}: {exc}")
    return result


def run(paths: list[Path], root: Path, *, network: bool = False,
        timeout: float = 15, max_urls: int = 100) -> dict:
    root = root.resolve()
    docs: dict[Path, Document] = {}
    findings: list[Finding] = []
    inputs: set[Path] = set()
    for item in paths:
        item = item.resolve()
        if not within(item, root):
            findings.append(Finding(str(item), 1, "input-outside-root", "error", "入力が --root の外です。"))
        elif item.is_dir():
            inputs.update(p.resolve() for p in item.rglob("*.md") if within(p.resolve(), root))
        elif item.is_file():
            inputs.add(item)
        else:
            findings.append(Finding(str(item), 1, "input-missing", "error", "入力が存在しません。"))
    if not inputs and not findings:
        findings.append(Finding(str(root), 1, "input-empty", "warning", "Markdown 入力がありません。"))
    for path in sorted(inputs):
        try:
            docs[path] = parse_document(path)
        except (OSError, UnicodeError) as exc:
            findings.append(Finding(str(path), 1, "input-read-error", "error", type(exc).__name__))
    urls: dict[str, list[dict]] = {}
    for path in sorted(inputs):
        if path not in docs:
            continue
        doc = docs[path]
        for line, target in doc.links:
            url = static_link(doc, line, target, root, docs)
            if url:
                urls.setdefault(url, []).append({"file": str(path), "line": line})
        findings.extend(doc.findings)
    results = []
    for index, (url, sources) in enumerate(urls.items()):
        result = (check_url(url, timeout) if network and index < max_urls else
                  {"url": url, "state": "skipped", "status": None, "method": None,
                   "final_url": None, "error": "URL 上限" if network else "offline"})
        result["sources"] = sources
        results.append(result)
    summary = dict(Counter(f.severity for f in findings))
    summary.update(files=len(inputs), urls=len(results),
                   network_errors=sum(r["state"] == "error" for r in results),
                   network_skipped=sum(r["state"] in ("skipped", "blocked") for r in results))
    return {"mode": "network" if network else "offline", "root": str(root),
            "findings": [asdict(f) for f in findings], "urls": results, "summary": summary}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+", type=Path, help="Markdown files or directories")
    parser.add_argument("--root", type=Path, help="読み取りを許可する範囲（既定: 入力の共通親）")
    parser.add_argument("--network", action="store_true", help="public URL の liveness を検査")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--strict", action="store_true", help="warning / 未検査 URL も exit 1")
    parser.add_argument("--timeout", type=float, default=15)
    parser.add_argument("--max-urls", type=int, default=100)
    args = parser.parse_args(argv)
    if not 0 < args.timeout <= 60 or not 1 <= args.max_urls <= 1000:
        parser.error("--timeout: (0, 60], --max-urls: [1, 1000]")
    root = args.root or Path(os.path.commonpath([
        str(p.resolve() if p.is_dir() else p.resolve().parent) for p in args.paths]))
    report = run(args.paths, root, network=args.network, timeout=args.timeout, max_urls=args.max_urls)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        for f in report["findings"]:
            print(f'{f["file"]}:{f["line"]}: {f["severity"]} {f["code"]}: {f["message"]}'
                  + (f' [{f["target"]}]' if f["target"] is not None else ""))
        for result in report["urls"]:
            print(f'{result["state"]}: {result["url"]} {result["status"] or ""} {result["error"] or ""}')
        print(json.dumps(report["summary"], ensure_ascii=False), file=sys.stderr)
    summary = report["summary"]
    failed = summary.get("error", 0) or summary["network_errors"]
    if args.strict:
        failed = failed or summary.get("warning", 0) or summary["network_skipped"]
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
