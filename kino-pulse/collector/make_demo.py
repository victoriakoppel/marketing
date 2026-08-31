#!/usr/bin/env python3
"""
Генератор демонстрационных снимков для Kino Pulse.

Нужен ровно для одного: показать, как выглядит дашборд с накопленной
историей, пока настоящий сбор ещё не запускался. Цифры синтетические
и порождаются от фиксированного зерна — каждый снимок помечен
"is_demo": true, и интерфейс показывает предупреждение.

  python collector/make_demo.py --days 14
  rm -rf data/snapshots/* && python collector/collect.py --source ticketon
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import random
from pathlib import Path

import collect  # соседний модуль: переиспользуем slugify/totals/rebuild

ROOT = Path(__file__).resolve().parent.parent

# Прокатные названия — только чтобы витрина выглядела правдоподобно.
CATALOG = [
    ("Дюна: Часть третья", 8.6, 2400, ["фантастика", "драма"]),
    ("Аватар: Огонь и пепел", 8.1, 3100, ["фантастика", "приключения"]),
    ("Кайрат", 7.9, 1600, ["драма"]),
    ("Зомбилэнд 3", 6.8, 900, ["комедия", "ужасы"]),
    ("Головоломка 3", 8.4, 2050, ["мультфильм", "семейный"]),
    ("Тайна дракона", 7.2, 1200, ["мультфильм"]),
    ("Астана: Ночной рейс", 7.5, 780, ["триллер"]),
    ("Формула мести", 6.4, 640, ["боевик"]),
    ("Свадьба по-казахски", 7.8, 1450, ["комедия"]),
    ("Последний рубеж", 6.9, 520, ["боевик", "драма"]),
    ("Ледяное сердце", 7.1, 410, ["мелодрама"]),
    ("Операция «Алатау»", 7.6, 960, ["боевик"]),
]

REACTIONS = ["🔥", "😍", "😂", "😢", "😱"]


def build_day(rng: random.Random, date: dt.date, day_index: int, total_days: int) -> dict:
    movies = []
    for position, (title, base_rating, base_reviews, genres) in enumerate(CATALOG):
        # Чем свежее фильм в списке, тем выше спрос; к концу проката — спад.
        decay = 1.0 - (position / (len(CATALOG) * 1.6))
        wave = 1.0 + 0.35 * ((day_index % 7) in (4, 5, 6))  # выходные
        drift = 1.0 + 0.04 * day_index * (1 if position < 4 else -0.5)
        sessions = max(3, int(rng.gauss(26 * decay, 3)))
        sales = max(40, int(sessions * rng.gauss(38, 7) * wave * max(0.2, drift)))
        reviews = int(base_reviews * (0.6 + 0.4 * day_index / max(1, total_days))
                      + rng.randint(0, 40))
        rating = round(min(9.6, max(5.0, rng.gauss(base_rating, 0.08))), 1)

        movies.append({
            "id": collect.slugify(title),
            "title": title,
            "rating": rating,
            "rating_votes": reviews * rng.randint(3, 6),
            "reviews_count": reviews,
            "sessions": sessions,
            "price_from": rng.choice([1400, 1600, 1800, 2000, 2200, 2500]),
            "total_sales": sales,
            "sales_basis": "demo",
            "poster": None,
            "url": None,
            "genres": genres,
            "reactions": {emoji: rng.randint(5, 240) for emoji in REACTIONS},
        })

    movies.sort(key=lambda m: m["total_sales"], reverse=True)
    stamp = dt.datetime.combine(date, dt.time(6, 0), dt.timezone(dt.timedelta(hours=6)))
    return {
        "date": date.isoformat(),
        "collected_at": stamp.isoformat(timespec="seconds"),
        "city": "almaty",
        "source": "демо-данные",
        "source_url": None,
        "strategy": "demo",
        "is_demo": True,
        "movies": movies,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Сгенерировать демо-историю")
    parser.add_argument("--days", type=int, default=14)
    parser.add_argument("--seed", type=int, default=20260831)
    args = parser.parse_args()

    rng = random.Random(args.seed)
    collect.SNAPSHOTS.mkdir(parents=True, exist_ok=True)
    today = dt.date.today()

    for index in range(args.days):
        date = today - dt.timedelta(days=args.days - 1 - index)
        snapshot = build_day(rng, date, index, args.days)
        path = collect.SNAPSHOTS / f"{date.isoformat()}.json"
        path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Создано демо-снимков: {args.days}")
    collect.rebuild()


if __name__ == "__main__":
    main()
