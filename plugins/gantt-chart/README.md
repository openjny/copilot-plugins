# gantt-chart

ガントチャートを編集できる canvas (`openjny-gantt-chart`) を追加するプラグインです。チャートは 1 つの JSON ファイルに保存されます。ユーザーは画面で、エージェントは action で、同じファイルを編集します。

<img width="1670" height="1059" alt="image" src="https://github.com/user-attachments/assets/98ce66e0-462a-42d2-b4bc-ab1a236fdc89" />

## 開き方

エージェントに「`plan.gantt.json` でガントチャートを開いて」と頼むか、canvas を開いて画面でパスを入力します。存在しないパスを指定すると、新しいチャートを作ります。拡張子は `.json` にしてください。

## 画面でできること

| 操作 | 方法 |
|:--|:--|
| タスクの追加・削除・インデント・並べ替え | ツールバー、またはタスク一覧のキー操作（矢印、Enter、Delete） |
| 名前の変更 | タスク名をダブルクリック |
| 日付の移動・期間の変更 | バーをドラッグ（右端で期間を変更） |
| 進捗・工数・担当・色ラベル・先行タスク・メモ | 右の詳細パネル |
| 休日・プロジェクト名 | 詳細パネルの「プロジェクト」タブ |
| 日・週・月の切り替え | ヘッダーの「日 / 週 / 月」 |
| ライト・ダークの切り替え | ヘッダーの太陽・月・モニターのボタン（モニターは OS の設定に合わせます） |
| 保存済みの状態に戻す | 「バージョン」 |
| JSON の書き出し | 「JSON エクスポート」（バージョンは含みません） |

## 日程の決まり方

- 期間は稼働日で数えます。土曜、日曜、プロジェクトの休日は稼働日に含めません。`1w` は 5 稼働日です。
- 先行タスクがあるタスクは、先行タスクの終了の翌稼働日にラグ（稼働日）を足した日に始まります。バーを動かすと、開始日ではなくラグが変わります。
- 子タスクを持つタスク（親タスク）の日付、進捗、工数は、子タスクから自動で決まります。進捗は子タスクの期間で重み付けします。
- 先行タスクが循環する変更は受け付けません。

## ファイル形式

`format` と `version` で判定します。違うファイルや新しい version は、上書きせずに画面へエラーを出します。1 タスクが 1 行なので、直接編集もできます。外部での変更は約 1 秒で画面に反映されます。

```json
{
  "format": "openjny-gantt-chart",
  "version": 1,
  "project": {"name": "新製品", "holidays": ["2026-11-23"]},
  "tasks": [
    {"id":"t1","name":"設計","level":0,"start":"2026-11-16","duration":5,"progress":0},
    {"id":"t2","name":"要件定義","level":1,"start":"2026-11-16","duration":2,"progress":0},
    {"id":"t3","name":"基本設計","level":1,"start":"2026-11-18","duration":2,"progress":0,"predecessors":[{"task":"t2","lag":0}]}
  ],
  "snapshots": []
}
```

`level` が階層です。最初のタスクは 0、以降は直前のタスクの `level` + 1 以下にします。

## エージェント向け action

| action | 内容 |
|:--|:--|
| `open_chart` | ファイルを開く（なければ作成） |
| `get_chart` | 全タスクの計算済みの日付、進捗、ユーザーが選択中のタスクを読む |
| `edit_chart` | 編集をまとめて適用する（途中で失敗したら何も変えない） |
| `reload` | ファイルを読み直す |

`edit_chart` の `ops` は `add`、`update`、`delete`、`move`、`indent`、`outdent`、`shift`、`project`、`snapshot`、`restore`、`delete_snapshot` です。項目は action のスキーマに書いてあります。

## 保存先

チャートは指定した JSON ファイルです。最近開いたファイルの一覧を `<copilot-home>/extension-data/openjny-gantt-chart/recent.json` に、選んだテーマを同じ場所の `theme.json` に保存します。

## テスト

```powershell
cd plugins/gantt-chart/extensions/gantt-chart
node --test test/model.test.mjs test/chart.test.mjs
```
