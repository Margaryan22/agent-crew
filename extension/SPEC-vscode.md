# ТЗ: VS Code-расширение «Agent Crew» v0

> **Заменено 29.09.2026** архитектурой «пульт» (PLAN.md, раздел A): агенты работают в официальном Claude Code на подписке пользователя, а расширение (с версии 0.3.0) — только установка, запуск и прогресс. Ниже — исходное ТЗ версии 0.1 с SDK-движком, оставлено для истории.

> Расширение — UI-обёртка над плагином `agent-crew` (см. `SPEC.md`). Логика агентов, скилы и хуки живут в плагине; расширение их не дублирует.
> Перед началом сверься с актуальной документацией:
> - Claude Agent SDK (TypeScript): https://code.claude.com/docs/en/agent-sdk/overview.md
> - VS Code Extension API: https://code.visualstudio.com/api
> - Публикация: https://code.visualstudio.com/api/working-with-extensions/publishing-extension
>
> Расхождения ТЗ с документацией фиксируй в `NOTES.md` и следуй документации.

## 1. Цель

Дать фрилансеру или студии запуск команды агентов из IDE: чат, прогресс задач, эскалации, расходы — без терминала. Работает в VS Code, Cursor, Windsurf.

## 2. Scope v0

**Входит:** чат-панель, дерево задач, статус-бар бюджета, эскалации, команды, хранение ключа API, публикация в VS Code Marketplace и Open VSX, модуль лицензии (выключен по умолчанию).

**Не входит:** облачный бэкенд, биллинг кредитами, веб-дашборд, JetBrains, web-версия расширения.

## 3. Технологии

- TypeScript strict, сборка esbuild (один бандл для extension host, отдельный для webview).
- `@anthropic-ai/claude-agent-sdk` — цикл агента. Плагин `agent-crew` подключается через опцию `plugins` с локальным путём (плагин поставляется внутри расширения в `resources/plugin/`).
- Webview: React + Vite, стили только через CSS-переменные темы VS Code (`--vscode-*`), без UI-китов с внешними ресурсами.
- Тесты: `@vscode/test-cli` + `@vscode/test-electron` (интеграционные), Vitest (юнит).
- Менеджер пакетов: npm.

Проверь, требует ли Agent SDK установленного Claude Code CLI или отдельного бинаря. Если требует — проверка при активации и walkthrough с инструкцией (п. 6).

## 4. Структура

```
/
├── src/
│   ├── extension.ts            # activate/deactivate, регистрация
│   ├── agent/
│   │   ├── session.ts          # обёртка над Agent SDK: старт, стоп, resume
│   │   ├── events.ts           # маппинг событий SDK → события UI (типизировано)
│   │   └── permissions.ts      # обработка запросов прав (п. 8)
│   ├── crew/
│   │   ├── watcher.ts          # FileSystemWatcher на .crew/**
│   │   ├── parser.ts           # парсинг tasks/*.md, status.md, escalations/*.md, costs.log
│   │   └── model.ts            # типы: Task, Escalation, Budget
│   ├── views/
│   │   ├── chatView.ts         # WebviewViewProvider
│   │   ├── tasksTree.ts        # TreeDataProvider
│   │   └── statusBar.ts
│   ├── secrets.ts              # SecretStorage для ключа API
│   ├── license.ts              # модуль лицензии (п. 11)
│   └── telemetry.ts
├── webview/                    # React-приложение чата
├── resources/
│   ├── plugin/                 # копия плагина agent-crew (сборочный шаг)
│   └── icon.png                # PNG ≥ 128×128, не SVG
├── test/
├── package.json
├── .vscodeignore
├── README.md  CHANGELOG.md  LICENSE  SUPPORT.md
└── NOTES.md
```

## 5. UI

### Activity Bar → контейнер «Crew»
1. **Чат (WebviewView).** Ввод идеи и сообщений; стрим ответов по агентам (имя агента, модель, статус); блоки эскалаций с кнопками вариантов; кнопка «Стоп».
2. **Задачи (TreeView).** Группы по статусу (`todo / in_progress / review / done / blocked`). Узел задачи: название, исполнитель, попытки. Клик — открыть `tasks/T-xxx.md`. Контекстное меню: «Показать diff» (через встроенную команду `vscode.diff` или Git-расширение).
3. **Решения (TreeView).** Список `decisions/ADR-*.md`.

### Статус-бар
`$ потрачено / $ потолок` и текущий активный агент. Клик — `/status` в чате.
При 80% потолка — предупреждение; при 100% — остановка сессии (п. 9).

### Уведомления
Эскалация → `showInformationMessage` с кнопками вариантов (до 3) + «Открыть в чате». Ответ записывается так же, как ответ в чате.

## 6. Команды и настройки

**Команды (Command Palette, префикс `Crew:`):**
`newProject`, `feature`, `status`, `stop`, `resume`, `setApiKey`, `clearApiKey`, `openBrief`, `openStatus`, `enterLicense`.

**Настройки (`crew.*`):**
- `budgetCapUsd` (число, по умолчанию 20);
- `stackProfile` (enum, v0: `tanstack`);
- `autonomy` (`full` — только эскалации; `review` — показывать бриф и ждать до N минут);
- `briefReviewMinutes` (по умолчанию 10, для `review`);
- `telemetry.enabled` (по умолчанию следует `vscode.env.isTelemetryEnabled`).

**Walkthrough при первом запуске:** ключ API → проверка зависимостей → первый `/new-project` на демо-идее.

## 7. Сессии

- Одна активная сессия на workspace.
- Сессия переживает перезагрузку окна: сохранять id сессии в `workspaceState`, при активации предлагать `resume`.
- Все события сессии пишутся в Output Channel «Crew» (для отладки).
- Расширение не хранит состояние проекта само: источник правды — `.crew/` в репо.

## 8. Права и безопасность

- **Workspace Trust:** в непроверенном workspace расширение не запускает сессии (`capabilities.untrustedWorkspaces: { supported: false }`).
- **Ключ API** только в `SecretStorage`, никогда в настройках, логах и webview.
- **Права инструментов:** политика задаётся хуками плагина. В режиме `full` любой запрос права, не покрытый политикой, — это эскалация, а не диалог «разрешить?».
- **Webview:** строгий CSP, только локальные ресурсы через `asWebviewUri`, `nonce` для скриптов, типизированный обмен сообщениями с валидацией.
- **Remote/Codespaces:** `extensionKind: ["workspace"]` — расширение работает там же, где файлы проекта.

## 9. Бюджет

- Стоимость — из событий/результатов Agent SDK (проверь поля в доках), дублируется в `.crew/costs.log`.
- Потолок из `crew.budgetCapUsd`; при превышении — остановка сессии, уведомление, запись в `status.md`.

## 10. Телеметрия

Только агрегаты без содержимого кода и промтов: длительность сессии, число задач, эскалаций, итоговая стоимость, ошибки. Уважать глобальный переключатель телеметрии VS Code. Описать в README.

## 11. Лицензия (модуль, по умолчанию выключен)

- Free: 1 активный проект, профиль `tanstack`.
- Pro: без ограничения проектов, все профили стеков, приоритетные обновления.
- Ключ вводится командой `enterLicense`, хранится в `SecretStorage`, проверяется через API провайдера лицензий (Polar или Lemon Squeezy — вынести за интерфейс `LicenseProvider`).
- Кэш проверки 7 дней; без сети — работать по кэшу; никогда не блокировать уже идущую сессию.
- В `package.json`: `"pricing": "Trial"` после включения модуля.

## 12. Упаковка и публикация

**Манифест `package.json`:** `publisher`, `name`, `displayName` (уникальные в Marketplace), `engines.vscode` (минимальная версия с нужным API), `icon` (PNG), `galleryBanner`, `repository`, `categories`, `keywords` (≤ 30), `pricing`.

**Контент:** `README.md` (картинки только по https, без SVG кроме разрешённых бейджей), `CHANGELOG.md`, `LICENSE`, `SUPPORT.md`.

**`.vscodeignore`:** исключить исходники `.ts`, тесты, `webview/src`, конфиги; оставить бандлы и `resources/`.

**Версии:** релизы `0.EVEN.x`, pre-release `0.ODD.x` (`vsce publish --pre-release`).

**CI (GitHub Actions):**
1. lint → юнит-тесты → интеграционные тесты → `vsce package`.
2. Публикация по тегу:
   - VS Code Marketplace: аутентификация через Microsoft Entra ID (workload identity), не через PAT — глобальные PAT в Azure DevOps отключаются 1 декабря 2026. Проверь актуальный способ для GitHub Actions в доке по CI.
   - Open VSX (для Cursor/Windsurf): `ovsx publish` с токеном из секретов.
3. Публиковать из Linux-раннера (на Windows теряются POSIX-атрибуты файлов).

Если в зависимостях появятся нативные модули — перейти на платформенные сборки (`--target`).

## 13. Критерии приёмки

- `vsce package` без ошибок и предупреждений; `.vsix` ставится через `code --install-extension`.
- В чистом VS Code: walkthrough → ключ → `/new-project` на eval-идее доходит до финального отчёта; дерево задач обновляется в реальном времени.
- Эскалация приходит уведомлением, ответ кнопкой продолжает сессию.
- Потолок бюджета останавливает сессию.
- Перезагрузка окна → `resume` продолжает сессию.
- В непроверенном workspace сессия не стартует.
- Ключ API не встречается ни в логах, ни в настройках, ни в сообщениях webview (тест).
- Работает в Cursor (ручная проверка через `.vsix`).
- Покрытие юнит-тестами `parser.ts`, `events.ts`, `license.ts` ≥ 80%.

## 14. Порядок работы

1. Скелет расширения, сборка, копирование плагина в `resources/`, CI до `vsce package`.
2. `session.ts` + Output Channel: запуск плагина через SDK, стрим в лог.
3. Watcher + парсер `.crew/` + дерево задач + статус-бар.
4. Webview чата, эскалации, уведомления.
5. Бюджет, resume, Workspace Trust, SecretStorage.
6. Walkthrough, README с гифками, CHANGELOG.
7. Модуль лицензии (выключен).
8. Публикация pre-release в оба маркетплейса.

После каждого шага — коммит и запись в `NOTES.md`.
