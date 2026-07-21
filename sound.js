/* ============================================================
   sound.js — короткие звуки на Web Audio (без файлов, бандл лёгкий).
   Фаза 6. Единственная точка синтеза звука в игре.

   AudioContext создаётся ЛЕНИВО — на первый реальный вызов play*(),
   который случится не раньше первого клика игрока (браузеры блокируют
   автозапуск звука без пользовательского жеста). Отдельный «анлок»
   не нужен: создание контекста внутри обработчика клика само по себе
   и есть тот жест.

   suspend()/resume() — вызываются из pauseGame()/resumeGame() в
   main.js (реклама, сворачивание вкладки). state.muted проверяется
   на каждый play*() — если звук выключен, просто ничего не звучит.
   ============================================================ */
const Sound = (() => {
  let ctx = null;
  let muted = false;

  function ensureContext() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null; // нет Web Audio — тихо деградируем, игра живая
      ctx = new AC();
    }
    ctx.resume(); // безопасно и при уже 'running' — браузер делает no-op
    return ctx;
  }

  function setMuted(value) {
    muted = value;
  }

  // suspend()/resume() на AudioContext безопасны в любом состоянии —
  // браузер сам делает их no-op, если действие не требуется. Проверка
  // по .state тут вредна: он обновляется АСИНХРОННО после resume(),
  // из-за чего suspend() мог не срабатывать, если состояние ещё не
  // успело перейти в 'running' к моменту вызова.
  function suspend() {
    if (ctx) ctx.suspend();
  }
  function resume() {
    if (ctx) ctx.resume();
  }

  /* ---------- Один короткий тон (строительный блок всех звуков) ---------- */
  function tone({ freq, duration, type = 'sine', gain = 0.15, delay = 0, freqEnd = null }) {
    if (muted) return;
    const audioCtx = ensureContext();
    if (!audioCtx) return;

    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.type = type;

    const t0 = audioCtx.currentTime + delay;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + duration);
    }
    gainNode.gain.setValueAtTime(0, t0);
    gainNode.gain.linearRampToValueAtTime(gain, t0 + 0.012);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  /* ---------- Игровые звуки ---------- */
  function playPour() {
    tone({ freq: 520, freqEnd: 380, duration: 0.14, type: 'sine', gain: 0.12 });
  }
  function playSettle() {
    tone({ freq: 300, freqEnd: 160, duration: 0.09, type: 'triangle', gain: 0.14 });
  }
  function playInvalid() {
    tone({ freq: 180, duration: 0.16, type: 'square', gain: 0.05 });
  }
  function playWin() {
    // Заметная, но короткая «ta-da»: восходящее арпеджио (C5-E5-G5-C6)
    // + финальный мажорный аккорд на более тёплой (triangle) волне.
    // Всё укладывается меньше чем в секунду — антистресс-темп сохранён,
    // просто момент теперь читается как награда, а не тихий бип.
    const arpeggio = [523.25, 659.25, 783.99, 1046.5];
    arpeggio.forEach((freq, i) => {
      tone({ freq, duration: 0.16, type: 'sine', gain: 0.13, delay: i * 0.07 });
    });
    const chordDelay = arpeggio.length * 0.07 + 0.02;
    [523.25, 659.25, 783.99].forEach(freq => {
      tone({ freq, duration: 0.5, type: 'triangle', gain: 0.11, delay: chordDelay });
    });
  }
  function playClick() {
    tone({ freq: 700, duration: 0.05, type: 'sine', gain: 0.07 });
  }
  /* Экран завершения ВСЕЙ кампании (не отдельного уровня) — тот же
     язык, что и playWin, но шире и с более длинным финальным
     аккордом: разовый момент заслуживает более заметную награду. */
  function playFanfare() {
    const arpeggio = [523.25, 659.25, 783.99, 1046.5, 1318.51];
    arpeggio.forEach((freq, i) => {
      tone({ freq, duration: 0.18, type: 'sine', gain: 0.13, delay: i * 0.08 });
    });
    const chordDelay = arpeggio.length * 0.08 + 0.02;
    [523.25, 659.25, 783.99, 1046.5].forEach(freq => {
      tone({ freq, duration: 0.8, type: 'triangle', gain: 0.1, delay: chordDelay });
    });
  }

  return { setMuted, suspend, resume, playPour, playSettle, playInvalid, playWin, playClick, playFanfare };
})();
