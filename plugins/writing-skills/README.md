# writing-skills

書き手を問わず、文章の表現、技術文書の書き方、文書の構造を別々にチェックする。

| Skill | 責務 |
| --- | --- |
| [anti-ai-writing](skills/anti-ai-writing/SKILL.md) | 日英の表現レビュー。補助lintで検出した結果を文脈に合わせて判断する。 |
| [technical-writing](skills/technical-writing/SKILL.md) | 日本語の技術文書の書き方。文書のモード、手順、一文一義、誤読の排除、用語統一。 |
| [markdown-check](skills/markdown-check/SKILL.md) | URL・相対リンク・アンカー、Markdown見出し・構文・表のチェック。 |

`anti-ai-writing` はAIにありがちな表現だけを扱う。人間の文章にも起きる曖昧さや構成の問題は `technical-writing` が扱う。
`markdown-check` は通常は報告のみ。書き換えは依頼があったときに別途行う。
外部URLの死活確認はオフラインの静的検証と区別する。
`markdown-check` は、用語ゆれ、意味の整合性、外部情報による事実確認を扱わない。用語の統一は `technical-writing` が見る。

`blog-writing` と旧 `evaluation/` の人手評価アプリは移行しない。
評価アプリのDB・生成文・評価結果を配布物に含めない。

## 検証

```bash
uv run --no-project python -m unittest discover \
  -s plugins/writing-skills/skills/anti-ai-writing/scripts -p 'test_*.py'
```

markdown-checkの実行・検証方法は [Skill定義](skills/markdown-check/SKILL.md) を参照。
背景資料は [LLMの文章に関する文献](references/LLMの文章に関する文献.md) にまとめる。
