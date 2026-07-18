/* ============================================================
   vk_platform.js — адаптер ВК Bridge под контракт platform.js.
   Публичный интерфейс БАЙТ-В-БАЙТ идентичен platform.js (те же 7
   методов, те же имена и сигнатуры: init, gameReady, getLang, save,
   load, showInterstitial, showRewarded) — main.js/game.js не знают,
   какая платформа под капотом, ни одной правки в общем коде не
   требуется.

   Источник методов ВК Bridge — сверено с исходниками пакета
   @vkontakte/vk-bridge@3.0.2 (packages/core/src/types/data.ts,
   README пакета; репозиторий VKCOM/vk-bridge на GitHub), НЕ по
   памяти. dev.vk.com напрямую из этой сети недоступен (как и
   Cloudflare Pages — см. стандарты студии), сверка велась через
   npm-пакет и его исходный код.

   Вне ВК-клиента (локальная разработка) vkBridge нет — все методы
   тихо деградируют в mock, игра остаётся живой (тот же принцип,
   что в platform.js).

   РЕШЕНИЕ 2026-07-18 (живой тест основателя нашёл 2 дефекта, оба
   починены здесь):
   1. Кнопка подсказки (#btn-hint) БОЛЬШЕ НЕ прячется превентивно.
      Раньше init() дергал VKWebAppCheckNativeAds и прятал кнопку при
      false/таймауте — на ПК это ложно срабатывало (кнопки не было
      вообще), при этом реклама на ПК реально работала. Метод
      VKWebAppCheckNativeAds исторически нестабилен (баг-репорты
      VKCOM/vk-bridge) — доверять ему для превентивного скрытия
      нельзя. Раз монетизация будет подключена — кнопка теперь ВСЕГДА
      видима на всех точках входа (WebView/Web-iframe/m.vk.com),
      недоступность рекламы обрабатывается РЕАКТИВНО, в момент клика,
      внутри showRewarded() (см. ниже) — не заранее.
   2. showRewarded(): официальный контракт VKWebAppShowNativeAds не
      даёт отдельного сигнала «досмотрено» — только один Promise на
      весь показ (resolve/reject после закрытия, см. типы пакета).
      Это и есть штатное поведение, менять нечего — но на реальном
      мобильном WebView встречается известная нестабильность моста:
      сообщение о закрытии рекламы иногда не долетает обратно в JS,
      пока нативный оверлей рекламы перекрывал WebView (Promise висит
      вечно, ни .then ни .catch). Раньше это оставляло игрока в
      тупике: ролик отыгран, а onRewarded() не вызывался никогда.
      Чиним ДВУМЯ мерами: (а) щедрый таймаут-предохранитель на сам
      показ — если мост завис, всё равно не блокируем игрока вечно;
      (б) по студийному стандарту — недоступная/сорвавшаяся реклама
      выдаёт награду БЕСПЛАТНО, а не оставляет тупик. Итог: подсказка
      выдаётся и при штатном .then() (ролик реально досмотрен), и при
      .catch()/таймауте (мост сглючил или рекламы не было) — тупика
      не остаётся ни в одном сценарии.
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
  /* Предохранитель показа rewarded-рекламы — НЕ обычный путь, а
     страховка от зависшего моста (см. журнал выше, п.2). Ролики ВК
     обычно 15–30 с; 40 с — щедрый запас поверх этого плюс время на
     сам показ/закрытие, чтобы не обрубить ЗАКОННО идущий длинный
     ролик, но и не держать игрока в паузе вечно, если мост потерял
     сообщение о закрытии. */
  const REWARD_AD_TIMEOUT_MS = 40000;

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
    // Кнопка подсказки НЕ прячется здесь: VKWebAppCheckNativeAds
    // ненадёжен для превентивной проверки (см. журнал наверху, п.1) —
    // доступность рекламы обрабатывается реактивно, в showRewarded().
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

  /* Награда — при штатном .then() (ролик реально досмотрен) И при
     .catch()/таймауте (реклама не показалась, ошибка, или мост
     потерял сообщение о закрытии — известная нестабильность на части
     мобильных клиентов, см. журнал наверху). По студийному стандарту
     недоступная реклама выдаёт награду бесплатно — тупика для игрока
     здесь нет ни в одном исходе. finish() — единая точка выхода,
     settled защищает от двойного вызова (штатный ответ ПОСЛЕ того,
     как уже сработал таймаут-предохранитель). */
  function showRewarded(onRewarded, onPause, onResume) {
    if (!ready) {
      console.warn('[vk_platform] dev: rewarded → награда выдана');
      if (onRewarded) onRewarded();
      if (onResume) onResume();
      return;
    }
    if (onPause) onPause();
    let settled = false;
    const finish = (grantReward, reason) => {
      if (settled) return;
      settled = true;
      // Видимый эффект — строго после onResume(), как в platform.js.
      if (onResume) onResume();
      if (grantReward && onRewarded) onRewarded();
      console.log('[vk_platform] rewarded завершён:', reason, '| награда:', grantReward);
    };
    withTimeout(
      vkBridge.send('VKWebAppShowNativeAds', { ad_format: 'reward' }),
      REWARD_AD_TIMEOUT_MS
    )
      .then(() => finish(true, 'ролик закрыт (resolve)'))
      .catch((e) => {
        console.warn('[vk_platform] rewarded недоступна/зависла — выдаём подсказку бесплатно:', e);
        finish(true, 'ошибка/таймаут — выдано бесплатно');
      });
  }

  return { init, gameReady, getLang, save, load, showInterstitial, showRewarded };
})();
