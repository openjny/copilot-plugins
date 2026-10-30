---
name: writing-style
description: "文章を書く・推敲する・校正するときの指針と、表現のクセを検出する lint。ブログ、README、設計書、PR 説明、メール、スライドなどで使う。AI 臭の除去にも使える。"
---

# Writing style

読み手が、必要なときに、必要な情報を、読みやすい形で受け取れる文章を書くための指針です。書くときや推敲するときに立ち返る考え方と、表現の偏りを機械的に拾う lint をまとめました。細かいルールは必要に応じてリファレンスを引きましょう。

- [references/principles.md](./references/principles.md): 原則。書くときも直すときも、最初に必ず読む
- [references/japanese.md](./references/japanese.md): 日本語の表現
- [references/english.md](./references/english.md): 英語の表現
- [references/technical.md](./references/technical.md): README、設計書、手順書、PR 説明など
- [references/design.md](./references/design.md): このスキルの設計。スキル自体を編集するときに読む

日英が混ざる文章は両方のファイルを、技術文書は加えて technical.md を参照します。

## 書くときの姿勢

読む場面を先に決め、結論と理由を先に置きます。媒体の形に合わせて書き方を変え、確かめられる事実で語り、根拠は主張の近くに置きます。規則と読み手の理解がぶつかったときは、読み手が優先です。既存の文書を直すときは、そのトーンと原文の確信度を変えません。理由と例は principles.md にあります。

## 進め方

1. 読み手、目的、結論を整理してから本文に向かいます。技術文書なら、まず文書のモードを決めましょう。
2. 短い文であっても全文に lint を通します。チャットの文章は標準入力か一時ファイルで渡してください。
3. 警告ごとに直すか残すかを判断します。機械的な一括置換を避け、指摘を消すためだけに事実を曲げてはいけません。
4. 修正後に再実行し、残した指摘に筋の通った理由があれば完了です。ゼロ件を目指す必要はありません。
5. 最後に全体を通読し、論理の流れや読みやすさを自分の目で確かめます。

レビューや診断だけを依頼されたときは、指摘と修正案を返すにとどめ、原文を直接書き換えるのは避けます。スクリプトを動かせない環境ではその事実を正直に伝え、確認済みと偽ってはいけません。Markdown の構造やリンク切れの確認は、同じプラグイン内の `markdown-check` に任せます。

## lint の動かし方

[scripts/lint.py](./scripts/lint.py) は Python 3.10 以上の標準ライブラリだけで動き、外部通信を行わず入力ファイルも一切変更しません。コマンド中の `<skill-directory>` は、この SKILL.md が置かれたディレクトリの絶対パスへ置き換えて実行します。

```bash
uv run --no-project "<skill-directory>/scripts/lint.py" --language ja draft.md
uv run --no-project "<skill-directory>/scripts/lint.py" --language en draft.md --json
uv run --no-project "<skill-directory>/scripts/lint.py" --language both draft.md
```

`--language` には ja、en、both を指定でき、ファイル名に `-` を渡せば標準入力を読み込みます。`--json` を添えると rule、severity、line、column、message、excerpt を含む結果を出力します。終了コードは 0 が指摘なしまたは info のみ、1 は警告やエラーの検出、2 が引数やルールの異常です。コード 1 は失敗ではなく見直すべき箇所がある合図にすぎません。

コードブロックやインラインコード、URL、先頭の YAML front matter は検査から除外されます。検出できるのは語句や記号、語尾や接続詞の重複といった表層パターンに限られるため、通読による推敲は不可欠です。検査ルールは [scripts/rules.json](./scripts/rules.json) に terms や pattern として追加でき、severity には info、warning、error を設定します。生成 AI 特有の定型句も検出対象に入っていますが、人間か AI かの判定は行いません。
