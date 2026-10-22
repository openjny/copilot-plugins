---
name: markdown-check
description: "Use when: Markdown 文書のリンクチェック、リンク切れ、URL 検証、相対リンク・anchor・reference link、見出し・構文・表の構造を著者や生成方法に関係なく検査したいとき。markdown check / doc lint / document check / broken link / validate URLs。既定は offline・report-only。文章の品質評価・リライト、認証付き HTTP、localhost の検査には使わない。"
license: MIT
---

# markdown-check

著者を問わず Markdown の機械的な問題を報告する。
対象は URL・相対リンク・anchor と Markdown の見出し・構文・表構造だけ。
文体、事実、読みやすさ、AI らしさは判断しない。
**入力ファイルを編集しない。修正依頼があってもこのスキルは報告まで。**

## 手順

1. 入力ファイル／ディレクトリと、読んでよい範囲 `--root` を決める。
2. まず offline 検査を実行する。外部 URL の生存確認は別扱いにする。
3. 利用者が外部アクセスを許可したときだけ `--network` を追加する。
4. error、warning、未検査を分け、ファイル・行・検査コードを報告する。
   network error だけで「リンクが削除された」と断定しない。
5. renderer 固有の問題や未検査項目を明示する。修正は自動適用しない。

以下のパスはこの `SKILL.md` があるディレクトリからの相対パス。
別の場所からはスクリプトへの絶対パスを使う。

```bash
# 単一ファイル: 外部通信なし
uv run scripts/check_docs.py /path/to/project/README.md

# docs 以下を検査し、project 内への相対参照も許可
uv run scripts/check_docs.py /path/to/project/docs --root /path/to/project --json

# 外部 URL の生存確認は明示的に opt-in
uv run scripts/check_docs.py /path/to/project/docs --root /path/to/project --network --json

# warning や未検査の外部 URL も失敗扱いにする
uv run scripts/check_docs.py /path/to/project/docs --strict

# ネットワーク上限: 逐次実行、URL 100 件、1 request 15 秒が既定
uv run scripts/check_docs.py /path/to/project/docs --network --max-urls 50 --timeout 10

# focused tests（実際の外部通信なし）
uv run scripts/test_check_docs.py
```

Python 3.11 以上。依存はスクリプトの PEP 723 metadata に記載し、
`uv run` が分離環境に解決する。global install や `pip` は使わない。

## 検査の範囲

### Offline static checks

- CommonMark parser + table 拡張を使用。ディレクトリは `*.md` を再帰走査する。
  明示したファイルは拡張子を問わず Markdown として読む。
- fenced / indented code、inline code、HTML comment、先頭 YAML frontmatter
  の link は抽出しない。frontmatter は終端だけ確認し、YAML 内容は検証しない。
- inline link、image、autolink、定義済み reference link を抽出する。
  未定義の full / collapsed reference は候補として warning。
  定義だけの未使用 URL、単なる裸 URL、shortcut reference の未定義候補は検査しない。
- 相対参照は文書の親ディレクトリ起点。percent-encoded path / anchor を decode。
  ファイル・ディレクトリの存在、`.md` への fragment を検査する。
  `?query` はローカルの存在確認では無視する。
- `--root` の既定は入力ディレクトリ／入力ファイルの親の共通祖先。
  symlink の参照先も範囲内のみ読む。広すぎる root は避ける。
  root 外は warning、入力自体が root 外なら error。
- 見出しは ATX / Setext、空見出し、レベル飛び、同名見出し、
  `#` 後の空白不足を検査。閉じていない fence / link 構文の候補も warning。
- table の列数と、不正な区切り行の候補を報告する。
- HTML の `id` と `<a name>` を anchor として扱い、重複は error。
  HTML の `href` / `src` は検査しない。

### Opt-in URL liveness

- HTTP(S) のみ。外部には抽出 URL のみを送る。本文や周辺テキストを送らない。
  ただし URL の path 自体も外部へ送るため、機密 path の文書は offline のまま使う。
- 認証しない。userinfo、query 付き URL は認証情報流出を避けるため blocked。
  cookie、Authorization、環境の proxy 設定は使わない。
- localhost、`.local` / `.internal`、非 public IP を含む DNS 解決先、
  port 80 / 443 以外は blocked。redirect 先も毎回検査する。
  接続は検査済み IP に固定し、HTTPS の証明書／hostname 検証は維持する。
- HEAD、405 / 501 のときだけ GET。body は読まない。redirect は最大 5 回。
  2xx を ok、それ以外や timeout / DNS / TLS / 接続障害を error として明示する。
- 逐次・重複 URL は一度だけ。cache、永続 state、retry は作らない。
  上限を超えた URL は skipped として残す。
- public service に認証が必要でも認証を試みない。401 / 403 / 429 などは
  status を報告するだけで、原因を断定しない。

## 出力と exit codes

テキストは finding と全外部 URL の状態を stdout、集計を stderr に出す。
`--json` は stdout に次の object を出し、offline でも URL を省略しない。

```json
{
  "mode": "offline",
  "root": "/path/to/project",
  "findings": [
    {
      "file": "/path/to/project/README.md",
      "line": 3,
      "code": "path-missing",
      "severity": "error",
      "message": "参照先が存在しません。",
      "target": "missing.md"
    }
  ],
  "urls": [
    {
      "url": "https://example.com",
      "state": "skipped",
      "status": null,
      "method": null,
      "final_url": null,
      "error": "offline",
      "sources": [{"file": "/path/to/project/README.md", "line": 4}]
    }
  ],
  "summary": {
    "error": 1,
    "files": 1,
    "urls": 1,
    "network_errors": 0,
    "network_skipped": 1
  }
}
```

`severity`: `error` / `warning` / `info`。該当しない severity の集計 key は省略。
URL `state`: `ok` / `error` / `blocked` / `skipped`。

| exit | 意味 |
|---|---|
| 0 | error なし。warning / skipped / blocked は残る可能性がある |
| 1 | static error または network error。`--strict` では warning / 未検査 URL も含む |
| 2 | 引数のエラー（argparse）。JSON 出力ではない |

## Markdown rendering の曖昧さ

- Markdown は未閉鎖構文を通常の本文として許容する。構文の候補は warning であり、
  Markdown 全体の構文妥当性を保証する linter ではない。
- anchor は GitHub-like: 小文字化、文字・数字・`_`・`-`・空白を残し、
  空白を `-` にする。同名は `-1`、`-2` …。重複見出し自体は warning。
  記号、Unicode、HTML、重複時の割当ては renderer と異なる場合がある。
- `{#custom-id}`、MDX、サイトルート相対 `/docs/...`、HTML link、
  非 Markdown ファイルの anchor、外部 URL fragment、JS は解決しない。
- GFM table は列不足を補完し余分を切り捨てる。列数 warning は表示不能の断定ではない。
  `\|` はセル内 pipe。code span 内でも pipe は escape が必要。
- 行番号は parser の block 開始位置を基本とする。複数行 link は
  厳密な link 開始行と異なることがある。

## 同梱ファイル

- [checker](./scripts/check_docs.py)
- [focused tests](./scripts/test_check_docs.py)
