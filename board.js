/* ============================================================
   board.js — отрисовка колб и элементов на Canvas + геометрия/анимация.
   Фаза 1: рендер уровня. Фаза 2: хит-тест, подсветка выбора,
   анимация перелива, «дрожание» при недопустимом ходе.
   Правила хода (что можно, что нельзя) — в game.js; board.js только
   знает пиксели и умеет плавно анимировать переход между ними.

   sameType(a, b) объявлена уже сейчас (задел из CLAUDE.md): сравнение
   элементов идёт через ОДНУ функцию, чтобы позже можно было подменить
   правило (напр. графом смешения цветов), не трогая движок.
   ============================================================ */
const Board = (() => {
  const VIAL_CAPACITY = 4;

  const SHAPE = { CIRCLE: 'circle', SQUARE: 'square' };

  /* Тёплая палитра студии: 3 цвета, разведённые ПО СВЕТЛОТЕ (светлый/
     средний/тёмный), не только по тону — задача 5, живой прогон нашёл,
     что горчичный и сливовый читались почти одинаково темными на
     мобиле/при дальтонизме (яркость по каналу L различалась <25%
     между соседними ступенями). Проверено автотестом (grayscale-лума
     ITU-R 601, тот же, что Pillow .convert('L')): c3→c1 разрыв 37.2%,
     c1→c2 разрыв 26.2% — оба выше порога ≥25%.

     ТЗ №9, задача A: c1 сдвинут #b7502e→#d25c35 (luma601 107→123,
     +15%) — единственный способ найти ОДИН цвет обводки темы,
     проходящий ≥2.0:1 против ВСЕХ трёх заливок и фона поля одновременно
     (см. THEME.outline и отчёт ТЗ №9 — c1 сидел ровно посередине между
     «обводка должна быть темнее c3» и «обводка должна быть светлее
     c2/paper», зазора не было ни при какой обводке без сдвига c1).
     Это МИНИМАЛЬНЫЙ сдвиг: найден перебором как самая узкая правка,
     сохраняющая luma-разрыв c1↔c2 ≥25% (получилось 26.2% — было 32.4%,
     запас сузился, но порог не нарушен). Направление темы (терракота)
     не изменено — c1 остался тем же оттенком, просто светлее. c2/c3 не
     трогались. --accent в style.css (кнопки) от c1 НЕ зависит и
     сохранил старое значение #b7502e — акцент интерфейса и заливка
     фигуры-c1 теперь разные оттенки терракоты (см. отчёт). */
  const COLORS = {
    c1: '#d25c35', // терракота (ТЗ №9: сдвинута светлее ради обводки) — luma≈123
    c2: '#e8bb5c', // светлый горчично-золотой — luma≈190
    c3: '#2c1611'  // тёплый тёмный оксблад/слива (ТЗ №4 задача A — разведена
                    // от Ягодной, см. check_palette.py межтемный ассерт)
  };

  /* ТЗ №4, задача B: THEME — canvas не читает CSS-переменные, поэтому
     обводочные/акцентные цвета канвы держим отдельным мутируемым
     объектом (тот же приём, что уже был у COLORS) — main.js applyTheme()
     подменяет THEME.ink/accent/outline ВМЕСТЕ с COLORS.c1/c2/c3 на
     каждую смену темы. Значения по умолчанию — Тёплая (совпадают с
     style.css :root, но независимы: канва рисуется без DOM-стилей). */
  const THEME = {
    ink: '#2b2723',
    // ТЗ №10, задача C: приведён к style.css --accent (#d25c35, = c1) —
    // держим оба в синхроне, как гласит коммент к THEME выше. Раньше
    // #b7502e совпадал со СТАРЫМ --accent; после правки CSS-токена он бы
    // разошёлся сам по себе, если не тронуть здесь тоже.
    accent: '#d25c35',
    /* ТЗ №9, задача A: единая обводка фигур на тему — раньше outlineFor()
       выбирала ink ИЛИ outlineLight под КАЖДУЮ заливку отдельно (тёмная
       заливка получала белый контур, светлая — чёрный), из-за чего одно
       поле показывало одновременно белые и чёрные обводки — разнобой,
       читался как недоделка. THEME.outline — ОДИН цвет на тему,
       используется для всех фигур без исключения (drawElement).
       Подобран так, чтобы контраст ≥2.0:1 держался разом против ВСЕХ
       трёх заливок И фона поля (см. check_palette.py, отчёт ТЗ №9):
       outline vs c1 2.08:1, vs c2 4.56:1, vs c3 2.09:1, vs board-bg
       6.84:1. */
    outline: '#554e46'
  };

  function hexToRgbString(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `${r}, ${g}, ${b}`;
  }

  function sameType(a, b) {
    return !!a && !!b && a.color === b.color && a.shape === b.shape;
  }

  let canvas, ctx;
  let level = null;

  // Геометрия последнего кадра — переиспользуется хит-тестом и анимациями.
  let lastLayout = null;
  let vialRects = []; // [{x, y}, ...] по индексу колбы

  // Состояние, влияющее на отрисовку (Фаза 2).
  let selectedIndex = -1;
  let shakeState = null;       // { index, offset }
  let hiddenTopByVial = {};    // { [vialIndex]: скольким верхним элементам не рисоваться (летят) }
  let floatingGroup = null;    // { elements, cx, cy, elSize, elGap } — «летящая» пачка

  // Подсказка (Фаза 5): пульсирующая подсветка пары источник→цель.
  let hintState = null;   // { from, to, pulse }
  let hintRafId = null;

  // Анимация-полировка (Фаза 6): «оседание» приземлившихся элементов.
  let settleState = null; // { vialIndex, count, scale }
  let settleRafId = null;

  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
  }

  function setLevel(lvl) {
    level = lvl;
    selectedIndex = -1;
    shakeState = null;
    hiddenTopByVial = {};
    floatingGroup = null;
    if (hintRafId) { cancelAnimationFrame(hintRafId); hintRafId = null; }
    hintState = null;
    if (settleRafId) { cancelAnimationFrame(settleRafId); settleRafId = null; }
    settleState = null;
    resize();
  }

  // ТЗ №9, задача B (вариант 2 отчёта ТЗ №8 + мягкий край, решение
  // основателя): раньше canvas всегда занимал ВЕСЬ board-wrap
  // (CSS width/height:100%), из-за чего подложка поля была заметно
  // крупнее реального содержимого (ratioH до 2.93× на уровне с одним
  // рядом). Теперь resize() сначала «сухим» проходом (без ctx-вызовов)
  // меряет bbox содержимого на ПОЛНОЙ доступной площади, затем ужимает
  // сам <canvas> CSS-размером (inline style) под содержимое + отступ —
  // .board-wrap уже flex/center, ужавшийся canvas центрируется сам.
  function measureContentBox(cssW, cssH, vialCount) {
    const layout = computeLayout(cssW, cssH, vialCount);
    const { cols, rows, vw, GAP, ROW_GAP, vh } = layout;
    const contentH = rows * vh + (rows - 1) * ROW_GAP;
    let contentW = 0;
    let remaining = vialCount;
    for (let r = 0; r < rows; r++) {
      const colsInRow = Math.min(cols, remaining);
      contentW = Math.max(contentW, colsInRow * vw + (colsInRow - 1) * GAP);
      remaining -= colsInRow;
    }
    return { layout, contentW, contentH };
  }

  // БАГ (см. docs/reports/BUG_board_canvas_width_padding_mismatch.md,
  // ТЗ №10 задача A): `* { box-sizing: border-box }` (style.css) значит
  // clientWidth/clientHeight родителя ВКЛЮЧАЮТ его собственный padding
  // (#board-wrap: 12px слева/справа, calc(header-h+16px)/90px сверху/
  // снизу) — content-box, реально доступный детям, у́же. Взятый «в лоб»
  // clientWidth заставлял resize() ставить canvas шире, чем flexbox
  // (min-width:0 на #board-canvas) готов был реально отрисовать: браузер
  // визуально сжимал холст обратно до content-box, а пиксельный буфер
  // (canvas.width) оставался настроен под завышенное число — рассинхрон
  // рисовал грязный обрезанный край. Меряем content-box явно.
  function contentBoxSize(el) {
    const cs = getComputedStyle(el);
    const w = el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    const h = el.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
    return { w, h };
  }

  // Отступ вокруг содержимого (вычисляется в resize(), см. комментарий
  // там) — хранится отдельно от cssW/cssH, потому что draw() тоже обязан
  // знать его: раскладка внутри draw() ведётся В БЮДЖЕТЕ (cssW/cssH минус
  // отступ), а не во всей площади канвы (задача A, ТЗ №10).
  let PAD = 18;

  function resize() {
    if (!canvas || !level) return;
    // Меряем РОДИТЕЛЯ (board-wrap), не сам canvas: после первого сжатия
    // canvas.clientWidth уже меньше доступной площади — замер по canvas
    // дал бы петлю (каждый resize сжимал бы холст ещё раз).
    const wrap = canvas.parentElement;
    const box = wrap ? contentBoxSize(wrap) : { w: canvas.clientWidth, h: canvas.clientHeight };
    const availW = box.w;
    const availH = box.h;
    if (availW === 0 || availH === 0) return;

    // Пробный проход на ПОЛНОЙ доступной площади — только чтобы оценить
    // масштаб фигур (vw) и вывести отступ. Задача A, ТЗ №10: раньше
    // отступ считался ПОСЛЕ раскладки (contentW + PAD*2) — на раскладках,
    // где ряд упирается в доступную ширину впритык (типичный случай),
    // computeLayout() тут же перевычислялся заново от этого же итогового
    // cssW и СНОВА растягивал колонки на всю ширину, без остатка съедая
    // добавленный отступ (по высоте эффекта не было — там раскладка не
    // упирается в свой предел, слабина остаётся сама). Отступ теперь
    // резервируется КАК БЮДЖЕТ до раскладки (PAD хранится в модульной
    // переменной, draw() читает то же значение) — колонки/ряды заполняют
    // урезанный бюджет, а не полный холст, отступ выживает на обеих осях.
    const probe = computeLayout(availW, availH, level.vials.length);
    PAD = Math.max(18, probe.vw * 0.22); // тот же отступ, что был у варианта 1 в отчёте ТЗ №8
    const { contentW, contentH } = measureContentBox(
      Math.max(1, availW - PAD * 2), Math.max(1, availH - PAD * 2), level.vials.length
    );
    const cssW = Math.min(availW, contentW + PAD * 2);
    const cssH = Math.min(availH, contentH + PAD * 2);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    // Мягкий край — скругление (статичное, style.css #board-canvas) +
    // растворение (box-shadow цветом --board-bg темы), оба декларативны,
    // JS их не трогает. Радиус НЕ считаем пропорционально размеру: живой
    // прогон (ТЗ №9, задача B) поймал, что крупный радиус (пробовали
    // 12% от меньшей стороны) обрезает угол хит-теста у самой границы
    // padded-зоны колбы на тесных раскладках (Board.hitTest перестаёт
    // видеть пиксели в скруглённом углу) — см. отчёт. Небольшой
    // фиксированный радиус (см. CSS) держит запас против PAD (≥18px в
    // computeLayout выше) с большим отрывом.

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    draw(cssW, cssH);
  }

  function redraw() {
    if (!canvas || !level) return;
    // Защита от рассинхрона (см. комментарий у resize()/contentBoxSize):
    // redraw() не предполагает, что буфер (canvas.width/height, в
    // девайс-пикселях) уже согласован с реальным CSS-размером холста —
    // сверяет и пересобирает буфер САМ, если разошлось, а не только
    // внутри resize(). Дешёвая проверка (canvas.clientWidth уже читается
    // ниже в любом случае), но закрывает класс багов на будущее, а не
    // только сегодняшний.
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    const expectedW = Math.round(cssW * dpr);
    const expectedH = Math.round(cssH * dpr);
    if (canvas.width !== expectedW || canvas.height !== expectedH) {
      canvas.width = expectedW;
      canvas.height = expectedH;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    draw(cssW, cssH);
  }

  // Высота колбы линейно зависит от её ширины (вместимость фиксирована),
  // поэтому коэффициент высчитывается один раз и переиспользуется.
  function vhFromVw(vw) {
    const elSize = vw * 0.74;
    const elGap = elSize * 0.12;
    const tubeTopMargin = elSize * 0.5;
    const tubeBottomMargin = elSize * 0.22;
    return tubeTopMargin + VIAL_CAPACITY * elSize + (VIAL_CAPACITY - 1) * elGap + tubeBottomMargin;
  }
  const VH_PER_VW = vhFromVw(1);

  /* ---------- Раскладка колб по доступной площади ---------- */
  function computeLayout(cssW, cssH, vialCount) {
    const GAP = 16;
    const ROW_GAP = 28;
    const MIN_VW = 52;
    const MAX_VW = 130;

    let cols = vialCount;
    while (cols > 1 && (cssW - GAP * (cols - 1)) / cols < MIN_VW) {
      cols--;
    }
    const rows = Math.ceil(vialCount / cols);

    const widthVW = (cssW - GAP * (cols - 1)) / cols;
    // Не даём колбам теряться в пустой высокой области: вписываем их
    // так, чтобы сетка занимала бОльшую часть доступной высоты, а не
    // только ширины (важно на высоких узких телефонных экранах).
    const availH = cssH * 0.92 - (rows - 1) * ROW_GAP;
    const heightVW = (availH / rows) / VH_PER_VW;

    let vw = Math.min(widthVW, heightVW, MAX_VW);
    vw = Math.max(24, vw); // не даём схлопнуться до нуля на совсем узких экранах

    const vh = vhFromVw(vw);
    const elSize = vw * 0.74;
    const elGap = elSize * 0.12;
    const tubeBottomMargin = elSize * 0.22;

    return { cols, rows, vw, vh, GAP, ROW_GAP, elSize, elGap, tubeBottomMargin };
  }

  // Габариты последнего кадра (ТЗ №8, задача B): холст (весь #board-canvas)
  // против содержимого (bounding box реально нарисованных колб) — числа
  // для diag-вывода (dev_board_diag.js) и для отчёта по подложке доски.
  // НЕ используются самим рендером — только измерение постфактум.
  let lastDiagMetrics = null;

  function draw(cssW, cssH) {
    ctx.clearRect(0, 0, cssW, cssH);
    if (!level) return;

    const vials = level.vials;
    // Тот же бюджет (cssW/cssH минус PAD), что и при замере в resize() —
    // раскладка не имеет права заново растянуться на весь холст (задача A,
    // ТЗ №10, см. комментарий у PAD/resize()).
    const layout = computeLayout(Math.max(1, cssW - PAD * 2), Math.max(1, cssH - PAD * 2), vials.length);
    lastLayout = layout;
    const { cols, rows, vw, vh, GAP, ROW_GAP } = layout;

    const gridH = rows * vh + (rows - 1) * ROW_GAP;
    let y = (cssH - gridH) / 2;
    let maxRowW = 0;

    vialRects = [];
    let vialIndex = 0;
    for (let r = 0; r < rows; r++) {
      const remaining = vials.length - vialIndex;
      const colsInRow = Math.min(cols, remaining);
      const rowW = colsInRow * vw + (colsInRow - 1) * GAP;
      maxRowW = Math.max(maxRowW, rowW);
      let x = (cssW - rowW) / 2;

      for (let c = 0; c < colsInRow; c++) {
        const idx = vialIndex;
        vialRects[idx] = { x, y };
        const shakeOffset = (shakeState && shakeState.index === idx) ? shakeState.offset : 0;
        const hintPulse = (hintState && (hintState.from === idx || hintState.to === idx)) ? hintState.pulse : 0;
        const settling = (settleState && settleState.vialIndex === idx) ? settleState : null;
        drawVial(x + shakeOffset, y, vw, vh, vials[idx], layout, {
          isSelected: selectedIndex === idx,
          hiddenCount: hiddenTopByVial[idx] || 0,
          hintPulse,
          settleCount: settling ? settling.count : 0,
          settleScale: settling ? settling.scale : 1
        });
        x += vw + GAP;
        vialIndex++;
      }
      y += vh + ROW_GAP;
    }

    lastDiagMetrics = {
      canvasW: cssW, canvasH: cssH,
      contentW: maxRowW, contentH: gridH,
      ratioW: maxRowW > 0 ? cssW / maxRowW : 0,
      ratioH: gridH > 0 ? cssH / gridH : 0
    };

    if (floatingGroup) {
      let fy = floatingGroup.cy;
      for (let i = 0; i < floatingGroup.elements.length; i++) {
        drawElement(floatingGroup.cx, fy, floatingGroup.elSize, floatingGroup.elements[i]);
        fy -= floatingGroup.elSize + floatingGroup.elGap;
      }
    }
  }

  /* ---------- Одна колба ---------- */
  function drawVial(x, y, vw, vh, elements, layout, options) {
    const { isSelected = false, hiddenCount = 0, hintPulse = 0, settleCount = 0, settleScale = 1 } = options || {};
    const r = vw * 0.18;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + vh - r);
    ctx.arcTo(x, y + vh, x + r, y + vh, r);
    ctx.lineTo(x + vw - r, y + vh);
    ctx.arcTo(x + vw, y + vh, x + vw, y + vh - r, r);
    ctx.lineTo(x + vw, y);

    ctx.fillStyle = `rgba(${hexToRgbString(THEME.ink)}, 0.05)`;
    ctx.fill();
    if (isSelected) {
      ctx.strokeStyle = THEME.accent;
      ctx.lineWidth = Math.max(3, vw * 0.05);
    } else if (hintPulse > 0) {
      // Пульсирующая подсветка подсказки — отличима от статичного выбора игрока.
      ctx.strokeStyle = THEME.accent;
      ctx.lineWidth = Math.max(2, vw * 0.035) + hintPulse * vw * 0.045;
    } else {
      ctx.strokeStyle = THEME.ink;
      ctx.lineWidth = Math.max(2, vw * 0.035);
    }
    ctx.lineJoin = 'round';
    ctx.stroke();

    const { elSize, elGap, tubeBottomMargin } = layout;
    const visibleCount = elements.length - hiddenCount;
    let cy = y + vh - tubeBottomMargin - elSize / 2;
    for (let i = 0; i < visibleCount; i++) {
      const cx = x + vw / 2;
      // Верхний элемент выбранной колбы визуально «приподнят» — как будто уже поднят для перелива.
      const isLiftedTop = isSelected && i === visibleCount - 1;
      // Только что приземлившиеся элементы (Фаза 6) — лёгкий «плюх»-масштаб.
      const isSettling = settleCount > 0 && i >= visibleCount - settleCount;
      const size = isSettling ? elSize * settleScale : elSize;
      drawElement(cx, isLiftedTop ? cy - elSize * 0.32 : cy, size, elements[i]);
      cy -= elSize + elGap;
    }
  }

  /* ---------- Один элемент (круг или квадрат в цвете) ---------- */
  function drawElement(cx, cy, size, el) {
    const fill = COLORS[el.color];
    ctx.fillStyle = fill;
    ctx.strokeStyle = THEME.outline; // ТЗ №9, задача A: одна обводка на тему, без per-заливки выбора
    ctx.lineWidth = Math.max(1.5, size * 0.06);

    if (el.shape === SHAPE.CIRCLE) {
      const radius = size / 2 * 0.9;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      const s = size * 0.86;
      const cr = s * 0.18;
      const left = cx - s / 2;
      const top = cy - s / 2;
      ctx.beginPath();
      ctx.moveTo(left + cr, top);
      ctx.lineTo(left + s - cr, top);
      ctx.arcTo(left + s, top, left + s, top + cr, cr);
      ctx.lineTo(left + s, top + s - cr);
      ctx.arcTo(left + s, top + s, left + s - cr, top + s, cr);
      ctx.lineTo(left + cr, top + s);
      ctx.arcTo(left, top + s, left, top + s - cr, cr);
      ctx.lineTo(left, top + cr);
      ctx.arcTo(left, top, left + cr, top, cr);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  /* ---------- Хит-тест: экранные координаты → индекс колбы ---------- */
  function hitTest(clientX, clientY) {
    if (!canvas || !lastLayout || !vialRects.length) return -1;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const pad = 8; // прощаем неточный тап рядом с колбой
    const { vw, vh } = lastLayout;
    for (let i = 0; i < vialRects.length; i++) {
      const r = vialRects[i];
      if (x >= r.x - pad && x <= r.x + vw + pad && y >= r.y - pad && y <= r.y + vh + pad) {
        return i;
      }
    }
    return -1;
  }

  /* ---------- Подсветка выбранной колбы-источника ---------- */
  function setSelected(index) {
    selectedIndex = index;
    redraw();
  }

  /* ---------- Недопустимый ход: короткое дрожание колбы-цели ---------- */
  function shake(index) {
    const duration = 300;
    const t0 = performance.now();
    function frame(now) {
      const t = (now - t0) / duration;
      if (t >= 1) { shakeState = null; redraw(); return; }
      shakeState = { index, offset: Math.sin(t * Math.PI * 5) * (1 - t) * 10 };
      redraw();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ---------- Анимация перелива: count верхних элементов из fromIdx в toIdx ----------
     Данные ещё НЕ изменены на момент вызова — позиции считаются от текущего
     состояния level.vials. Модель обновляется в onDone (данные — источник
     истины, отрисовка следует за ними). */
  function animatePour({ fromIdx, toIdx, count, duration = 240, onDone }) {
    if (!level || !lastLayout || !vialRects[fromIdx] || !vialRects[toIdx]) {
      if (onDone) onDone();
      return;
    }
    const sourceVial = level.vials[fromIdx];
    const targetVial = level.vials[toIdx];
    const startSlotIndex = sourceVial.length - count;
    const endSlotIndex = targetVial.length;

    const { vw, vh, elSize, elGap, tubeBottomMargin } = lastLayout;
    const srcRect = vialRects[fromIdx];
    const dstRect = vialRects[toIdx];

    const startCx = srcRect.x + vw / 2;
    const startCy = srcRect.y + vh - tubeBottomMargin - elSize / 2 - startSlotIndex * (elSize + elGap);
    const endCx = dstRect.x + vw / 2;
    const endCy = dstRect.y + vh - tubeBottomMargin - elSize / 2 - endSlotIndex * (elSize + elGap);

    const elements = sourceVial.slice(startSlotIndex);
    hiddenTopByVial = { [fromIdx]: count };

    const arcH = elSize * 1.1;
    const t0 = performance.now();

    function frame(now) {
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - (1 - t) * (1 - t); // ease-out — быстро и мягко, антистресс-темп
      const cx = startCx + (endCx - startCx) * eased;
      const cy = startCy + (endCy - startCy) * eased - Math.sin(eased * Math.PI) * arcH;
      floatingGroup = { elements, cx, cy, elSize, elGap };
      redraw();

      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        hiddenTopByVial = {};
        floatingGroup = null;
        startSettleAnimation(toIdx, count); // «плюх»-полировка приземления
        if (onDone) onDone();
        redraw();
      }
    }
    requestAnimationFrame(frame);
  }

  // easeOutBack: лёгкий перехлёст за 1.0 перед тем, как осесть — стандартная
  // «пружинка» для приземления, без сторонних либ.
  function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  /* ---------- «Плюх»: приземлившиеся элементы чуть оседают и пружинят ---------- */
  function startSettleAnimation(vialIndex, count) {
    if (settleRafId) cancelAnimationFrame(settleRafId);
    const duration = 220;
    const t0 = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - t0) / duration);
      settleState = { vialIndex, count, scale: 0.6 + 0.4 * easeOutBack(t) };
      redraw();
      if (t < 1) {
        settleRafId = requestAnimationFrame(frame);
      } else {
        settleState = null;
        settleRafId = null;
        redraw();
      }
    }
    settleRafId = requestAnimationFrame(frame);
  }

  /* ---------- Подсказка: пульсирующая подсветка пары источник→цель ---------- */
  function showHint(fromIdx, toIdx) {
    if (hintRafId) cancelAnimationFrame(hintRafId);
    const duration = 2200;
    const t0 = performance.now();
    function frame(now) {
      const t = (now - t0) / duration;
      if (t >= 1) { hintState = null; hintRafId = null; redraw(); return; }
      hintState = { from: fromIdx, to: toIdx, pulse: 0.5 + 0.5 * Math.sin(t * Math.PI * 6) };
      redraw();
      hintRafId = requestAnimationFrame(frame);
    }
    hintRafId = requestAnimationFrame(frame);
  }

  function clearHint() {
    if (hintRafId) { cancelAnimationFrame(hintRafId); hintRafId = null; }
    if (hintState) { hintState = null; redraw(); }
  }

  // ТЗ №8, задача B: геометрия последнего кадра для diag-вывода
  // (dev_board_diag.js) — снимок, не пересчитывает и не форсирует рендер.
  function getDiagMetrics() {
    return lastDiagMetrics;
  }

  return {
    init, setLevel, resize, redraw,
    hitTest, setSelected, shake, animatePour, showHint, clearHint,
    getDiagMetrics,
    // computeLayout — диагностический экспорт (перенесено с
    // fix/vk-remove-shop при сведении в main): координаты клика для
    // Playwright-приёмки берутся из того, что реально нарисовано
    // (computeLayout/getDiagMetrics), не калибруются через hitTest.
    // Чистая функция, ничего не меняет в рендере.
    computeLayout,
    sameType, SHAPE, COLORS, THEME, VIAL_CAPACITY
  };
})();
