# スキルの設計

このスキルの各ファイルに何を書くか、新しい規則をどこに足すかを決めるための文書です。スキルを編集するときに読みます。使う側は、SKILL.md から読み始めれば足ります。

## ファイルの責務

| ファイル | 書くこと | 書かないこと |
|:--|:--|:--|
| SKILL.md | スキルを読み込む判断に使う description、原則の要点、手順、lint の使い方 | 個別の表現規則 |
| references/principles.md | 書き手や言語を問わず、常に当てはまる原則 | 言語や文書の種類に固有の規則 |
| references/japanese.md | 日本語に固有の表現規則と修正例 | 英語の規則 |
| references/english.md | 英語に固有の表現規則 | 日本語の規則 |
| references/technical.md | README、設計書、手順書、PR 説明など、技術文書の書き方 | 言語に固有の表現規則 |
| scripts/rules.json | lint が検出する語句と正規表現 | 機械で判定できない規則 |
| scripts/lint.py | rules.json では書けない判定（語尾や接続詞の反復、Markdown の除外処理）の実装 | 語句のリスト |
| scripts/test_lint.py | lint の動作と、SKILL.md や references 内のリンクの検査 | |

## 新しい規則の置き場所

規則を足すときは、次の順に当てはまる場所を探します。

1. 書き手や言語を問わず常に当てはまるなら、principles.md です。
2. 特定の言語の表現なら、japanese.md か english.md です。技術文書にだけ当てはまるなら、technical.md に書きます。
3. 語句やパターンで機械的に検出できるなら、rules.json にも足します。message には、直し方が分かる一文を添えてください。語句のリストで表せない判定は lint.py に実装し、test_lint.py にテストを足します。
4. Markdown のリンクや構造の問題は、このスキルの対象外です。同じプラグインの `markdown-check` に任せます。

同じ内容を 2 か所に書かないでください。すでに別のファイルにあるなら、リンクで参照します。SKILL.md に置いてよいのは、principles.md の要点だけです。
