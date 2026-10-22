---
name: slide-cookbook
description: スライドの構成・図解・デザインの参考事例を Slideland (slideland.tech) から探す。スライドを作成・編集するとき、構成や図解のアイデア、レイアウト、配色、テイストの参考が欲しいときに使う。Use when creating or editing slides and you need layout, diagram, or design references.
---

# Slide Cookbook

[Slideland](https://www.slideland.tech/docs/category-list) は、実在する企業のスライドを「構成」「図解」「配色」などの切り口で分類した参考集です。スライドを作る前や編集中に、表現したい内容に合う参考スライドを探すために使います。

## サイトの構造

入口は [カテゴリ一覧](https://www.slideland.tech/docs/category-list) です。カテゴリは次の軸に分かれています。

| 軸 | パス | 何がわかるか |
|:--|:--|:--|
| ページ | `/docs/page/<slug>` | そのスライドで何を語るか（表紙、目次、課題、ロードマップ、料金表、組織図、IR など）の構成例 |
| グラフ | `/docs/graph/<slug>` | データの見せ方（円、棒、折れ線、ウォーターフォールなど） |
| 図解 | `/docs/schematic/<slug>` | 図形の配置（フロー、サイクル、マトリクス、ピラミッド、ツリー、ベン図、ガントチャートなど） |
| イラスト・写真 | `/docs/illustration/<slug>`、`/docs/photo/<slug>` | ビジュアル素材の使い方 |
| カラー・テイスト | `/docs/color/<slug>`、`/docs/taste/<slug>` | 配色と雰囲気 |
| 業種 | `/docs/category/<slug>` | 業界ごとの見せ方 |
| 資料の種類 | `/docs/material/<slug>` | 会社紹介、サービス紹介、決算説明、事業計画、登壇資料など |

各カテゴリページは 1 ページ約 56 枚のサムネイル（出典スライドへのリンク付き）を並べ、2 ページ目以降は `/docs/<軸>/<slug>/2` のように続きます。カテゴリの slug は一覧ページで確認します。推測でパスを作らないでください。

## 探し方のコツ

1. 作ろうとしているスライドで何を表現したいかを言語化し、複数の軸から該当カテゴリを複数選びます。1 つの軸だけで絞らないほうが、よい参考に出会えます。
   - 構成の軸: `page`（何を語るか）、`material`（資料の種類）
   - 図形・配置の軸: `schematic`、`graph`
   - 見た目の軸: `color`、`taste`、`illustration`、`photo`
   - 文脈の軸: 業種（`category`）
2. 図解は特に、似た内容でも複数の型を見比べるのがおすすめです。例えば「手順を示したい」なら、フロー（横型・縦型）、階段・ステップ、サイクル、ガントチャートを並べて見ます。
3. 各スライドをブラウザーで 1 枚ずつ開くのではなく、サムネイルを 1 枚のコンタクトシートにまとめて画像として読み取ると、効率よく多くの図を見渡せます（下記）。
4. 気になったスライドは、コンタクトシートの出力に含まれるタグ（`schematic/flow` や `color/navy` など）から別カテゴリへ辿れます。同じ事例が使っている配色、テイスト、ページ種別をそのまま次の探索に使えます。
5. 参考にした場合は、出典スライドの URL を控えます。デザインの意図や構造を学ぶために使い、レイアウトや文言の転用は避けます。

## コンタクトシートで一覧する

[scripts/contact_sheet.py](./scripts/contact_sheet.py) は、カテゴリページのサムネイル（640px 幅の WebP）を取得して番号付きの 1 枚の JPEG に結合し、各スライドの題名、出典 URL、タグを標準出力に出します。Python と `uv` が必要で、依存する Pillow は `uv` が自動で用意します。

```shell
uv run <skill-dir>/scripts/contact_sheet.py schematic/flow
uv run <skill-dir>/scripts/contact_sheet.py schematic/flow --page 2 --start 9 --count 9
uv run <skill-dir>/scripts/contact_sheet.py https://www.slideland.tech/docs/color/navy --cols 4 --count 12
```

- 既定は先頭から 9 枚（3 列）です。`--start`（ページ内の 0 始まりの位置）と `--count` で続きを見られます。
- 出力された JPEG のパスを `view` などで画像として読み取ります。画像内の番号が標準出力の `[番号]` に対応します。
- 細部を確認したいスライドは、`--start` と `--count 1`〜`2`、`--cols 1`、`--width 1280` で拡大して見直せます。
- 一時フォルダに出力されます。不要になったら削除してください。

> [!NOTE]
> スクリプトはカテゴリページの HTML 構造に依存します。サイトの構造が変わって取得できないときは、ブラウザーでカテゴリページを開き、サムネイルを直接確認してください。
