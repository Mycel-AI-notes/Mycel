# Mycel — Knowledge Base Directory Spec

**Версия:** 0.1
**Дата:** 2026-05
**Зависимости:** Mycel spec 0.2, Database spec 0.1

---

## 0. TL;DR

Любая директория в vault может стать Knowledge Base (KB). Правый клик по папке → "Превратить в базу знаний" → создаётся `index.md` внутри папки с автогенерированным `db`-блоком, который отображает все `.md` файлы директории (кроме самого `index.md`). При клике на KB-папку в сайдбаре открывается `index.md`. Данные хранятся в `.db.json` рядом с папкой по стандарту Database spec. KB доступна в общем меню баз данных.

---

## 1. Активация

### Правый клик по папке в сайдбаре

```
📂 papers/
  ├── ...

  [Right Click]
  ┌─────────────────────────────┐
  │ 📄 New note                 │
  │ 📂 New folder               │
  │ ─────────────────────────── │
  │ 🌿 Превратить в базу знаний │
  │ ─────────────────────────── │
  │ ✏️  Rename                   │
  │ 🗑  Delete                   │
  └─────────────────────────────┘
```

### Что происходит при активации

1. Создаётся файл `papers/index.md` с автогенерированным содержимым (см. раздел 3)
2. Создаётся файл `papers.db.json` рядом с папкой (не внутри) — по стандарту Database spec
3. В `.mycel/kb-dirs.json` добавляется запись `{ "path": "papers", "db": "papers.db.json" }`
4. Иконка папки в сайдбаре меняется на 🗃
5. Клик на папку в сайдбаре теперь открывает `index.md` вместо разворачивания дерева

### Структура на диске

```
my-vault/
├── papers/
│   ├── index.md              ← KB-страница (зарезервирована)
│   ├── attention-is-all.md
│   ├── dpo-paper.md
│   └── rlhf-overview.md
├── papers.db.json            ← база данных KB (рядом с папкой)
└── .mycel/
    └── kb-dirs.json          ← реестр KB-директорий
```

`papers.db.json` лежит рядом с папкой, а не внутри — чтобы не попадать в собственную базу и не захламлять директорию.

### `.mycel/kb-dirs.json`

```json
{
  "version": 1,
  "dirs": [
    {
      "path": "papers",
      "db": "papers.db.json",
      "created_at": "2026-05-11T14:32:00Z"
    },
    {
      "path": "books/read",
      "db": "books/read.db.json",
      "created_at": "2026-05-10T09:00:00Z"
    }
  ]
}
```

---

## 2. Схема базы данных KB

При активации автоматически создаётся `papers.db.json` с дефолтной схемой:

```json
{
  "version": 1,
  "schema": {
    "title": {
      "type": "text",
      "label": "Title",
      "width": 300
    },
    "tags": {
      "type": "multi-select",
      "label": "Tags",
      "options": [],
      "width": 200
    },
    "status": {
      "type": "select",
      "label": "Status",
      "options": ["todo", "in-progress", "done"],
      "width": 120
    },
    "notes": {
      "type": "rich-text",
      "label": "Notes",
      "width": 250
    }
  },
  "views": {
    "default": {
      "label": "All files",
      "visible_columns": ["title", "tags", "status", "notes"],
      "sort": null,
      "filters": []
    }
  },
  "rows": []
}
```

### Строки — синхронизация с файлами

Каждый `.md` файл в директории (кроме `index.md`) = одна строка в `rows`.

```json
{
  "id": "uuid-v4",
  "page": "papers/attention-is-all.md",
  "title": "Attention Is All You Need",
  "tags": ["transformers", "attention"],
  "status": "done",
  "notes": "Ключевая статья по архитектуре [[transformer]]"
}
```

Поле `page` — стандартный page-link из Database spec. Клик → открывает файл в редакторе.

Поле `title` — по умолчанию берётся из:
1. YAML frontmatter `title:` если есть
2. Первого заголовка `# H1` если есть
3. Имени файла без расширения

### Синхронизация файлов ↔ строк

FS watcher следит за директорией. События:

| Событие | Действие |
|---|---|
| Создан новый `.md` (не `index.md`) | Добавить строку в `rows` с auto-filled `title` |
| Удалён `.md` файл | Удалить строку из `rows` |
| Переименован `.md` файл | Обновить `page` в соответствующей строке |
| Изменён `.md` файл | Переспарсить `title` из frontmatter/H1 если изменился |

`index.md` всегда игнорируется — не попадает в базу.

Подпапки игнорируются — рекурсии нет.

---

## 3. index.md

### Автогенерированное содержимое при создании KB

````markdown
---
kb: true
dir: papers
---

# papers

```db
source: ../papers.db.json
view: default
```

<!-- Свободный текст ниже — редактируй как обычную заметку -->
````

Frontmatter `kb: true` — маркер для Mycel что это KB-страница. `dir` — относительный путь к директории.

### Поведение в редакторе

`index.md` открывается как обычная заметка. `db`-блок рендерится как таблица (стандартный Database рендерер). Ниже таблицы — свободное пространство для текста, ссылок, заметок о коллекции.

Пользователь может:
- Добавлять колонки в таблицу
- Менять view (фильтры, сортировка)
- Писать свободный текст под таблицей
- Переименовать заголовок `# papers`

Пользователь не может:
- Удалить `db`-блок через UI (кнопка удаления заблокирована для KB db-блока)
- Удалить `index.md` через сайдбар пока папка является KB (показывается предупреждение)

---

## 4. Сайдбар

### Иконки и поведение

```
🗃 papers/                    ← KB-папка, иконка отличается
   ├── 📄 attention-is-all
   ├── 📄 dpo-paper
   └── 📄 rlhf-overview
```

**Одиночный клик на 🗃 papers/** → открывает `index.md` (KB-страница)
**Стрелка/треугольник** → разворачивает/сворачивает дерево файлов как обычно

Обе операции доступны независимо — клик на иконку/название открывает KB, клик на стрелку разворачивает.

### Правый клик на KB-папку

```
🗃 papers/
  [Right Click]
  ┌──────────────────────────────────┐
  │ 📄 New note                      │
  │ 📂 New folder                    │
  │ ────────────────────────────────  │
  │ 📖 Open Knowledge Base           │
  │ ⚙️  KB Settings                   │
  │ 🔓 Разжаловать в обычную папку   │
  │ ────────────────────────────────  │
  │ ✏️  Rename                        │
  │ 🗑  Delete                        │
  └──────────────────────────────────┘
```

---

## 5. Меню баз данных

KB-директории появляются в общем списке баз данных наравне с `.db.json` файлами.

```
📊 Databases                              [ + New database ]

  Standalone
  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
  📊  books.db.json                   24 rows
  📊  tasks.db.json                    8 rows

  Knowledge Bases
  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
  🗃  papers/                          3 files
  🗃  books/read/                     12 files
```

Клик на KB в этом меню → открывает `index.md` соответствующей директории.

---

## 6. KB Settings

`⚙️ KB Settings` из правого клика → modal:

```
⚙️ Knowledge Base Settings — papers/

  Columns ──────────────────────────────────
  [Manage columns →]   (открывает стандартный column manager)

  Sync ─────────────────────────────────────
  [✓] Auto-sync files on change
  [ ] Include in GitHub sync (attachments)

  Danger Zone ──────────────────────────────
  [🔓 Разжаловать в обычную папку]
```

---

## 7. Разжалование

"Разжаловать в обычную папку":

1. Убрать запись из `.mycel/kb-dirs.json`
2. Иконка папки возвращается к обычной 📂
3. Клик на папку снова разворачивает дерево
4. `index.md` остаётся как обычная заметка — не удаляется
5. `papers.db.json` остаётся на диске — не удаляется
6. Показывается уведомление: "papers/ больше не является KB. index.md и papers.db.json сохранены."

Данные не теряются. Повторная активация KB подхватит существующий `papers.db.json`.

---

## 8. Tauri Commands

```rust
// commands/kb.rs

/// Активировать директорию как KB
kb_init(dir_path: String) -> Result<KbInitResult>
// KbInitResult: { index_path, db_path, rows_created: u32 }

/// Деактивировать KB (разжаловать)
kb_deinit(dir_path: String) -> Result<()>

/// Список всех KB в vault
kb_list() -> Result<Vec<KbEntry>>

/// Синхронизировать файлы директории с rows в .db.json
/// Вызывается FS watcher'ом при изменениях в KB-директории
kb_sync_files(dir_path: String) -> Result<KbSyncResult>
// KbSyncResult: { added: u32, removed: u32, updated: u32 }

/// Получить мета-информацию KB
kb_info(dir_path: String) -> Result<KbInfo>
// KbInfo: { dir, db_path, index_path, file_count, schema }
```

### Модели

```rust
#[derive(Serialize, Deserialize)]
struct KbEntry {
    path: String,        // "papers"
    db: String,          // "papers.db.json"
    created_at: String,  // ISO 8601
}

#[derive(Serialize, Deserialize)]
struct KbDirsConfig {
    version: u32,
    dirs: Vec<KbEntry>,
}
```

---

## 9. Frontend компоненты

```
src/components/
├── sidebar/
│   └── KbFolderRow.tsx          # Строка KB-папки в сайдбаре (иконка 🗃, клик → index.md)
├── kb/
│   ├── KbContextMenu.tsx        # Правый клик — пункты KB
│   ├── KbSettingsModal.tsx      # ⚙️ KB Settings
│   ├── KbInitConfirm.tsx        # Подтверждение при активации
│   └── KbDeinitConfirm.tsx      # Подтверждение при разжаловании
└── database/
    └── DatabasesMenu.tsx        # Обновить: добавить секцию Knowledge Bases
```

---

## 10. Edge cases

| Ситуация | Поведение |
|---|---|
| `index.md` уже существует в папке до активации KB | Показать диалог: "index.md уже существует. Использовать его как KB-страницу?" Если да — добавить frontmatter и db-блок в начало файла |
| `papers.db.json` уже существует рядом | Использовать существующий, не перезаписывать. Синхронизировать файлы с существующими rows |
| Папка переименована снаружи (через Finder/Explorer) | FS watcher обнаруживает → обновить path в `kb-dirs.json`, обновить `source` в `index.md`, переименовать `.db.json` |
| KB-папка удалена снаружи | Убрать из `kb-dirs.json`, показать уведомление |
| Файл `index.md` удалён снаружи | Предложить восстановить при следующем открытии папки |
| Вложенные KB (KB внутри KB) | Разрешено. Каждая директория независима. Файлы вложенной KB не попадают в родительскую (папки игнорируются) |

---

## 11. Что НЕ делаем в v1

- Рекурсивный обход поддиректорий
- Несколько views для одной KB (только `default`)
- Шаблоны схемы при создании (дефолтная схема для всех)
- Автоматическое заполнение колонок из frontmatter файлов (только `title`)
- Drag-and-drop файлов между KB
- Экспорт KB в CSV

---

## 12. Acceptance Criteria

- Правый клик по папке `papers/` → "Превратить в базу знаний" → создались `papers/index.md` и `papers.db.json` → папка получила иконку 🗃
- Клик на 🗃 papers/ → открылся `index.md` с db-таблицей. В таблице строки для каждого `.md` файла (кроме `index.md`)
- Создал новый файл `papers/new-paper.md` → через < 1с появился в таблице
- Удалил `papers/old.md` → строка исчезла из таблицы
- Отредактировал ячейку `status` → изменение записалось в `papers.db.json`
- Клик на 📄 в строке → открылся соответствующий `.md` файл
- Меню Databases → секция Knowledge Bases → papers/ присутствует → клик → открыл index.md
- Разжаловал → иконка 📂, клик разворачивает дерево, `index.md` и `papers.db.json` живы
- Повторная активация → подхватил существующий `papers.db.json`, данные не потеряны
- `index.md` не появляется как строка в своей же таблице
