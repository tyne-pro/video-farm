// Понятные сообщения журнала на языке страницы. Никаких названий библиотек и программ.
const T = {
  uk: {
    started: 'Генератор запущено', queued: 'У черзі', check: 'Перевіряємо ключ кабінету…', tier: 'Ключ кабінету перевірено, тариф: {tier}, залишилось роликів: {left}',
    files: 'Файли отримано: {n}', prepare: 'Готуємо відео…', trimmed: 'Ролик скорочено до {sec} с за тарифом', cuts: 'Вирізаємо паузи: {from} → {to} с',
    speech: 'Розпізнаємо мову…', words: 'Розпізнано слів: {n}', noSpeech: 'У відео немає мови: субтитрів не буде', text: 'Пишемо текст ролика…', textRules: 'Текст склали за правилами (сервер не відповів)',
    stickers: 'Підбираємо стікери…', montage: 'Монтуємо…', render: 'Рендер…', draft: 'Рендер чернетки…', done: 'Готово: {file}', draftDone: 'Чернетка готова: подивіться, поправте й запустіть фінал',
    limitLeft: 'Ліміт демо вичерпано', error: 'Помилка: {msg}', firstRun: 'Перший запуск: готуємо модель розпізнавання мови (один раз)…', rerender: 'Перезбираємо за виправленим планом',
    auth: 'Кабінет не підключено: натисніть «Підключити кабінет» у програмі або на сторінці ферми', limit: 'Ліміт роликів за тарифом вичерпано', busy: 'Демо зараз перевантажене, спробуйте пізніше', offline: 'Немає зв’язку з кабінетом. Перевірте інтернет',
    needVideo: 'Додайте відео', needItems: 'Додайте хоча б один кліп або картинку', needTopic: 'Впишіть тему ролика', noAudio: 'У відео немає звуку',
  },
  ru: {
    started: 'Генератор запущен', queued: 'В очереди', check: 'Проверяем ключ кабинета…', tier: 'Ключ кабинета проверен, тариф: {tier}, осталось роликов: {left}',
    files: 'Файлы получены: {n}', prepare: 'Готовим видео…', trimmed: 'Ролик сокращён до {sec} с по тарифу', cuts: 'Вырезаем паузы: {from} → {to} с',
    speech: 'Распознаём речь…', words: 'Распознано слов: {n}', noSpeech: 'В видео нет речи: субтитров не будет', text: 'Пишем текст ролика…', textRules: 'Текст составили по правилам (сервер не ответил)',
    stickers: 'Подбираем стикеры…', montage: 'Монтируем…', render: 'Рендер…', draft: 'Рендер черновика…', done: 'Готово: {file}', draftDone: 'Черновик готов: посмотрите, поправьте и запустите финал',
    limitLeft: 'Лимит демо исчерпан', error: 'Ошибка: {msg}', firstRun: 'Первый запуск: готовим модель распознавания речи (один раз)…', rerender: 'Пересобираем по исправленному плану',
    auth: 'Кабинет не подключён: нажмите «Подключить кабинет» в программе или на странице фермы', limit: 'Лимит роликов по тарифу исчерпан', busy: 'Демо сейчас перегружено, попробуйте позже', offline: 'Нет связи с кабинетом. Проверьте интернет',
    needVideo: 'Добавьте видео', needItems: 'Добавьте хотя бы один клип или картинку', needTopic: 'Впишите тему ролика', noAudio: 'В видео нет звука',
  },
  en: {
    started: 'Generator started', queued: 'Queued', check: 'Checking the cabinet key…', tier: 'Cabinet key checked, plan: {tier}, clips left: {left}',
    files: 'Files received: {n}', prepare: 'Preparing the video…', trimmed: 'Clip shortened to {sec} s by the plan', cuts: 'Cutting pauses: {from} → {to} s',
    speech: 'Recognising speech…', words: 'Words recognised: {n}', noSpeech: 'No speech in the video: no captions', text: 'Writing the clip text…', textRules: 'Text made by rules (the server did not answer)',
    stickers: 'Picking stickers…', montage: 'Editing…', render: 'Rendering…', draft: 'Rendering a draft…', done: 'Done: {file}', draftDone: 'Draft is ready: watch, fix and render the final',
    limitLeft: 'Demo limit used up', error: 'Error: {msg}', firstRun: 'First run: preparing the speech model (once)…', rerender: 'Rebuilding from the fixed plan',
    auth: 'The cabinet is not connected: press Connect the cabinet in the app or on the farm page', limit: 'The plan’s clip limit is used up', busy: 'The demo is busy right now, try later', offline: 'No connection to the cabinet. Check the internet',
    needVideo: 'Add a video', needItems: 'Add at least one clip or picture', needTopic: 'Enter the clip topic', noAudio: 'The video has no sound',
  },
}
const TIER = { uk: { demo: 'демо', premium: 'Premium', pro: 'Pro' }, ru: { demo: 'демо', premium: 'Premium', pro: 'Pro' }, en: { demo: 'demo', premium: 'Premium', pro: 'Pro' } }

export function t(lang, key, vars = {}) {
  const dict = T[lang] || T.uk
  return String(dict[key] ?? T.uk[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => (k === 'tier' ? (TIER[lang] || TIER.uk)[vars.tier] || vars.tier : vars[k] ?? ''))
}
