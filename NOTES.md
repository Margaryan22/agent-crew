# NOTES — agent-crew

Журнал реализации `SPEC.md` по плану `PLAN.md`: что сделано на каждом шаге, расхождения с документацией и открытые вопросы. Заметки по VS Code-расширению — в `extension/NOTES.md`.

## Шаг 0 — проверки (29.09.2026, Claude Code 2.1.283)

Прогон на реальном CLI в изолированном профиле (`CLAUDE_CONFIG_DIR`), без обращений к модели.

| # | Вопрос | Результат |
|---|---|---|
| 1 | Грузятся ли вложенные группы скилов через ключ `skills` манифеста | **Да.** `skills: ["./skills/core", "./skills/commands"]` проходит `claude plugin validate --strict`. В логе: `Loaded 2 skills from plugin … custom path: …/skills/core`. Имя команды — последний сегмент: `skills/commands/new-project/SKILL.md` → `/agent-crew:new-project`. Скил с `user-invocable: false` грузится, но не показывается в списках `skills`/`slash_commands` init-сообщения. |
| 2 | Работают ли хуки во frontmatter скила **плагина** | **Регистрируются при вызове команды:** `Registered 1 hooks from skill 'agent-crew:new-project'`. Срабатывание на вызове инструмента подтвердим на первом живом прогоне (нужен вызов модели). |
| 3 | Как `userConfig` доходит до хуков | Явно заданные значения экспортируются как `CLAUDE_PLUGIN_OPTION_<KEY>` (ключ в верхнем регистре); для плагина из `--plugin-dir` ключ в `pluginConfigs` — `agent-crew@inline`. **Значения `default` из манифеста в env не попадают**, поэтому плагин подставляет значения по умолчанию сам (`resolveCrewConfig`). Переменные `CREW_*` из окружения процесса доходят до хуков. |
| 4 | Срабатывает ли `UserPromptExpansion` в `-p` | **Да**, до обращения к API: `command_name: "agent-crew:new-project"`, `command_args`, `command_source: "plugin"`, `session_id`. На этом держится пометка crew-сессии (решение 6). |
| 5 | `AskUserQuestion` и `defer` в `-p` | Не проверено: нужен вызов модели. Проверим на шаге 6 (eval-раннер). |
| 6 | Ссылки `open?prompt=` и `install-plugin` официального расширения Claude Code | Перенесено на шаг E. |

Агент плагина с `model`, `effort`, `tools` загружается как `agent-crew:pm`.

## Структура репозитория

29.09.2026 VS Code-расширение перенесено в `extension/` subtree-merge'ем из репозитория `agent_team` с сохранением истории (коммиты `5c622c9`, `2b8d2b4`, `68702c6`).

## Шаг 1 — скелет, манифесты, контракт, CI (29.09.2026)

- **Marketplace** `.claude-plugin/marketplace.json` (имя `agent-crew`) и **плагин** `plugins/agent-crew` 0.1.0. Манифест подключает группы скилов (`core`, `stacks/tanstack`, `commands`) и объявляет `userConfig` (`budget_cap_usd`, `stack_profile`, `autonomy`, `brief_review_minutes`). Три команды пока заглушки до шага 5.
- **`claude plugin validate --strict`** проходит для marketplace и плагина.
- **Установка в чистом конфиге** работает (критерий §12): `claude plugin marketplace add <репо>` → `claude plugin install agent-crew@agent-crew --config …` → в сессии видны `agent-crew:new-project`, `:feature`, `:status`. CLI при этом пишет «userConfig options not yet set», даже когда в манифесте есть `default`: значения по умолчанию подставляет плагин (шаг 0, п. 3).
- **`crew-contract/`** (Zod 4): схемы 11 артефактов, терпимые читатели (включая формат расширения v0.1 и русские ключи), канонические писатели, валидатор по пути файла, `costs.log` (JSONL + чтение старых строк `key=value`), конфиг, `access-checklist`/`interview`, Node-хелперы (эксклюзивное выделение id, атомарная запись). 90 тестов, покрытие строк 100%, веток 90,7%. Эталонная папка `crew-contract/fixtures/valid/.crew` проходит строгую проверку целиком.
- **Сборка** `crew-contract/scripts/build.mjs` генерирует `plugins/agent-crew/lib/crew-contract.mjs` (самодостаточный ESM, Zod внутри, 483 КБ после минификации, импорт ~11 мс) и `crew-contract/schemas/*.schema.json`. `--check` в CI ловит устаревшие сгенерированные файлы.
- **Расширение** переведено на плагин из этого репозитория (`../plugins/agent-crew`), издатель `whysargis`, репозиторий `Margaryan22/agent-crew`. Линт, 120 юнит-тестов и 8 + 1 интеграционных тестов зелёные на новом месте.
- **CI** `.github/workflows/ci.yml`: контракт (typecheck, тесты, свежесть генерации), валидация манифестов установленным Claude Code, расширение (линт, юнит, интеграция на stable и 1.90.0, упаковка). Release-workflow расширения перенесён в корень (тег `extension-vX.Y.Z`); под универсальную сборку его перепишем на шаге E.
- В эталонной папке лежит `.gitignore` для `logs/` и `sessions/` (так будет в реальных проектах), поэтому эти фикстуры добавлены в git через `git add -f`.
