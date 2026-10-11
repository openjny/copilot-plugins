# writing-skills

書き手を問わず文章の表現と文書の構造を別々にチェックする。

| Skill | 責務 |
| --- | --- |
| [anti-ai-writing](skills/anti-ai-writing/SKILL.md) | 日英の表現レビュー。補助lintで検出した結果を文脈に合わせて判断する。 |
| [doc-lint](skills/doc-lint/SKILL.md) | URL・相対リンク・アンカー、Markdown見出し・構文・表のチェック。 |

`doc-lint` は通常は報告のみ。書き換えは依頼があったときに別途行う。
外部URLの死活確認はオフラインの静的検証と区別する。
用語ゆれ、意味の整合性、外部情報による事実確認は初期範囲に含めない。

`blog-writing` と旧 `evaluation/` の人手評価アプリは移行しない。
評価アプリのDB・生成文・評価結果を配布物に含めない。

## 検証

```bash
uv run --no-project python -m unittest discover \
  -s plugins/writing-skills/skills/anti-ai-writing/scripts -p 'test_*.py'
```

doc-lintの実行・検証方法は [Skill定義](skills/doc-lint/SKILL.md) を参照。
背景資料は [LLMの文章に関する文献](docs/LLMの文章に関する文献.md) にまとめる。
