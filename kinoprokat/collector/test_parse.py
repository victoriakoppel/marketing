#!/usr/bin/env python3
"""
Проверка разбора карточки фильма Kino.kz.

Эталон взят с реальной страницы kino.kz/ru/movie/12034: числа в HTML ниже —
те же, что напечатаны на сайте, вместе с неразрывными пробелами внутри них.
Именно на них разбор однажды и споткнулся, поэтому тест их и сторожит.

  python collector/test_parse.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import collect  # noqa: E402
from bs4 import BeautifulSoup  # noqa: E402

PAGE = """<!doctype html><html><head><title>Человек-паук</title></head><body>
<header><a href="/ru">kino.kz</a> <button>Алматы</button></header>
<span class="age">14+</span>
<h1>Человек-паук: Новый день</h1>
<div class="genres"><a>боевик</a><a>приключения</a><a>фэнтези</a><a>фантастика</a></div>
<img src="https://kino.kz/posters/12034.jpg" alt="постер">
<nav><a>Билеты</a><a>О фильме</a><a>Рецензии (1&nbsp;284)</a></nav>
<div class="counter"><b>632&nbsp;836 билетов продано</b><small>+168 за последние 15 минут</small></div>
<div class="reactions">
  <span>&#128293; 6&nbsp;465</span><span>&#128525; 1&nbsp;577</span>
  <span>&#128521; 1&nbsp;205</span><span>&#129303; 561</span><span>&#128564; 387</span>
</div>
<p>Осталось 5 билетов на ближайший сеанс</p>
<table>
<tr><td>17:50</td><td>Kinopark 5 Atakent</td><td>2&nbsp;000 &#8376;</td><td>1&nbsp;200 &#8376;</td></tr>
<tr><td>19:10</td><td>Kinopark 6 (Спутник)</td><td>2&nbsp;200 &#8376;</td><td>1&nbsp;400 &#8376;</td></tr>
<tr><td>21:30</td><td>Chaplin MEGA</td><td>2&nbsp;500 &#8376;</td><td>1&nbsp;500 &#8376;</td></tr>
</table>
<footer><a href="/ru/movie/12034">Человек-паук</a><a href="/ru/movie/11987">Другой фильм</a></footer>
</body></html>"""

EXPECTED = {
    "title": "Человек-паук: Новый день",
    "total_sales": 632836,     # счётчик продаж, а не «осталось 5 билетов»
    "sales_basis": "kino_kz_counter",
    "reviews_count": 1284,     # неразрывный пробел внутри числа
    "sessions": 3,
    "price_from": 1200.0,      # самый дешёвый билет из всех категорий
}


def main() -> int:
    movie = collect.parse_kino_movie(PAGE, "https://kino.kz/ru/movie/12034")
    assert movie is not None, "карточка не разобралась совсем"

    failures = []
    for field, expected in EXPECTED.items():
        got = movie[field]
        mark = "✓" if got == expected else "✗"
        print(f"{mark} {field}: {got}")
        if got != expected:
            failures.append(f"{field}: получено {got!r}, ожидалось {expected!r}")

    reactions = {"🔥": 6465, "😍": 1577, "😉": 1205, "🤗": 561, "😴": 387}
    if movie["reactions"] == reactions:
        print(f"✓ reactions: {movie['reactions']}")
    else:
        failures.append(f"reactions: получено {movie['reactions']!r}")

    links = collect.movie_links(BeautifulSoup(PAGE, "html.parser"), "https://kino.kz")
    if len(links) == 2:
        print(f"✓ ссылки на карточки: {len(links)}")
    else:
        failures.append(f"ссылки: получено {links!r}")

    if failures:
        print("\nПРОВАЛ:")
        for line in failures:
            print("  •", line)
        return 1
    print("\nВсё сходится с эталоном.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
