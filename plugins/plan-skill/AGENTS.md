# plan-skill プラグイン ガイドライン

反復的プランニング手法を提供するプラグイン。Discovery → Alignment → Design → Refinement のサイクルを通じて、実行前に包括的なアクションプランを策定する。

## ディレクトリ構造

```
plugins/plan-skill/
  plugin.json
  AGENTS.md                    ← ガイドライン（このファイル）
  skills/
    plan-skill/
      SKILL.md                 ← プランニング手法のスキル定義
```

## 設計方針

- **計画のみ、実行しない**: プロジェクトの編集・実装は行わない。計画の保存にはホストの専用永続化ツールだけを使い、利用できなければ会話に提示して未保存と明示する
- **反復的**: Discovery → Alignment → Design → Refinement を必要に応じて繰り返す
- **ユーザー承認必須**: 計画の最終確認はユーザーが行う

## 変更時の注意

- SKILL.md を変更する場合は `plugin.json` の `version` をバンプする
- ワークフローの各フェーズ（Discovery / Alignment / Design / Refinement）の責務を混ぜない
