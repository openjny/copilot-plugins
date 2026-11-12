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
- 画面は Playwright（playwright-core と Edge）で確かめています。再現スクリプトはまだリポジトリに入っていません。`test/ui/` に、ダミーの計画ファイルと一緒に置くのが次の課題です。スクリプトは、サーバー側に残る設定（言語 `locale.json`、画面の `view.json`。`view.json` には一覧の列 `cols` も入り、既定はタスク名だけです）を、始めと終わりに初期値へ戻します。戻さないと、次のスクリプトが前の言語や前の列で動いて、順番によって失敗します。

## 守ること

- 日程は「置かれた日（`start`）と、先行タスクが許す最初の日の、遅いほう」です。先行タスクは押すだけで、引っ張りません。`finalize` が計算結果を `start` に書き戻すので、短くしたり、つながりを消したりしても、タスクは動きません。この前提を変えるときは、`model.test.mjs` の「predecessors only push」のテストから直します。
- 稼働日は、毎週の休み（`weeklyOff`。既定は土曜と日曜）の曜日と、`holidays` に入っている日を除いた日と、`extraWorkdays` に入れた日です（両方に入っている日は働く日です）。日付を決める関数はすべて `makeCalendar` の `isWorkday` を通します。週の始まり（`weekStart`）は表示だけで、休みの決め方には関わりません。画面の右クリックでの切り替え（`toggleWorkday`）は、曜日の決まりと違うときだけ、その日をどちらかのリストに入れます（`cal.isRegular` が、曜日だけで決まる状態です）。
- ファイル形式は version 4 です。タスクの値は `props`（プロパティの名前をキーにした連想配列）に入り、プロジェクトが `properties` で定義を持ちます。工数のような項目は、組み込みではなくプロパティです（担当 `resources` だけは、組み込みのまま残しています）。version 2 と version 3 は `readDoc` が読み込み時に直します（`effort` → `estimate` → 数値のプロパティ「想定工数」と「実績工数」。使われていたものだけを作ります）。形式を変えるときは、読み込み側で古い version を直すか、`unsupported_version` にするかを決めて、テストに書きます。
- プロパティの値の検査は `checkValue`（ひとつの値）と `checkProps`（タスク全体）にあり、`finalize`（編集のあと）と `readDoc`（読み込み）の両方が通ります。JSON Schema は値の中身を定義しません（名前が動的なため）。親タスクが合計などを出すプロパティ（`aggregate`）の値は、`finalize` が親から消し、`schedule` が `row.props` に子から計算して入れます。画面は、値を読むときは `row.props`、編集するときは `task.props` を使います。
- 一覧の列のキーは、`name`、`dur`、`res`、プロパティの `p:<名前>` です。名前に引用符やカンマが入りうるので、CSS セレクターや HTML の属性に直接入れず（`data-cols` は JSON を URL エンコードしています）、要素は `dataset.key` で探します。プロパティの名前を変える・消すときは、`renameCol` が列を追従させます（`view.json` は画面全体で 1 つなので、別のファイルの同名のプロパティにも効きます）。
- 日程が動く操作（つなぐ、期間を変える、右へ動かす）には、画面で事前の表示と「元に戻す」を付けます。`applyOps` が返す `shifted` と `dropped` を使い、画面は同じ関数で事前に計算します（`previewOps`）。
- ja と en のキーは同じにします（`i18n.test.mjs` が確かめます）。数で文が変わるときは `key.one` と `key.other` を使いますが、ja は `other` しか選ばれません。名前を入れたい文は、1 件用と複数用（`key` と `keyMany`）に分けます。
- ソースは `edit` ツールで直します。PowerShell の文字列置換は、バッククォートや `$` で壊れやすく、失敗しても何も書き込まれないことがあります。

## 画面で引っかかりやすいところ

- バーを押したときに `preventDefault` とポインターのキャプチャをするため、`dblclick` が届きません。ダブルクリックは `isDoubleClick` で数えます。
- `replaceChildren` で要素を差し替えると、フォーカス中の入力欄に `blur` が飛びます。入力中の状態は、再描画をまたいで持ち越します（`app.tagDraft`、`app.titleRedraw`）。
- 依存関係の線の当たり判定（太さの約 10 倍）は、バーの左端に重なります。バーの端をクリックすると線が選ばれるので、テストでは端から離れた所を押します。
- 選んだタスクに属するもの（行の背景、パネル、三角、チャート上の名前）の色は、クラス `tc-<色>` が決める `--tc` を使います。バーそのものは `c-<色>`（`--fill`、`--sum`）です。この 2 つは別の系統なので、色を増やすときは両方に足します（`PALETTE` と、CSS の `c-*` と `tc-*`）。
- ソースの一括置換を PowerShell で行うときは、置換する文字列の前後に空白などを入れず、一意に決まる長さにします（` today` のような短い語を置換すると、関係のない所まで書き換わります）。置換する文字列にバッククォートや `${` が入るとき（Markdown の `コード` など）は、二重引用符の文字列を使うと構文エラーになり、何も書き込まれません。edit ツールか、単一引用符のヒアドキュメント（`@'...'@`）を使い、書き込んだあとは `Select-String` で確かめます（表示用のツールは、書き換え直後に古い内容を返すことがあります）。
- 組み込みの項目を消す（プロパティにするなど）ときは、画面確認のスクリプトも `data-field` や、タスクの生のキーを探して直します。プロパティの欄は、名前ではなく並び順の `prop-<番号>` を `data-field` にしています（名前に引用符が入りうるため）。
- 親タスクのバー（`.sbar`）の箱は、三角形を含む全体の大きさです。形は `::before` の `clip-path` で切り抜くので、箱の外形（選択の枠、遅れの縁取り）は長方形になります。太さと三角形の大きさは `summarySize()` が決め、CSS 変数 `--sbar-h`、`--sbar-ov`、`--sbar-w` で渡します。
- 右ボタンのドラッグによる移動は、スクロール量を「前回の位置との差」で足します。範囲が左へ伸びると `renderChart` が `scrollLeft` を自分で補正するので、開始時の値からの絶対位置で計算するとずれます。右ボタンを離したあとに出る `contextmenu` は、動かしたときだけ捕捉して止めます（Windows ではボタンを離すと出ます）。
- ヘッダーのセルのマーク（`app.bandCell`、`app.menuCell`、チャート上の帯 `hband`）は、ヘッダーを描き直すとセルが別の要素になるので、`renderBody` が毎回外します。メニューを開いている間だけ、押したセルの `.target` と帯を保ちます（`hideMenu` が外します）。ヘッダーのセルの `data-from`、`data-to` は、そのセルが表す日の範囲で、年・月のセルは範囲の端で切れていても丸ごとの範囲です。
