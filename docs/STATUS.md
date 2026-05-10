# Mycel — Статус разработки

Последнее обновление: 2026-05

---

## Что сделано

### Инфраструктура
- [x] Tauri 2.x + React 19 + TypeScript (strict) + Vite
- [x] Tailwind CSS с CSS-переменными для тем
- [x] Zustand-сторы: `useVaultStore`, `useUIStore`
- [x] Path aliases (`@/*`)
- [x] Базовая типизация (`src/types/index.ts`)

### Спринт 1 — Скелет (частично)
- [x] Трёхколоночный layout: sidebar / editor / right panel
- [x] Сворачиваемые панели (кнопки в тулбаре)
- [x] Светлая и тёмная тема, переключение через `useTheme`
- [x] Открытие волта через dialog выбора папки (`tauri-plugin-dialog`)
- [x] Создание `.mycel/config.json` при инициализации волта
- [x] Файловое дерево: рекурсивный обход, папки + `.md` файлы, сортировка dirs-first
- [x] CRUD заметок: создать, переименовать, удалить (hard delete, не в корзину)
- [x] Множественные вкладки (tabs) с активной заметкой
- [x] Inline-поле создания заметки в сайдбаре (без `window.prompt`)
- [x] Удаление через `tauri-plugin-dialog confirm` (без `window.confirm`)
- [ ] Восстановление последнего волта при запуске
- [ ] Переключение между несколькими волтами
- [ ] Создание/удаление папок
- [ ] Soft delete в `.mycel/trash/`
- [ ] Дебаунс автосохранения 500мс (сейчас только Cmd+S и кнопка Save)
- [ ] Кастомный title bar

### Rust backend
- [x] `vault_open` — открыть волт, вернуть дерево файлов
- [x] `vault_get_tree` — обновить дерево
- [x] `vault_root` — текущий путь волта
- [x] `note_read` — читать файл + парсить
- [x] `note_save` — записать файл
- [x] `note_create` — создать файл с шаблоном `# Title\n\n`
- [x] `note_delete` — удалить файл
- [x] `note_rename` — переименовать файл
- [x] `notes_list` — список всех `.md` с заголовками (для autocomplete/switcher)
- [x] `backlinks_get` — найти все заметки, ссылающиеся на текущую
- [x] Парсер `parse_note`: frontmatter (gray_matter), заголовки, wikilinks, хэштеги

### Спринт 2 — Live preview
- [ ] **Ничего не сделано.** Редактор показывает сырой markdown.

### Спринт 3 — Wikilinks, теги, бэклинки (частично)
- [x] Парсер wikilinks в Rust (`[[target]]`, `[[target|alias]]`, `![[embed]]`)
- [x] Автодополнение wikilinks при наборе `[[` (CodeMirror autocomplete)
- [x] Ctrl/Cmd+click по `[[wikilink]]` → открыть заметку
- [x] Бэклинки в правой панели (список заметок со сниппетом контекста)
- [x] Quick switcher (Cmd+O) с fuzzy-поиском по именам
- [x] Панель Outline в правом сайдбаре (список заголовков)
- [x] Панель Tags в правом сайдбаре (frontmatter + inline #hashtags)
- [ ] Автообновление wikilinks при переименовании заметки
- [ ] Embed `![[note]]` — inline рендер содержимого заметки
- [ ] Unlinked mentions
- [ ] Панель всех тегов с количеством, фильтрация по тегу
- [ ] Автодополнение при наборе `#`

### Спринт 4 — Daily notes, command palette (частично)
- [x] Daily notes (Cmd+D) → открыть/создать `daily/YYYY-MM-DD.md`
- [ ] Command palette (Cmd+P) — только quick switcher есть
- [ ] Скролл к заголовку из outline, подсветка активного

---

## Текущие проблемы (баги)

- [ ] Редактор: нет дебаунс-автосохранения (500мс после остановки набора)
- [ ] Нет восстановления последнего волта при перезапуске

---

## Что делаем дальше

### Приоритет 1 — Доделать базовый функционал (Sprint 1 holes)

| Задача | Сложность |
|---|---|
| Дебаунс автосохранения 500мс | Низкая |
| Восстановление последнего волта (`tauri-plugin-store` или config) | Средняя |
| Soft delete в `.mycel/trash/` вместо hard delete | Средняя |
| Создание/удаление папок | Средняя |

### Приоритет 2 — Live preview редактора (Sprint 2) ⭐ САМОЕ ВАЖНОЕ

Это ключевая фича. Без неё это просто текстовый редактор, а не PKM.

Реализация через кастомные декорации CodeMirror 6:

| Элемент | Описание |
|---|---|
| Заголовки `# ## ###` | Скрывать `#` вне курсора, стилизовать размер/вес |
| Bold `**text**` | Показывать форматирование, скрывать маркеры |
| Italic `*text*` | То же |
| Strikethrough `~~text~~` | То же |
| Inline code `` `code` `` | Фоновая подсветка, моноширинный шрифт |
| Code blocks ` ``` ` | Рамка, кнопка copy, синтаксис-подсветка |
| Списки | Буллеты, нумерация, вложенность |
| Чекбоксы `- [ ]` | Кликабельный рендер |
| Цитаты `>` | Левая полоса, отступ |
| Горизонтальная линия `---` | Визуальный разделитель |
| Ссылки `[text](url)` | Показывать text, Ctrl+click открывает |
| Изображения `![alt](path)` | Inline рендер |
| Wikilinks `[[note]]` | Подсветка: зелёный если существует, серый если нет |

Типографика: Inter 16px / line-height 1.7 / max-width 720px / центрирование.

### Приоритет 3 — Sprint 3 остатки

- Автообновление wikilinks при переименовании
- Embed `![[note]]`
- Command palette (Cmd+P)

### Приоритет 4 — Sprint 5 (поиск, граф, FS watcher)

- Tantivy full-text search
- FS watcher (`notify` крейт)
- Граф связей

### Приоритет 5 — Айдентика (Sprint 7)

- Палитра «Грибница» из спеки
- Empty states
- Логотип

---

## Стек (зафиксирован)

| Слой | Технология |
|---|---|
| Shell | Tauri 2.x |
| Backend | Rust stable |
| Frontend | React 19 + TypeScript strict |
| Build | Vite |
| Editor | CodeMirror 6 |
| State | Zustand 5 |
| Styling | Tailwind CSS 3 |
| Search | Tantivy (запланировано) |
| Vector DB | LanceDB (запланировано) |
| Embeddings | Ollama (запланировано) |
| Markdown | pulldown-cmark |
