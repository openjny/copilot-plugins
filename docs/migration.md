# 中央Skillの移行対応表

確認日: 2026-10-12。プロジェクト系Skillは対象外。

## 正本

- 公開: `openjny/copilot-plugins`、marketplace名 `openjny`。
- 非公開: `openjny/copilot-plugins-private`、marketplace名 `openjny-private`。
- 元の非公開 `openjny-agent-plugins` は履歴を維持してrenameする。
- インストール済みコピーは正本として編集しない。

## 公開側

| 移行元 | 移行先 | 扱い |
| --- | --- | --- |
| 既存copilot-plugins | 既存6 Plugin | 継続 |
| 旧agent-plugins / personal-skills | plan-skill | 計画専用を維持しホスト固有ツール参照を修正 |
| 旧agent-plugins | writing-skills/anti-ai-writing | lint・テスト・日英参照を維持 |
| personal-skills/link-liveness | writing-skills/doc-lint | 文書リンク・構造チェックへ再設計 |
| agent-skills | azure-ops | azure-price-api、azure-updatesと補助assets/script |

## 非公開側

| 移行元 | Plugin | 扱い |
| --- | --- | --- |
| 旧agent-plugins | software-architecture | 2 Skillと資料を維持 |
| 旧agent-plugins | think-like | me、narita、最新mainのtoshioを維持 |
| personal-skills | notebooklm | 独立Plugin |
| personal-skills | pptx-as-md | 独立Plugin |
| personal-skills | rakuten-carshare-check | 独立Plugin、検索専用 |
| personal-skills | yt-transcript | 独立Plugin |
| ghe-ops-skills | ghe-ops | clickops、ghe-webui、github-wafを維持 |

マーケット仕様とGHE知識の更新Skillは非公開リポジトリの `.github/skills` に残す。

## 廃止

- 旧agent-plugins: blog-writing、research-tools、microsoft-work、browser-use。
- writing-skillsの人手評価アプリ `evaluation/`。
- personal-skills: grilling-ddd、kaizen-idea、slide-hosting-sites、tech-news、doc-toolkit。
- council / grilling / plan-skillのローカル重複は比較・検証後に整理する。

## 差分の扱い

- plan-skillの2コピーは、front matterのdescription引用符だけが異なる。
- grillingは公開版がホスト非依存・日本語であり、旧版の一問ずつの手順を包含する。
  公開版を維持する。
- councilはローカルのモデル名更新を保全し、ユーザー確認のうえ固定名を廃止。
  利用可能な異なる3プロバイダーから各1つ、対象の課題に適した最上位モデルを選ぶ。
  モデル指定を支援しない実行環境や3プロバイダー未満の場合は制約を報告して確認する。

## 配布・切替条件

1. Git履歴とローカル未コミット変更は移行前バックアップで復元検証済み。
2. manifest schema、front matter、相対参照とスクリプトテストを確認する。
3. `copilot --plugin-dir` で一時的に認識を検証する。
4. 公開ファイルの出典・機密情報、公開先を確認してpushする。
5. 新マーケットからインストール・動作確認し、旧コピーを整理する。
6. personal-skills、agent-skills、ghe-ops-skillsは移行と動作確認後にarchiveする。

実アカウント操作、字幕取得、カーシェア検索などは構造検証とは別のsmoke test。
未検証のサービス操作を検証済みと扱わない。
公開ghe-ops-skillsをarchiveしても公開履歴は残る。
