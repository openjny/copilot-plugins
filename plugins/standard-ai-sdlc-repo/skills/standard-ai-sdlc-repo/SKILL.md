---
name: standard-ai-sdlc-repo
description: "AI支援ソフトウェア開発向けの標準的なリポジトリをセットアップまたはレビューし、必要な基本ファイル、ドキュメント、ガバナンス、エージェント向けコンテキストを整備するスキル。Use when: プロジェクト開始、リポジトリ初期化、プロジェクトセットアップ、リポジトリのひな型作成、標準ファイルの要否判断、README、プロダクトビジョン、AGENTS.md、CONTRIBUTING、SECURITY、ADR、docs、tests、CI構成。Triggers: project setup, repo setup, scaffold repository"
---

# 標準AI支援SDLCリポジトリ

人とAIコーディングエージェントの両方にとって理解しやすく、保守しやすいリポジトリを作成またはレビューします。プロジェクトの実際のリスク、対象者、ライフサイクルに合わせて構成を調整し、形式を整えるためだけの空ファイルは作成しません。

## 手順

1. リポジトリを調査し、プロジェクト種別、成熟度、想定利用者、デプロイ形態、共同作業の形態を特定します。
2. 構成を実質的に変える情報だけを質問します。最低限、公開か非公開か、個人開発か共同開発か、デプロイするシステムかライブラリのみか、機密データを扱うかを確認します。
3. 下表から成果物を選びます。**必須**を標準の基礎とし、**条件付き**の成果物は条件に該当する場合だけ追加します。
4. ファイルを作成する前に、採用する構成と前提を簡潔に説明します。
5. [`references/`](references/) のテンプレートを出発点として再利用します。リポジトリに合わせて調整し、説明用のプレースホルダーと不要なセクションは削除します。
6. エコシステムの公式初期化ツールと既存のリポジトリ規約があれば優先します。生成された設定を汎用テンプレートで置き換えません。
7. リンク、設定構文、ビルドやテストのコマンド、クリーンなチェックアウトからの開始手順を検証します。
8. 作成したもの、意図的に省略したもの、その理由を報告します。

## リポジトリ構成

| パス | 役割 | 必須 | 条件 | 参考 |
|:---|:---|:---|:---|:---|
| `README.md` | 入口として目的、状態、クイックスタート、使い方、詳細ドキュメントへのリンクを示す | はい | 常に作成 | [テンプレート](references/README.template.md) |
| `.gitignore` | 生成物、ローカル状態、シークレットがバージョン管理へ入ることを防ぐ | はい | 実際に使う言語とツールに合わせて常に作成 | [gitignoreテンプレート](https://github.com/github/gitignore) |
| `LICENSE` | 再利用と配布の権利を明示する | 条件付き | 公開またはソース共有するリポジトリでは必須。所有者と相談して選び、暗黙に推測しない | [choosealicense.com](https://choosealicense.com/) |
| `AGENTS.md` | コーディングエージェント向けに固有のコマンド、境界、規約、検証ルールを示す | はい | AI支援開発では常に作成。簡潔かつ検証可能に保つ | [テンプレート](references/AGENTS.template.md) |
| `.github/copilot-instructions.md` | GitHub Copilot固有の常時適用するリポジトリ指示を提供する | 条件付き | `AGENTS.md` では十分に表せないCopilot固有の指示がある場合。内容を重複させない | [GitHub Docs](https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot) |
| `CONTRIBUTING.md` | セットアップ、作業手順、品質ゲート、コントリビューションへの期待を説明する | 条件付き | 共同開発、公開、または複数チームで扱うリポジトリ | [テンプレート](references/CONTRIBUTING.template.md) |
| `CODE_OF_CONDUCT.md` | コミュニティで期待する行動と適用方法を定義する | 条件付き | 外部参加を受け入れる公開プロジェクトまたはコミュニティ | [Contributor Covenant](https://www.contributor-covenant.org/) |
| `SECURITY.md` | 脆弱性の非公開報告方法とバージョンサポート方針を示す | 条件付き | 公開、デプロイ、配布、セキュリティ上重要、または依存先として提供するプロジェクト | [テンプレート](references/SECURITY.template.md) |
| `CHANGELOG.md` | リリースされた重要な変更を人が読める形で記録する | 条件付き | 利用者がいるバージョン付き製品やライブラリ。別の場所でリリースを追跡する継続的デプロイの社内アプリでは省略可能 | [Keep a Changelog](https://keepachangelog.com/) |
| `docs/product-vision.md` | 望ましい将来、受益者、価値、目標、非目標、成功指標、原則を定義する | はい | プロジェクト開始時は常に作成。ごく小規模なら同じ項目を `README.md` に含めてもよい | [テンプレート](references/product-vision.template.md) |
| `docs/architecture/README.md` | システムコンテキスト、制約、品質目標、主要コンポーネント、実行・配置ビューを説明する | 条件付き | 複数コンポーネント、重要な連携、明白でないアーキテクチャ、または大きな運用リスクがある場合 | [arc42](https://arc42.org/overview) |
| `docs/decisions/NNNN-title.md` | 重要な意思決定、その背景、選択肢、結果を記録する | 条件付き | 元に戻すコストが高い、または後から再検討される可能性が高い意思決定 | [テンプレート](references/adr.template.md) |
| `docs/roadmap.md` | ビジョンを機能一覧にせず、意図する成果と順序を伝える | 条件付き | 複数のマイルストーンまたはステークホルダーの期待がある共有製品 | [Product Goal](https://scrumguides.org/scrum-guide.html#product-goal) |
| `src/` | 本番ソースコードをテストや運用資産から分離して格納する | 条件付き | エコシステムの慣例である場合。別の標準配置を持つフレームワークには強制しない | エコシステムの規約 |
| `tests/` | ソースと同じ場所に置かないテストを格納する | 条件付き | エコシステムの慣例である場合。それ以外はテストをソースと同じ場所に置く規約に従う | エコシステムの規約 |
| `scripts/` | 開発、検証、リリース、保守の反復可能な自動化を格納する | 条件付き | パッケージマネージャーの単純なスクリプトでは収まらない場合。可能ならWindowsとLinuxの両方に対応する | プロジェクト固有 |
| `.editorconfig` | エディター間で基本的な空白と改行の扱いをそろえる | 条件付き | 複数のコントリビューターまたは異なる開発環境がある場合 | [EditorConfig](https://editorconfig.org/) |
| 依存関係マニフェストとロックファイル | 再現可能な依存関係とプロジェクトメタデータを宣言する | はい | エコシステムが使用する場合は常に作成。推奨されるロックファイルをコミットする | エコシステムの規約 |
| ビルド、リント、フォーマット、テスト設定 | 品質チェックを実行可能かつ再現可能にする | はい | 実際に使用するツールだけを追加。各チェックに正規のコマンドを一つ定める | エコシステムの規約 |
| `.github/workflows/ci.yml` | 変更提案に対して必須チェックを一貫して実行する | 条件付き | 共有リポジトリ、保護ブランチ、リリース可能な成果物、またはデプロイするサービス | [GitHub Actions](https://docs.github.com/en/actions) |
| `.github/ISSUE_TEMPLATE/` | 再現可能な不具合報告と実行可能な機能要望を収集する | 条件付き | 複数人または外部利用者からIssueを受け付ける場合 | [GitHub Docs](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests) |
| `.github/pull_request_template.md` | 変更の意図、検証、リスク、関連作業の記載を促す | 条件付き | Pull Requestが通常の統合手段である場合 | [GitHub Docs](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests) |
| `docs/threat-model.md` | 資産、信頼境界、脅威、緩和策を特定する | 条件付き | 認証、認可、信頼できない入力、機密データ、公開エンドポイント、または影響の大きな操作がある場合 | [OWASP Threat Modeling](https://owasp.org/www-community/Threat_Modeling) |
| `docs/operations/` | デプロイ、設定、可観測性、バックアップ、復旧、インシデント対応を文書化する | 条件付き | デプロイするサービス、または作者以外が運用するシステム | プロジェクト固有 |

## 選定ルール

- プレースホルダーだらけの大規模な構成より、小さくても完全な基礎構成を優先します。
- 安定した意図と変化する計画を分離します。ビジョンは方向、ロードマップは順序、Issueは作業を表します。
- 製品の意図とアーキテクチャを分離します。受益者と成果はビジョンに、コンポーネントと技術的なトレードオフはアーキテクチャとADRに記載します。
- 実行可能な正しい情報はスクリプトと設定に置きます。ドキュメントで実装を言い換えず、正規のコマンドへリンクします。
- 隣接する期待が生じそうな場合は、非目標を明記します。非目標は境界であり、単に後のマイルストーンへ延期した作業ではありません。
- 同じ指示を `README.md`、`AGENTS.md`、Copilot向け指示へ重複して書きません。正規の記載場所を一つ選び、ほかからリンクします。
- 見栄えだけを目的にバッジ、ガバナンス、リリース自動化、コンプライアンス文書を追加しません。

## 最小構成

新しいAI支援プロジェクトでは、次の構成から始めます。

```text
.
|-- README.md
|-- AGENTS.md
|-- .gitignore
|-- docs/
|   `-- product-vision.md
|-- <dependency manifest and lockfile>
|-- <source layout>
|-- <test layout>
`-- <build, lint, format, and test configuration>
```

共同作業、セキュリティ、アーキテクチャ、運用、自動化の成果物は、それぞれの条件に該当する場合だけ追加します。

## 完了条件

- 新しいコントリビューターやエージェントが、プロジェクトの目的、想定受益者、非目標を特定できます。
- 記載されたセットアップがクリーンなチェックアウトから動作します。
- ビルド、リント、テストのコマンドが明示され、実行できます。
- 条件付き成果物には実際の所有者と内容があり、省略した成果物には説明可能な理由があります。
- 生成物、ローカルパス、資格情報、シークレットがコミットされていません。
- `README.md`、`AGENTS.md`、このスキルが生成した文書からのリンクがすべて解決します。

## 出典

- [Product Vision Board](https://www.romanpichler.com/tools/product-vision-board): ビジョン、対象グループ、ニーズ、製品、事業目標。
- [The Scrum Guide](https://scrumguides.org/scrum-guide.html#product-goal): プロダクトゴール、製品境界、ステークホルダー、利用者、顧客。
- [Standard for Public Code: Document codebase objectives](https://www.standardforpubliccode.org/criteria/document-codebase-objectives.html): リポジトリ単位のミッションと目標。
- [arc42](https://arc42.org/overview): アーキテクチャ目標、制約、コンテキスト、意思決定、ビュー。
- [Kubernetes Enhancement Proposal template](https://github.com/kubernetes/enhancements/tree/master/keps/NNNN-kep-template): 動機、目標、非目標、ユーザーストーリー、リスク、検証。
- [Open Source Guides](https://opensource.guide/starting-a-project/): 公開プロジェクトの基本ファイルとコミュニティプラクティス。
