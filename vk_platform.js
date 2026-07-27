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

   РЕШЕНИЕ 2026-07-18 (продолжение — второй живой тест основателя):
   на ПК подсказка после рекламы видна, на телефоне — ролик закрыт
   штатно, Promise резолвится нормально, но подсветка не появляется.
   Дело НЕ в rewarded-потоке (он уже чинился выше) — дело в ТАЙМИНГЕ
   вызова onRewarded() относительно фактического возврата экрана.
   Board.showHint(from, to) (board.js, общий код — не трогаем) берёт
   t0 = performance.now() СИНХРОННО в момент вызова и отсчитывает
   2200мс РЕАЛЬНОГО времени через requestAnimationFrame. На мобильном
   WebView нативный рекламный оверлей может приостанавливать rAF, пока
   висит поверх страницы; onRewarded() у нас срабатывал СРАЗУ по
   resolve Promise — то есть в тот момент, когда оверлей ТОЛЬКО
   начинает закрываться, а не когда экран уже реально виден. Если
   первый кадр анимации добирается до rAF с опозданием (пока rAF был
   на паузе), t0 давно в прошлом — на первом же реальном кадре t уже
   ≥ 1, и showHint() гасит подсказку, ПОКАЗАВ её ноль раз. На ПК
   нативного оверлея нет, rAF не приостанавливается — поэтому там
   всё видно. Чиним ТОЛЬКО в адаптере: перед вызовом onRewarded()
   ждём подтверждённой видимости страницы (+ пару кадров сверху, чтобы
   рендер-цикл гарантированно ожил) и на всякий случай форсируем
   Board.resize() — если WebView успел поменять размеры (адресная
   строка/safe-area) пока был перекрыт рекламой, подсказка не должна
   рисоваться по устаревшим координатам. Board.resize() — уже
   ПУБЛИЧНЫЙ метод board.js (тот же, что дёргается на window resize/
   orientationchange), просто вызываем его из адаптера — код board.js
   не редактируется. ТРЕБУЕТ ПОДТВЕРЖДЕНИЯ ЖИВЫМ ТЕСТОМ НА ТЕЛЕФОНЕ —
   в песочнице (Playwright) нет способа сымитировать нативный
   рекламный оверлей ВК и его влияние на visibilitychange/rAF, только
   логика и синтетические сценарии проверены здесь.
   ============================================================ */
const Platform = (() => {
  const SAVE_KEY = 'colorsort_save';
  /* РЕШЕНИЕ 2026-07-26 (основатель): вызовы рекламы ВК Bridge
     (баннер/interstitial/rewarded) идут БЕЗУСЛОВНО — не гадаем заранее,
     подключены ли ads-юниты в кабинете ВК, а просто вызываем API и
     доверяем catch-обработчикам ниже (они и раньше существовали и
     проверены — см. showBannerAd/showInterstitial/showRewarded): сбой
     вызова (юнит не настроен, сетевая ошибка) — задокументированный
     ожидаемый исход для этих методов пакета @vkontakte/vk-bridge, а не
     регрессия, и ни один catch не роняет игру (баннер — тихий
     console.error без колбэка; interstitial — onResume(false), геймплей
     разблокируется тем же кодом, что и при успехе; rewarded — награда
     выдаётся всё равно, студийный стандарт «недоступная реклама не
     оставляет тупик»). Флаг оставлен как ручной аварийный выключатель
     (переключить на false), а не удалён — если модерация или сам ВК
     Bridge потребуют временно откатиться на «не пытаться показывать»,
     это одна строка, а не восстановление кода из истории git.
     Раньше (до 26.07) флаг был false «до подключения юнитов в
     кабинете» — это ручное решение отменено этой правкой: юниты либо
     уже подключены, либо результат вызова(успех/сбой) сам расскажет
     через catch, без необходимости знать это заранее. */
  const ADS_CONNECTED_VK = true;
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
  /* Тот же предохранитель, для interstitial — тот же нативный API
     (VKWebAppShowNativeAds), та же документированная нестабильность
     моста (см. журнал выше). Раньше showInterstitial() не был обёрнут
     в withTimeout — если Promise зависал, onResume() не вызывался
     НИКОГДА, goToNextLevel() (main.js) не доходил до loadLevel(), и
     игрок оставался запертым на оверлее победы/главы навсегда — живой
     Playwright-тест (зависший мок VKWebAppShowNativeAds) воспроизвёл
     именно это. Значение то же, что у rewarded — общий показ той же
     API, тот же ожидаемый диапазон длительности ролика. */
  const INTERSTITIAL_AD_TIMEOUT_MS = 40000;
  /* Страховка ожидания видимости после закрытия рекламного оверлея
     (см. журнал выше, второе решение). НЕ про сам показ рекламы —
     это отдельная, короткая пауза ПОСЛЕ того, как Promise уже
     разрешился, на случай если document.visibilitychange по какой-то
     причине не придёт (не все нативные оверлеи гарантированно её
     шлют) — тогда просто продолжаем, не блокируя награду вечно. */
  const VISIBILITY_WAIT_TIMEOUT_MS = 3000;
  /* Каданс interstitial (Task 3, ЗАДАЧА VK-переподачи 2026-07-26):
     реже, чем дефолт main.js (раз в 3 уровня / 90с) — раз в 4 уровня /
     120с. main.js читает эти поля через Platform.AD_LEVELS_INTERVAL/
     AD_MIN_GAP_MS (типа buyCosmetic выше — платформенное решение живёт
     в адаптере, не в общем коде); Яндекс-сборка (platform.js) их не
     экспортирует — там каданс остаётся прежним. */
  const AD_LEVELS_INTERVAL = 4;
  const AD_MIN_GAP_MS = 120000;

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

  /* Ждём, пока страница ГАРАНТИРОВАННО видима, и добавляем два тика
     requestAnimationFrame сверху — не просто дождаться флага
     document.visibilityState, а дать рендер-циклу реально возобновить
     работу (флаг может смениться на кадр раньше, чем rAF снова начнёт
     тикать регулярно). Нужно ТОЛЬКО чтобы Board.showHint() (общий
     код) стартовал свой 2200мс wall-clock пульс уже на видимом,
     свежеотрисованном экране — см. журнал наверху. */
  function waitVisibleAndSettled() {
    return new Promise((resolve) => {
      let done = false;
      const finishWait = () => {
        if (done) return;
        done = true;
        document.removeEventListener('visibilitychange', onVisible);
        clearTimeout(fallbackTimer);
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      };
      const onVisible = () => {
        if (document.visibilityState === 'visible') finishWait();
      };
      const fallbackTimer = setTimeout(finishWait, VISIBILITY_WAIT_TIMEOUT_MS);
      if (document.visibilityState === 'visible') {
        finishWait();
      } else {
        document.addEventListener('visibilitychange', onVisible);
      }
    });
  }

  /* Применяется ТОЛЬКО если ADS_CONNECTED_VK вручную вернули в false
     (аварийный откат, см. комментарий у флага выше) — при действующем
     умолчании (true, решение 26.07) эта функция не вызывается вообще,
     подпись кнопки остаётся штатной («▶ … за рекламу», i18n.js), потому
     что реклама теперь действительно пытается показаться при каждом
     клике. Снимает ▶-значок и меняет подпись на нейтральную, БЕЗ слова
     «реклама» — на случай отката, чтобы подпись не врала, если решат
     снова показывать «ролика не будет ни при каком клике». Атрибут
     data-i18n у подписи снимаем — иначе она вернётся к «Подсказка за
     рекламу» при следующем applyStrings() (общий код i18n.js, не
     трогаем). Кнопка НЕ прячется (решение 18.07 выше остаётся в силе) —
     просто перестаёт обещать то, чего не будет; сама подсказка всё
     равно доступна и бесплатна (см. showRewarded). Вызывается из init()
     ДО проверки vkBridge — это статический факт флага, не зависящий от
     того, ответил мост или нет. */
  function applyAdsDisconnectedHintUI() {
    const badge = document.querySelector('.hint-ad-badge');
    if (badge) badge.remove();
    const label = document.querySelector('.hint-ad-label');
    if (label) {
      label.removeAttribute('data-i18n');
      label.textContent = 'Подсказка';
    }
  }

  /* ---------- Реклама: гарантированная поверхность (Task A, ЗАДАЧА
     ..._VK.md) ----------
     Модератор отклонил билд именно потому, что единственная рекламная
     поверхность (rewarded) реактивно скрывалась/не показывалась без
     филла — он не увидел рекламу вообще. Стики-баннер решает это:
     показывается ОДИН РАЗ при старте и висит поверх страницы весь
     сеанс, не завися от кликов игрока (в отличие от interstitial и
     rewarded). Вызывается безусловно при успешном init() (решение
     26.07, см. журнал у ADS_CONNECTED_VK выше) — сбой самого запроса
     (юнит не настроен/сетевая ошибка) ловится catch() ниже и только
     логируется, игру не роняет и ничего не блокирует.
     banner_location:'top' — решение по умолчанию, НЕ проверено живым
     ВК-клиентом (баннер нативный, в песочнице без vkBridge не
     рендерится вообще). Игровые кнопки .hint-wrap/.undo-btn стоят по
     НИЗУ экрана (style.css) — баннер снизу рисковал бы их перекрыть,
     верх перекрывает только редко тапаемую шапку (назад/звук). Если
     живой тест на телефоне покажет перекрытие — правка одной строки
     ('top'->'bottom') здесь, слой вёрстки не трогаем. */
  function showBannerAd() {
    vkBridge.send('VKWebAppShowBannerAd', {
      banner_location: 'top',
      layout_type: 'overlay'
    }).catch((e) => {
      console.error('[vk_platform] showBannerAd:', e);
    });
  }

  /* ---------- Инициализация ----------
     Обязательный таймаут (шрам Словохода b7): вне ВК-клиента
     VKWebAppInit не отвечает — без таймаута игра вечно висит на
     загрузке БЕЗ ошибок в консоли. При таймауте/ошибке — дев-режим,
     игра обязана дойти до меню. */
  async function init() {
    if (!ADS_CONNECTED_VK) applyAdsDisconnectedHintUI();
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
    if (ADS_CONNECTED_VK) showBannerAd();
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
    if (!ADS_CONNECTED_VK) {
      // Аварийный откат (см. комментарий у ADS_CONNECTED_VK выше) — при
      // действующем умолчании (true) сюда не заходим, вызов идёт
      // безусловно ниже.
      if (onResume) onResume(false);
      return;
    }
    if (!ready) {
      console.warn('[vk_platform] dev: interstitial пропущен');
      if (onResume) onResume();
      return;
    }
    if (onPause) onPause();
    withTimeout(
      vkBridge.send('VKWebAppShowNativeAds', { ad_format: 'interstitial' }),
      INTERSTITIAL_AD_TIMEOUT_MS
    )
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
  /* Задача 15 (диагностика): основатель наблюдал подсказки без рекламы
     и не мог отличить причину — здесь ЕДИНСТВЕННАЯ строка на каждый
     запрос rewarded (кроме исхода «лимит», который решается в main.js
     ДО вызова этой функции — адаптер про суточный лимит не знает).
     Причины исхода:
       показан         — VKWebAppShowNativeAds резолвится (ролик закрыт штатно);
       нет филла/отказ моста — Promise отклонён (документированный исход
                          пакета: юнит не настроен/нет заполнения/мост
                          потерял сообщение о закрытии), включая наш
                          собственный withTimeout-таймаут — с точки
                          зрения основателя это тот же симптом «рекламы
                          не было»;
       ошибка           — синхронное исключение ДО/ВОКРУГ самого вызова
                          (неожиданное, не задокументированный исход API). */
  function logRewardedOutcome(reason, detail) {
    const line = `[rewarded] ${reason}`;
    if (detail !== undefined) console.log(line, detail);
    else console.log(line);
  }

  function showRewarded(onRewarded, onPause, onResume) {
    if (!ADS_CONNECTED_VK) {
      // Аварийный откат (см. комментарий у ADS_CONNECTED_VK выше) — при
      // действующем умолчании (true) сюда не заходим, попытка показа
      // (VKWebAppShowNativeAds) идёт безусловно ниже; сбой ловится
      // catch()'ем withTimeout ниже и всё равно выдаёт награду.
      logRewardedOutcome('запрос — аварийный откат (ADS_CONNECTED_VK=false), подсказка сразу и бесплатно');
      if (onRewarded) onRewarded();
      return;
    }
    if (!ready) {
      logRewardedOutcome('запрос — dev-режим (нет vkBridge), подсказка выдана без рекламы');
      if (onRewarded) onRewarded();
      if (onResume) onResume();
      return;
    }
    if (onPause) onPause();
    let settled = false;
    const finish = (grantReward, reason, detail) => {
      if (settled) return;
      settled = true;
      // Видимый эффект — строго после onResume(), как в platform.js.
      if (onResume) onResume();
      logRewardedOutcome(reason, detail);
      if (grantReward && onRewarded) {
        // На мобильном ВК onRewarded() (внутри — Board.showHint(), общий
        // код) не должен стартовать, пока экран ещё реально перекрыт
        // рекламным оверлеем — см. журнал наверху. Ждём подтверждённой
        // видимости, форсируем пересчёт лэйаута на случай смены
        // размеров вьюпорта за время рекламы, и только потом отдаём
        // награду вызывающей стороне.
        const waitStartedAt = performance.now();
        waitVisibleAndSettled().then(() => {
          if (typeof Board !== 'undefined' && Board.resize) Board.resize();
          console.log('[vk_platform] rewarded: экран подтверждён видимым через', Math.round(performance.now() - waitStartedAt), 'мс — показываем подсказку');
          onRewarded();
        });
      }
    };
    let sendPromise;
    try {
      sendPromise = withTimeout(
        vkBridge.send('VKWebAppShowNativeAds', { ad_format: 'reward' }),
        REWARD_AD_TIMEOUT_MS
      );
    } catch (e) {
      // Синхронное исключение до отправки — не задокументированный
      // исход API, отдельная категория «ошибка» (не путать с штатным
      // отказом/отсутствием филла ниже).
      finish(true, 'ошибка — подсказка выдана бесплатно', e);
      return;
    }
    sendPromise
      .then(() => finish(true, 'показан — ролик закрыт, награда выдаётся'))
      .catch((e) => {
        const isTimeout = e instanceof Error && e.message === 'timeout';
        const reason = isTimeout
          ? `нет филла/отказ моста — мост не ответил за ${REWARD_AD_TIMEOUT_MS}мс, подсказка выдана бесплатно`
          : 'нет филла/отказ моста — подсказка выдана бесплатно';
        finish(true, reason, e);
      });
  }

  /* ---------- _STUB_ Косметическая покупка (Task C, ЗАДАЧА_..._VK.md) ----------
     ОТКЛЮЧЕНО флагом COSMETIC_SHOP_ENABLED_VK ниже — решение основателя
     2026-07-26: в переподачу идут ТОЛЬКО Task A (реклама) и Task B
     (rewarded не прячется). VKWebAppShowOrderBox требует сервер-колбэк
     подтверждения покупки (см. типы пакета) — бэкенда у студии нет,
     подтвердить транзакцию нечем. Код НЕ удалён (правило студии —
     незавершённый артефакт выключается/переименовывается, не стирается) —
     включить обратно (COSMETIC_SHOP_ENABLED_VK = true), когда появится
     сервер-колбэк.

     Task 4 (та же переподача 2026-07-26): раз покупки нет, строка в
     меню возвращена как ПРЕВЬЮ — main.js красит колбы кликом БЕЗ
     обращения к buyCosmetic/OrderBox и без персистентности (см.
     main.js, revertCosmeticTheme). Доступность превью гейтится ОТДЕЛЬНЫМ
     флагом COSMETIC_PREVIEW_VK ниже (не завязан на
     COSMETIC_SHOP_ENABLED_VK — превью не требует сервер-колбэка вообще,
     ничего не покупается) — экспортируется безусловно как обычное поле
     объекта Platform (тот же приём, что AD_LEVELS_INTERVAL выше), на
     Яндексе (platform.js) не экспортировано, там фичи физически нет.

     8-й метод СВЕРХ общего 7-методного контракта — существует ТОЛЬКО
     здесь (Яндекс platform.js его не экспортирует физически), main.js
     проверяет наличие через typeof перед вызовом (тот же приём, что и
     DEV_UNLOCK_ALL). Флаг ниже управляет именно этим typeof-гейтом:
     пока false, buyCosmetic не попадает в возвращаемый объект Platform
     вообще.
     item ДОЛЖЕН точно совпадать со строкой, заведённой в каталоге
     товаров кабинета ВК (см. отчёт/предусловие основателя) — сама цена
     и карточка товара настраиваются ТОЛЬКО в кабинете, не в коде
     (OrderRequestOptions пакета не несёт цены). Верифицировано по
     packages/src/types/data.ts пакета @vkontakte/vk-bridge@3.0.2. */
  const COSMETIC_SHOP_ENABLED_VK = false; // _STUB_: см. комментарий выше — нет сервер-колбэка для OrderBox
  const COSMETIC_PREVIEW_VK = true; // превью не требует OrderBox — включено независимо от покупки
  const COSMETIC_ITEM_ID = 'sea_theme';

  /* ---------- Плашка номера билда (задача 14) ----------
     Плейсхолдер на диске — build.py подставляет реальное значение
     ('vk-b<счётчик>-<git-хэш>-<дата>') ТОЛЬКО в копию для ВК-сборки
     (см. build_vk(), тот же приём точечной замены байт в собранном
     файле, что у 2 тегов index.html — исходник на диске не трогается).
     Локальный запуск без сборки покажет плейсхолдер как есть — это
     нормально, значит билд не собирался через build.py. main.js читает
     через typeof (тот же приём, что COSMETIC_PREVIEW_VK) — на Яндексе
     (platform.js) поля физически нет, там плашка не показывается. */
  const BUILD = 'vk-b7-023dc49-20260727';

  async function buyCosmetic(onSuccess, onFail) {
    if (!ready) {
      console.warn('[vk_platform] dev: buyCosmetic — нет vkBridge, покупка не выполняется');
      if (onFail) onFail('dev-mode');
      return;
    }
    try {
      const res = await vkBridge.send('VKWebAppShowOrderBox', {
        type: 'item',
        item: COSMETIC_ITEM_ID
      });
      if (res.status === 'success') {
        console.log('[vk_platform] buyCosmetic: успех, order_id', res.order_id);
        if (onSuccess) onSuccess();
      } else {
        console.warn('[vk_platform] buyCosmetic: не завершена, статус', res.status);
        if (onFail) onFail(res.status); // 'cancel' | 'fail'
      }
    } catch (e) {
      console.error('[vk_platform] VKWebAppShowOrderBox ошибка (товар не настроен в кабинете?):', e);
      if (onFail) onFail('error');
    }
  }

  return {
    init, gameReady, getLang, save, load, showInterstitial, showRewarded,
    AD_LEVELS_INTERVAL, AD_MIN_GAP_MS, COSMETIC_PREVIEW_VK, BUILD,
    // _STUB_: buyCosmetic попадает в контракт ТОЛЬКО когда
    // COSMETIC_SHOP_ENABLED_VK = true (см. комментарий у флага выше) —
    // сейчас false, метод физически отсутствует на объекте Platform.
    ...(COSMETIC_SHOP_ENABLED_VK ? { buyCosmetic } : {})
  };
})();
