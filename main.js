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
    shop:    document.getElementById('screen-shop'),
    game:    document.getElementById('screen-game')
  };

  /* DEV_UNLOCK_ALL — из dev_flags.js, который НЕ грузится в билде
     площадки (build.py вырезает и файл, и тег — см. CLAUDE.md
     «УПАКОВКА»). typeof-проверка: в проде переменной физически нет. */
  const devUnlockAll = typeof DEV_UNLOCK_ALL !== 'undefined' && DEV_UNLOCK_ALL === true;

  const btnPlay     = document.getElementById('btn-play');
  const btnLevels   = document.getElementById('btn-levels');
  const btnGridBack = document.getElementById('btn-grid-back');
  const levelGridEl = document.getElementById('level-grid');
  const btnBack     = document.getElementById('btn-back');
  const btnNext     = document.getElementById('btn-next');
  const btnHint     = document.getElementById('btn-hint');
  const soundBtns   = document.querySelectorAll('#btn-sound, #btn-sound-game');
  const boardCanvas = document.getElementById('board-canvas');
  const boardWrap   = document.getElementById('board-wrap');
  const gameHeader  = document.querySelector('#screen-game .game-header');
  const winOverlay  = document.getElementById('win-overlay');
  const winProgressFill  = document.getElementById('win-progress-fill');
  const winProgressLabel = document.getElementById('win-progress-label');
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

  /* Экран завершения ГЛАВЫ (каждые CHAPTER_SIZE уровней, кроме
     последнего уровня массива — там срабатывает финал выше). Легче
     финального: короче конфетти, без фанфары — см. showChapterCompleteOverlay. */
  const CHAPTER_SIZE     = 12;
  const chapterOverlay      = document.getElementById('chapter-overlay');
  const btnChapterNext      = document.getElementById('btn-chapter-next');
  const chapterTitleEl      = document.getElementById('chapter-title');
  const chapterStatTotalEl   = document.getElementById('chapter-stat-total');
  const chapterStatAverageEl = document.getElementById('chapter-stat-average');
  const chapterStatFastestEl = document.getElementById('chapter-stat-fastest');
  const chapterStatSlowestEl = document.getElementById('chapter-stat-slowest');

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
    maxUnlocked: 0,
    themeOwned: false,
    // Задача 11: суточный лимит показов rewarded (рекомендация доки ВК,
    // защита от накрутки). rewardedDay — календарная дата ('YYYY-MM-DD',
    // ЛОКАЛЬНАЯ, не UTC) последнего засчитанного показа; rewardedCount
    // обнуляется, как только текущая дата отличается от rewardedDay —
    // см. checkRewardedDailyReset(). Добавляет ~20 байт к сейву, лимит
    // (~2236Б, см. память студии) не под угрозой.
    rewardedCount: 0,
    rewardedDay: ''
  };

  function isLevelUnlocked(idx) {
    return devUnlockAll || idx <= state.maxUnlocked;
  }

  /* ---------- Магазин / Косметика (Task C, ЗАДАЧА_..._VK.md) ----------
     ПЕРЕСМОТРЕНО на переподачу 2026-07-26 (Задача 4 → Задача 7):
     покупка (Platform.buyCosmetic, VKWebAppShowOrderBox) остаётся
     ОТКЛЮЧЕНА флагом COSMETIC_SHOP_ENABLED_VK в vk_platform.js —
     сервер-колбэка для подтверждения транзакции у студии нет (см.
     комментарий у флага там). Вместо покупки — превью: клик красит
     колбы визуально, НЕ персистится (state.themeOwned не трогаем,
     Platform.save не вызываем), выход в меню и перезагрузка возвращают
     исходную палитру. Board.COLORS (board.js) — обычный мутируемый
     объект, читается на каждой отрисовке (ctx.fillStyle =
     COLORS[el.color]) — подмена/откат применяются без единой правки
     board.js.
     Задача 7: промо убрано из меню в отдельную вкладку «Магазин».
     SHOP_ITEMS — список тем, рассчитанный на рост ассортимента (сейчас
     одна позиция) — renderShop() строит DOM из массива, не хардкодит
     разметку одной темы. Доступность самой вкладки — флаг адаптера
     Platform.COSMETIC_PREVIEW_VK (типа AD_LEVELS_INTERVAL выше:
     платформенное решение живёт в адаптере, main.js площадку не
     знает) — на Яндексе не экспортирован, там фичи физически нет.
     Разблокировка КОНКРЕТНОЙ темы внутри магазина — по unlockLevel
     позиции (диапазон ТЗ 2-5 для морской темы), не самой вкладки —
     вкладка «Магазин» есть в меню всегда (на ВК), пуста до разблокировки
     первой темы. */
  const ORIGINAL_THEME = { ...Board.COLORS }; // снимок ДО любых мутаций — превью обратимо
  /* Морская палитра — та же правка светлоты, что у Board.COLORS (задача
     5): бирюзовый/зелёный раньше читались почти одинаково тёмными.
     Разрывы (grayscale-лума): c3→c1 31.9%, c1→c2 27.2% — оба ≥25%. */
  const SHOP_ITEMS = [
    {
      id: 'sea_theme',
      labelKey: 'shopSeaThemeLabel',
      theme: { c1: '#3a8891', c2: '#8fd0a0', c3: '#16232e' },
      unlockLevel: 3
    }
  ];

  const btnShop      = document.getElementById('btn-shop');
  const btnShopBack  = document.getElementById('btn-shop-back');
  const shopListEl   = document.getElementById('shop-list');
  const shopEmptyEl  = document.getElementById('shop-empty');
  const shopDots     = [1, 2, 3].map(n => document.getElementById(`shop-current-dot-${n}`));

  function applyCosmeticTheme(theme) {
    Object.assign(Board.COLORS, theme);
  }
  function revertCosmeticTheme() {
    Object.assign(Board.COLORS, ORIGINAL_THEME);
  }

  /* Кнопка «Магазин» в меню — гейтится ТОЛЬКО наличием фичи у площадки
     (Platform.COSMETIC_PREVIEW_VK), не прогрессом: сама вкладка видна
     всегда на ВК, содержимое внутри гейтится по каждой теме отдельно. */
  function updateShopButtonVisibility() {
    if (!btnShop) return;
    btnShop.classList.toggle('hidden', !Platform.COSMETIC_PREVIEW_VK);
  }

  /* Живой индикатор «превью видно не выходя из магазина» (критерий
     приёмки задачи 7) — читает ТЕКУЩИЙ Board.COLORS (не список тем),
     обновляется сразу после клика «Посмотреть», без перехода на другой
     экран. */
  function refreshShopCurrentPreview() {
    const keys = ['c1', 'c2', 'c3'];
    shopDots.forEach((dot, i) => { if (dot) dot.style.background = Board.COLORS[keys[i]]; });
  }

  function renderShop() {
    if (!shopListEl) return;
    shopListEl.innerHTML = '';
    const unlockedItems = SHOP_ITEMS.filter(item => state.maxUnlocked >= item.unlockLevel);
    shopEmptyEl.classList.toggle('hidden', unlockedItems.length > 0);
    unlockedItems.forEach(item => {
      const row = document.createElement('div');
      row.className = 'shop-item';

      /* Задача 10: было 3 абстрактных кружка (.cosmetic-dot) — заменено
         на узнаваемый мини-макет колбы (тот же силуэт, что рисует
         board.js — скруглённое дно, открытый верх) с 3 стопкой фигур
         круг/квадрат/круг в цветах темы, чтобы было видно, КАК это
         будет выглядеть в игре, а не абстрактную палитру. Под макетом —
         некликабельная кнопка «Скоро…» (сама покупка ещё не подключена,
         см. vk_platform.js COSMETIC_SHOP_ENABLED_VK) — даёт понять, что
         тема будет продаваться, не обещая рабочую кнопку. */
      const previewCol = document.createElement('div');
      previewCol.className = 'shop-item-previewcol';

      const vial = document.createElement('div');
      vial.className = 'shop-vial-preview';
      vial.setAttribute('aria-hidden', 'true');
      const shapes = ['circle', 'square', 'circle'];
      ['c1', 'c2', 'c3'].forEach((k, i) => {
        const el = document.createElement('span');
        el.className = `shop-vial-el ${shapes[i]}`;
        el.style.background = item.theme[k];
        vial.appendChild(el);
      });

      const soonBtn = document.createElement('button');
      soonBtn.type = 'button';
      soonBtn.className = 'shop-item-soon';
      soonBtn.disabled = true; // некликабельная — товар в кабинете ВК ещё не подключён
      soonBtn.setAttribute('aria-disabled', 'true');
      soonBtn.setAttribute('data-i18n', 'comingSoon');
      soonBtn.textContent = t('comingSoon');

      previewCol.appendChild(vial);
      previewCol.appendChild(soonBtn);

      const info = document.createElement('div');
      info.className = 'shop-item-info';
      const labelEl = document.createElement('span');
      labelEl.className = 'cosmetic-label';
      labelEl.setAttribute('data-i18n', item.labelKey);
      labelEl.textContent = t(item.labelKey);
      const captionEl = document.createElement('span');
      captionEl.className = 'shop-item-caption';
      captionEl.setAttribute('data-i18n', 'shopPreviewCaption');
      captionEl.textContent = t('shopPreviewCaption');
      info.appendChild(labelEl);
      info.appendChild(captionEl);

      const btn = document.createElement('button');
      btn.className = 'btn shop-item-btn';
      btn.setAttribute('data-i18n', 'cosmeticPreview');
      btn.textContent = t('cosmeticPreview');
      btn.addEventListener('click', () => {
        applyCosmeticTheme(item.theme);
        refreshShopCurrentPreview(); // видно сразу здесь, без выхода из магазина
      });

      row.appendChild(previewCol);
      row.appendChild(info);
      row.appendChild(btn);
      shopListEl.appendChild(row);
    });
  }

  if (btnShop) {
    btnShop.addEventListener('click', () => {
      show('shop');
      renderShop();
      refreshShopCurrentPreview();
    });
  }
  if (btnShopBack) {
    btnShopBack.addEventListener('click', () => {
      revertCosmeticTheme(); // превью не персистится — выход в меню возвращает исходную палитру
      show('menu');
    });
  }

  function show(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
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
     подбирают наибольший размер, при котором помещается МАКСИМУМ
     строк без переполнения по ширине. Если ни при каком числе колонок
     тайл не дотягивает до MIN_TILE (156 плиток на узком экране) —
     сетка становится выше экрана и скроллится ВНУТРИ #grid-wrap
     (overflow-y:auto в style.css), страница (html,body) по-прежнему
     не скроллится (стандарт студии, шрам ВК-порта: 100vh раздувает
     iframe площадки — см. журнал). Решение основателя (вариант A):
     вертикальный скролл + подмотка к текущему уровню, не карта глав
     и не страницы. */
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
    // MIN_TILE поднят с 26 до 36 (решение основателя, п.1.8 требований
    // площадки): 26px (~4мм) заметно ниже отраслевых ориентиров
    // 44pt/48dp для минимальной цели касания — риск промаха/усталости
    // пальца на 156 плитках. Шрифт номера уже привязан к tilePx
    // (см. ниже) — с ростом MIN_TILE читаемость растёт вместе с ним,
    // отдельно трогать не нужно.
    const MIN_TILE = 36;
    const MAX_TILE = 60;

    let bestTile = MIN_TILE, bestCols = count, fitsWithoutScroll = false;
    for (let cols = 1; cols <= count; cols++) {
      const rows = Math.ceil(count / cols);
      const tileW = (cssW - GAP * (cols - 1)) / cols;
      const tileH = (cssH - GAP * (rows - 1)) / rows;
      const tile = Math.min(tileW, tileH, MAX_TILE);
      if (tile > bestTile) { bestTile = tile; bestCols = cols; fitsWithoutScroll = true; }
    }

    let tilePx;
    if (fitsWithoutScroll) {
      tilePx = Math.max(MIN_TILE, Math.floor(bestTile));
    } else {
      // Ни одна раскладка не даёт тайл больше MIN_TILE в пределах
      // высоты экрана (156 плиток на узком экране) — подбираем колонки
      // ТОЛЬКО по ширине, высоту не учитываем. Сетка становится выше
      // экрана — это нормально, #grid-wrap скроллит её внутри себя.
      bestCols = Math.min(count, Math.max(1, Math.floor((cssW + GAP) / (MIN_TILE + GAP))));
      tilePx = MIN_TILE;
    }
    levelGridEl.style.gridTemplateColumns = `repeat(${bestCols}, ${tilePx}px)`;
    levelGridEl.style.gridAutoRows = `${tilePx}px`;
    levelGridEl.style.fontSize = Math.max(10, Math.floor(tilePx * 0.4)) + 'px';
  }

  /* Подмотка сетки к текущему уровню — примерно на трети высоты
     контейнера сверху, не впритык к краю (решение основателя, вариант
     A). Считается вручную через getBoundingClientRect (НЕ scrollIntoView
     — шрам Словохода: scrollIntoView молча не срабатывает, если
     контейнер ещё display:none/нулевой высоты). Если высота нулевая —
     это ошибка вызова (экран должен быть уже показан и отрисован),
     проговариваем в консоль, а не проглатываем молча. */
  function scrollGridToCurrent() {
    const wrap = document.getElementById('grid-wrap');
    if (wrap.clientHeight === 0) {
      console.error('[grid] scrollGridToCurrent: контейнер сетки имеет нулевую высоту — подмотка невозможна (вызвано до показа экрана?)');
      return;
    }
    const tiles = levelGridEl.querySelectorAll('.grid-tile');
    const currentTile = tiles[state.levelIndex];
    if (!currentTile) return;
    const wrapRect = wrap.getBoundingClientRect();
    const tileRect = currentTile.getBoundingClientRect();
    const tileCenterInScroll = wrap.scrollTop + (tileRect.top - wrapRect.top) + tileRect.height / 2;
    const targetScrollTop = tileCenterInScroll - wrap.clientHeight / 3;
    const maxScrollTop = wrap.scrollHeight - wrap.clientHeight;
    wrap.scrollTop = Math.max(0, Math.min(targetScrollTop, maxScrollTop));
  }

  btnLevels.addEventListener('click', () => {
    show('grid');
    syncHeaderSpace();
    renderGrid();
    scrollGridToCurrent();
  });
  btnGridBack.addEventListener('click', () => {
    revertCosmeticTheme(); // превью не персистится — выход в меню возвращает исходную палитру
    show('menu');
  });

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
     Оба условия вместе, чтобы не докучать рекламой аудитории 35+.
     Каданс — платформенное решение (main.js площадку не знает, см.
     CLAUDE.md): читаем из Platform.AD_LEVELS_INTERVAL/AD_MIN_GAP_MS,
     если адаптер их не экспортирует (Яндекс, platform.js) — дефолт
     раз в 3 уровня / 90с, как и было. ВК-адаптер (vk_platform.js,
     решение основателя 2026-07-26) переопределяет на раз в 4 уровня /
     120с — реже, тише для той же аудитории. */
  const AD_LEVELS_INTERVAL = Platform.AD_LEVELS_INTERVAL || 3;
  const AD_MIN_GAP_MS = Platform.AD_MIN_GAP_MS || 90000;
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

  /* ---------- Суточный лимит rewarded (задача 11) ----------
     30 показов/сутки — рекомендация доки ВК, защита от накрутки.
     Сутки — КАЛЕНДАРНЫЕ по локальному времени устройства (не UTC и не
     скользящее окно 24ч) — простая, предсказуемая для игрока модель. */
  const REWARDED_DAILY_LIMIT = 30;
  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function checkRewardedDailyReset() {
    const today = todayKey();
    if (state.rewardedDay !== today) {
      state.rewardedDay = today;
      state.rewardedCount = 0;
    }
  }

  btnHint.addEventListener('click', () => {
    const hint = Game.findHint();
    if (!hint) {
      showHintToast(); // мягкое сообщение — ролик не показываем зря
      return;
    }
    checkRewardedDailyReset();
    if (state.rewardedCount >= REWARDED_DAILY_LIMIT) {
      // Лимит исчерпан — подсказка ВСЁ РАВНО бесплатна, БЕЗ попытки
      // показа рекламы (стандарт п.190: недоступная реклама не тупик;
      // здесь недоступность не техническая, а по лимиту, но принцип
      // тот же). Кнопка НЕ прячется — просто эта конкретная подсказка
      // тихо идёт по бесплатному пути, как при adblock/отсутствии филла.
      Board.showHint(hint.from, hint.to);
      return;
    }
    state.rewardedCount++;
    Platform.save({ ...state }); // полный объект — считаем показ сразу, не дожидаясь колбэка рекламы
    Platform.showRewarded(
      () => Board.showHint(hint.from, hint.to), // награда получена — подсвечиваем ход
      pauseGame,
      resumeGame
    );
  });

  /* ---------- Победа / переход уровней ----------
     pendingWinTransition — что делать по клику «Дальше», решено ЗДЕСЬ,
     в момент победы, а не пересчитано заново в обработчике клика. Это
     не стиль, а необходимость (см. краевой случай ниже, фаза 3): для
     обычного перехода state.levelIndex продвигается уже в
     showWinOverlay(), и если бы btnNext пересчитывал «какой уровень
     следующий» из ТЕКУЩЕГО state.levelIndex в момент клика, он бы
     получил уже сдвинутое значение и промахнулся на один уровень
     вперёд. */
  let pendingWinTransition = null;

  function showWinOverlay() {
    // Активное время уровня (Вариант Б, stats.js) фиксируется РОВНО в
    // момент победы — до этого таймер нигде не показывается игроку.
    const seconds = Stats.finishLevel();
    const finishedIdx = state.levelIndex; // 0-индексный, только что пройденный
    state.levelTimes[finishedIdx] = seconds;

    const finishedLevelNumber = finishedIdx + 1;
    const nextIdx = finishedIdx + 1;
    const isChapterEnd = finishedLevelNumber % CHAPTER_SIZE === 0;
    const isCampaignEnd = nextIdx >= LEVELS.length;
    pendingWinTransition = { nextIdx, isChapterEnd, isCampaignEnd, chapterNum: finishedLevelNumber / CHAPTER_SIZE };

    // Полоса прогресса главы: N из 12, N = позиция ВНУТРИ текущей главы
    // (1..12), из levelIndex — новых полей сейва не заводим.
    const posInChapter = ((finishedLevelNumber - 1) % CHAPTER_SIZE) + 1;
    winProgressFill.style.width = (posInChapter / CHAPTER_SIZE * 100) + '%';
    winProgressLabel.textContent = `${posInChapter} ${t('of')} ${CHAPTER_SIZE}`;

    /* КРАЕВОЙ СЛУЧАЙ (задача фаза 3): точка «Продолжить» продвигается
       ЗДЕСЬ, в момент завершения уровня — не по клику «Дальше» и не по
       факту предзагрузки следующего. Иначе выход в меню/перезагрузка
       страницы с этого экрана (до клика «Дальше») вернули бы игрока на
       ТОЛЬКО ЧТО пройденный уровень (state.levelIndex ещё не сдвинут) —
       он решал бы пройденный уровень заново (не «пропуск», но и не
       корректное продолжение). Сдвигаем levelIndex/maxUnlocked и
       сохраняем ПОЛНЫЙ объект одним действием — это и есть «сейв по
       факту завершения уровня». ТОЛЬКО для обычного перехода: глава/
       финал остаются как есть (их продвижение — штатная логика
       goToNextLevel/loadLevel по клику «Дальше» на СВОИХ оверлеях).
       ПЕРЕСМОТРЕНО (задача 8): Board.setLevel(LEVELS[nextIdx]) здесь
       БОЛЬШЕ НЕ ВЫЗЫВАЕТСЯ — раньше следующий уровень отрисовывался
       ПОД оверлеем победы, пока ещё летит конфетти, и игрок видел
       смену поля до того, как понял, что уровень сменился. Канвас
       остаётся на ТОЛЬКО ЧТО пройденном (собранном) уровне до самого
       клика «Дальше»; фактическая смена данных — в loadLevel(), внутри
       goToNextLevel(), с видимым fade-переходом (см. ниже). */
    if (!isChapterEnd && !isCampaignEnd) {
      state.levelIndex = nextIdx;
      state.maxUnlocked = Math.max(state.maxUnlocked, nextIdx);
    }

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

  /* Те же 4 цифры, но СРЕЗ ТОЛЬКО по уровням этой главы (CHAPTER_SIZE
     штук) — chapterNum считается от 1 (глава 1 = уровни 1-12). Ничего
     нового в сейве не заводим: и это, и computeCampaignStats читают
     один и тот же state.levelTimes[]. */
  function computeChapterStats(chapterNum) {
    const startIdx = (chapterNum - 1) * CHAPTER_SIZE;
    const endIdx = startIdx + CHAPTER_SIZE;
    const times = state.levelTimes.slice(startIdx, endIdx).filter(v => typeof v === 'number' && v >= 0);
    const total = times.reduce((a, b) => a + b, 0);
    const average = times.length ? total / times.length : 0;
    const fastest = times.length ? Math.min(...times) : 0;
    const slowest = times.length ? Math.max(...times) : 0;
    return { total, average, fastest, slowest };
  }

  function hideChapterOverlay() {
    chapterOverlay.classList.add('hidden');
  }

  /* Экран «Глава N пройдена» — вызывается из btnNext ПЕРЕД переходом на
     следующий уровень (сам win-overlay уровня, showWinOverlay выше, не
     трогаем и не меняем — это отдельный, более лёгкий оверлей поверх
     той же механики паузы/сохранения). Фанфары нет (эксклюзив финала,
     решение постановки), конфетти короче (см. confetti.js opts). */
  function showChapterCompleteOverlay(chapterNum) {
    hideWinOverlay();
    const stats = computeChapterStats(chapterNum);
    chapterTitleEl.textContent = `${t('chapter')} ${chapterNum} ${t('chapterComplete')}`;
    chapterStatTotalEl.textContent = formatTime(stats.total);
    chapterStatAverageEl.textContent = formatTime(stats.average);
    chapterStatFastestEl.textContent = formatTime(stats.fastest);
    chapterStatSlowestEl.textContent = formatTime(stats.slowest);
    chapterOverlay.classList.remove('hidden');
    Sound.playChapterWin(); // задача 9: чуть богаче обычного playWin, короче playFanfare
    Confetti.burst({ count: 18, durationMs: 1200 }); // короче и реже финальных — глава легче
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
    revertCosmeticTheme(); // превью не персистится — выход в меню возвращает исходную палитру
    show('menu');
  });

  /* ---------- Fade-переход между уровнями (задача 8) ----------
     Смена данных уровня (loadLevel → Board.setLevel) физически
     происходит ПОСРЕДИ короткого fade-out, пока канвас уже невидим —
     игрок не видит момент подмены, только плавное затемнение старого
     поля и появление нового. BOARD_FADE_MS — половина общего перехода
     (CSS-transition той же длительности на возврат класса) — итог
     около 2×180=360мс, в диапазоне ~300-400мс из ТЗ. Спешить некуда
     (решение основателя) — задержка не про производительность. */
  const BOARD_FADE_MS = 180;

  /* Общий переход «на следующий уровень» — используется и обычным
     btnNext (см. ниже), и кнопкой «Дальше» экрана главы. */
  function goToNextLevel(nextIdx) {
    hideWinOverlay();
    hideChapterOverlay();
    boardWrap.classList.add('board-fade');
    setTimeout(() => {
      // Interstitial (с кулдауном) — в паузе ПОСЛЕ оверлея, ДО загрузки уровня.
      maybeShowInterstitial(() => {
        loadLevel(nextIdx);
        // Точка сохранения (Фаза 4): levelIndex обновился — прогресс продвинулся.
        // НЕ сохраняем на каждый ход/кадр — только на переходе уровня и звуке.
        Platform.save({ ...state });
        // Убираем класс на следующем кадре — иначе браузер может схлопнуть
        // add+remove в один рендер и transition не проиграется.
        requestAnimationFrame(() => boardWrap.classList.remove('board-fade'));
      });
    }, BOARD_FADE_MS);
  }

  btnNext.addEventListener('click', () => {
    // Решение принято в showWinOverlay() (см. pendingWinTransition
    // выше) — не пересчитываем заново из state.levelIndex, он для
    // обычного перехода уже продвинут к этому моменту.
    const transition = pendingWinTransition;
    pendingWinTransition = null;
    if (!transition) return; // защита: клик без предшествующего showWinOverlay быть не должен
    if (transition.isCampaignEnd) {
      // Кампания пройдена целиком — экран завершения вместо тихого
      // возврата в меню (levelIndex остаётся на последнем уровне,
      // сохранён уже в showWinOverlay). Проверяется ПЕРВЫМ — уровень
      // 156 кратен CHAPTER_SIZE, но здесь это финал, не глава.
      showCampaignCompleteOverlay();
      return;
    }
    if (transition.isChapterEnd) {
      showChapterCompleteOverlay(transition.chapterNum);
      return;
    }
    goToNextLevel(transition.nextIdx);
  });

  btnChapterNext.addEventListener('click', () => {
    goToNextLevel(state.levelIndex + 1);
  });

  /* ---------- Кнопки меню ----------
     «Играть» — единственный вход в игру, ведёт на state.levelIndex
     (бывшее поведение «Продолжить»). Решение основателя: путь,
     стирающий прогресс без подтверждения, из UI убран целиком —
     отдельной кнопки «Продолжить»/сброса больше нет. */
  function playGame() {
    show('game');
    loadLevel(state.levelIndex);
  }
  btnPlay.addEventListener('click', playGame);
  btnBack.addEventListener('click', () => {
    Stats.stop(); // ушли с уровня без победы — незавершённый отрезок не считаем
    revertCosmeticTheme(); // превью не персистится — выход в меню возвращает исходную палитру
    show('menu');
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
    if (typeof state.rewardedCount !== 'number' || state.rewardedCount < 0) state.rewardedCount = 0;
    if (typeof state.rewardedDay !== 'string') state.rewardedDay = '';
    checkRewardedDailyReset(); // сейв мог пролежать со вчера — обнулить счётчик при заходе в новый день
    updateShopButtonVisibility();
    applyMuteIcon();

    show('menu');

    // Game Ready — когда игра реально готова к взаимодействию (п.1.19.2)
    Platform.gameReady();
  }

  boot();
})();
