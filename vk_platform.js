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
  /* РЕШЕНИЕ 2026-07-21: ads-юниты этой игры в кабинете ВК ещё НЕ
     подключены/не одобрены — это известно ЗАВЕДОМО, а не проверяется
     рантаймом. Рантайм-проверку (VKWebAppCheckNativeAds) уже пробовали
     и убрали 18.07 именно за ненадёжность (см. журнал выше) — повторно
     использовать её для того же вопроса было бы тем же шрамом. Поэтому
     ручной флаг, не API-вызов: переключить на true, когда реклама в
     кабинете ВК реально подключена и одобрена. Пока false — подпись
     кнопки подсказки не обещает ролик (нет ▶, нет слова «реклама»,
     см. applyAdsDisconnectedHintUI), а сама подсказка выдаётся
     мгновенно и бесплатно (см. showRewarded) — без попытки открыть
     несуществующую рекламу и без тупика для игрока. */
  const ADS_CONNECTED_VK = false;
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
  /* Страховка ожидания видимости после закрытия рекламного оверлея
     (см. журнал выше, второе решение). НЕ про сам показ рекламы —
     это отдельная, короткая пауза ПОСЛЕ того, как Promise уже
     разрешился, на случай если document.visibilitychange по какой-то
     причине не придёт (не все нативные оверлеи гарантированно её
     шлют) — тогда просто продолжаем, не блокируя награду вечно. */
  const VISIBILITY_WAIT_TIMEOUT_MS = 3000;

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

  /* Кнопка подсказки НЕ обещает ролик, когда ads-юниты в кабинете ВК
     ещё не подключены (ADS_CONNECTED_VK=false выше) — иначе подпись
     «▶ … за рекламу» врёт: ролика не будет ни при каком клике. Снимаем
     ▶-значок и меняем подпись на нейтральную, БЕЗ слова «реклама».
     Атрибут data-i18n у подписи снимаем — иначе она вернётся к
     «Подсказка за рекламу» при следующем applyStrings() (общий код
     i18n.js, не трогаем). Кнопка НЕ прячется (решение 18.07 выше
     остаётся в силе) — просто перестаёт обещать то, чего не будет;
     сама подсказка всё равно доступна и бесплатна (см. showRewarded).
     Вызывается из init() ДО проверки vkBridge — это статический факт
     кабинета ВК, не зависящий от того, ответил мост или нет (дев-режим
     тоже не должен обещать рекламу). */
  function applyAdsDisconnectedHintUI() {
    const badge = document.querySelector('.hint-ad-badge');
    if (badge) badge.remove();
    const label = document.querySelector('.hint-ad-label');
    if (label) {
      label.removeAttribute('data-i18n');
      label.textContent = 'Подсказка';
    }
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
    if (!ADS_CONNECTED_VK) {
      // Ads-юниты не подключены (см. ADS_CONNECTED_VK выше) — заведомо
      // известно, что ролика не будет НИ ПРИ КАКОЙ попытке, поэтому
      // саму попытку (VKWebAppShowNativeAds) даже не делаем: не тратим
      // время игрока на вызов, который гарантированно ничего не
      // покажет. onPause/onResume не дёргаем — паузы фактически нет,
      // экран ничем не перекрывается. Награда — сразу.
      console.log('[vk_platform] rewarded: ads не подключены — подсказка сразу и бесплатно');
      if (onRewarded) onRewarded();
      return;
    }
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
      console.log('[vk_platform] rewarded завершён:', reason, '| награда:', grantReward);
      if (grantReward && onRewarded) {
        // На мобильном ВК onRewarded() (внутри — Board.showHint(), общий
        // код) не должен стартовать, пока экран ещё реально перекрыт
        // рекламным оверлеем — см. журнал наверху. Ждём подтверждённой
        // видимости, форсируем пересчёт лэйаута на случай смены
        // размеров вьюпорта за время рекламы, и только потом отдаём
        // награду вызывающей стороне. Два лога раздельно (решение vs.
        // фактический показ) — на живом устройстве через remote-debug
        // будет видно, если когда-нибудь разъедутся снова.
        const waitStartedAt = performance.now();
        waitVisibleAndSettled().then(() => {
          if (typeof Board !== 'undefined' && Board.resize) Board.resize();
          console.log('[vk_platform] rewarded: экран подтверждён видимым через', Math.round(performance.now() - waitStartedAt), 'мс — показываем подсказку');
          onRewarded();
        });
      }
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
