#!/usr/bin/env python3
"""
Kino Pulse — сборщик открытых данных по кинопрокату.

Забирает афишу города с публичного сайта и складывает ежедневный снимок
в data/snapshots/YYYY-MM-DD.json, после чего пересобирает data/latest.json
и data/history.json, из которых читает дашборд.

Разбор страницы идёт от самого надёжного способа к самому хрупкому:

  1. JSON-LD (schema.org: ScreeningEvent / Movie / ItemList) — размечен
     самим сайтом, не зависит от вёрстки. Основной путь.
  2. Состояние SPA (__NEXT_DATA__, __NUXT__, __INITIAL_STATE__) — тоже
     структурированные данные, но ключи у каждого сайта свои.
  3. CSS-селекторы из SOURCES — последний рубеж, ломается при редизайне.

Запуск:
  python collect.py --probe                 # разведка: что вообще отдаёт страница
  python collect.py --source ticketon --city almaty
  python collect.py --rebuild               # пересобрать latest/history из снимков
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    sys.exit("Нужны зависимости: pip install -r collector/requirements.txt")

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SNAPSHOTS = DATA / "snapshots"

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
TIMEOUT = 30

# Города и источники. listing — страница афиши, с которой начинается обход.
# css — резервные селекторы; правятся руками после `--probe`, если сайт
# не отдаёт ни JSON-LD, ни состояния SPA.
SOURCES = {
    "kino": {
        "title": "Kino.kz",
        "base": "https://kino.kz",
        "listing": "https://kino.kz/{city}/movies",
        "css": {
            "card": ".movie-card, [class*='movieCard'], article[class*='movie']",
            "title": "h3, h2, [class*='title']",
            "rating": "[class*='rating'], [class*='score']",
            "reviews": "[class*='review'], [class*='comment']",
            "price": "[class*='price']",
            "link": "a[href]",
            "poster": "img[src], img[data-src]",
        },
    },
    "ticketon": {
        "title": "Ticketon",
        "base": "https://ticketon.kz",
        "listing": "https://ticketon.kz/{city}/cinema",
        "css": {
            "card": ".event-item, .movie-item, [class*='event']",
            "title": "h3, h2, .title, [class*='title']",
            "rating": "[class*='rating']",
            "reviews": "[class*='review']",
            "price": "[class*='price']",
            "link": "a[href]",
            "poster": "img[src], img[data-src]",
        },
    },
    "kinopark": {
        "title": "Kinopark",
        "base": "https://www.kinopark.kz",
        "listing": "https://www.kinopark.kz/ru/movies-today",
        "css": {
            "card": "[class*='movie']",
            "title": "h3, h2, [class*='title']",
            "rating": "[class*='rating']",
            "reviews": "[class*='review']",
            "price": "[class*='price']",
            "link": "a[href]",
            "poster": "img[src], img[data-src]",
        },
    },
}


# ─────────────────────────────  сеть  ─────────────────────────────

def fetch(url: str) -> str:
    r = requests.get(
        url,
        headers={"User-Agent": UA, "Accept-Language": "ru,kk;q=0.9,en;q=0.8"},
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    return r.text


# ───────────────────────  извлечение структуры  ───────────────────────

def walk(node):
    """Обойти произвольное дерево JSON, отдавая каждый словарь."""
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from walk(value)
    elif isinstance(node, list):
        for item in node:
            yield from walk(item)


def extract_jsonld(soup: BeautifulSoup) -> list[dict]:
    """Все объекты из <script type="application/ld+json">, развёрнутые в плоский список."""
    out = []
    for tag in soup.find_all("script", type="application/ld+json"):
        raw = tag.string or tag.get_text() or ""
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            # некоторые сайты кладут в один тег несколько объектов подряд
            try:
                parsed = json.loads("[" + re.sub(r"}\s*{", "},{", raw.strip()) + "]")
            except json.JSONDecodeError:
                continue
        out.extend(walk(parsed))
    return out


SPA_PATTERNS = [
    (r'<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)</script>', "__NEXT_DATA__"),
    (r"window\.__NUXT__\s*=\s*(\{.*?\});?\s*</script>", "__NUXT__"),
    (r"window\.__INITIAL_STATE__\s*=\s*(\{.*?\});?\s*</script>", "__INITIAL_STATE__"),
]


def extract_spa_state(html: str) -> tuple[str, dict] | tuple[None, None]:
    for pattern, name in SPA_PATTERNS:
        m = re.search(pattern, html, re.DOTALL)
        if not m:
            continue
        try:
            return name, json.loads(m.group(1))
        except json.JSONDecodeError:
            continue
    return None, None


# ──────────────────────────  нормализация  ──────────────────────────

def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "").strip().lower()
    text = re.sub(r"[^\w\s-]", "", text, flags=re.UNICODE)
    return re.sub(r"[\s_-]+", "-", text).strip("-") or "movie"


def to_number(value):
    """'8,4' → 8.4; 'от 1 800 ₸' → 1800; None → None."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    digits = re.sub(r"[^\d.,]", "", str(value)).replace(",", ".")
    if not digits or digits in {".", ","}:
        return None
    # цена вида '1.800' — точка как разделитель тысяч
    if digits.count(".") > 1:
        digits = digits.replace(".", "")
    try:
        return float(digits)
    except ValueError:
        return None


def blank_movie(title: str) -> dict:
    return {
        "id": slugify(title),
        "title": title.strip(),
        "rating": None,
        "rating_votes": None,
        "reviews_count": None,
        "sessions": 0,
        "price_from": None,
        "total_sales": None,
        "sales_basis": None,
        "seats_total": 0,
        "seats_taken": 0,
        "poster": None,
        "url": None,
        "genres": [],
        "reactions": {},
    }


def merge_rating(movie: dict, node: dict) -> None:
    agg = node.get("aggregateRating")
    if not isinstance(agg, dict):
        return
    movie["rating"] = movie["rating"] or to_number(agg.get("ratingValue"))
    votes = to_number(agg.get("ratingCount"))
    reviews = to_number(agg.get("reviewCount"))
    if votes:
        movie["rating_votes"] = int(votes)
    if reviews:
        movie["reviews_count"] = int(reviews)


def offer_price(node: dict):
    offers = node.get("offers")
    prices = []
    for offer in walk(offers) if offers else []:
        price = to_number(offer.get("price"))
        if price:
            prices.append(price)
    return min(prices) if prices else None


def from_jsonld(nodes: list[dict], base: str) -> list[dict]:
    """
    Собрать фильмы из schema.org-разметки.

    ScreeningEvent — это один сеанс: их количество и есть «сеансы сегодня»,
    а минимум по offers.price — «цена от». Movie даёт рейтинг и отзывы.
    """
    movies: dict[str, dict] = {}

    def bucket(title: str) -> dict:
        key = slugify(title)
        if key not in movies:
            movies[key] = blank_movie(title)
        return movies[key]

    for node in nodes:
        types = node.get("@type") or node.get("type")
        types = [types] if isinstance(types, str) else list(types or [])
        types = {str(t).lower() for t in types}

        if "screeningevent" in types:
            work = node.get("workPresented") or node.get("about") or {}
            title = (work.get("name") if isinstance(work, dict) else None) or node.get("name")
            if not title:
                continue
            movie = bucket(title)
            movie["sessions"] += 1
            price = offer_price(node)
            if price and (movie["price_from"] is None or price < movie["price_from"]):
                movie["price_from"] = price
            # если сайт публикует вместимость и остаток мест — считаем занятость
            total = to_number(node.get("maximumAttendeeCapacity"))
            free = to_number(node.get("remainingAttendeeCapacity"))
            if total and free is not None:
                movie["seats_total"] += int(total)
                movie["seats_taken"] += max(0, int(total) - int(free))
            if isinstance(work, dict):
                merge_rating(movie, work)

        elif "movie" in types:
            title = node.get("name")
            if not title:
                continue
            movie = bucket(title)
            merge_rating(movie, node)
            url = node.get("url")
            if isinstance(url, str):
                movie["url"] = url if url.startswith("http") else base.rstrip("/") + url
            image = node.get("image")
            if isinstance(image, str):
                movie["poster"] = image
            elif isinstance(image, dict):
                movie["poster"] = image.get("url")
            genre = node.get("genre")
            if isinstance(genre, str):
                movie["genres"] = [genre]
            elif isinstance(genre, list):
                movie["genres"] = [str(g) for g in genre][:3]
            price = offer_price(node)
            if price and (movie["price_from"] is None or price < movie["price_from"]):
                movie["price_from"] = price

    return list(movies.values())


def from_css(soup: BeautifulSoup, cfg: dict) -> list[dict]:
    """Резервный разбор по селекторам. Работает, пока сайт не переверстают."""
    css = cfg["css"]
    base = cfg["base"]
    movies = []
    for card in soup.select(css["card"]):
        title_el = card.select_one(css["title"])
        title = title_el.get_text(strip=True) if title_el else None
        if not title or len(title) < 2:
            continue
        movie = blank_movie(title)

        rating_el = card.select_one(css["rating"])
        if rating_el:
            movie["rating"] = to_number(rating_el.get_text(strip=True))

        reviews_el = card.select_one(css["reviews"])
        if reviews_el:
            count = to_number(reviews_el.get_text(strip=True))
            movie["reviews_count"] = int(count) if count else None

        price_el = card.select_one(css["price"])
        if price_el:
            movie["price_from"] = to_number(price_el.get_text(strip=True))

        link_el = card.select_one(css["link"])
        if link_el and link_el.get("href"):
            href = link_el["href"]
            movie["url"] = href if href.startswith("http") else base.rstrip("/") + "/" + href.lstrip("/")

        img = card.select_one(css["poster"])
        if img:
            movie["poster"] = img.get("src") or img.get("data-src")

        movies.append(movie)
    return movies


def finalize(movies: list[dict]) -> list[dict]:
    """
    Досчитать производные поля.

    total_sales заполняется ТОЛЬКО если источник отдал занятость зала.
    Продажи билетов нигде не публикуются как открытые данные, поэтому
    единственная честная опора — число занятых мест в схемах сеансов.
    Нет данных о местах — остаётся null, и дашборд честно покажет прочерк.
    """
    for movie in movies:
        if movie["seats_taken"] > 0:
            movie["total_sales"] = movie["seats_taken"]
            movie["sales_basis"] = "seats_taken"
        movie.pop("seats_total", None)
        movie.pop("seats_taken", None)
        if movie["rating"] is not None:
            movie["rating"] = round(movie["rating"], 1)
    movies.sort(key=lambda m: (m["total_sales"] or 0, m["sessions"]), reverse=True)
    return movies


# ──────────────────────────  сбор снимка  ──────────────────────────

def collect(source_key: str, city: str) -> dict:
    cfg = SOURCES[source_key]
    url = cfg["listing"].format(city=city)
    print(f"→ {url}")
    html = fetch(url)
    soup = BeautifulSoup(html, "html.parser")

    strategy = "json-ld"
    movies = finalize(from_jsonld(extract_jsonld(soup), cfg["base"]))

    if not movies:
        name, state = extract_spa_state(html)
        if state:
            print(f"  JSON-LD пуст, найдено состояние SPA: {name}")
            print("  Ключи верхнего уровня:", list(state)[:20])
            print("  Разбор состояния зависит от сайта — опишите маппинг в from_spa().")
        strategy = "css"
        movies = finalize(from_css(soup, cfg))

    if not movies:
        raise SystemExit(
            "Не удалось извлечь ни одного фильма. Запустите `--probe` и поправьте\n"
            f"селекторы в SOURCES['{source_key}']['css'] под текущую вёрстку."
        )

    print(f"  Стратегия: {strategy}; фильмов: {len(movies)}")
    now = dt.datetime.now(dt.timezone(dt.timedelta(hours=6)))  # Алматы, UTC+6
    return {
        "date": now.date().isoformat(),
        "collected_at": now.isoformat(timespec="seconds"),
        "city": city,
        "source": cfg["title"],
        "source_url": url,
        "strategy": strategy,
        "is_demo": False,
        "movies": movies,
    }


def probe(source_key: str, city: str) -> None:
    """Разведка: показать, что страница вообще отдаёт, не сохраняя ничего."""
    cfg = SOURCES[source_key]
    url = cfg["listing"].format(city=city)
    print(f"Источник: {cfg['title']}\nURL: {url}\n")
    html = fetch(url)
    print(f"Размер HTML: {len(html):,} байт")
    soup = BeautifulSoup(html, "html.parser")

    nodes = extract_jsonld(soup)
    kinds = defaultdict(int)
    for node in nodes:
        t = node.get("@type") or node.get("type")
        for name in ([t] if isinstance(t, str) else list(t or [])):
            kinds[str(name)] += 1
    print(f"\nJSON-LD объектов: {len(nodes)}")
    for name, count in sorted(kinds.items(), key=lambda kv: -kv[1]):
        print(f"  {name}: {count}")

    name, state = extract_spa_state(html)
    print(f"\nСостояние SPA: {name or 'не найдено'}")
    if state:
        print("  Ключи верхнего уровня:", list(state)[:20])

    found = soup.select(cfg["css"]["card"])
    print(f"\nCSS-селектор карточки '{cfg['css']['card']}' → {len(found)} совпадений")
    for card in found[:3]:
        title_el = card.select_one(cfg["css"]["title"])
        print("  •", title_el.get_text(strip=True)[:70] if title_el else "(без заголовка)")

    movies = finalize(from_jsonld(nodes, cfg["base"])) or finalize(from_css(soup, cfg))
    print(f"\nИтог разбора: {len(movies)} фильмов")
    for movie in movies[:5]:
        print("  ", json.dumps(movie, ensure_ascii=False)[:160])


# ────────────────────────  запись и история  ────────────────────────

def totals(movies: list[dict]) -> dict:
    rated = [m["rating"] for m in movies if m.get("rating")]
    sales = [m["total_sales"] for m in movies if m.get("total_sales")]
    return {
        "movies": len(movies),
        "total_sales": int(sum(sales)) if sales else None,
        "avg_rating": round(sum(rated) / len(rated), 2) if rated else None,
        "reviews": int(sum(m.get("reviews_count") or 0 for m in movies)),
        "sessions": int(sum(m.get("sessions") or 0 for m in movies)),
    }


def save_snapshot(snapshot: dict) -> Path:
    SNAPSHOTS.mkdir(parents=True, exist_ok=True)
    path = SNAPSHOTS / f"{snapshot['date']}.json"
    path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  Снимок сохранён: {path.relative_to(ROOT)}")
    return path


def rebuild() -> None:
    """Пересобрать latest.json и history.json из архива снимков."""
    files = sorted(SNAPSHOTS.glob("*.json"))
    if not files:
        raise SystemExit("Нет ни одного снимка в data/snapshots/")

    days = []
    for path in files:
        snap = json.loads(path.read_text(encoding="utf-8"))
        days.append({
            "date": snap["date"],
            "is_demo": snap.get("is_demo", False),
            "totals": totals(snap["movies"]),
            "movies": [
                {
                    "id": m["id"],
                    "title": m["title"],
                    "total_sales": m.get("total_sales"),
                    "rating": m.get("rating"),
                    "reviews_count": m.get("reviews_count"),
                    "sessions": m.get("sessions"),
                }
                for m in snap["movies"]
            ],
        })

    latest = json.loads(files[-1].read_text(encoding="utf-8"))
    latest["totals"] = totals(latest["movies"])

    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / "latest.json").write_text(
        json.dumps(latest, ensure_ascii=False, indent=2), encoding="utf-8")
    (DATA / "history.json").write_text(
        json.dumps({"days": days}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  Пересобрано: {len(days)} дней, последний срез {latest['date']}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Сборщик открытых данных Kino Pulse")
    parser.add_argument("--source", default="ticketon", choices=sorted(SOURCES))
    parser.add_argument("--city", default="almaty")
    parser.add_argument("--probe", action="store_true", help="разведка источника без записи")
    parser.add_argument("--rebuild", action="store_true", help="пересобрать latest/history")
    args = parser.parse_args()

    if args.rebuild:
        rebuild()
        return

    try:
        if args.probe:
            probe(args.source, args.city)
            return
        snapshot = collect(args.source, args.city)
    except requests.exceptions.RequestException as error:
        raise SystemExit(
            f"Не удалось получить страницу источника: {error.__class__.__name__}.\n"
            "Проверьте доступ в интернет — в закрытых окружениях исходящий HTTPS\n"
            "может блокироваться политикой сети, и сбор нужно запускать снаружи\n"
            "(локально или в GitHub Actions)."
        ) from error

    save_snapshot(snapshot)
    rebuild()


if __name__ == "__main__":
    main()
