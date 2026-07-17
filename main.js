/* ============================================================
   main.js — точка входа.
   Загрузка → init SDK → автоязык → восстановление сейва → меню →
   Game Ready. Игровой цикл (колбы/перелив/победа) — Фазы 1-3.
   Сохранение прогресса через platform.js — Фаза 4.
   Реклама (interstitial с кулдауном, rewarded-подсказка) — Фаза 5.
   Звук (sound.js) и полировка анимаций — Фаза 6.
   Конфетти (confetti.js) и усиленный «вау»-момент победы — точечная
   правка по решению основателя.
   ============================================================ */
(() => {
  const screens = {
    loading: document.getElementById('screen-loading'),
    menu:    document.getElementById('screen-menu'),
    grid:    document.getElementById('screen-grid'),
    game:    document.getElementById('screen-game')
  };

  /* DEV_UNLOCK_ALL — из dev_flags.js, который НЕ грузится в билде
     площадки (build.py вырезает и файл, и тег — см. CLAUDE.md
     «УПАКОВКА»). typeof-проверка: в проде переменной физически нет. */
  const devUnlockAll = typeof DEV_UNLOCK_ALL !== 'undefined' && DEV_UNLOCK_ALL === true;

  const btnPlay     = document.getElementById('btn-play');
  const btnContinue = document.getElementById('btn-continue');
  const btnLevels   = document.getElementById('btn-levels');
  const btnGridBack = document.getElementById('btn-grid-back');
  const levelGridEl = document.getElementById('level-grid');
  const btnBack     = document.getElementById('btn-back');
  const btnNext     = document.getElementById('btn-next');
  const btnHint     = document.getElementById('btn-hint');
  const soundBtns   = document.querySelectorAll('#btn-sound, #btn-sound-game');
  const boardCanvas = document.getElementById('board-canvas');
  const gameHeader  = document.querySelector('#screen-game .game-header');
  const winOverlay  = document.getElementById('win-overlay');
  const levelIndicator = document.getElementById('level-indicator');
  const hintToast   = document.getElementById('hint-toast');
  const confettiCanvas = document.getElementById('confetti-canvas');

  /* Экран завершения кампании (после последнего уровня) */
  const campaignOverlay  = document.getElementById('campaign-overlay');
  const btnCampaignMenu  = document.getElementById('btn-campaign-menu');
  const statTotalEl      = document.getElementById('stat-total');
  const statAverageEl    = document.getElementById('stat-average');
  const statFastestEl    = document.getElementById('stat-fastest');
  const statSlowestEl    = document.getElementById('stat-slowest');

  /* Сейв: ВСЕГДА полный объект (стандарт студии).
     levelTimes[i] — активное время (сек) на уровень i, пишется при
     победе (Stats.finishLevel, Вариант Б — см. stats.js).
     maxUnlocked — furthest реально пройденный/открытый уровень, ТОЛЬКО
     растёт; отдельно от levelIndex («где игрок сейчас/точка Продолжить»),
     потому что грид позволяет ЗАЙТИ на уже открытый уровень назад —
     если бы замок сетки читался из levelIndex, повторный проход
     раннего уровня откатил бы прогресс и снова запер бы всё дальше. */
  const state = {
    levelIndex: 0,
    onboardingSeen: false,
    muted: false,
    levelTimes: [],
    maxUnlocked: 0
  };

  function isLevelUnlocked(idx) {
    return devUnlockAll || idx <= state.maxUnlocked;
  }

  function show(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  /* Видимость «Продолжить» зависит от ТЕКУЩЕГО state.levelIndex, а не
     только от сейва при старте — иначе кнопка не появится, если пройти
     уровни и вернуться в меню в рамках той же сессии (без перезагрузки). */
  function updateContinueVisibility() {
    btnContinue.classList.toggle('hidden', state.levelIndex === 0);
  }

  /* ---------- Звук: тумблёр ---------- */
  function applyMuteIcon() {
    soundBtns.forEach(b => b.classList.toggle('muted', state.muted));
    Sound.setMuted(state.muted);
  }
  function toggleSound() {
    state.muted = !state.muted;
    applyMuteIcon();
    Platform.save({ ...state }); // полный объект
  }
  soundBtns.forEach(b => b.addEventListener('click', toggleSound));

  /* Короткий тап-звук на ЛЮБОЙ кнопке интерфейса (делегирование — не
     привязываемся к конкретным обработчикам, ничего не пропустим).
     Слушатель на document ловит клик уже ПОСЛЕ обработчика самой
     кнопки (порядок всплытия) — toggleSound успевает обновить
     Sound.setMuted до того, как здесь решится, играть ли звук. */
  document.addEventListener('click', (e) => {
    if (e.target.closest('.btn')) Sound.playClick();
  });

  /* ---------- Резерв под шапку ----------
     Высота .game-header не хардкодится: меряем фактический рендер
     (зависит от масштаба ОС/браузера, шрифта, длины текста уровня),
     прокидываем в CSS-переменную — board-wrap всегда отступает ровно
     на реальную высоту шапки, без риска наложения. */
  function syncHeaderSpace() {
    const activeHeader = screens.game.classList.contains('active') ? gameHeader
      : screens.grid.classList.contains('active') ? screens.grid.querySelector('.game-header')
      : null;
    if (!activeHeader) return;
    const h = Math.ceil(activeHeader.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--header-h', h + 'px');
    if (screens.game.classList.contains('active')) Board.resize();
    else layoutGrid();
  }
  window.addEventListener('resize', syncHeaderSpace);
  window.addEventListener('orientationchange', syncHeaderSpace);

  /* ---------- Сетка уровней (прогресс + прыжок на уже открытый) ----------
     Раскладка считается сама, как в Board.computeLayout — плитки
     подбирают наибольший размер, при котором ВСЕ LEVELS.length
     помещаются без скролла (анти-скролл — стандарт студии, скролл
     внутри отдельного экрана не заводим). */
  function renderGrid() {
    levelGridEl.innerHTML = '';
    for (let i = 0; i < LEVELS.length; i++) {
      const unlocked = isLevelUnlocked(i);
      const tile = document.createElement('button');
      tile.className = 'grid-tile' + (unlocked ? '' : ' locked') + (i === state.levelIndex ? ' current' : '');
      if (unlocked) {
        tile.textContent = String(i + 1);
        tile.addEventListener('click', () => {
          show('game');
          loadLevel(i);
          Platform.save({ ...state });
        });
      } else {
        tile.disabled = true;
        tile.setAttribute('aria-label', 'locked');
        const lock = document.createElement('span');
        lock.className = 'lock-icon';
        tile.appendChild(lock);
      }
      levelGridEl.appendChild(tile);
    }
    layoutGrid();
  }

  function layoutGrid() {
    if (!screens.grid.classList.contains('active')) return;
    const wrap = document.getElementById('grid-wrap');
    // clientWidth/Height включают padding самого wrap (там резерв под
    // шапку сверху) — вычитаем его, иначе сетка меряет себя по ПОЛНОЙ
    // рамке контейнера и переполняет реальную видимую область (шрам:
    // плитки налезали на шапку и уезжали за нижний край без скролла).
    const cs = getComputedStyle(wrap);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const cssW = wrap.clientWidth - padX;
    const cssH = wrap.clientHeight - padY;
    if (cssW <= 0 || cssH <= 0) return;
    const count = LEVELS.length;
    const GAP = 8;
    const MIN_TILE = 26;
    const MAX_TILE = 60;

    let bestTile = MIN_TILE, bestCols = count;
    for (let cols = 1; cols <= count; cols++) {
      const rows = Math.ceil(count / cols);
      const tileW = (cssW - GAP * (cols - 1)) / cols;
      const tileH = (cssH - GAP * (rows - 1)) / rows;
      const tile = Math.min(tileW, tileH, MAX_TILE);
      if (tile > bestTile) { bestTile = tile; bestCols = cols; }
    }
    const tilePx = Math.max(MIN_TILE, Math.floor(bestTile));
    levelGridEl.style.gridTemplateColumns = `repeat(${bestCols}, ${tilePx}px)`;
    levelGridEl.style.gridAutoRows = `${tilePx}px`;
    levelGridEl.style.fontSize = Math.max(10, Math.floor(tilePx * 0.4)) + 'px';
  }

  btnLevels.addEventListener('click', () => {
    show('grid');
    syncHeaderSpace();
    renderGrid();
  });
  btnGridBack.addEventListener('click', () => show('menu'));

  /* ---------- Пауза геймплея/звука ----------
     Единая точка для ДВУХ триггеров: реклама (Фаза 5, колбэки
     onPause/onResume у interstitial и rewarded) и сворачивание вкладки
     (visibilitychange, ниже). В этой игре геймплей ходовой (не
     реалтайм), «пауза геймплея» по факту сводится к паузе звука —
     ничего само по себе не продолжает идти, пока вкладка скрыта. */
  function pauseGame() {
    Sound.suspend();
    Stats.pause();
  }
  function resumeGame() {
    Sound.resume();
    Stats.resume();
  }

  /* ---------- Interstitial между уровнями: двойной кулдаун ----------
     Не чаще раза в 3 пройденных уровня И не чаще раза в 90 секунд —
     оба условия вместе, чтобы не докучать рекламой аудитории 35+. */
  const AD_LEVELS_INTERVAL = 3;
  const AD_MIN_GAP_MS = 90000;
  let levelsSinceAd = 0;
  let lastAdAt = 0;

  function maybeShowInterstitial(afterShown) {
    levelsSinceAd++;
    const now = performance.now();
    const intervalOk = levelsSinceAd >= AD_LEVELS_INTERVAL;
    const cooldownOk = (now - lastAdAt) >= AD_MIN_GAP_MS;
    if (!intervalOk || !cooldownOk) {
      afterShown();
      return;
    }
    levelsSinceAd = 0;
    lastAdAt = now;
    Platform.showInterstitial(pauseGame, () => {
      resumeGame();
      afterShown();
    });
  }

  /* ---------- Rewarded-подсказка ---------- */
  function showHintToast() {
    hintToast.classList.remove('hidden');
    clearTimeout(showHintToast._t);
    showHintToast._t = setTimeout(() => hintToast.classList.add('hidden'), 1800);
  }
  btnHint.addEventListener('click', () => {
    const hint = Game.findHint();
    if (!hint) {
      showHintToast(); // мягкое сообщение — ролик не показываем зря
      return;
    }
    Platform.showRewarded(
      () => Board.showHint(hint.from, hint.to), // награда получена — подсвечиваем ход
      pauseGame,
      resumeGame
    );
  });

  /* ---------- Победа / переход уровней ---------- */
  function showWinOverlay() {
    // Активное время уровня (Вариант Б, stats.js) фиксируется РОВНО в
    // момент победы — до этого таймер нигде не показывается игроку.
    const seconds = Stats.finishLevel();
    state.levelTimes[state.levelIndex] = seconds;
    Platform.save({ ...state }); // полный объект — переживает закрытие вкладки отсюда же
    winOverlay.classList.remove('hidden');
    Confetti.burst(); // «вау»-момент; сама уважает prefers-reduced-motion
  }
  function hideWinOverlay() {
    winOverlay.classList.add('hidden');
  }

  function loadLevel(idx) {
    state.levelIndex = idx;
    state.maxUnlocked = Math.max(state.maxUnlocked, idx);
    const level = LEVELS[idx];
    levelIndicator.textContent = `${t('level')} ${idx + 1}`; // без «/ всего» — общее число уровней игроку не показываем
    syncHeaderSpace();
    hideWinOverlay();
    Board.setLevel(level);
    Game.setLevel(level);
    Stats.startLevel(idx);
  }

  function formatTime(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  /* 4 цифры экрана завершения кампании: общее, среднее, самый быстрый,
     самый долгий уровень — по всем записанным активным временам. */
  function computeCampaignStats() {
    const times = state.levelTimes.filter(v => typeof v === 'number' && v >= 0);
    const total = times.reduce((a, b) => a + b, 0);
    const average = times.length ? total / times.length : 0;
    const fastest = times.length ? Math.min(...times) : 0;
    const slowest = times.length ? Math.max(...times) : 0;
    return { total, average, fastest, slowest };
  }

  function showCampaignCompleteOverlay() {
    hideWinOverlay();
    const stats = computeCampaignStats();
    statTotalEl.textContent = formatTime(stats.total);
    statAverageEl.textContent = formatTime(stats.average);
    statFastestEl.textContent = formatTime(stats.fastest);
    statSlowestEl.textContent = formatTime(stats.slowest);
    campaignOverlay.classList.remove('hidden');
    Sound.playFanfare();
    Confetti.burst();
  }
  btnCampaignMenu.addEventListener('click', () => {
    campaignOverlay.classList.add('hidden');
    show('menu');
    updateContinueVisibility();
  });

  btnNext.addEventListener('click', () => {
    const nextIdx = state.levelIndex + 1;
    if (nextIdx >= LEVELS.length) {
      // Кампания пройдена целиком — экран завершения вместо тихого
      // возврата в меню (levelIndex остаётся на последнем уровне,
      // сохранён уже в showWinOverlay).
      showCampaignCompleteOverlay();
      return;
    }
    hideWinOverlay();
    // Interstitial (с кулдауном) — в паузе ПОСЛЕ оверлея, ДО загрузки уровня.
    maybeShowInterstitial(() => {
      loadLevel(nextIdx);
      // Точка сохранения (Фаза 4): levelIndex обновился — прогресс продвинулся.
      // НЕ сохраняем на каждый ход/кадр — только на переходе уровня и звуке.
      Platform.save({ ...state });
    });
  });

  /* ---------- Кнопки меню ----------
     «Играть» — всегда новая игра с уровня 1 (сбрасывает прогресс).
     «Продолжить» — с сохранённого места (видна только если есть прогресс). */
  function startNewGame() {
    state.levelIndex = 0;
    state.levelTimes = []; // новый прогон кампании — старые времена не мешают статистике
    state.maxUnlocked = 0; // «Играть» — честный новый прогон, грид запирается заново
    show('game');
    loadLevel(0);
    Platform.save({ ...state }); // сброс — тоже «обновился levelIndex», сохраняем сразу
  }
  function continueGame() {
    show('game');
    loadLevel(state.levelIndex);
  }
  btnPlay.addEventListener('click', startNewGame);
  btnContinue.addEventListener('click', continueGame);
  btnBack.addEventListener('click', () => {
    Stats.stop(); // ушли с уровня без победы — незавершённый отрезок не считаем
    show('menu');
    updateContinueVisibility();
  });

  /* Любой тап по игровому экрану — сигнал активности для таймера
     (Вариант Б, stats.js): выводит счёт из простоя, если он там стоял. */
  screens.game.addEventListener('pointerdown', () => Stats.onInput());

  /* п.1.6.2.7: над полем ПКМ/протяжка не должны открывать системное
     меню браузера (user-select уже погашен в CSS). */
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  /* ---------- Пауза при сворачивании (п.1.3) ---------- */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pauseGame();
    } else {
      resumeGame();
    }
  });

  /* ---------- Запуск ---------- */
  async function boot() {
    Board.init(boardCanvas);
    Confetti.init(confettiCanvas);
    Game.init(boardCanvas, showWinOverlay);

    await Platform.init();

    // Автоязык из SDK (п.2.14)
    setLanguage(Platform.getLang());

    // Восстановление прогресса (гостевой сейв платформы, ТОЛЬКО через
    // Platform.load — без localStorage и без прямых вызовов ysdk).
    // Нет сейва (первый запуск) → остаётся дефолт levelIndex 0.
    const saved = await Platform.load();
    if (saved && typeof saved.levelIndex === 'number') {
      Object.assign(state, saved);
    }
    // Граничный случай: сейв битый/уровней стало меньше, чем в сейве
    // (или игрок прошёл все уровни — levelIndex остаётся на последнем,
    // это НЕ выходит за границы массива) — подстраховка от краша.
    if (state.levelIndex < 0 || state.levelIndex >= LEVELS.length) {
      state.levelIndex = 0;
    }
    if (!Array.isArray(state.levelTimes)) state.levelTimes = [];
    if (typeof state.maxUnlocked !== 'number' || state.maxUnlocked < state.levelIndex) {
      state.maxUnlocked = state.levelIndex; // сейв старее этого поля — считаем открытым хотя бы то, что уже пройдено
    }
    if (state.maxUnlocked >= LEVELS.length) state.maxUnlocked = LEVELS.length - 1;
    updateContinueVisibility();
    applyMuteIcon();

    show('menu');

    // Game Ready — когда игра реально готова к взаимодействию (п.1.19.2)
    Platform.gameReady();
  }

  boot();
})();
