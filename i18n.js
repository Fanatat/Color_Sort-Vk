/* ============================================================
   i18n — RU + EN (жанр без текста, английский почти бесплатен)
   Язык берётся из SDK (ysdk.environment.i18n.lang, ISO 639-1),
   фолбэк — ru. Неизвестные языки → en.
   ============================================================ */
const I18N = {
  ru: {
    title: 'Сортировка: Цвет и Форма', // карточное имя (п.5.1.3, решение основателя 2026-07-17)
    play: 'Играть',
    continue: 'Продолжить',
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
    levels: 'Уровни'
  },
  en: {
    title: 'Sort: Color & Shape', // карточное имя (п.5.1.3, решение основателя 2026-07-17)
    play: 'Play',
    continue: 'Continue',
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
    levels: 'Levels'
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
