// Понятные сообщения журнала на языке страницы. Никаких названий библиотек и программ.
const T = {
  uk: {
    disk: 'Мало місця на диску: вільно {free}, потрібно хоча б {need}. Звільніть місце або натисніть «Очистити кеш» у програмі',
    evStarted: 'Генератор запущено', evDone: 'Ролик готовий: «{title}»', evFailed: 'Ролик «{title}» не зібрався: {reason}', evCancelled: 'Скасовано: «{title}»',
    evCache: 'Кеш очищено, звільнено {size}', evRepairOk: 'Програму підготовлено до роботи', evRepairFail: 'Підготовку не завершено, спробуйте ще раз',
    evPaused: 'Чергу поставлено на паузу', evResumed: 'Черга продовжується',
    detFailed: 'Ролик повернуто в ліміт. Натисніть «Повторити» на сторінці ферми або «Скопіювати звіт» для підтримки.', detDisk: 'Звільніть місце на диску або натисніть «Очистити кеш» і запустіть ролик ще раз.',
    started: 'Генератор запущено', queued: 'У черзі', check: 'Перевіряємо ключ кабінету…', tier: 'Ключ кабінету перевірено, тариф: {tier}, залишилось роликів: {left}',
    files: 'Файли отримано: {n}', prepare: 'Готуємо відео…', trimmed: 'Ролик скорочено до {sec} с за тарифом', cuts: 'Вирізаємо паузи: {from} → {to} с',
    speech: 'Розпізнаємо мову…', words: 'Розпізнано слів: {n}', noSpeech: 'У відео немає мови: субтитрів не буде', text: 'Пишемо текст ролика…', textRules: 'Текст склали за правилами (сервер не відповів)',
    stickers: 'Підбираємо стікери…', montage: 'Монтуємо…', render: 'Рендер…', draft: 'Рендер чернетки…', done: 'Готово: {file}', draftDone: 'Чернетка готова: подивіться, поправте й запустіть фінал',
    limitLeft: 'Ліміт демо вичерпано', error: 'Помилка: {msg}', firstRun: 'Перший запуск: готуємо модель розпізнавання мови (один раз)…', rerender: 'Перезбираємо за виправленим планом',
    auth: 'Кабінет не підключено: натисніть «Підключити кабінет» у програмі або на сторінці ферми', limit: 'Ліміт роликів за тарифом вичерпано', busy: 'Демо зараз перевантажене, спробуйте пізніше', offline: 'Немає зв’язку з кабінетом. Перевірте інтернет',
    needVideo: 'Додайте відео', notVideo: 'Файл не схожий на відео. Спробуйте інший файл', skipped: 'Файл «{name}» не вдалося прочитати, пропускаємо', cancelled: 'Скасовано', stock: 'Підбираємо відео з безкоштовних стоків…', stockDone: 'Додано відео з безкоштовних стоків: {n}', stockNone: 'Стокових відео не знайшли — малюємо живий фон під тему', failed: 'Не вдалося змонтувати ролик. Натисніть «Повторити»', retry: 'Повторюємо', needItems: 'Додайте хоча б один кліп або картинку', needTopic: 'Впишіть тему ролика', noAudio: 'У відео немає звуку',
  },
  ru: {
    disk: 'Мало места на диске: свободно {free}, нужно хотя бы {need}. Освободите место или нажмите «Очистить кеш» в программе',
    evStarted: 'Генератор запущен', evDone: 'Ролик готов: «{title}»', evFailed: 'Ролик «{title}» не собрался: {reason}', evCancelled: 'Отменено: «{title}»',
    evCache: 'Кеш очищен, освобождено {size}', evRepairOk: 'Программа подготовлена к работе', evRepairFail: 'Подготовка не завершена, попробуйте ещё раз',
    evPaused: 'Очередь на паузе', evResumed: 'Очередь продолжается',
    detFailed: 'Ролик возвращён в лимит. Нажмите «Повторить» на странице фермы или «Скопировать отчёт» для поддержки.', detDisk: 'Освободите место на диске или нажмите «Очистить кеш» и запустите ролик ещё раз.',
    started: 'Генератор запущен', queued: 'В очереди', check: 'Проверяем ключ кабинета…', tier: 'Ключ кабинета проверен, тариф: {tier}, осталось роликов: {left}',
    files: 'Файлы получены: {n}', prepare: 'Готовим видео…', trimmed: 'Ролик сокращён до {sec} с по тарифу', cuts: 'Вырезаем паузы: {from} → {to} с',
    speech: 'Распознаём речь…', words: 'Распознано слов: {n}', noSpeech: 'В видео нет речи: субтитров не будет', text: 'Пишем текст ролика…', textRules: 'Текст составили по правилам (сервер не ответил)',
    stickers: 'Подбираем стикеры…', montage: 'Монтируем…', render: 'Рендер…', draft: 'Рендер черновика…', done: 'Готово: {file}', draftDone: 'Черновик готов: посмотрите, поправьте и запустите финал',
    limitLeft: 'Лимит демо исчерпан', error: 'Ошибка: {msg}', firstRun: 'Первый запуск: готовим модель распознавания речи (один раз)…', rerender: 'Пересобираем по исправленному плану',
    auth: 'Кабинет не подключён: нажмите «Подключить кабинет» в программе или на странице фермы', limit: 'Лимит роликов по тарифу исчерпан', busy: 'Демо сейчас перегружено, попробуйте позже', offline: 'Нет связи с кабинетом. Проверьте интернет',
    needVideo: 'Добавьте видео', notVideo: 'Файл не похож на видео. Попробуйте другой файл', skipped: 'Файл «{name}» не удалось прочитать, пропускаем', cancelled: 'Отменено', stock: 'Подбираем видео из бесплатных стоков…', stockDone: 'Добавлено видео из бесплатных стоков: {n}', stockNone: 'Стоковых видео не нашли — рисуем живой фон под тему', failed: 'Не удалось смонтировать ролик. Нажмите «Повторить»', retry: 'Повторяем', needItems: 'Добавьте хотя бы один клип или картинку', needTopic: 'Впишите тему ролика', noAudio: 'В видео нет звука',
  },
  en: {
    disk: 'Not enough disk space: {free} free, at least {need} needed. Free up space or press Clear cache in the app',
    evStarted: 'Generator started', evDone: 'Clip ready: «{title}»', evFailed: 'Clip «{title}» failed: {reason}', evCancelled: 'Cancelled: «{title}»',
    evCache: 'Cache cleared, {size} freed', evRepairOk: 'The app is ready to work', evRepairFail: 'Preparation did not finish, try again',
    evPaused: 'Queue paused', evResumed: 'Queue resumed',
    detFailed: 'The clip went back to your limit. Press Retry on the farm page or Copy report for support.', detDisk: 'Free up disk space or press Clear cache and start the clip again.',
    started: 'Generator started', queued: 'Queued', check: 'Checking the cabinet key…', tier: 'Cabinet key checked, plan: {tier}, clips left: {left}',
    files: 'Files received: {n}', prepare: 'Preparing the video…', trimmed: 'Clip shortened to {sec} s by the plan', cuts: 'Cutting pauses: {from} → {to} s',
    speech: 'Recognising speech…', words: 'Words recognised: {n}', noSpeech: 'No speech in the video: no captions', text: 'Writing the clip text…', textRules: 'Text made by rules (the server did not answer)',
    stickers: 'Picking stickers…', montage: 'Editing…', render: 'Rendering…', draft: 'Rendering a draft…', done: 'Done: {file}', draftDone: 'Draft is ready: watch, fix and render the final',
    limitLeft: 'Demo limit used up', error: 'Error: {msg}', firstRun: 'First run: preparing the speech model (once)…', rerender: 'Rebuilding from the fixed plan',
    auth: 'The cabinet is not connected: press Connect the cabinet in the app or on the farm page', limit: 'The plan’s clip limit is used up', busy: 'The demo is busy right now, try later', offline: 'No connection to the cabinet. Check the internet',
    needVideo: 'Add a video', notVideo: 'The file does not look like a video. Try another file', skipped: 'Could not read «{name}», skipping it', cancelled: 'Cancelled', stock: 'Looking for free stock videos…', stockDone: 'Free stock videos added: {n}', stockNone: 'No stock videos found — drawing a live background for the topic', failed: 'Could not edit the clip. Press Retry', retry: 'Retrying', needItems: 'Add at least one clip or picture', needTopic: 'Enter the clip topic', noAudio: 'The video has no sound',
  },
}
const TIER = { uk: { demo: 'демо', premium: 'Premium', pro: 'Pro' }, ru: { demo: 'демо', premium: 'Premium', pro: 'Pro' }, en: { demo: 'demo', premium: 'Premium', pro: 'Pro' } }

export function t(lang, key, vars = {}) {
  const dict = T[lang] || T.uk
  return String(dict[key] ?? T.uk[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => (k === 'tier' ? (TIER[lang] || TIER.uk)[vars.tier] || vars.tier : vars[k] ?? ''))
}
