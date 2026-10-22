# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow"]
# ///
"""Slideland のカテゴリページのスライド画像を 1 枚のコンタクトシートに結合する。

Usage:
    uv run contact_sheet.py schematic/flow
    uv run contact_sheet.py schematic/flow --page 2 --start 9 --count 9
    uv run contact_sheet.py https://www.slideland.tech/docs/color/navy --cols 4 --count 12
"""

from __future__ import annotations

import argparse
import html
import io
import re
import sys
import tempfile
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BASE = "https://www.slideland.tech"
UA = {"User-Agent": "Mozilla/5.0"}
CARD = re.compile(
    r'<div class="quicklink-image-wrapper"><a [^>]*href="(?P<src>[^"]+)"[^>]*>'
    r'<img src="(?P<img>[^"]+)"[^>]*alt="(?P<alt>[^"]*)".*?'
    r'(?P<tags><div class="quicklink-tags-container.*?)</div></div></div>',
    re.S,
)
TAG = re.compile(r'<a class="quicklink-tag" href="(?P<href>[^"]+)">#(?:<!-- -->)?(?P<name>[^<]+)</a>')


@dataclass(frozen=True)
class Slide:
    title: str
    source_url: str
    image_url: str
    tags: tuple[str, ...]


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as res:
        return res.read()


def page_url(target: str, page: int) -> str:
    path = re.sub(r"^https?://[^/]+", "", target).strip("/")
    path = re.sub(r"^docs/", "", path)
    if m := re.search(r"/(\d+)$", path):
        path = path[: m.start()]
        page = page if page > 1 else int(m[1])
    suffix = f"/{page}" if page > 1 else ""
    return f"{BASE}/docs/{path}{suffix}"


def parse_slides(page_html: str) -> list[Slide]:
    slides = []
    for m in CARD.finditer(page_html):
        tags = tuple(
            f"{html.unescape(t['name'])}={t['href'].removeprefix('/docs/')}"
            for t in TAG.finditer(m["tags"])
        )
        slides.append(
            Slide(
                title=html.unescape(m["alt"]),
                source_url=html.unescape(m["src"]),
                image_url=BASE + m["img"].replace(".webp", "-640w.webp"),
                tags=tags,
            )
        )
    return slides


def load_font(size: int) -> ImageFont.ImageFont:
    for name in ("meiryo.ttc", "YuGothM.ttc", "msgothic.ttc", "arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size)


def build_sheet(slides: list[Slide], first_no: int, cols: int, thumb_w: int) -> Image.Image:
    with ThreadPoolExecutor(max_workers=8) as pool:
        images = list(pool.map(lambda s: Image.open(io.BytesIO(fetch(s.image_url))).convert("RGB"), slides))
    thumb_h = round(thumb_w * 9 / 16)
    gap = 8
    rows = -(-len(images) // cols)
    sheet = Image.new("RGB", (cols * (thumb_w + gap) + gap, rows * (thumb_h + gap) + gap), "#444444")
    draw = ImageDraw.Draw(sheet)
    font = load_font(max(18, thumb_w // 16))
    for i, img in enumerate(images):
        x = gap + (i % cols) * (thumb_w + gap)
        y = gap + (i // cols) * (thumb_h + gap)
        sheet.paste(img.resize((thumb_w, thumb_h), Image.LANCZOS), (x, y))
        label = str(first_no + i)
        box = draw.textbbox((x + 6, y + 6), label, font=font)
        draw.rectangle((box[0] - 4, box[1] - 2, box[2] + 4, box[3] + 2), fill="#d00000")
        draw.text((x + 6, y + 6), label, fill="white", font=font)
    return sheet


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("target", help="カテゴリのパス (例: schematic/flow) またはカテゴリページの URL")
    ap.add_argument("--page", type=int, default=1, help="ページ番号 (既定: 1)")
    ap.add_argument("--start", type=int, default=0, help="ページ内の開始位置 (0 始まり、既定: 0)")
    ap.add_argument("--count", type=int, default=9, help="結合する枚数 (既定: 9)")
    ap.add_argument("--cols", type=int, default=3, help="列数 (既定: 3)")
    ap.add_argument("--width", type=int, default=640, help="サムネイル 1 枚の幅 px (既定: 640)")
    ap.add_argument("--out", type=Path, help="出力先 (既定: 一時フォルダの JPEG)")
    args = ap.parse_args()

    sys.stdout.reconfigure(encoding="utf-8")
    url = page_url(args.target, args.page)
    try:
        slides = parse_slides(fetch(url).decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"取得に失敗しました ({e.code}): {url} (ページ番号が範囲外の可能性があります)", file=sys.stderr)
        return 1
    if not slides:
        print(f"スライドが見つかりません: {url}", file=sys.stderr)
        return 1
    chosen = slides[args.start : args.start + args.count]
    if not chosen:
        print(f"範囲外です (このページは {len(slides)} 枚): start={args.start}", file=sys.stderr)
        return 1

    sheet = build_sheet(chosen, args.start + 1, args.cols, args.width)
    slug = re.sub(r"[^A-Za-z0-9]+", "_", args.target.strip("/"))
    out = args.out or Path(tempfile.gettempdir()) / f"slideland_{slug}_p{args.page}_{args.start + 1}.jpg"
    sheet.save(out, quality=85)

    print(f"page: {url} ({len(slides)} slides)")
    print(f"sheet: {out} ({sheet.width}x{sheet.height})")
    for no, s in enumerate(chosen, start=args.start + 1):
        print(f"[{no}] {s.title}\n    source: {s.source_url}\n    tags: {', '.join(s.tags)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
