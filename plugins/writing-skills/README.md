# writing-skills

書き手を問わず、文章を書くときに意識することと、Markdown文書のリンク・構造のチェックを提供する。

| Skill | 責務 |
| --- | --- |
| [writing-style](skills/writing-style/SKILL.md) | 文章を書く・直すときの共通原則。日英の表現と技術文書の書き方を `references/` に持ち、補助lintで表現のクセを検出する。 |
| [markdown-check](skills/markdown-check/SKILL.md) | URL・相対リンク・アンカー、Markdown見出し・構文・表のチェック。 |

`writing-style` は、書き手が人でもAIでも使う。技術文書の書き方（文書のモード、手順、一文一義、誤読の排除、用語統一）は [technical.md](skills/writing-style/references/technical.md) にまとめる。ファイルの責務と規則の置き場所は [design.md](skills/writing-style/references/design.md) に書く。
`markdown-check` は通常は報告のみ。書き換えは依頼があったときに別途行う。
外部URLの死活確認はオフラインの静的検証と区別する。
`markdown-check` は、用語ゆれ、意味の整合性、外部情報による事実確認を扱わない。用語の統一は `writing-style` が見る。

`blog-writing` と旧 `evaluation/` の人手評価アプリは移行しない。
評価アプリのDB・生成文・評価結果を配布物に含めない。

## 検証

```bash
uv run --no-project python -m unittest discover \
  -s plugins/writing-skills/skills/writing-style/scripts -p 'test_*.py'
```

markdown-checkの実行・検証方法は [Skill定義](skills/markdown-check/SKILL.md) を参照。
背景資料は [LLMの文章に関する文献](references/LLMの文章に関する文献.md) にまとめる。
