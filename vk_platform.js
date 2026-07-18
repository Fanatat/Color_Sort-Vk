/* ============================================================
   vk_platform.js — адаптер ВК Bridge под контракт platform.js.
   Публичный интерфейс БАЙТ-В-БАЙТ идентичен platform.js (те же 7
   методов, те же имена и сигнатуры: init, gameReady, getLang, save,
   load, showInterstitial, showRewarded) — main.js/game.js не знают,
   какая платформа под капотом, ни одной правки в общем коде не
   требуется. Плюс ОДИН метод-расширение, которого в контракте
   Яндекса нет — isRewardedAvailable() (используется только внутри
   этого файла, main.js его не вызывает).

   Источник методов ВК Bridge — сверено 2026-07-17 с исходниками
   пакета @vkontakte/vk-bridge@3.0.2 (packages/core/src/types/data.ts,
   README пакета; репозиторий VKCOM/vk-bridge на GitHub), НЕ по
   памяти. dev.vk.com напрямую из этой сети недоступен (как и
   Cloudflare Pages — см. стандарты студии), сверка велась через
   npm-пакет и его исходный код.

   Вне ВК-клиента (локальная разработка) vkBridge нет — все методы
   тихо деградируют в mock, игра остаётся живой (тот же принцип,
   что в platform.js).
   ============================================================ */
const Platform = (() => {
  const SAVE_KEY = 'colorsort_save';
  /* Таймаут init подобран под ЖЕЛЕЗНОЕ правило студии: «платформа не
     отвечает» → меню за ≤3 с. Замер живого прогона: при 2500 мс меню
     появлялось за ~3060 мс (загрузка+парс бандла ~560 мс поверх
     таймаута) — впритык ЗА границу. 2000 мс даёт меню за ~2.6 с с
     запасом на медленные устройства, оставаясь в рамках «2–3 с» из
     глобального стандарта. VKWebAppInit — локальное рукопожатие с
     родительским фреймом (обычно <500 мс), поэтому 2000 мс не грозит
     ложным таймаутом на реальном, но медленном соединении ВК. */
  const INIT_TIMEOUT_MS = 2000;
  const CHECK_ADS_TIMEOUT_MS = 1500;

  let ready = false; // true только после успешного VKWebAppInit

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), ms);
      promise.then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); }
      );
    });
  }

  /* ---------- Инициализация ----------
     Обязательный таймаут (шрам Словохода b7): вне ВК-клиента
     VKWebAppInit не отвечает — без таймаута игра вечно висит на
     загрузке БЕЗ ошибок в консоли. При таймауте/ошибке — dev-режим,
     игра обязана дойти до меню. */
  async function init() {
    if (typeof vkBridge === 'undefined') {
      console.warn('[vk_platform] Bridge не найден — dev-режим (mock)');
      return false;
    }
    try {
      await withTimeout(vkBridge.send('VKWebAppInit'), INIT_TIMEOUT_MS);
      ready = true;
      console.log('[vk_platform] VK Bridge инициализирован');
    } catch (e) {
      console.error('[vk_platform] VKWebAppInit не ответил/ошибка:', e);
      return false;
    }
    // Прятание кнопки подсказки — по факту доступности рекламы, не
    // блокирует загрузку игры (не await). Мок всегда «отдаёт»
    // рекламу (стандарт студии) — эта ветка внутри if(ready), значит
    // в dev-режиме без Bridge вообще не выполняется, кнопка видна.
    hideHintIfAdsUnavailable();
    return true;
  }

  /* ---------- Game Ready ----------
     У ВК нет аналога LoadingAPI.ready() — метод-заглушка, чтобы
     main.js вызывал Platform.gameReady() без ветвления по площадке. */
  function gameReady() {}

  /* ---------- Язык ----------
     ВК-билд лочится на русский (вариант A, решение постановки):
     аудитория ВК русскоязычная, карточка игры тоже на русском —
     англ. браузер не должен расходиться с карточкой. */
  function getLang() {
    return 'ru';
  }

  /* ---------- Сохранение ----------
     VKWebAppStorageSet/Get, ключ colorsort_save. ВАЖНО (стандарт
     студии): объект сейва пишется ВСЕГДА ЦЕЛИКОМ — сюда прилетает
     уже готовый fullState из main.js, адаптер его не трогает,
     только сериализует. */
  async function save(fullState) {
    if (!ready) {
      console.warn('[vk_platform] dev-режим: сейв пропущен', fullState);
      return;
    }
    try {
      await vkBridge.send('VKWebAppStorageSet', {
        key: SAVE_KEY,
        value: JSON.stringify(fullState)
      });
    } catch (e) {
      console.error('[vk_platform] VKWebAppStorageSet ошибка:', e);
    }
  }

  async function load() {
    if (!ready) return null;
    try {
      const res = await vkBridge.send('VKWebAppStorageGet', { keys: [SAVE_KEY] });
      const entry = res.keys.find((k) => k.key === SAVE_KEY);
      // Пустая строка — штатный ответ ВК для отсутствующего ключа
      // (первый запуск, не битый сейв) — не пытаемся её парсить.
      if (!entry || !entry.value) return null;
      return JSON.parse(entry.value);
    } catch (e) {
      console.error('[vk_platform] VKWebAppStorageGet/парсинг ошибка:', e);
      return null;
    }
  }

  /* ---------- Реклама ----------
     В отличие от Яндекс SDK, ВК Bridge не даёт отдельного события
     «показ открылся» — один Promise на весь показ (resolve/reject
     после закрытия). onPause вызываем синхронно перед send() —
     функционально то же самое (пауза звука/геймплея перед роликом,
     снятие паузы после), просто без промежуточного колбэка от ВК. */
  function showInterstitial(onPause, onResume) {
    if (!ready) {
      console.warn('[vk_platform] dev: interstitial пропущен');
      if (onResume) onResume();
      return;
    }
    if (onPause) onPause();
    vkBridge.send('VKWebAppShowNativeAds', { ad_format: 'interstitial' })
      .then(() => { if (onResume) onResume(true); })
      .catch((e) => {
        console.error('[vk_platform] interstitial:', e);
        if (onResume) onResume(false);
      });
  }

  function showRewarded(onRewarded, onPause, onResume) {
    if (!ready) {
      console.warn('[vk_platform] dev: rewarded → награда выдана');
      if (onRewarded) onRewarded();
      if (onResume) onResume();
      return;
    }
    if (onPause) onPause();
    vkBridge.send('VKWebAppShowNativeAds', { ad_format: 'reward' })
      .then(() => {
        // Видимый эффект — строго после onResume(), как в platform.js.
        if (onResume) onResume();
        if (onRewarded) onRewarded();
      })
      .catch((e) => {
        console.error('[vk_platform] rewarded:', e);
        if (onResume) onResume();
      });
  }

  /* ---------- Расширение ТОЛЬКО для ВК-адаптера ----------
     В контракте Яндекса (7 методов выше) такого метода нет — main.js
     его не вызывает и не обязан про него знать. Используется только
     внутри этого файла для прятания #btn-hint. VKWebAppCheckNativeAds
     исторически нестабилен на части клиентов (известные баг-репорты
     VKCOM/vk-bridge) — при любой неопределённости отдаём false, это
     безопасный дефолт (кнопка скрыта — не тупик, игра решается и без
     подсказки по спеке). */
  async function isRewardedAvailable() {
    if (!ready) return false;
    try {
      const res = await withTimeout(
        vkBridge.send('VKWebAppCheckNativeAds', { ad_format: 'reward' }),
        CHECK_ADS_TIMEOUT_MS
      );
      return !!res.result;
    } catch (e) {
      console.warn('[vk_platform] VKWebAppCheckNativeAds недоступен:', e);
      return false;
    }
  }

  function hideHintIfAdsUnavailable() {
    isRewardedAvailable().then((available) => {
      if (available) return;
      const wrap = document.querySelector('.hint-wrap');
      if (wrap) wrap.classList.add('hidden');
    });
  }

  return { init, gameReady, getLang, save, load, showInterstitial, showRewarded, isRewardedAvailable };
})();
