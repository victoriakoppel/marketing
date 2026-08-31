/* Текущий кинопрокат — логика дашборда. Ванильный JS, без зависимостей.
   Данные приходят из data/latest.json (текущий срез) и data/history.json
   (все накопленные дневные снимки). Оба файла пишет collector/collect.py. */

'use strict';

const DATA_LATEST = 'data/latest.json';
const DATA_HISTORY = 'data/history.json';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  latest: null,
  history: { days: [] },
  query: '',
  sort: 'sales',
  metric: 'total_sales',
  movieId: null,
  hasSales: false,
};

/* ─────────────────────────  форматирование  ───────────────────────── */

const nf = new Intl.NumberFormat('ru-RU');
const DASH = '—';

const num = (value) => (value === null || value === undefined ? DASH : nf.format(Math.round(value)));

const dec = (value, digits = 1) =>
  value === null || value === undefined ? DASH : value.toFixed(digits).replace('.', ',');

const signed = (value) => (value > 0 ? `+${num(value)}` : num(value));

const money = (value) => (value ? `${nf.format(Math.round(value))} ₸` : DASH);

function shortDate(iso) {
  const [, month, day] = iso.split('-');
  return `${day}.${month}`;
}

function longDate(iso) {
  const date = new Date(`${iso}T00:00:00`);
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3200);
}

/* ───────────────────────────  загрузка  ─────────────────────────── */

async function loadJSON(path) {
  const response = await fetch(`${path}?v=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

async function boot() {
  try {
    const [latest, history] = await Promise.all([
      loadJSON(DATA_LATEST),
      loadJSON(DATA_HISTORY).catch(() => ({ days: [] })),
    ]);
    state.latest = latest;
    state.history = history && Array.isArray(history.days) ? history : { days: [] };
    state.hasSales = (latest.movies || []).some((m) => m.total_sales !== null && m.total_sales !== undefined);
    if (!state.hasSales) {
      // источник не отдаёт продажи — переводим витрину на сеансы,
      // иначе сортировка молча расходилась бы с подписью в контроле
      state.sort = 'sessions';
      const sortEl = $('#sort');
      sortEl.querySelector('option[value="sales"]').disabled = true;
      sortEl.value = 'sessions';
      $('#salesTitle').textContent = 'Сеансы по фильмам';
      $('#salesEyebrow').textContent = 'ЛИДЕРЫ ПО СЕАНСАМ';
      $('#marketTitle').textContent = 'Сеансы по дням';
      $('#marketUnit').textContent = 'сеансы';
      const salesMetric = $('.metric-switch button[data-metric="total_sales"]');
      salesMetric.disabled = true;
      salesMetric.classList.remove('active');
      const reviewsMetric = $('.metric-switch button[data-metric="reviews_count"]');
      reviewsMetric.classList.add('active');
      state.metric = 'reviews_count';
    }

    renderHeader();
    renderOverview();
    renderTrends();
  } catch (error) {
    console.error(error);
    $('#lastUpdate').textContent = 'Данные не загружены';
    $('.live').classList.add('stale');
    $('#liveLabel').textContent = 'Нет данных';
    toast('Не удалось загрузить данные. Запустите сборщик.');
  }
}

/* ───────────────────────────  шапка  ─────────────────────────── */

function renderHeader() {
  const { latest } = state;
  const stamp = new Date(latest.collected_at);
  const when = Number.isNaN(stamp.getTime())
    ? longDate(latest.date)
    : stamp.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  $('#lastUpdate').textContent = `Срез от ${when}`;

  const ageDays = Math.floor((Date.now() - new Date(`${latest.date}T00:00:00`)) / 86400000);
  if (ageDays > 1) {
    $('.live').classList.add('stale');
    $('#liveLabel').textContent = `Данные за ${longDate(latest.date)}`;
  }

  if (latest.is_demo) $('#demoBanner').hidden = false;

  const city = (latest.city || '').toUpperCase();
  $('#heroEyebrow').textContent = `${city || 'ГОРОД'} · ЕЖЕДНЕВНАЯ АНАЛИТИКА · ${(latest.source || '').toUpperCase()}`;
  $('#ratingNote').textContent = `по оценкам «${latest.source || 'источник'}»`;
}

/* ───────────────────────  текущий срез  ─────────────────────── */

function sumBy(list, key) {
  return list.reduce((acc, item) => acc + (item[key] || 0), 0);
}

function renderOverview() {
  const movies = state.latest.movies || [];
  const totals = state.latest.totals || {};

  $('#heroMovies').textContent = movies.length;
  $('#totalSales').textContent = state.hasSales ? num(totals.total_sales ?? sumBy(movies, 'total_sales')) : DASH;
  $('#avgRating').textContent = dec(totals.avg_rating ?? null);
  $('#totalReviews').textContent = num(totals.reviews ?? sumBy(movies, 'reviews_count'));
  $('#totalSessions').textContent = num(totals.sessions ?? sumBy(movies, 'sessions'));

  renderSalesDelta();
  renderSalesChart(movies);
  renderPulse(movies);
  renderCatalog();
}

/* Дельта продаж к предыдущему снимку — только по фильмам, которые есть
   в обоих срезах, иначе новинка в афише выглядела бы ростом рынка. */
function renderSalesDelta() {
  const el = $('#salesDelta');
  const days = state.history.days;
  if (!state.hasSales) {
    el.textContent = 'Источник не публикует продажи';
    return;
  }
  if (days.length < 2) {
    el.textContent = 'Первый базовый снимок';
    return;
  }
  const previous = days[days.length - 2];
  const current = days[days.length - 1];
  const before = new Map(previous.movies.map((m) => [m.id, m]));
  let delta = 0;
  let matched = 0;
  current.movies.forEach((movie) => {
    const past = before.get(movie.id);
    if (past && past.total_sales != null && movie.total_sales != null) {
      delta += movie.total_sales - past.total_sales;
      matched += 1;
    }
  });
  if (!matched) {
    el.textContent = 'Нет пересечения с прошлым срезом';
    return;
  }
  el.textContent = `${signed(delta)} к ${shortDate(previous.date)} · ${matched} фильмов`;
  el.className = delta >= 0 ? 'up' : 'down';
}

function renderSalesChart(movies) {
  const key = state.hasSales ? 'total_sales' : 'sessions';
  $('#salesUnit').textContent = state.hasSales ? 'всего билетов' : 'сеансов';
  const top = [...movies]
    .filter((m) => m[key])
    .sort((a, b) => b[key] - a[key])
    .slice(0, 7);

  const host = $('#salesChart');
  if (!top.length) {
    host.innerHTML = '<p class="muted">Нет данных для графика.</p>';
    return;
  }
  const max = top[0][key];
  host.innerHTML = top
    .map(
      (movie) => `
      <div class="bar-row">
        <div class="bar-label" title="${escapeHTML(movie.title)}">${escapeHTML(movie.title)}</div>
        <div class="bar-value">${num(movie[key])}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${(movie[key] / max) * 100}%"></div></div>
      </div>`
    )
    .join('');
}

function renderPulse(movies) {
  const totals = {};
  movies.forEach((movie) => {
    Object.entries(movie.reactions || {}).forEach(([emoji, count]) => {
      totals[emoji] = (totals[emoji] || 0) + count;
    });
  });
  const rows = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const host = $('#reactionPulse');
  if (!rows.length) {
    host.innerHTML = '<p class="muted">Источник не отдаёт emoji-реакции.</p>';
    return;
  }
  const max = rows[0][1];
  host.innerHTML = rows
    .map(
      ([emoji, count]) => `
      <div class="reaction-row">
        <div class="emoji">${emoji}</div>
        <div class="track"><i style="width:${(count / max) * 100}%"></i></div>
        <div class="count">${num(count)}</div>
      </div>`
    )
    .join('');
}

/* ───────────────────────────  каталог  ─────────────────────────── */

const SORTERS = {
  sales: (a, b) => (b.total_sales || 0) - (a.total_sales || 0),
  rating: (a, b) => (b.rating || 0) - (a.rating || 0),
  reviews: (a, b) => (b.reviews_count || 0) - (a.reviews_count || 0),
  sessions: (a, b) => (b.sessions || 0) - (a.sessions || 0),
};

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])
  );
}

function ratingClass(rating) {
  if (rating === null || rating === undefined) return 'none';
  if (rating >= 7.5) return '';
  if (rating >= 6) return 'mid';
  return 'low';
}

function topReaction(movie) {
  const entries = Object.entries(movie.reactions || {});
  if (!entries.length) return DASH;
  const [emoji, count] = entries.sort((a, b) => b[1] - a[1])[0];
  return `${emoji} ${num(count)}`;
}

function visibleMovies() {
  const query = state.query.trim().toLowerCase();
  return (state.latest.movies || [])
    .filter((movie) => !query || movie.title.toLowerCase().includes(query))
    .sort(SORTERS[state.sort] || SORTERS.sales);
}

function renderCatalog() {
  const movies = visibleMovies();
  const rows = $('#movieRows');
  const cards = $('#movieCards');

  if (!movies.length) {
    rows.innerHTML = '<tr class="empty-row"><td colspan="8">Ничего не найдено.</td></tr>';
    cards.innerHTML = '<p class="muted">Ничего не найдено.</p>';
    return;
  }

  rows.innerHTML = movies
    .map(
      (movie, index) => `
      <tr data-id="${escapeHTML(movie.id)}">
        <td class="rank">${index + 1}</td>
        <td class="name">${escapeHTML(movie.title)}</td>
        <td class="num">${num(movie.total_sales)}</td>
        <td><span class="rating-pill ${ratingClass(movie.rating)}">${dec(movie.rating)}</span></td>
        <td>${topReaction(movie)}</td>
        <td class="num">${num(movie.reviews_count)}</td>
        <td class="num">${money(movie.price_from)}</td>
        <td class="num">${num(movie.sessions)}</td>
      </tr>`
    )
    .join('');

  cards.innerHTML = movies
    .map(
      (movie) => `
      <article class="movie-card" data-id="${escapeHTML(movie.id)}">
        <div class="head">
          <b>${escapeHTML(movie.title)}</b>
          <span class="rating-pill ${ratingClass(movie.rating)}">${dec(movie.rating)}</span>
        </div>
        <div class="facts">
          <div>Продажи<b>${num(movie.total_sales)}</b></div>
          <div>Отзывы<b>${num(movie.reviews_count)}</b></div>
          <div>Сеансы<b>${num(movie.sessions)}</b></div>
        </div>
      </article>`
    )
    .join('');
}

/* ─────────────────────────  карточка фильма  ───────────────────────── */

function openDetail(id) {
  const movie = (state.latest.movies || []).find((m) => m.id === id);
  if (!movie) return;
  const dialog = $('#detailDialog');

  const trajectory = state.history.days
    .map((day) => ({ date: day.date, entry: day.movies.find((m) => m.id === id) }))
    .filter((point) => point.entry);
  const first = trajectory[0];
  const last = trajectory[trajectory.length - 1];
  const grew =
    first && last && first.entry.total_sales != null && last.entry.total_sales != null
      ? last.entry.total_sales - first.entry.total_sales
      : null;

  const reactions = Object.entries(movie.reactions || {})
    .sort((a, b) => b[1] - a[1])
    .map(([emoji, count]) => `<i>${emoji} ${num(count)}</i>`)
    .join('');

  $('#detailContent').innerHTML = `
    <h3>${escapeHTML(movie.title)}</h3>
    <p class="sub">${escapeHTML((movie.genres || []).join(' · ') || 'жанр не указан')} ·
      наблюдаем ${trajectory.length} ${plural(trajectory.length, 'день', 'дня', 'дней')}</p>
    <div class="detail-grid">
      <div><span>ПРОДАЖИ</span><b>${num(movie.total_sales)}</b></div>
      <div><span>ОЦЕНКА</span><b>${dec(movie.rating)}</b></div>
      <div><span>ОТЗЫВЫ</span><b>${num(movie.reviews_count)}</b></div>
      <div><span>СЕАНСЫ</span><b>${num(movie.sessions)}</b></div>
      <div><span>ЦЕНА ОТ</span><b>${money(movie.price_from)}</b></div>
      <div><span>ЗА ПЕРИОД</span><b>${grew === null ? DASH : signed(grew)}</b></div>
    </div>
    ${reactions ? `<div class="detail-reactions">${reactions}</div>` : ''}
    ${movie.url ? `<a class="detail-link" href="${escapeHTML(movie.url)}" target="_blank" rel="noopener">Открыть на сайте источника →</a>` : ''}
  `;
  dialog.showModal();
}

function plural(count, one, few, many) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/* ───────────────────────────  графики  ─────────────────────────── */

function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function drawChart(canvas, points, options = {}) {
  const empty = document.getElementById(options.emptyId);
  const valid = points.filter((p) => p.value !== null && p.value !== undefined);

  if (valid.length < 2) {
    if (empty) {
      empty.textContent = valid.length
        ? 'Нужен минимум второй срез — график появится после следующего сбора.'
        : 'Пока нет данных за период.';
      empty.classList.add('show');
    }
    const blank = canvas.getContext('2d');
    blank.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  if (empty) empty.classList.remove('show');

  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return; // вкладка скрыта — перерисуем при показе
  canvas.width = width * dpr;
  canvas.height = height * dpr;

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const pad = { top: 18, right: 16, bottom: 28, left: 52 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const values = valid.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  min = Math.max(0, min - span * 0.15);
  max += span * 0.15;

  const xAt = (i) => pad.left + (plotW * i) / (valid.length - 1);
  const yAt = (v) => pad.top + plotH - ((v - min) / (max - min)) * plotH;

  // сетка и подписи оси Y
  ctx.font = '11px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = min + ((max - min) * tick) / 4;
    const y = yAt(value);
    ctx.strokeStyle = cssVar('--rule-soft', '#efece8');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, y + 0.5);
    ctx.lineTo(width - pad.right, y + 0.5);
    ctx.stroke();
    ctx.fillStyle = cssVar('--ink-faint', '#9b979d');
    ctx.textAlign = 'right';
    ctx.fillText(options.formatY ? options.formatY(value) : num(value), pad.left - 10, y);
  }

  // подписи оси X — не чаще, чем позволяет ширина
  const step = Math.max(1, Math.ceil(valid.length / 7));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  valid.forEach((point, i) => {
    if (i % step && i !== valid.length - 1) return;
    ctx.fillStyle = cssVar('--ink-faint', '#9b979d');
    ctx.fillText(shortDate(point.date), xAt(i), height - pad.bottom + 9);
  });

  // заливка под линией
  const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
  gradient.addColorStop(0, options.fill || cssVar('--accent-wash', 'rgba(158,27,50,0.08)'));
  gradient.addColorStop(1, 'transparent');
  ctx.beginPath();
  ctx.moveTo(xAt(0), pad.top + plotH);
  valid.forEach((point, i) => ctx.lineTo(xAt(i), yAt(point.value)));
  ctx.lineTo(xAt(valid.length - 1), pad.top + plotH);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // линия
  ctx.beginPath();
  valid.forEach((point, i) => (i ? ctx.lineTo(xAt(i), yAt(point.value)) : ctx.moveTo(xAt(i), yAt(point.value))));
  ctx.strokeStyle = options.stroke || cssVar('--accent', '#9e1b32');
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // точки
  valid.forEach((point, i) => {
    ctx.beginPath();
    ctx.arc(xAt(i), yAt(point.value), 3.5, 0, Math.PI * 2);
    ctx.fillStyle = cssVar('--surface', '#ffffff');
    ctx.fill();
    ctx.strokeStyle = options.stroke || cssVar('--accent', '#9e1b32');
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  canvas._chart = { valid, xAt, yAt, pad, plotH, options };
}

function attachHover(canvas) {
  canvas.addEventListener('mousemove', (event) => {
    const chart = canvas._chart;
    if (!chart) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    let nearest = 0;
    let best = Infinity;
    chart.valid.forEach((_, i) => {
      const distance = Math.abs(chart.xAt(i) - x);
      if (distance < best) { best = distance; nearest = i; }
    });
    const point = chart.valid[nearest];
    const label = chart.options.formatY ? chart.options.formatY(point.value) : num(point.value);
    canvas.title = `${longDate(point.date)}: ${label}`;
  });
}

/* ───────────────────────────  динамика  ─────────────────────────── */

function renderTrends() {
  const days = state.history.days;

  $('#trendDays').textContent = days.length
    ? `${days.length} ${plural(days.length, 'день', 'дня', 'дней')}`
    : DASH;
  $('#trendRange').textContent = days.length
    ? `${longDate(days[0].date)} — ${longDate(days[days.length - 1].date)}`
    : 'Первый срез';

  renderTrendDeltas(days);
  renderMarketChart(days);
  renderMovieSelector();
  renderMovieChart();
  renderMovers(days);
}

function renderTrendDeltas(days) {
  const salesEl = $('#trendSalesDelta');
  const reviewsEl = $('#trendReviewsDelta');

  if (days.length < 2) {
    salesEl.textContent = DASH;
    reviewsEl.textContent = DASH;
    return;
  }
  const previous = days[days.length - 2];
  const current = days[days.length - 1];

  const before = new Map(previous.movies.map((m) => [m.id, m]));
  let salesDelta = 0;
  let matched = 0;
  current.movies.forEach((movie) => {
    const past = before.get(movie.id);
    if (past && past.total_sales != null && movie.total_sales != null) {
      salesDelta += movie.total_sales - past.total_sales;
      matched += 1;
    }
  });
  salesEl.textContent = matched ? signed(salesDelta) : DASH;
  salesEl.className = matched && salesDelta < 0 ? 'down' : matched ? 'up' : '';

  const reviewsDelta = (current.totals.reviews || 0) - (previous.totals.reviews || 0);
  reviewsEl.textContent = signed(reviewsDelta);
  reviewsEl.className = reviewsDelta < 0 ? 'down' : 'up';
}

function renderMarketChart(days) {
  const points = days.map((day) => ({
    date: day.date,
    value: state.hasSales ? day.totals.total_sales : day.totals.sessions,
  }));
  drawChart($('#marketChart'), points, { emptyId: 'marketEmpty' });
}

function renderMovieSelector() {
  const select = $('#trendMovie');
  const seen = new Map();
  state.history.days.forEach((day) =>
    day.movies.forEach((movie) => seen.set(movie.id, movie.title))
  );
  (state.latest.movies || []).forEach((movie) => seen.set(movie.id, movie.title));

  if (!seen.size) {
    select.innerHTML = '<option>Нет фильмов</option>';
    return;
  }
  if (!state.movieId || !seen.has(state.movieId)) {
    state.movieId = (state.latest.movies || [])[0]?.id || [...seen.keys()][0];
  }
  select.innerHTML = [...seen.entries()]
    .map(([id, title]) => `<option value="${escapeHTML(id)}"${id === state.movieId ? ' selected' : ''}>${escapeHTML(title)}</option>`)
    .join('');
}

// каждому показателю — свой цвет, оба из палитры страницы
function metricColors(metric) {
  if (metric === 'rating') return { stroke: cssVar('--warn', '#9a6a12'), fill: cssVar('--warn-wash', 'rgba(154,106,18,0.08)') };
  if (metric === 'reviews_count') return { stroke: cssVar('--data', '#2f4b6e'), fill: cssVar('--data-wash', 'rgba(47,75,110,0.1)') };
  return { stroke: cssVar('--accent', '#9e1b32'), fill: cssVar('--accent-wash', 'rgba(158,27,50,0.08)') };
}

function renderMovieChart() {
  const points = state.history.days.map((day) => {
    const entry = day.movies.find((movie) => movie.id === state.movieId);
    return { date: day.date, value: entry ? entry[state.metric] : null };
  });
  const colors = metricColors(state.metric);
  drawChart($('#movieChart'), points, {
    emptyId: 'movieEmpty',
    stroke: colors.stroke,
    fill: colors.fill,
    formatY: state.metric === 'rating' ? (value) => dec(value) : undefined,
  });
}

function renderMovers(days) {
  const host = $('#moversList');
  const period = $('#moversPeriod');

  if (days.length < 2) {
    host.innerHTML = '<div class="empty">Сравнение появится после второго сбора.</div>';
    period.textContent = '';
    return;
  }
  const previous = days[days.length - 2];
  const current = days[days.length - 1];
  period.textContent = `${shortDate(previous.date)} → ${shortDate(current.date)}`;

  const before = new Map(previous.movies.map((m) => [m.id, m]));
  const key = state.hasSales ? 'total_sales' : 'reviews_count';

  const movers = current.movies
    .map((movie) => {
      const past = before.get(movie.id);
      if (!past || past[key] == null || movie[key] == null) return null;
      const delta = movie[key] - past[key];
      const percent = past[key] ? (delta / past[key]) * 100 : null;
      return { title: movie.title, delta, percent };
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 6);

  if (!movers.length) {
    host.innerHTML = '<div class="empty">Нет фильмов, присутствующих в обоих срезах.</div>';
    return;
  }
  const unit = state.hasSales ? 'билетов' : 'отзывов';
  host.innerHTML = movers
    .map(
      (mover) => `
      <div class="mover">
        <div class="who">
          <b title="${escapeHTML(mover.title)}">${escapeHTML(mover.title)}</b>
          <span>${signed(mover.delta)} ${unit}</span>
        </div>
        <div class="delta ${mover.delta >= 0 ? 'up' : 'down'}">
          ${mover.percent === null ? DASH : `${mover.percent > 0 ? '+' : ''}${dec(mover.percent, 1)}%`}
        </div>
      </div>`
    )
    .join('');
}

/* ───────────────────────────  события  ─────────────────────────── */

$$('.view-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.view-tab').forEach((other) => other.classList.toggle('active', other === tab));
    const view = tab.dataset.view;
    $('#overviewView').classList.toggle('active', view === 'overview');
    $('#trendsView').classList.toggle('active', view === 'trends');
    // canvas не имеет размеров, пока вкладка скрыта — рисуем после показа
    if (view === 'trends' && state.latest) {
      renderMarketChart(state.history.days);
      renderMovieChart();
    }
  });
});

$('#search').addEventListener('input', (event) => {
  state.query = event.target.value;
  renderCatalog();
});

$('#sort').addEventListener('change', (event) => {
  state.sort = event.target.value;
  renderCatalog();
});

$('#trendMovie').addEventListener('change', (event) => {
  state.movieId = event.target.value;
  renderMovieChart();
});

$$('.metric-switch button').forEach((button) => {
  button.addEventListener('click', () => {
    $$('.metric-switch button').forEach((other) => other.classList.toggle('active', other === button));
    state.metric = button.dataset.metric;
    renderMovieChart();
  });
});

document.addEventListener('click', (event) => {
  const row = event.target.closest('.movie-table tbody tr[data-id], .movie-card[data-id]');
  if (row) openDetail(row.dataset.id);
});

$('.dialog-close').addEventListener('click', () => $('#detailDialog').close());
$('#detailDialog').addEventListener('click', (event) => {
  if (event.target === event.currentTarget) $('#detailDialog').close();
});

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!state.latest || !$('#trendsView').classList.contains('active')) return;
    renderMarketChart(state.history.days);
    renderMovieChart();
  }, 160);
});

attachHover($('#marketChart'));
attachHover($('#movieChart'));

boot();
