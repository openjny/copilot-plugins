# gantt-chart 開発メモ

このプラグインを直すときに、先に知っておくと手戻りが減ることをまとめます。ユーザー向けの説明は [README.md](./README.md) にあります。

## 構成

| 場所 | 役割 |
|:--|:--|
| `extensions/gantt-chart/lib/model.mjs` | 日付、日程の計算、編集操作（`applyOps`）、入力の検証。ブラウザーでも読み込む純粋なモジュール |
| `extensions/gantt-chart/lib/format.mjs`、`schema/` | ファイル形式 v2（スキーマが定義）。メモリ上は平らなリスト、ファイルでは木 |
| `extensions/gantt-chart/lib/chart.mjs`、`server.mjs`、`store.mjs` | 履歴（元に戻す）、ファイルとの同期、HTTP、画面の設定の保存 |
| `extensions/gantt-chart/assets/` | 画面（`app.js`、`style.css`、`index.html`）。リクエストのたびにディスクから読みます |
| `extensions/gantt-chart/lib/locales/` | ja と en のメッセージ |

## 確かめ方

- 単体テスト（`extensions/gantt-chart` で）: `node --test test\model.test.mjs test\chart.test.mjs test\i18n.test.mjs test\validate.test.mjs`。`node --test` にディレクトリは渡せないので、ファイルを並べます。
- 手元で試すときは、インストール済みのコピー（`~/.copilot/installed-plugins/openjny/gantt-chart/extensions/gantt-chart`）に、`node_modules` と `test` を除いて上書きします（`robocopy` の終了コード 1 は成功です）。
- `assets/` と `lib/locales/` は読み直されるので、リロードは要りません。`lib/*.mjs` と `extension.mjs` を変えたら `extensions_reload` を、上書きとは別の呼び出しで行い、新しい instanceId でキャンバスを開き直します。
- 画面は Playwright（playwright-core と Edge）で確かめています。再現スクリプトはまだリポジトリに入っていません。`test/ui/` に、ダミーの計画ファイルと一緒に置くのが次の課題です。

## 守ること

- 日程は「置かれた日（`start`）と、先行タスクが許す最初の日の、遅いほう」です。先行タスクは押すだけで、引っ張りません。`finalize` が計算結果を `start` に書き戻すので、短くしたり、つながりを消したりしても、タスクは動きません。この前提を変えるときは、`model.test.mjs` の「predecessors only push」のテストから直します。
- 稼働日は、平日（`holidays` に入っていない日）と、`workdays` に入れた土日です。日付を決める関数はすべて `makeCalendar` の `isWorkday` を通します。週の始まり（`weekStart`）は表示だけで、休みの決め方には関わりません。
- ファイル形式は version 3 です（想定工数は `estimate`、実績工数は `actual`）。version 2 は `readDoc` が読み込み時に直します（`effort` を `estimate` に改名するだけ）。形式を変えるときは、読み込み側で古い version を直すか、`unsupported_version` にするかを決めて、テストに書きます。
- 日程が動く操作（つなぐ、期間を変える、右へ動かす）には、画面で事前の表示と「元に戻す」を付けます。`applyOps` が返す `shifted` と `dropped` を使い、画面は同じ関数で事前に計算します（`previewOps`）。
- ja と en のキーは同じにします（`i18n.test.mjs` が確かめます）。数で文が変わるときは `key.one` と `key.other` を使いますが、ja は `other` しか選ばれません。名前を入れたい文は、1 件用と複数用（`key` と `keyMany`）に分けます。
- ソースは `edit` ツールで直します。PowerShell の文字列置換は、バッククォートや `$` で壊れやすく、失敗しても何も書き込まれないことがあります。

## 画面で引っかかりやすいところ

- バーを押したときに `preventDefault` とポインターのキャプチャをするため、`dblclick` が届きません。ダブルクリックは `isDoubleClick` で数えます。
- `replaceChildren` で要素を差し替えると、フォーカス中の入力欄に `blur` が飛びます。入力中の状態は、再描画をまたいで持ち越します（`app.tagDraft`、`app.titleRedraw`）。
- 依存関係の線の当たり判定（太さの約 10 倍）は、バーの左端に重なります。バーの端をクリックすると線が選ばれるので、テストでは端から離れた所を押します。
- 選んだタスクに属するもの（行の背景、パネル、三角、チャート上の名前）の色は、クラス `tc-<色>` が決める `--tc` を使います。バーそのものは `c-<色>`（`--fill`、`--sum`）です。この 2 つは別の系統なので、色を増やすときは両方に足します（`PALETTE` と、CSS の `c-*` と `tc-*`）。
- ソースの一括置換を PowerShell で行うときは、置換する文字列の前後に空白などを入れず、一意に決まる長さにします（` today` のような短い語を置換すると、関係のない所まで書き換わります）。
