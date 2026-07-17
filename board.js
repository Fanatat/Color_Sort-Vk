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

  // Тёплая палитра студии: 3 хорошо различимых цвета элементов.
  const COLORS = {
    c1: '#b7502e', // терракота (акцент студии)
    c2: '#d9a441', // горчичный
    c3: '#7a3b56'  // сливовый
  };

  const INK = '#2b2723';
  const ACCENT = '#b7502e';

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

  function resize() {
    if (!canvas || !level) return;
    // Размер берём у самого canvas (CSS width:100%/height:100% уже
    // корректно вписывает его в контентную область board-wrap, за
    // вычетом padding). JS только настраивает чёткость под DPI.
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (cssW === 0 || cssH === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    draw(cssW, cssH);
  }

  function redraw() {
    if (!canvas || !level) return;
    draw(canvas.clientWidth, canvas.clientHeight);
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

  function draw(cssW, cssH) {
    ctx.clearRect(0, 0, cssW, cssH);
    if (!level) return;

    const vials = level.vials;
    const layout = computeLayout(cssW, cssH, vials.length);
    lastLayout = layout;
    const { cols, rows, vw, vh, GAP, ROW_GAP } = layout;

    const gridH = rows * vh + (rows - 1) * ROW_GAP;
    let y = (cssH - gridH) / 2;

    vialRects = [];
    let vialIndex = 0;
    for (let r = 0; r < rows; r++) {
      const remaining = vials.length - vialIndex;
      const colsInRow = Math.min(cols, remaining);
      const rowW = colsInRow * vw + (colsInRow - 1) * GAP;
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

    ctx.fillStyle = 'rgba(43, 39, 35, 0.05)';
    ctx.fill();
    if (isSelected) {
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = Math.max(3, vw * 0.05);
    } else if (hintPulse > 0) {
      // Пульсирующая подсветка подсказки — отличима от статичного выбора игрока.
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = Math.max(2, vw * 0.035) + hintPulse * vw * 0.045;
    } else {
      ctx.strokeStyle = INK;
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
    ctx.fillStyle = COLORS[el.color];
    ctx.strokeStyle = INK;
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

  return {
    init, setLevel, resize, redraw,
    hitTest, setSelected, shake, animatePour, showHint, clearHint,
    sameType, SHAPE, COLORS, VIAL_CAPACITY
  };
})();
