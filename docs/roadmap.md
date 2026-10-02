# Роадмап Mycel — обновление 02.10.2026

Основа: [аудит от 30.09.2026](audit/2026-09-30-repo-audit.md) (все баги закрыты,
остались «точки роста») + рынок на октябрь 2026. Источники внизу.

## Что изменилось на рынке

1. **Заметки стали рабочим местом для AI-агентов.** Vault на `.md` +
   MCP-сервер — уже стандартный ход: SoloMD («bundled MCP server lets Claude
   Code / Codex / Cursor drive your vault»), Tolaria (Claude/Gemini/Codex CLI
   + MCP), Atomic, десятки `obsidian-mcp` серверов. Mycel — local-first, на
   `.md`, на Tauri 2 — это ровно та ниша; MCP-сервера у нас нет.
2. **Obsidian закрывает «базы данных».** Bases получил kanban (1.14.0,
   сентябрь 2026), в плане — calendar view; есть Airtable-импорт, CLI,
   headless Sync, iOS Share Sheet. Наши inline-базы `mycel-db` перестают быть
   уникальными по факту наличия — выигрывать надо **редактированием и
   удобством**, а не самим фактом табличек.
3. **Жалобы пользователей на всех:** нет совместной работы, граф
   бесполезен после пары сотен заметок, задачи «через плагины и коды»,
   падение производительности на 5k+ заметок (Logseq). Garden/GTD и индекс на
   SQLite бьют ровно сюда.
4. **Локальные эмбеддинги стали дешёвыми:** EmbeddingGemma (308M, <200 МБ
   RAM, мультиязычный, работает через Ollama/llama.cpp) и nomic/bge-m3 в
   Ollama. Требовать платный OpenRouter-ключ для семантического поиска больше
   не оправдано.
5. **Tauri 2 mobile «работает, но с шероховатостями»** (плагины, подпись,
   webview). Для read-only/capture компаньона годится, для основного клиента —
   рано. Десктоп-релизы требуют подписи/нотаризации и updater (minisign).

## Что уже есть (README-роадмап отставал)

Убираем из «будущего»: LaTeX (KaTeX), картинки/вложения, шифрование `.md.age`
с аппаратным ключом, AI-индекс и семантический поиск (через OpenRouter),
Garden/GTD, Present mode, KB-директории, quick-note auto-filing, корзина,
автосохранение, CI.

## План

Порядок важен: сначала то, без чего не уходят с Obsidian, потом то, чем
выигрываем.

### Фаза 1 — Индекс и поиск (1–2 недели) · P0
- SQLite **FTS5** в существующий `.mycel/ai/index.db`, инкрементально из
  `core/watcher.rs`. Полнотекстовый поиск `⌘⇧F` с операторами `path:` `tag:`
  `file:` `-`. Бесплатно, офлайн.
- Тот же индекс — источник для бэклинков, тегов, графа, `notes_list`
  (закрывает остатки перформанс-пунктов P2).
- **Локальные эмбеддинги по умолчанию** (Ollama: EmbeddingGemma/nomic) за
  существующим трейтом `embedder.rs`; OpenRouter остаётся опцией. Трейт и для
  chat-провайдера вместо захардкоженного `openrouter.rs`.
- Закрыть открытые баги баз: #16, #18, #26 (длинные ячейки, 1 колонка).

### Фаза 2 — Привычки пользователя Obsidian (1–2 недели) · P0/P1
- Командная палитра `⌘P` + настраиваемые хоткеи.
- Daily notes + шаблоны, `aliases` во frontmatter.
- Embeds `![[Note]]` (парсер уже умеет, UI пропускает), unlinked mentions,
  локальный граф, панель unresolved links, закладки.
- Редактор properties (frontmatter) — особенно ценно в паре с `mycel-db`.

### Фаза 3 — Агентный слой (2–3 недели) · P1, главный рычаг
- **MCP-сервер Mycel** (stdio, отдельный бинарь или режим `mycel --mcp`):
  `search`, `read_note`, `append`, `create`, `backlinks`, `list_tags`,
  `query_db`. Шифрованные заметки — недоступны без разблокировки, явно.
- Права и журнал: агент пишет только в выбранные папки, каждое изменение
  видно в git/корзине (у нас это уже есть — это наше преимущество перед
  конкурентами).
- Вопросы к vault (RAG на локальном индексе) в UI.
- Дифференциатор: **Garden + MCP** — агент разбирает inbox, готовит weekly
  review, раскладывает quick-заметки (фича filing уже есть).

### Фаза 4 — Дистрибуция (параллельно с 3) · P1
- Подписанные релизы: Apple notarization, Windows signing, Tauri updater
  (minisign) + GitHub Releases workflow. Без этого «скачал и поставил» не
  работает, и все фичи выше никто не увидит.
- Сайт/лендинг, демо-GIF, пост-запуск на Hacker News / Product Hunt / Telegram.
- Импорт из Obsidian (vault уже `.md`; нужны callouts, properties, Bases-файлы
  → `mycel-db`).

### Фаза 5 — Дифференциация (после 1–4) · P2
- Inline-базы: kanban и calendar view (догоняем Bases), формулы, relation
  между базами, импорт CSV/Airtable.
- Минимальный плагинный API (slash-команды, панели, декорации). Это ров
  Obsidian; делать после стабилизации внутренних API.
- Иерархия KB (issue #23), «git-grid активности» (#25).
- Тесты синка (#28), «local things integration» (#32) — уточнить, что это.

### Дальше / под вопросом · P3
- **Мобильный компаньон** (read-only + capture), через Tauri 2 mobile —
  только после того, как дистрибуция на десктопе заработала. Альтернатива:
  PWA/capture через Telegram-бота (у вас он уже есть) в `quick/`.
- Совместная работа (CRDT) — дорого, у Obsidian тоже ещё в планах; не
  гнаться.
- Community-темы, публикация заметок (Publish-аналог).

## Рекомендация

Начать с **Фазы 1**, затем сразу **Фазу 3** (MCP), а Фазу 2 делать кусками.
Причина: полнотекстовый поиск — единственный блокер перехода с Obsidian;
MCP — самый заметный сейчас тренд, где Mycel может попасть в «заметки для
агентов» быстрее, чем Obsidian-плагины, потому что у нас уже есть
шифрование, корзина и git-синк как гарантии безопасности для записи агентом.

## Что я не смог проверить

- Страницу `obsidian.md/roadmap` напрямую не открыл (доступ из контейнера
  закрыт), опирался на сводки поисковика и changelog 1.14.x.
- SoloMD, Atomic, Open Science знаю только по описаниям в результатах
  поиска; Tolaria — по README.
- «Tauri mobile готов только для простых кейсов» — оценка из обзорных
  статей, не мои замеры.

## Источники

- [Obsidian changelog 1.14.3](https://obsidian.md/changelog/2026-09-29-desktop-v1.14.3/), [1.14.0](https://obsidian.md/changelog/2026-09-02-desktop-v1.14.0/), [Obsidian roadmap](https://obsidian.md/roadmap/)
- [The 2026 Obsidian Report Card](https://practicalpkm.com/2026-obsidian-report-card/)
- [Markdown in 2026: Not Just for Writing Anymore](https://kurtis-redux.medium.com/markdown-in-2026-not-just-for-writing-anymore-d4433fa1ec9a)
- [SoloMD](https://github.com/zhitongblog/solomd), [Tolaria](https://github.com/refactoringhq/tolaria), [Show HN: Atomic](https://news.ycombinator.com/item?id=47889110)
- [Obsidian MCP Server: Connect Your Notes to AI Coding Agents](https://www.morphllm.com/obsidian-mcp-server)
- [EmbeddingGemma](https://developers.googleblog.com/introducing-embeddinggemma/), [Ollama embeddings](https://docs.ollama.com/capabilities/embeddings)
- [Tauri 2](https://v2.tauri.app/), [Tauri code signing (DEV)](https://dev.to/tomtomdu73/ship-your-tauri-v2-app-like-a-pro-code-signing-for-macos-and-windows-part-12-3o9n)
- [Top 10 PKM apps 2026](https://guptadeepak.com/tools/top-10-note-taking-pkm-apps-2026/), [Logseq vs Obsidian](https://itsfoss.com/comparison/obsidian-vs-logseq/)
