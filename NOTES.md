# NOTES — VS Code-расширение «Agent Crew» v0

Рабочий журнал реализации `SPEC-vscode.md`: расхождения ТЗ с документацией и реальностью, принятые решения, контракт с плагином и открытые вопросы. Сверено с Claude Agent SDK **0.3.283** (Claude Code 2.1.283), VS Code 1.139.1 и 1.90.0, `@vscode/vsce` 4.0.0 — 26.09.2026.

## Журнал по шагам ТЗ (§14)

| Шаг | Что сделано | Проверка |
| --- | --- | --- |
| 1. Скелет, сборка, плагин, CI до `vsce package` | esbuild → `dist/extension.js` (CJS), Vite → `dist/webview/chat.{js,css}`, `scripts/copy-plugin.mjs`, `scripts/stage-sdk.mjs`, `scripts/package.mjs`, `.github/workflows/ci.yml` | `vsce package --target darwin-arm64` → 94.7 МБ VSIX, бинарь сохраняет `rwxr-xr-x` |
| 2. `session.ts` + Output Channel | `CrewSession` (streaming input, start/send/interrupt/close/resume), лог «Crew» (LogOutputChannel) с редактированием секретов | юнит-тесты `session.test.ts`; живой прогон SDK с плагином — см. «Проверено вживую» |
| 3. Watcher, парсер `.crew/`, дерево задач, статус-бар | `crew/watcher.ts`, `crew/parser.ts`, `crew/snapshot.ts`, `views/tasksTree.ts`, `views/statusBar.ts` | юнит + интеграционный тест «follows task changes live» |
| 4. Webview чата, эскалации, уведомления | React-чат, `crew/escalations.ts`, `agent/permissions.ts`, уведомления с кнопками | юнит `escalations/permissions/controller`, интеграционный «answers an escalation» |
| 5. Бюджет, resume, Workspace Trust, SecretStorage | `crew/budget.ts`, `controller.ts`, `secrets.ts` | юнит + интеграционные «budget cap», «never exposes the API key», «untrusted workspace» |
| 6. Walkthrough, README, CHANGELOG | 3 шага walkthrough, README/CHANGELOG/SUPPORT/LICENSE | `vsce package` без WARNING |
| 7. Модуль лицензии (выключен) | `license.ts`: `LicenseProvider` (Polar, Lemon Squeezy), кэш 7 дней, офлайн по кэшу, проверки только при старте | `license.test.ts`, покрытие 100% строк |
| 8. Pre-release в оба маркетплейса | `.github/workflows/release.yml` (Entra ID + Open VSX) | **не опубликовано** — нужны учётки и настоящий плагин, см. «Что нужно от вас» |

Шаги 1–5 и 7 написаны за один проход, поэтому в git они лежат несколькими крупными коммитами, а не восемью (промежуточные коммиты по шагам не собирались бы).

## Расхождения с ТЗ и решения

1. **Agent SDK требует нативный бинарь Claude Code.** Пакет `@anthropic-ai/claude-agent-sdk` ставит бинарь через optional dependency под платформу (`@anthropic-ai/claude-agent-sdk-<platform>`, ~215 МБ, ~95 МБ в VSIX). Отдельно ставить Claude Code CLI не нужно, но бинарь платформенный, поэтому по §12 сборки идут через `--target` (8 таргетов: linux/alpine/darwin/win32 × x64/arm64; `linux-armhf` не поддержан SDK). Есть и универсальная сборка без бинаря (`node scripts/package.mjs --universal`): тогда нужен `crew.claudeCodePath` или `claude` в `PATH`. Проверка при активации и шаг walkthrough «Check dependencies» есть (§3/§6).
2. **SDK — только ESM, и из бандла он не находит свой бинарь.** SDK не бандлится: `scripts/stage-sdk.mjs` кладёт самодостаточный `sdk.mjs` в `dist/sdk/`, расширение (CJS) грузит его через `import()`. Путь к бинарю передаётся явно (`pathToClaudeCodeExecutable`). Порядок поиска: `crew.claudeCodePath` → `dist/bin/claude` → `claude` в `PATH`.
3. **Команды плагина в SDK неймспейсятся:** `/agent-crew:new-project`, а не `/new-project`. Расширение само переписывает `/new-project|/feature|/status` в неймспейс плагина.
4. **`/status` — встроенная команда Claude Code.** «Crew: Status» и клик по статус-бару при активной сессии отправляют `/agent-crew:status`. Без сессии показывается локальная сводка из `.crew/`: сессию ради статуса не запускаем, деньги не тратим.
5. **Переменные `CLAUDECODE` / `CLAUDE_CODE_*` от родительского процесса ломают авторизацию.** Проверено вживую: с ними дочерний CLI игнорирует `ANTHROPIC_API_KEY` (`apiKeySource: none`, «Not logged in»), без них берёт ключ (`apiKeySource: ANTHROPIC_API_KEY`). Такое бывает, если VS Code запущен из терминала Claude Code. `buildSessionEnv` вычищает эти переменные и конкурирующие `ANTHROPIC_AUTH_TOKEN` и `CLAUDE_CODE_OAUTH_TOKEN`.
6. **Стоимость в SDK приходит только в конце хода** (`result.total_cost_usd`, накопительная по сессии; при resume продолжает сохранённый итог). Контроль потолка поэтому в три слоя: (а) `maxBudgetUsd = потолок − уже потрачено` — жёсткий стоп внутри CLI (`error_max_budget_usd`); (б) опрос `query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()` раз в 15 с во время хода — экспериментальный API, после первой ошибки отключается; (в) проверка после каждого `result`. Потолок считается на проект: сумма по всем сессиям из `.crew/costs.log`, по каждой сессии берётся максимальный накопленный итог. `crew.budgetCapUsd = 0` — без потолка.
7. **Публикация в Marketplace.** Официальная документация подтверждает `vsce publish --azure-credential` (Microsoft Entra ID) и отключение глобальных PAT 1 декабря 2026. В `release.yml` так и сделано: `azure/login@v2` (OIDC, `allow-no-subscriptions`) + `--azure-credential`. В `vsce` 4.0 есть и более простой вариант — `vsce publish --oidc` (Trusted Publishing: политика настраивается прямо в Marketplace, без Azure-идентичности). Если настройка Entra ID окажется тяжёлой, достаточно заменить шаг `azure/login` + флаг на `--oidc`.
8. **`vsce package` печатает `The file extension/dist/bin/claude is large (214.61 MB)`.** Это информационная строка, не `WARNING`, и она неизбежна при бандле бинаря. Лимит размера VSIX в Marketplace не документирован; в Open VSX, по сообщениям, около 250 МБ, у нас ~95 МБ.
9. **Restricted Mode.** `capabilities.untrustedWorkspaces.supported: false` выключает установленное расширение в непроверенном workspace. VS Code не применяет это к расширению из `--extensionDevelopmentPath`, а `@vscode/test-electron` всегда передаёт `--disable-workspace-trust`. Поэтому (а) в контроллере есть второй барьер `workspace.isTrusted`, (б) недоверенный сценарий гоняется своим раннером `scripts/test-untrusted.mjs` и проверяет, что ни один запрос к SDK не стартует.
10. **Webview собран без `<form>`:** при `enableForms: false` (строгий режим) submit не срабатывает, поэтому используются кнопки и Enter.
11. **`engines.vscode: ^1.90.0`, `@types/vscode` 1.90.0** — ради Cursor и Windsurf, которые отстают от upstream. Интеграционные тесты проходят и на 1.90.0, и на 1.139.1. «Show Diff» пользуется `vscode.changes` (многофайловый diff), а где его нет — выбором файла и `vscode.diff`.
12. **TypeScript 6.0**, а не 7.0: `typescript-eslint` пока поддерживает `<6.1`.
13. **Язык UI — английский** (Marketplace). Русская локализация (`package.nls.ru.json` + `vscode.l10n`) — задача на будущее.
14. **Настройки сессии:** `settingSources: ['project', 'local']`, то есть CLAUDE.md и `.claude/settings*.json` проекта применяются, а глобальные настройки пользователя нет. Так политика прав определяется плагином, а не личным `~/.claude`. `permissionMode: 'default'`: всё, что не решили хуки плагина, приходит в `canUseTool` и становится эскалацией (§8).
15. **Телеметрия (§10):** облачного бэкенда в v0 нет (§2), поэтому `TelemetryLogger` пишет события только в лог «Crew» на уровне debug. Уважается глобальный переключатель VS Code (через `createTelemetryLogger`) и `crew.telemetry.enabled`. Общие свойства VS Code отключены (`ignoreBuiltInCommonProperties`).

## Контракт с плагином agent-crew (предположения — сверить с SPEC.md плагина)

`SPEC.md` плагина и сам плагин в этом репозитории отсутствуют. Формат ниже — моё предположение; парсер к нему терпим (frontmatter или строки `Key: value`, английские и русские ключи и статусы, синонимы).

- **Имя плагина:** `agent-crew`; команды `new-project`, `feature`, `status`.
- **`.crew/tasks/T-xxx.md`:** frontmatter `id, title, status (todo|in_progress|review|done|blocked), assignee, attempts, branch?, base?, files?`. По `branch`/`base` работает «Show Diff» (diff веток через Git API); без них — diff файлов `files` или всех незакоммиченных изменений.
- **`.crew/escalations/E-xxx.md`:** `id, status (open|answered|resolved|cancelled), kind (question|permission|brief-review), task?, agent?, options: [...]`, секции `## Question`, `## Options`, `## Answer`. Ответ расширение записывает в тот же файл (`status: answered`, `answer`, `answered_at`, секция `## Answer`) и отправляет в сессию сообщение `Answer to escalation E-xxx (…): …`. Эскалации от `AskUserQuestion` и запросов прав расширение само пишет в этот каталог, чтобы `.crew/` оставался источником правды.
- **`kind: brief-review`:** так плагин просит одобрить бриф. При `crew.autonomy=review` расширение показывает эскалацию и через `briefReviewMinutes` отвечает `Approve` автоматически; при `full` одобряет сразу.
- **`.crew/decisions/ADR-*.md`**, **`.crew/status.md`** (`phase` во frontmatter + первый абзац), **`.crew/brief.md`**.
- **`.crew/costs.log`** — пишет расширение: `ISO-время session=<id> turn_cost_usd=… session_total_usd=… source=sdk`. Парсер понимает также JSON-строки и `время $сумма`.
- **Переменные окружения для плагина:** `CREW_HOST=vscode`, `CREW_AUTONOMY`, `CREW_BRIEF_REVIEW_MINUTES`, `CREW_STACK_PROFILE`, `CREW_BUDGET_CAP_USD`.

## Проверено вживую / не проверено

- ✅ Реальный SDK 0.3.283 с реальным бинарём: плагин из `plugins: [{type:'local'}]` грузится при `settingSources: []`, команда видна как `agent-crew:new-project`, `sdk.mjs` работает из произвольного каталога. Этим снят главный технический риск из прошлой памяти проекта.
- ✅ Наши `CrewSession` + `EventMapper` + `resolveRuntime` на реальном SDK и бинаре из `dist/` (с плагином-заглушкой и фейковым ключом): `init` показывает плагин и все три команды `agent-crew:*`, `apiKeySource: ANTHROPIC_API_KEY` при унаследованных `CLAUDE_CODE_*`. С неверным ключом CLI уходит в 10 ретраев `authentication_failed`, поэтому контроллер останавливает сессию на первом таком ретрае (и на `billing_error`) с понятным сообщением.
- ✅ 120 юнит-тестов (Vitest); покрытие `parser.ts` 100% строк / 92% веток, `events.ts` 100% / 89%, `license.ts` 100% / 97% (порог 80% зашит в `vitest.config.mts`).
- ✅ Интеграционные тесты в VS Code 1.139.1 и 1.90.0: команды, манифест, живое обновление задач, открытие брифа и статуса, загрузка React-webview, сквозная сессия с фейковым SDK (ключ не утекает в webview, лог и настройки, даже если агент его печатает), стоп по бюджету, ответ на эскалацию, недоверенный workspace.
- ❌ **Сквозной прогон с настоящими агентами** (`/new-project` до финального отчёта, §13): нужны `ANTHROPIC_API_KEY` и настоящий плагин `agent-crew`.
- ❌ **Cursor/Windsurf** — ручная проверка через `.vsix` (§13).
- ❌ **Перезагрузка окна → resume** — логика покрыта юнит-тестами (`dispose` сохраняет `running`, `offerResume`), вживую не проверялась.
- ❌ **Кнопки в уведомлениях** — автотестами не нажать; путь ответа тот же, что у чата, и покрыт юнит-тестами.

## Что нужно от вас

1. **Плагин `agent-crew`:** путь для сборки (`AGENT_CREW_PLUGIN_DIR`, по умолчанию `../agent-crew`) и репозиторий для CI (переменная `AGENT_CREW_PLUGIN_REPO`, для приватного — секрет `AGENT_CREW_PLUGIN_TOKEN`). Без него CI собирает против тестовой заглушки, а `verify-dist` не даст упаковать заглушку на публикацию.
2. **Идентичность в Marketplace:** `publisher` (сейчас `agent-crew`), `repository`/`bugs`/`homepage` (сейчас `github.com/agent-crew/agent-crew-vscode`) — это заглушки.
3. **LICENSE:** сейчас проприетарный текст-заглушка. Выбор лицензии — ваше решение.
4. **Юридическая проверка:** расширение распространяет бинарь Claude Code и SDK (© Anthropic, «All rights reserved», условия по ссылке в `LICENSE`). SDK рассчитан на встраивание в приложения, но редистрибуцию внутри VSIX стоит подтвердить.
5. **Публикация:** Azure managed identity или app registration с federated credential (issuer `https://token.actions.githubusercontent.com`, subject `repo:<owner>/<repo>:environment:marketplace`), добавленная в publisher Marketplace; переменные `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`; GitHub environment `marketplace`; секрет `OVSX_PAT` и namespace в Open VSX (`npx ovsx create-namespace agent-crew`).
6. **GIF для README:** записать на живом прогоне и вставить https-ссылками (SVG в README запрещены).
7. **Модуль лицензии:** включить — `LICENSE_MODULE_ENABLED = true` и `LICENSE_PROVIDER_CONFIG` (id организации Polar или store/product Lemon Squeezy) в `src/license.ts`, плюс `"pricing": "Trial"` в `package.json`.

## Сборка и проверка

```bash
npm ci
AGENT_CREW_PLUGIN_DIR=../agent-crew npm run build     # или test/fixtures/agent-crew-stub для локальной проверки
npm run lint                                          # ESLint + tsc (расширение, webview, тесты)
npm run test:unit                                     # Vitest + покрытие
npm run test:integration                              # VS Code (trusted) + свой раннер (untrusted)
node scripts/package.mjs --target darwin-arm64        # VSIX; 0.ODD.x автоматически --pre-release
code --install-extension vsix/agent-crew-darwin-arm64-0.1.0.vsix
```
