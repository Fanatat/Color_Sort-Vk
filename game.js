/* ============================================================
   game.js — ввод, правило перелива и условие победы.
   Владеет игровыми ПРАВИЛАМИ (что можно/нельзя) и текущей моделью
   уровня; Board отвечает только за пиксели/анимацию. Переход между
   уровнями (какой уровень следующий, экран меню) — забота main.js;
   game.js лишь сообщает о победе через колбэк.
   ============================================================ */
const Game = (() => {
  let canvas, undoBtn, onWinCallback;
  let level = null;
  let selectedIndex = -1;
  let busy = false;        // идёт анимация — новые тапы игнорируем
  let lastMove = null;     // { from, to, elements } — только последний ход
  let solved = false;      // уровень пройден — вход заблокирован до следующего уровня

  function init(canvasEl, onWin) {
    canvas = canvasEl;
    onWinCallback = onWin;
    undoBtn = document.getElementById('btn-undo');

    let downX = 0, downY = 0;
    canvas.addEventListener('pointerdown', (e) => {
      downX = e.clientX;
      downY = e.clientY;
    });
    canvas.addEventListener('pointerup', (e) => {
      // Отличаем тап от свайпа/скролла жестом — большое смещение не считаем тапом.
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 12) return;
      onTap(e.clientX, e.clientY);
    });

    if (undoBtn) undoBtn.addEventListener('click', undo);
    updateUndoButton();
  }

  function setLevel(lvl) {
    level = lvl;
    selectedIndex = -1;
    busy = false;
    lastMove = null;
    solved = false;
    Board.setSelected(-1);
    updateUndoButton();
  }

  /* Победа: КАЖДАЯ колба либо пуста, либо однородна по цвету И форме
     И заполнена до вместимости целиком (недобранная колба — не победа). */
  function isLevelSolved(vials) {
    return vials.every(vial => {
      if (vial.length === 0) return true;
      if (vial.length !== Board.VIAL_CAPACITY) return false;
      const top = vial[0];
      return vial.every(el => Board.sameType(el, top));
    });
  }

  /* Колба «собрана» (заполнена, все элементы одного типа) — залочена:
     из неё нельзя лить (ни игроку тапом, ни подсказке), см. onTap и
     findHint ниже. Решение основателя 2026-07-17 — раньше первый
     ЛЕГАЛЬНЫЙ (но бессмысленный) ход мог указывать «перелей уже
     собранную колбу в пустую». */
  function isCollected(vial) {
    return vial.length === Board.VIAL_CAPACITY && vial.every(el => Board.sameType(el, vial[0]));
  }

  /* Сколько верхних одинаковых элементов из sourceVial поместится в targetVial. */
  function computeMoveCount(sourceVial, targetVial) {
    if (sourceVial.length === 0) return 0;
    if (targetVial.length >= Board.VIAL_CAPACITY) return 0;

    const top = sourceVial[sourceVial.length - 1];
    const targetTop = targetVial[targetVial.length - 1];
    if (targetVial.length > 0 && !Board.sameType(targetTop, top)) return 0;

    let count = 0;
    for (let i = sourceVial.length - 1; i >= 0; i--) {
      if (Board.sameType(sourceVial[i], top)) count++;
      else break;
    }
    return Math.min(count, Board.VIAL_CAPACITY - targetVial.length);
  }

  function onTap(clientX, clientY) {
    if (busy || solved || !level) return;
    const idx = Board.hitTest(clientX, clientY);
    if (idx === -1) return;

    Board.clearHint(); // любое взаимодействие с полем снимает подсказку

    if (selectedIndex === -1) {
      if (level.vials[idx].length === 0) return; // нечего поднимать
      if (isCollected(level.vials[idx])) return; // залочена — уже собрана, из неё не льём
      selectedIndex = idx;
      Board.setSelected(idx);
      return;
    }

    if (idx === selectedIndex) {
      selectedIndex = -1;
      Board.setSelected(-1);
      return;
    }

    const sourceVial = level.vials[selectedIndex];
    const targetVial = level.vials[idx];
    const count = computeMoveCount(sourceVial, targetVial);

    if (count === 0) {
      Sound.playInvalid();
      Board.shake(idx); // лёгкий отказ, без наказания; выбор источника остаётся
      return;
    }

    const fromIdx = selectedIndex;
    const toIdx = idx;
    selectedIndex = -1;
    Board.setSelected(-1);
    busy = true;
    Sound.playPour();

    Board.animatePour({
      fromIdx, toIdx, count,
      onDone: () => {
        const moved = sourceVial.splice(sourceVial.length - count, count);
        targetVial.push(...moved);
        lastMove = { from: fromIdx, to: toIdx, elements: moved.slice() };
        busy = false;
        updateUndoButton();
        Sound.playSettle();

        if (isLevelSolved(level.vials)) {
          solved = true;
          updateUndoButton(); // прятать её теперь безусловно (см. toggle ниже)
          Sound.playWin();
          if (onWinCallback) onWinCallback();
        }
      }
    });
  }

  function undo() {
    if (!lastMove || busy || solved || !level) return;
    const { from, to, elements } = lastMove;
    const count = elements.length;
    const sourceVial = level.vials[to];   // сейчас элементы здесь
    const targetVial = level.vials[from]; // возвращаем сюда

    selectedIndex = -1;
    Board.setSelected(-1);
    lastMove = null;
    busy = true;
    updateUndoButton();

    Board.animatePour({
      fromIdx: to, toIdx: from, count,
      onDone: () => {
        const moved = sourceVial.splice(sourceVial.length - count, count);
        targetVial.push(...moved);
        busy = false;
        Sound.playSettle();
      }
    });
  }

  function updateUndoButton() {
    if (!undoBtn) return;
    undoBtn.classList.toggle('hidden', !lastMove || solved);
  }

  /* ---------- Подсказка: первый ход НАСТОЯЩЕГО кратчайшего BFS-решения ----------
     Решение основателя 2026-07-17 (починка дефекта): раньше отдавали
     первую попавшуюся ЛЕГАЛЬНУЮ пару источник→цель — из-за этого
     подсказка могла предложить «перелей уже собранную колбу в пустую»
     (легальный, но бессмысленный ход) или гонять одиночный элемент
     туда-сюда без продвижения к победе. Теперь — BFS от ТЕКУЩЕЙ позиции
     по настоящим правилам игрока (computeMoveCount, с той же блокировкой
     собранных колб как источника, что и у игрока — см. isCollected/
     onTap выше), возвращаем первый ход кратчайшего найденного решения.
     Такой ход по определению либо ведёт к победе, либо приближает к
     ней, и никогда не трогает уже собранную колбу. Если решения от
     текущей позиции нет (тупик) — null, main.js покажет тост без ролика. */
  function cloneVials(vials) {
    return vials.map(v => v.slice());
  }
  function vialSignature(vial) {
    return vial.map(el => el.color + el.shape[0]).join('');
  }
  function hintStateKey(vials) {
    const sigs = vials.map(vialSignature);
    sigs.sort();
    return sigs.join('|');
  }
  function hintLegalMoves(vials) {
    const moves = [];
    for (let i = 0; i < vials.length; i++) {
      if (vials[i].length === 0 || isCollected(vials[i])) continue; // залочена/пусто — не источник
      for (let j = 0; j < vials.length; j++) {
        if (i === j) continue;
        if (computeMoveCount(vials[i], vials[j]) > 0) moves.push({ from: i, to: j });
      }
    }
    return moves;
  }
  function applyHintMove(vials, move) {
    const next = cloneVials(vials);
    const count = computeMoveCount(next[move.from], next[move.to]);
    const moved = next[move.from].splice(next[move.from].length - count, count);
    next[move.to].push(...moved);
    return next;
  }
  function findHint() {
    if (!level) return null;
    const start = cloneVials(level.vials);
    if (isLevelSolved(start)) return null;

    const visited = new Set([hintStateKey(start)]);
    let frontier = [{ vials: start, firstMove: null }];
    let depth = 0;
    const MAX_DEPTH = 200;
    const VISITED_CAP = 200000;

    while (frontier.length > 0 && depth < MAX_DEPTH) {
      depth++;
      const next = [];
      for (const node of frontier) {
        for (const move of hintLegalMoves(node.vials)) {
          const nv = applyHintMove(node.vials, move);
          const key = hintStateKey(nv);
          if (visited.has(key)) continue;
          const firstMove = node.firstMove || move; // ход из САМОГО начала цепочки
          if (isLevelSolved(nv)) return firstMove;
          visited.add(key);
          next.push({ vials: nv, firstMove });
        }
      }
      frontier = next;
      if (visited.size > VISITED_CAP) break; // защитный предохранитель — тупик по факту
    }
    return null; // решения от текущей позиции не нашли — тупик
  }

  return { init, setLevel, findHint };
})();
