/* ============================================================
   i18n — RU + EN (жанр без текста, английский почти бесплатен)
   Язык берётся из SDK (ysdk.environment.i18n.lang, ISO 639-1),
   фолбэк — ru. Неизвестные языки → en.
   ============================================================ */
const I18N = {
  ru: {
    title: 'Сортировка: Цвет и Форма', // карточное имя (п.5.1.3, решение основателя 2026-07-17)
    play: 'Играть',
    restart: 'Начать сначала',
    level: 'Уровень',
    win: 'Уровень пройден!',
    next: 'Дальше',
    noMoves: 'Нет доступных ходов',
    hintAd: 'Подсказка за рекламу',
    campaignWinTitle: 'Поздравляем! Вы прошли все уровни',
    campaignWinNote: 'Следите за обновлениями — скоро добавим новые',
    campaignMenu: 'В меню',
    statTotal: 'Всего',
    statAverage: 'В среднем',
    statFastest: 'Быстрее всего',
    statSlowest: 'Дольше всего',
    levels: 'Уровни',
    chapter: 'Глава',
    chapterComplete: 'пройдена',
    of: 'из',
    shop: 'Магазин',
    themeDefaultLabel: 'Тёплая тема',
    themeSeaLabel: 'Морская тема',
    themeForestLabel: 'Лесная тема',
    themeBerryLabel: 'Ягодная тема',
    shopApply: 'Применить',
    shopActive: 'Активна ✓',
    cosmeticBuy: 'Купить',
    shopPurchaseNotCompleted: 'Покупка не завершена',
    // ТЗ №14, этап 2: модуль удержания (retention.js), перенесён с
    // нонограмм. «Пазл» -> «уровень» (в Color Sort нет пазлов).
    retentionWaitingLine: 'Уровни ждут: {n}',
    retentionNextAt:      'ещё +{n} в {time}',
    retentionEmptyLine:   '+{n} {word} {verb} в {time}',
    retentionFull:        'Уровни ждут — играйте!',
    // ТЗ №14, этап 3 (добор): подпись обязана однозначно называть И
    // рекламу, И награду (п.4.5.1 требований Яндекса) — прежний текст
    // называл только результат (тот же приём, что renderRewardedButton
    // нонограмм, но там не было этого требования площадки).
    retentionRewardedBtn: 'Открыть ещё +{n} за рекламу',
    levelWordOne:  'уровень',
    levelWordFew:  'уровня',
    levelWordMany: 'уровней',
    levelArriveVerbOne:  'откроется',
    levelArriveVerbMany: 'откроются',
    retentionStreakLine:  'Серия входов: {n} из {m}',
    retentionRewardHints: '+{n} подсказки бесплатно — серия входов!',
    // Награда 3-го дня — конкретная тема (решение основателя 22.08):
    // ягодная тема дарится бесплатно, минуя магазин/IAP.
    retentionRewardStyle: 'Ягодная тема открыта — серия входов!',
    retentionRewardDrip:  'Открыт новый уровень!'
  },
  en: {
    title: 'Sort: Color & Shape', // карточное имя (п.5.1.3, решение основателя 2026-07-17)
    play: 'Play',
    restart: 'Restart',
    level: 'Level',
    win: 'Level complete!',
    next: 'Next',
    noMoves: 'No moves available',
    hintAd: 'Hint for an ad',
    campaignWinTitle: "Congratulations! You've completed all levels",
    campaignWinNote: 'Stay tuned — new levels are on the way',
    campaignMenu: 'To menu',
    statTotal: 'Total',
    statAverage: 'Average',
    statFastest: 'Fastest',
    statSlowest: 'Slowest',
    levels: 'Levels',
    chapter: 'Chapter',
    chapterComplete: 'complete',
    of: 'of',
    shop: 'Shop',
    themeDefaultLabel: 'Warm theme',
    themeSeaLabel: 'Sea theme',
    themeForestLabel: 'Forest theme',
    themeBerryLabel: 'Berry theme',
    shopApply: 'Apply',
    shopActive: 'Active ✓',
    cosmeticBuy: 'Buy',
    shopPurchaseNotCompleted: 'Purchase not completed',
    retentionWaitingLine: 'Levels waiting: {n}',
    retentionNextAt:      'plus {n} more at {time}',
    retentionEmptyLine:   '+{n} {word} {verb} at {time}',
    retentionFull:        'Levels are waiting — go play!',
    retentionRewardedBtn: 'Watch an ad for +{n} more levels',
    levelWordOne:  'level',
    levelWordFew:  'levels',
    levelWordMany: 'levels',
    levelArriveVerbOne:  'unlocks',
    levelArriveVerbMany: 'unlock',
    retentionStreakLine:  'Login streak: {n} of {m}',
    retentionRewardHints: '+{n} free hints — login streak!',
    retentionRewardStyle: 'Berry theme unlocked — login streak!',
    retentionRewardDrip:  'A new level unlocked!'
  }
};

let currentLang = 'ru';

function setLanguage(lang) {
  // ru/be/kk/uk/uz → русский интерфейс; остальное → en
  const ruFamily = ['ru', 'be', 'kk', 'uk', 'uz'];
  currentLang = ruFamily.includes(lang) ? 'ru' : (I18N[lang] ? lang : 'en');
  document.documentElement.lang = currentLang;
  applyStrings();
}

function t(key) {
  return (I18N[currentLang] && I18N[currentLang][key]) || I18N.ru[key] || key;
}

function applyStrings() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.title = t('title');
}
