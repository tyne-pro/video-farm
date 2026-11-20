export type Lang = 'uk' | 'ru' | 'en'

const D = {
  uk: {
    brand: 'Ферма роликів', toCabinet: 'До кабінету', myClips: 'Мої ролики', connected: 'Програма на цьому компʼютері', theme: 'Тема',
    listSub: 'Ролики на цьому компʼютері. Відкрий будь-який, щоб змонтувати точніше: перемотка, розрізи, порядок кадрів.',
    all: 'Усі', ready: 'Готові', drafts: 'Змінені',
    final: 'Готово', draft: 'Змінено', edit: 'Редагувати', download: 'Завантажити', original: 'Оригінал', inFolder: 'У папці', remove: 'Видалити',
    modeCut: 'порізати відео', modeClips: 'з кліпів', modeScript: 'за інструкцією', noProject: 'зроблено до редактора',
    empty: 'Тут зʼявляться ролики, які ти змонтуєш. Почни на сторінці ферми в кабінеті.', openFarm: 'Відкрити ферму',
    note: '«Оригінал» — твоє вихідне відео без субтитрів і стікерів. «Видалити» прибирає ролик із папки «Готово»; 7 днів його можна повернути.',
    delTitle: 'Видалити ролик?', delText: 'Ролик і його проєкт зникнуть зі списку й папки «Готово». Протягом 7 днів його можна повернути.', cancel: 'Скасувати',
    deleted: 'Ролик видалено', undo: 'Повернути', restored: 'Ролик повернуто', failed: 'Не вийшло. Спробуй ще раз', rendering: 'Збираємо…',
    back: 'Мої ролики', saved: 'Збережено на компʼютері', saving: 'Зберігаю…', notSaved: 'Не збереглося', undoT: 'Скасувати (⌘Z)', redoT: 'Повторити (⇧⌘Z)',
    makeFinal: 'Зробити фінал 1080p', finalDone: 'Фінал готовий: він у папці «Готово»', openFile: 'Показати', locked: 'Фінал із редактора — у Premium і Pro. У демо можна дивитися й монтувати превʼю.', plans: 'Тарифи',
    files: 'Мої файли', addHint: 'Натисни, щоб додати в кінець. Перетягни на кліп на доріжці — замінить його.', preview: 'Превʼю 540p', fromPc: 'з цього компʼютера',
    split: 'Розрізати', dup: 'Дублювати', del: 'Видалити', magnet: 'Магніт', zoom: 'Масштаб', fit: 'Увесь ролик',
    video: 'Відео', text: 'Текст', stickers: 'Стікери', voice: 'Голос', music: 'Музика',
    clip: 'Кліп', clipOf: 'Кліп {n} з {total}', start: 'Початок', length: 'Тривалість', from: 'З файлу, с', replace: 'Замінити на вибраний файл', bgClip: 'Живий фон під тему',
    volume: 'Гучність', musicHint: 'Музика грає під усім роликом; її можна посунути й підрізати.',
    nothing: 'Вибери кліп на доріжці, щоб змінити його. Пробіл — пуск, S — розрізати, ⌫ — видалити, ⌘Z — скасувати.',
    maxLen: 'Довше за тариф не можна: до {sec} с', textLater: 'Тексти й стікери самі їдуть за монтажем.',
    filesAt: 'Файли', traffic: 'Через інтернет у цьому ролику', trafficVal: '0 МБ відео', left: 'залишилось', of: 'з',
    loading: 'Відкриваємо проєкт…', notFound: 'Проєкт не знайдено', noApp: 'Програма не відповідає. Перевір, що TyneFarm відкрита.',
    clipName: 'Назва ролика', tabSel: 'Вибране', tabStyle: 'Стиль ролика', styleNote: 'Шрифти Google з кирилицею й латиницею. Видно одразу в превʼю і так само у фіналі.', presets: 'Готові стилі',
    p_classic: 'Класика', p_neon: 'Неон', p_plate: 'Плашка', p_minimal: 'Мінімал', p_magazine: 'Журнал', p_handwritten: 'Рукопис',
    hookFont: 'Шрифт заголовків і хука', subFont: 'Шрифт субтитрів', fontAuto: 'Як у стилі', colors: 'Кольори', textColor: 'Текст', textAuto: 'Авто', accentColor: 'Акцент', ownColor: 'Свій колір',
    accentHow: 'Як виділяти акцент', m_color: 'Кольором', m_marker: 'Маркером', m_glow: 'Світінням', m_bigger: 'Більшим', backingT: 'Підкладка під субтитри', b_shadow: 'Тінь', b_plate: 'Плашка', b_outline: 'Обведення', b_none: 'Без',
    ownFont: 'Свій шрифт із папки «fonts»', lockStyle: 'Усі шрифти, свої кольори й акценти — у Premium і Pro. У демо — три готові стилі.', lockOwn: 'Свій шрифт — у Pro',
    caption: 'Субтитр', captionHint: 'Натисни на слово — увімкнеш або вимкнеш акцент. *Слово* в зірочках теж стає акцентом.', heading: 'Заголовок', hookT: 'Хук', end: 'Кінець', delCaption: 'Видалити текст', textPart: 'Цей субтитр розрізаний монтажем: текст правиться цілком.',
    play: 'Пуск', pause: 'Пауза', mutedHint: 'Голос і музика — з файлів на цьому компʼютері',
  },
  ru: {
    brand: 'Ферма роликов', toCabinet: 'В кабинет', myClips: 'Мои ролики', connected: 'Программа на этом компьютере', theme: 'Тема',
    listSub: 'Ролики на этом компьютере. Открой любой, чтобы смонтировать точнее: перемотка, разрезы, порядок кадров.',
    all: 'Все', ready: 'Готовые', drafts: 'Изменённые',
    final: 'Готово', draft: 'Изменено', edit: 'Редактировать', download: 'Скачать', original: 'Оригинал', inFolder: 'В папке', remove: 'Удалить',
    modeCut: 'порезать видео', modeClips: 'из клипов', modeScript: 'по инструкции', noProject: 'сделан до редактора',
    empty: 'Здесь появятся ролики, которые ты смонтируешь. Начни на странице фермы в кабинете.', openFarm: 'Открыть ферму',
    note: '«Оригинал» — твоё исходное видео без субтитров и стикеров. «Удалить» убирает ролик из папки «Готово»; 7 дней его можно вернуть.',
    delTitle: 'Удалить ролик?', delText: 'Ролик и его проект исчезнут из списка и папки «Готово». В течение 7 дней его можно вернуть.', cancel: 'Отмена',
    deleted: 'Ролик удалён', undo: 'Вернуть', restored: 'Ролик возвращён', failed: 'Не получилось. Попробуй ещё раз', rendering: 'Собираем…',
    back: 'Мои ролики', saved: 'Сохранено на компьютере', saving: 'Сохраняю…', notSaved: 'Не сохранилось', undoT: 'Отменить (⌘Z)', redoT: 'Повторить (⇧⌘Z)',
    makeFinal: 'Сделать финал 1080p', finalDone: 'Финал готов: он в папке «Готово»', openFile: 'Показать', locked: 'Финал из редактора — в Premium и Pro. В демо можно смотреть и монтировать превью.', plans: 'Тарифы',
    files: 'Мои файлы', addHint: 'Нажми, чтобы добавить в конец. Перетащи на клип на дорожке — заменит его.', preview: 'Превью 540p', fromPc: 'с этого компьютера',
    split: 'Разрезать', dup: 'Дублировать', del: 'Удалить', magnet: 'Магнит', zoom: 'Масштаб', fit: 'Весь ролик',
    video: 'Видео', text: 'Текст', stickers: 'Стикеры', voice: 'Голос', music: 'Музыка',
    clip: 'Клип', clipOf: 'Клип {n} из {total}', start: 'Начало', length: 'Длительность', from: 'Из файла, с', replace: 'Заменить на выбранный файл', bgClip: 'Живой фон под тему',
    volume: 'Громкость', musicHint: 'Музыка играет под всем роликом; её можно сдвинуть и подрезать.',
    nothing: 'Выбери клип на дорожке, чтобы изменить его. Пробел — пуск, S — разрезать, ⌫ — удалить, ⌘Z — отменить.',
    maxLen: 'Длиннее тарифа нельзя: до {sec} с', textLater: 'Тексты и стикеры сами едут за монтажом.',
    filesAt: 'Файлы', traffic: 'Через интернет в этом ролике', trafficVal: '0 МБ видео', left: 'осталось', of: 'из',
    loading: 'Открываем проект…', notFound: 'Проект не найден', noApp: 'Программа не отвечает. Проверь, что TyneFarm открыта.',
    clipName: 'Название ролика', tabSel: 'Выбранное', tabStyle: 'Стиль ролика', styleNote: 'Шрифты Google с кириллицей и латиницей. Видно сразу в превью и так же в финале.', presets: 'Готовые стили',
    p_classic: 'Классика', p_neon: 'Неон', p_plate: 'Плашка', p_minimal: 'Минимал', p_magazine: 'Журнал', p_handwritten: 'Рукопись',
    hookFont: 'Шрифт заголовков и хука', subFont: 'Шрифт субтитров', fontAuto: 'Как в стиле', colors: 'Цвета', textColor: 'Текст', textAuto: 'Авто', accentColor: 'Акцент', ownColor: 'Свой цвет',
    accentHow: 'Как выделять акцент', m_color: 'Цветом', m_marker: 'Маркером', m_glow: 'Свечением', m_bigger: 'Крупнее', backingT: 'Подложка под субтитры', b_shadow: 'Тень', b_plate: 'Плашка', b_outline: 'Обводка', b_none: 'Без',
    ownFont: 'Свой шрифт из папки «fonts»', lockStyle: 'Все шрифты, свои цвета и акценты — в Premium и Pro. В демо — три готовых стиля.', lockOwn: 'Свой шрифт — в Pro',
    caption: 'Субтитр', captionHint: 'Нажми на слово — включишь или выключишь акцент. *Слово* в звёздочках тоже становится акцентом.', heading: 'Заголовок', hookT: 'Хук', end: 'Конец', delCaption: 'Удалить текст', textPart: 'Этот субтитр разрезан монтажом: текст правится целиком.',
    play: 'Пуск', pause: 'Пауза', mutedHint: 'Голос и музыка — из файлов на этом компьютере',
  },
  en: {
    brand: 'Video farm', toCabinet: 'To the cabinet', myClips: 'My clips', connected: 'App on this computer', theme: 'Theme',
    listSub: 'Clips on this computer. Open any to edit it precisely: scrubbing, cuts, shot order.',
    all: 'All', ready: 'Ready', drafts: 'Changed',
    final: 'Ready', draft: 'Changed', edit: 'Edit', download: 'Download', original: 'Original', inFolder: 'Show in folder', remove: 'Delete',
    modeCut: 'cut a video', modeClips: 'from clips', modeScript: 'from a brief', noProject: 'made before the editor',
    empty: 'Clips you make will show up here. Start on the farm page in the cabinet.', openFarm: 'Open the farm',
    note: '“Original” is your source video without captions or stickers. “Delete” removes the clip from the Ready folder; you can bring it back for 7 days.',
    delTitle: 'Delete the clip?', delText: 'The clip and its project leave the list and the Ready folder. You can bring it back for 7 days.', cancel: 'Cancel',
    deleted: 'Clip deleted', undo: 'Undo', restored: 'Clip restored', failed: 'That did not work. Try again', rendering: 'Rendering…',
    back: 'My clips', saved: 'Saved on this computer', saving: 'Saving…', notSaved: 'Not saved', undoT: 'Undo (⌘Z)', redoT: 'Redo (⇧⌘Z)',
    makeFinal: 'Render final 1080p', finalDone: 'The final is ready in the Ready folder', openFile: 'Show', locked: 'Final renders from the editor come with Premium and Pro. In the demo you can watch and edit the preview.', plans: 'Plans',
    files: 'My files', addHint: 'Click to add at the end. Drop on a clip in the track to replace it.', preview: 'Preview 540p', fromPc: 'from this computer',
    split: 'Split', dup: 'Duplicate', del: 'Delete', magnet: 'Magnet', zoom: 'Zoom', fit: 'Whole clip',
    video: 'Video', text: 'Text', stickers: 'Stickers', voice: 'Voice', music: 'Music',
    clip: 'Clip', clipOf: 'Clip {n} of {total}', start: 'Start', length: 'Length', from: 'From file, s', replace: 'Replace with the chosen file', bgClip: 'Live background',
    volume: 'Volume', musicHint: 'Music plays under the whole clip; you can move and trim it.',
    nothing: 'Pick a clip in the track to change it. Space plays, S splits, ⌫ deletes, ⌘Z undoes.',
    maxLen: 'Your plan allows up to {sec} s', textLater: 'Text and stickers follow the edit on their own.',
    filesAt: 'Files', traffic: 'Sent over the internet for this clip', trafficVal: '0 MB of video', left: 'left', of: 'of',
    loading: 'Opening the project…', notFound: 'Project not found', noApp: 'The app does not answer. Check that TyneFarm is open.',
    clipName: 'Clip name', tabSel: 'Selected', tabStyle: 'Clip style', styleNote: 'Google fonts with Cyrillic and Latin. You see it in the preview right away, and the final looks the same.', presets: 'Ready styles',
    p_classic: 'Classic', p_neon: 'Neon', p_plate: 'Plate', p_minimal: 'Minimal', p_magazine: 'Magazine', p_handwritten: 'Handwritten',
    hookFont: 'Headings and hook font', subFont: 'Captions font', fontAuto: 'As in the style', colors: 'Colours', textColor: 'Text', textAuto: 'Auto', accentColor: 'Accent', ownColor: 'Own colour',
    accentHow: 'How to mark the accent', m_color: 'Colour', m_marker: 'Marker', m_glow: 'Glow', m_bigger: 'Bigger', backingT: 'Behind captions', b_shadow: 'Shadow', b_plate: 'Plate', b_outline: 'Outline', b_none: 'None',
    ownFont: 'Own font from the “fonts” folder', lockStyle: 'All fonts, own colours and accents come with Premium and Pro. The demo has three ready styles.', lockOwn: 'Own font comes with Pro',
    caption: 'Caption', captionHint: 'Click a word to turn its accent on or off. A *word* in asterisks becomes an accent too.', heading: 'Heading', hookT: 'Hook', end: 'End', delCaption: 'Delete text', textPart: 'This caption is split by the edit: its text is edited as a whole.',
    play: 'Play', pause: 'Pause', mutedHint: 'Voice and music come from files on this computer',
  },
} as const

export type Key = keyof typeof D.uk

function pick(): Lang {
  try {
    const q = new URLSearchParams(location.search).get('lang')
    const v = (q || localStorage.getItem('farm-lang') || navigator.language.slice(0, 2)) as Lang
    const lang = v in D ? v : 'uk'
    localStorage.setItem('farm-lang', lang)
    return lang
  } catch { return 'uk' }
}

export let lang: Lang = pick()
export const setLang = (l: Lang) => { lang = l; try { localStorage.setItem('farm-lang', l) } catch { /* не критично */ } }
export const t = (k: Key, vars: Record<string, string | number> = {}) => String(D[lang][k] ?? D.uk[k]).replace(/\{(\w+)\}/g, (_, v) => String(vars[v] ?? ''))
document.documentElement.lang = lang

export const fmt = (sec: number, tenths = false) => {
  const s = Math.max(0, sec)
  const m = Math.floor(s / 60)
  const r = s - m * 60
  return `${m}:${(tenths ? r.toFixed(1) : Math.floor(r).toString()).padStart(tenths ? 4 : 2, '0')}`
}
export const when = (ms: number) => new Date(ms).toLocaleString(lang === 'uk' ? 'uk-UA' : lang === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
