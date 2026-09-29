# PLAN — плагин `agent-crew` v0

План к `SPEC.md` с учётом уже сделанного VS Code-расширения (`extension/NOTES.md`) и актуальной документации Claude Code (сверено 26.09.2026, Claude Code 2.1.283). **Утверждён 29.09.2026** вместе с изменением архитектуры из раздела A; принятые решения — в разделе 5.

## A. Архитектура продукта (решение от 29.09.2026)

**Цель:** продукт находится в браузере расширений VS Code (и Cursor/Windsurf через Open VSX), а команда агентов работает **на подписке пользователя** — Claude сейчас, ChatGPT следующим этапом.

**Почему не так, как было задумано.** Anthropic запрещает сторонним продуктам на Agent SDK вход по подписке Claude и работу через учётные данные Pro/Max от имени пользователя ([Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance), [Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)). Разрешено другое: пользователь сам входит со своей подпиской в официальный Claude Code и пользуется в нём плагинами.

**Схема «пульт».**
- Агенты работают внутри официального ассистента пользователя: расширение Claude Code (`anthropic.claude-code`), на следующем этапе — Codex (`openai.chatgpt`). Вход, подписка и оплата полностью на стороне Anthropic/OpenAI.
- Ядро продукта — **плагин `agent-crew`**: агенты, скилы, хуки. Пишется сразу в переносимом формате: общее — скилы (`SKILL.md`), скрипты хуков, контракт `.crew/`; своё для каждого ассистента — манифест и описания агентов.
- **Расширение «Agent Crew»** не вызывает модели и не касается логина. Оно:
  - проводит через установку ассистента и плагина (ссылка `vscode://anthropic.claude-code/install-plugin?plugin=agent-crew&marketplace=Margaryan22/agent-crew`);
  - запускает команды ссылкой `vscode://anthropic.claude-code/open?prompt=/agent-crew:new-project…` (запрос подставляется, пользователь нажимает Enter);
  - показывает прогресс из `.crew/`: задачи, решения, эскалации, статус, отчёт;
  - возвращает пользователя в нужную сессию ассистента (`…/open?session=<id>`; id пишет хук плагина).
- **Режим API-ключа (SDK-движок) из расширения убирается.** Кто хочет платить по ключу, входит с ключом в сам Claude Code. Вместе с движком уходят вшитый бинарь Claude Code, сборки по ~95 МБ под 8 платформ и юридический вопрос о его распространении: VSIX становится универсальным и маленьким.
- **Бюджет.** На подписке доллары не считаются, действуют лимиты плана, поэтому панель показывает расход токенов (оценка плагина) и ведёт в `/usage`. Потолок в долларах остаётся только у eval-раннера (`--max-budget-usd`).

**Codex (этап C, после первого живого прогона на Claude).** Проверено по [документации OpenAI](https://learn.chatgpt.com/docs):
- есть официальное расширение, вход через «Sign in with ChatGPT», плагины в открытом формате Agent Plugins (понимают Claude-совместимые манифесты и выставляют хукам `CLAUDE_PLUGIN_ROOT`), скилы, сабагенты, хуки;
- **своих агентов плагин не несёт**: они задаются TOML-файлами в `.codex/agents/` проекта, поэтому `/new-project` будет раскладывать их из шаблонов;
- в хуках нет `agent_type`, поэтому зоны записи по ролям слабее;
- хуки плагина пользователь должен один раз одобрить;
- скилы вызываются как `$имя`;
- способа открыть чат IDE-расширения с готовым запросом в документации нет.

**Репозиторий:** один, `github.com/Margaryan22/agent-crew`. Расширение публикует издатель `whysargis` (`whysargis.agent-crew`), название — «Agent Crew». В названии и логотипе нельзя использовать Claude, Anthropic, ChatGPT, OpenAI; фразу «работает с Claude Code» в описании писать можно.

```
agent-crew/
├── .claude-plugin/marketplace.json   marketplace для Claude Code
├── plugins/agent-crew/               плагин (+ lib/crew-contract.mjs — сгенерирован)
├── crew-contract/                    общий формат .crew/: Zod-схемы, тесты, фикстуры
├── extension/                        VS Code-расширение «Agent Crew» (перенесено с историей)
├── evals/                            идеи, скрытые тесты, раннер, результаты
├── SPEC.md  PLAN.md  NOTES.md
```

## 0. Коротко

1. **Формат `.crew/`.** SPEC и расширение расходятся в 21 месте. Ни одно расхождение не блокирует работу, но в трёх местах сейчас два писателя без правил: `costs.log`, ответы на эскалации и нумерация `E-xxx`. Решаем это одним контрактом, в котором у каждого файла и поля есть владелец.
2. **`crew-contract/`.** Zod-схемы в корне репо плагина. Сборка кладёт бандл без зависимостей внутрь плагина (`plugins/agent-crew/lib/`). Оттуда его берут хуки, CLI-хелпер `bin/crew` и расширение, которое и так копирует плагин себе. Ни npm-пакета, ни второго канала доставки не нужно.
3. **План по §13.** Семь шагов из SPEC и шаг 0: короткие проверки четырёх мест, где документация допускает два толкования.
4. **Устаревшее в SPEC.** Вложенные папки скилов (§3) без манифеста не загрузятся. Сабагентам недоступен `AskUserQuestion`, поэтому PM не может сам вести интервью (§5). Плагин не видит расходы в долларах, так что потолок бюджета «в конфиге плагина» (§8) может держать только хост. Для eval (§11) появился встроенный `claude plugin eval` с baseline, но полный прогон с его ограничениями не помещается, поэтому нужен гибрид.
5. **Новые возможности, которых нет в SPEC:** `userConfig`, `bin/`, `paths` у скилов, `isolation: worktree`, workflows, `defer`, `UserPromptExpansion`. Использую те, что снимают риски. Решения — в разделе 5, изменения из-за новой архитектуры — в разделе 6.

---

## 1. Сверка `.crew/` (SPEC §6) с контрактом расширения

«Расширение» здесь — формат, который расширение сейчас читает и пишет (см. `extension/NOTES.md`, раздел «Контракт с плагином»). В колонке «Решение» — что попадёт в `crew-contract`.

| # | Тема | SPEC.md | Расширение сейчас | Решение | Почему |
|---|---|---|---|---|---|
| D1 | Исполнитель задачи | `owner` | `assignee` (а `owner` принимается как синоним) | **`owner`** | Термин SPEC, и в промптах агентов будет он. В расширении это переименование в одну строку, а старые файлы оно и так читает. |
| D2 | `model`, `last_error_hash` в задаче | есть | нет | **Оставить оба.** `model` показывается в дереве задач, `last_error_hash` — служебное поле. | Нужны для лестницы эскалации моделей и детектора повторной ошибки (§8). |
| D3 | `id`, `title` задачи | не указаны | ожидаются, есть fallback на имя файла и заголовок | **Обязательные поля frontmatter** | Стабильные id не зависят от имени файла, а заголовок не приходится выковыривать из markdown. |
| D4 | Статусы задачи | перечня нет, по §7 цикл: исполнитель → тесты → QA → Security → `done` | `todo / in_progress / review / done / blocked` | **Пять статусов расширения плюс `review_stage: qa \| security`** и `escalation: E-xxx` для `blocked` | Пяти групп достаточно для UI; стадия показывает, где задача в цикле §7.7; ссылка на эскалацию объясняет блокировку. |
| D5 | Ветки и файлы задачи | нет, но есть скил «git-процесс» | `branch`, `base`, `files` (для Show Diff) | **Оставить как необязательные**, заполняет скил git-процесса | Трассируемость и diff в IDE без лишних договорённостей. |
| D6 | Граф задач и доля бюджета | в тексте (§5 «граф задач», §8 «доля бюджета»), полей нет | нет | **`depends_on`, `budget_usd`, `spent_usd_estimate`** | Без полей детектор «превысила долю бюджета» и порядок задач живут только в памяти оркестратора. |
| D7 | Формат эскалации | тело: «что застряло; что пробовали; 2–3 варианта с рекомендацией» | frontmatter `options`, секции `Question / Options / Answer` | **Данные для машины во frontmatter** (`question` одной строкой, `options`, `recommended`), в теле — свободные секции для человека: «Что застряло / Что пробовали / Варианты» | Расширение не должно зависеть от языка заголовков; требование SPEC к содержанию сохраняется. |
| D8 | Куда записан ответ человека | «в `decisions/`» | в файл эскалации (`status: answered`, `answer`) плюс сообщение в сессию | **И туда, и туда, с разделением обязанностей:** хост пишет `answer / answered_at / answered_by` в файл эскалации; оркестратор оформляет решение как `decisions/ADR-xxx.md` с `source: E-xxx` и ставит эскалации `status: resolved`, `decision: ADR-xxx`. Для `permission` и `brief-review` ADR не создаётся. | Хост не может корректно написать ADR (нумерация, контекст архитектора). У каждого поля один писатель. Цепочка E → ADR трассируется. Намерение SPEC выполнено. |
| D9 | Виды эскалаций | неявно: застревание, нехватка доступов, спор PM с критиком | `question / permission / brief-review` | **`kind: stuck \| access \| question \| permission \| brief-review`** плюс `reason` для `stuck`: `attempts_exceeded \| repeated_error \| pm_critic_deadlock \| edit_flipflop \| task_budget` | Метрика `escalations` в eval (§11) и бейджи в UI. |
| D10 | Кто создал эскалацию | — | расширение само создаёт файлы для `AskUserQuestion` и запросов прав | **`source: plugin \| host`** | Оркестратор не должен «обрабатывать» и превращать в ADR эскалации, созданные хостом. Расширение по этому полю понимает, как доставить ответ. |
| D11 | Нумерация `E-xxx` | один писатель (плагин) | тоже пишет, выбирая `max+1` | **Общее правило:** `max+1` + эксклюзивное создание файла (`wx`/`O_EXCL`), повтор при `EEXIST`; хелпер в контракте | Писателей два, центрального аллокатора нет; без правила гонка даст перезапись. |
| D12 | Ревью брифа | §7.3: «показать и продолжать **без ожидания**» | `crew.autonomy=review` ждёт до N минут | **По умолчанию поведение SPEC (`autonomy=full`).** `review` включается явно: плагин создаёт `brief-review` и завершает ход; в расширении таймер хоста отвечает `Approve` через N минут, в CLI отвечает человек. | Выполняются оба ТЗ. Ждать умеет только хост: у плагина нет надёжного «sleep». |
| D13 | `status.md` | свободная форма, пишет хранитель | читает frontmatter `phase` и первый абзац, при стопе дописывает цитату «⛔ …» | **Frontmatter `phase` (enum), `updated_at`, `active_tasks`, `stop_reason`, `summary`.** Хост меняет только `phase: stopped` и `stop_reason` и дописывает одну строку-цитату. Хранитель обязан сохранять чужие ключи. | Хранитель регулярно переписывает файл; без правила пометка хоста о стопе исчезнет. |
| D14 | `costs.log` | принадлежит плагину (§6, §8) | пишет расширение: `key=value`, итоги сессии | **JSONL, только дописывание, поле `source`:** `sdk` / `headless` — авторитетные итоги сессии от хоста; `estimate` — оценки плагина по задачам. Потолок считается только по авторитетным. | Хуки не видят долларов: в `PostToolUse` для Agent есть лишь токены последнего запроса, у фоновых сабагентов нет и их. Итог в долларах знает только хост (`total_cost_usd`). |
| D15 | Где потолок бюджета | «параметр в конфиге плагина» (§8) | `crew.budgetCapUsd` + `maxBudgetUsd` в SDK | **`userConfig.budget_cap_usd` в плагине** (для CLI) плюс переопределение хостом через `CREW_BUDGET_CAP_USD`. Жёсткую остановку делает хост (`--max-budget-usd` / `maxBudgetUsd`); в интерактивном CLI без хоста плагин останавливается только по оценке. | См. D14. Кроме того, `pluginConfigs` читается только из user/managed-настроек, а расширение запускает SDK с `settingSources: ['project','local']`, так что значения ему нужно передавать через env. |
| D16 | Файлы, которых нет у одной из сторон | `brief.review.md`, `access-checklist.md`; «глоссарий» (§5); лог хуков (§9); финальный отчёт (§7.8) | — | **Добавить в контракт:** `brief.review.md`, `access-checklist.md`, `glossary.md`, `interview.md`, `report.md`, `logs/hooks.jsonl` (+ `.crew/.gitignore` для `logs/`) | В SPEC названы артефакты без путей. Расширение сможет показать «нужно от вас» и открыть отчёт. |
| D17 | Команды | скилы в `skills/commands/` | зовёт `/agent-crew:new-project`, `/feature`, `/status` | **Совместимо**, если скилы загрузятся (см. раздел 4, O1). Имя плагина в контракте константой. | Имя команды берётся из последнего сегмента пути: `…/new-project/SKILL.md` → `/agent-crew:new-project`. |
| D18 | Имена ADR | `ADR-xxx.md` | `ADR-\d+` в начале имени, slug допускается | **`ADR-001-slug.md`**, frontmatter `id, title, status, date, source?, supersedes?` | Совместимо с обеими сторонами. |
| D19 | Переменные окружения | не описаны | расширение передаёт `CREW_HOST, CREW_AUTONOMY, CREW_BRIEF_REVIEW_MINUTES, CREW_STACK_PROFILE, CREW_BUDGET_CAP_USD` | **Принять**, добавить `CREW_EVAL=1`. Порядок разрешения: `CREW_*` → `CLAUDE_PLUGIN_OPTION_*` (userConfig) → `EVAL_*` → значения по умолчанию. Агентам значения передаёт хук `SessionStart` через `additionalContext`. | В контент скилов подставляется только `${user_config.*}`, а env хоста — нет. `claude plugin eval` пропускает только `EVAL_*`. |
| D20 | Версия формата | нет | нет | **`.crew/crew.json`:** `contract_version`, `plugin {name, version}`, `stack_profile`, `created_at` | Расширение сможет предупредить о несовместимой версии, а не разбирать файлы молча и неверно. |
| D21 | Заготовленные ответы интервью (eval) | «идея + заготовленные ответы» (§11) | — | **`.crew/interview.md`:** пары вопрос–ответ, `answered_by: human \| eval`. Раннер заполняет его заранее; PM спрашивает только о том, чего там нет. | В `claude -p` без permission host `AskUserQuestion` недоступен, а прогон должен быть неинтерактивным. |

### 1.1. Кто пишет какой файл

Главное правило контракта: у каждого поля один писатель.

| Файл | Пишет | Читают |
|---|---|---|
| `crew.json` | команда `/new-project` (плагин) | хост, плагин |
| `interview.md` | оркестратор (вопросы); человек или eval-раннер (ответы) | PM |
| `brief.md` | PM | все |
| `brief.review.md` | критик | PM, оркестратор |
| `access-checklist.md` | PM (пункты); человек отмечает `[x]` | оркестратор, хост |
| `decisions/ADR-*.md` | архитектор; оркестратор — по ответам на эскалации | все |
| `tasks/T-*.md` | frontmatter — **только через `bin/crew task …`** (оркестратор, исполнители, QA, Security); тело — исполнитель | все, хост |
| `escalations/E-*.md` | создаёт плагин (`source: plugin`) или хост (`source: host`); поля ответа — хост; `resolved`/`decision` — оркестратор | все |
| `status.md`, `glossary.md` | хранитель; хост — только `phase: stopped` и `stop_reason` | все |
| `report.md` | оркестратор | хост, человек |
| `costs.log` | хост (`sdk`/`headless`), хук плагина (`estimate`) — только дописывание | хост, оркестратор, `/status` |
| `logs/hooks.jsonl` | хуки плагина | отладка, eval |

### 1.2. Что поменять в расширении (отдельный репо, после утверждения контракта)

1. `copy-plugin.mjs`: плагин теперь лежит в `../agent-crew/plugins/agent-crew`.
2. Разбор `.crew/` перевести на `lib/crew-contract` (lenient-режим); в `src/crew/parser.ts` остаётся только UI-обвязка.
3. Задачи: `owner`, показывать `model`, `review_stage`, `depends_on`.
4. Эскалации:
   - писать `source: host` и `answered_by`;
   - не ставить `resolved`;
   - показывать `recommended` первой кнопкой;
   - добавить бейджи для `stuck` и `access`;
   - создавать файлы эксклюзивно.
5. `costs.log` перевести в JSONL; потолок считать только по `source ∈ {sdk, headless}`.
6. `status.md`: при стопе менять `phase` и `stop_reason` через writer из контракта.
7. Читать `crew.json` и предупреждать о несовпадении мажорной версии контракта.
8. (v0.1) Показывать открытые пункты `access-checklist.md` и команду «Open Report».

---

## 2. Единый контракт `crew-contract/`

### 2.1. Где живёт и как доставляется

```
agent-crew/                              (этот репо)
├── crew-contract/                       источник правды: TS + Zod 4, тесты, фикстуры, README
│   ├── src/                             схемы, парсер/сериализатор frontmatter, id, пути, конфиг
│   ├── fixtures/valid|invalid/          эталонные .crew-файлы (golden) — ими тестируются обе стороны
│   ├── schemas/*.json                   генерируется из Zod (z.toJSONSchema) — для людей и агентов
│   └── README.md
└── plugins/agent-crew/
    ├── lib/crew-contract.mjs            ГЕНЕРИРУЕТСЯ: esbuild-бандл без зависимостей (zod внутри)
    ├── lib/crew-contract.d.ts           ГЕНЕРИРУЕТСЯ: типы для расширения
    ├── bin/crew                         CLI для агентов поверх lib (см. 2.4)
    └── hooks/scripts/*.mjs              импортируют ../../lib/crew-contract.mjs
```

Почему так:
- **Код контракта должен лежать внутри плагина.** Документация: при установке из marketplace в кэш копируется только каталог плагина, а файлы вне его хукам недоступны. Локальный marketplace и SDK (`plugins: [{type:'local'}]`) грузят плагин на месте, без `npm install`. Поэтому бандл без зависимостей обязателен (это совпадает с §9: «без внешних зависимостей»).
- **Расширению не нужен npm-пакет.** Репозиторий один (раздел A), поэтому esbuild расширения импортирует `crew-contract/src` напрямую, а версия контракта всегда совпадает с плагином из того же коммита.
- **Сгенерированные файлы коммитятся.** Плагин ставится из git без шага сборки. CI проверяет актуальность: пересобирает и делает `git diff --exit-code`.

### 2.2. Состав

| Модуль | Что внутри |
|---|---|
| `version` | `CONTRACT_VERSION = 1`; правила: новые необязательные поля — минорная версия, переименование или удаление — мажорная |
| `paths` | все пути `.crew/…`, включая новые из D16 |
| `ids` | регулярки `T-\d{3,}`, `E-\d{3,}`, `ADR-\d{3,}`; `nextId()`; правило эксклюзивного создания |
| `frontmatter` | разбор (терпимый: синонимы ключей, русские ключи и статусы — перенос логики из расширения) и сериализация (строгая, стабильный порядок ключей, чужие ключи сохраняются) |
| `schemas/*` | Zod-схемы файлов (2.3), каждая в двух режимах: **strict** для писателей (хук-валидатор, `bin/crew`) и **lenient** для читателей (расширение; неизвестные поля пропускаются как есть) |
| `costs` | схема строки JSONL; `projectSpentUsd()` (максимум по сессии, только авторитетные источники); `sessionTotal()` |
| `config` | `resolveCrewConfig(env)`: `CREW_*` → `CLAUDE_PLUGIN_OPTION_*` → `EVAL_*` → значения по умолчанию |
| `checklist` | разбор `access-checklist.md` и `interview.md` в структуры |

### 2.3. Схемы

Поля, обязательные для писателя, помечены «✓». Время — ISO 8601.

**`tasks/T-xxx.md`**

| Поле | Тип | ✓ | Примечание |
|---|---|---|---|
| `id` | `T-001…` | ✓ | совпадает с именем файла (строгий режим) |
| `title` | строка 1–120 | ✓ | |
| `status` | `todo \| in_progress \| review \| done \| blocked` | ✓ | |
| `owner` | kebab-имя агента | ✓ | известные: `pm, critic, architect, qa, frontend, backend, db, security, keeper, orchestrator`; для будущих профилей — любое kebab-имя |
| `attempts` | int ≥ 0 | ✓ | |
| `model` | `haiku \| sonnet \| opus \| fable` или полный id | | текущая ступень лестницы §8 |
| `last_error_hash` | hex 12 | | |
| `depends_on` | `T-id[]` | | |
| `review_stage` | `qa \| security` | | только при `status: review` |
| `escalation` | `E-id` | | только при `status: blocked` |
| `branch`, `base` | строка | | |
| `files` | `string[]` | | |
| `budget_usd`, `spent_usd_estimate` | число ≥ 0 | | |
| `created_at`, `updated_at` | время | ✓ | |

**`escalations/E-xxx.md`**

| Поле | Тип | ✓ | Примечание |
|---|---|---|---|
| `id` | `E-001…` | ✓ | |
| `kind` | `stuck \| access \| question \| permission \| brief-review` | ✓ | |
| `reason` | `attempts_exceeded \| repeated_error \| pm_critic_deadlock \| edit_flipflop \| task_budget` | | обязательно при `kind: stuck` |
| `source` | `plugin \| host` | ✓ | |
| `status` | `open \| answered \| resolved \| cancelled` | ✓ | |
| `question` | строка ≤ 300, одна строка | ✓ | текст уведомления |
| `options` | `string[]` 1–4 | ✓ | плагин даёт 2–3 (SPEC); `AskUserQuestion` — до 4; уведомление показывает первые 3 |
| `recommended` | строка ∈ `options` | | рекомендация (SPEC §8) |
| `task`, `agent` | `T-id`, строка | | |
| `created_at` | время | ✓ | |
| `answer`, `answered_at`, `answered_by` | строка, время, `human \| auto \| eval` | | пишет хост; при `answered`/`resolved` обязательны |
| `decision` | `ADR-id` | | пишет оркестратор при `resolved` |

**`decisions/ADR-xxx-slug.md`:** `id` ✓, `title` ✓, `status: proposed | accepted | superseded | rejected` ✓, `date` ✓, `source?: E-id`, `supersedes?: ADR-id`.

**`status.md`:** `phase` ✓ `interview | brief | architecture | acceptance_tests | decomposition | tasks | final | done | stopped | failed`, `updated_at` ✓, `active_tasks?`, `stop_reason?: budget_cap | user | error`, `summary?` (≤ 280, для UI).

**`brief.md`:** `version` ✓, `status: draft | in_review | approved` ✓, `review_rounds` 0–3 ✓, `approved_at?`.
**`brief.review.md`:** `round` 1–3 ✓, `verdict: approve | revise | deadlock` ✓, `checklist: {value, scope, measurability, risks}: pass | fail` ✓.
**`access-checklist.md`, `interview.md`:** frontmatter необязателен; строки `- [ ] пункт — зачем` и блоки `### Q:` / `A:` соответственно; разбор в модуле `checklist`.
**`crew.json`:** `contract_version` ✓, `plugin: {name, version}` ✓, `stack_profile` ✓, `created_at` ✓.
**`costs.log` (JSONL):** `ts` ✓, `source: sdk | headless | estimate | manual` ✓, `session_id?`, `turn_cost_usd?`, `session_total_usd?`, `task?`, `agent?`, `model?`, `tokens?: {input, output, cache_read, cache_write}`; хотя бы одно поле стоимости обязательно.
**`logs/hooks.jsonl`:** `ts, session_id, hook, event, tool, agent_type?, decision: allow | deny | ask | defer | none, reason?, input_digest` (хэш входа, **не сам вход** — чтобы в лог не попали секреты).

### 2.4. Как контракт соблюдается

- **`bin/crew`.** CLI плагина. Пока плагин включён, Claude Code кладёт `bin/` в `PATH` Bash-инструмента. Команды: `crew task new|set|show`, `crew escalate`, `crew id next`, `crew validate`, `crew cost add`. Агенты меняют состояние через него, а не правят YAML руками: меньше битых файлов и атомарная запись.
- **Хук-валидатор `PostToolUse` на `Write|Edit` в `.crew/**`.** Проверяет файл strict-схемой. При ошибке возвращает `decision: "block"` с `reason`, и агент исправляет файл сам.
- **Golden-фикстуры `crew-contract/fixtures/`.** На них одинаково проходят тесты плагина и расширения.

### 2.5. README контракта (содержание)

Назначение и владельцы файлов (таблица 1.1), схемы с примерами, жизненный цикл задачи и эскалации (диаграммы состояний), правило id, `costs.log` и расчёт бюджета, разрешение конфига, версионирование, как подключить в расширении.

---

## 3. План реализации (SPEC §13)

После каждого шага — коммит и короткая запись в `NOTES.md`, как требует SPEC. Размер: S — до дня, M — 1–3 дня, L — больше.

### Шаг 0. Проверки (S, одноразовые, в `NOTES.md` попадают только выводы)

В четырёх местах документация допускает два толкования, а от ответа зависит дизайн:
1. Работают ли хуки из frontmatter у **скилов плагина**. У агентов плагина они игнорируются, про скилы прямо не сказано. Если работают, хуки «режима crew» регистрирует сам `/new-project`, а не глобальный `hooks.json`.
2. Загрузка вложенных групп скилов через ключ манифеста `skills: ["./skills/core", …]` и итоговые имена команд.
3. Доходит ли `pluginConfigs` до плагина, загруженного через SDK (id `agent-crew@inline`), если передать его флагом `settings`. Если нет — остаётся env (D19).
4. `AskUserQuestion` и `defer` в `claude -p`: подтвердить поведение для eval-раннера.

Шаги 1–4 проверяются без API-ключа (хук `SessionStart` срабатывает до обращения к API). Для проверки 4 ключ нужен.

### Шаг 1. Скелет, манифесты, валидация (S)

- `.claude-plugin/marketplace.json` в корне. Имя marketplace не из списка зарезервированных, например `agent-crew-tools` (решение 5.3).
- `plugins/agent-crew/.claude-plugin/plugin.json`:
  - `name`, `version`, `description`, `author`, `license`;
  - `skills: ["./skills/core", "./skills/stacks/tanstack", "./skills/commands"]`;
  - `userConfig`: `budget_cap_usd` (number, min 0, default 20), `stack_profile` (options `["tanstack"]`), `autonomy` (options `["full","review"]`), `brief_review_minutes` (number, 1–240).
- `crew-contract/` со схемами из раздела 2, тестами (`node:test` или Vitest — внутри репо, на рантайм плагина не влияет) и генерацией `lib/`.
- CI: `claude plugin validate --strict` для marketplace и плагина, тесты контракта, проверка свежести `lib/`.
- **Готово, когда** обе валидации проходят в `--strict`, а `claude --plugin-dir plugins/agent-crew` показывает три команды.

### Шаг 2. Хуки и тесты (M)

Node ESM, exec-form (`args` с `${CLAUDE_PLUGIN_ROOT}`), без зависимостей (контракт из `lib/`), JSON-вывод `hookSpecificOutput.permissionDecision`. Старые `decision: approve/block` устарели.

| Хук | Событие / matcher | Что делает |
|---|---|---|
| `crew-session` | `UserPromptExpansion` (`agent-crew:*`), `SessionStart` | Помечает сессию как crew (`.crew/.sessions/<session_id>`) или признаёт её таковой по `CREW_HOST`. Внедряет конфиг и сводку статуса через `additionalContext`. **Все остальные хуки работают только в crew-сессиях**, иначе плагин мешал бы обычной работе пользователя (например, блокировал бы его собственный `git push`). |
| `guard-packages` | `PreToolUse` `Bash` | `npm/pnpm/yarn add\|install <pkg>`: allowlist профиля или проверка в registry (пакет существует, старше 30 дней, заметное число загрузок). Кэш в `${CLAUDE_PLUGIN_DATA}`, таймаут. Если registry недоступен — `deny` с понятным сообщением. |
| `guard-dangerous` | `PreToolUse` `Bash`, `Write\|Edit` | `rm -rf` вне проекта; `git push` в `main`/`master` и `--force`; запись в `.env` с непохожими на заглушки значениями. |
| `guard-network` | `PreToolUse` `Bash`, `WebFetch` | `curl`/`wget` (и `WebFetch`) только на хосты из allowlist. |
| `zone-guard` | `PreToolUse` `Write\|Edit\|NotebookEdit` | По `agent_type` (`agent-crew:frontend` и т. д.) разрешает запись только в зоне агента (§5). Главный поток (оркестратор) пишет только в `.crew/`. |
| `allow-policy` | `PreToolUse` | Возвращает **`allow`** для работы в своей зоне и для списка безопасных команд (тесты, сборка, `git add/commit/switch -c`). Без этого в расширении (`permissionMode: default`) **каждая** запись превращалась бы в эскалацию. |
| `crew-validate` | `PostToolUse` `Write\|Edit` в `.crew/**` | Проверка контрактом, `block` с причиной. |
| `edit-journal` | `PostToolUse` `Edit\|Write` | Хэши правок по агентам в `.crew/logs/edits.jsonl` — сигнал для детектора «туда-обратно» (§8). |
| `cost-estimate` | `SubagentStop` | Суммирует usage из `agent_transcript_path` по таблице цен и пишет `costs.log` с `source: estimate` и `task` (из тега `[T-xxx]` в промпте делегирования). |
| `audit-log` | все `PreToolUse` | Решение хука → `.crew/logs/hooks.jsonl` (§9). |

**Тесты:** `node:test`, JSON на stdin → проверка stdout и кода выхода для каждого сценария §9. Отдельный набор попыток обхода: кавычки, `&&`/`;`, `env X=1 rm`, `sh -c`, `xargs rm`, переменные в пути, `git push origin HEAD:main`.

**Ограничение записываю в NOTES сразу:** разбор bash хуками — защита по принципу best effort. Для прогонов нужен ещё и sandbox хоста (раздел 4, O18).

### Шаг 3. Агенты и скилы `core/` (M)

- **9 файлов в `agents/`** (без оркестратора — см. решение 5.1). Frontmatter: `name`, `description`, `model`, `effort`, `tools`/`disallowedTools`, `skills`, `maxTurns`, `color`. Тело — секции «Цель / Зона ответственности / Запрещено / Входы / Выходы / Критерий готовности / Кому эскалирует».
- **Поля, которые у агентов плагина игнорируются:** `permissionMode`, `hooks`, `mcpServers`. Отсюда `zone-guard`.
- **Веб-контент — данные, а не инструкции.** Эта оговорка стоит у агентов с `WebFetch`/`WebSearch` (§9).
- **`core/`:**
  - `brief`, `interview`, `git-process`, `acceptance-tests`, `code-review`, `security-review`, `crew-files` (как пользоваться `bin/crew`);
  - `orchestration`: пайплайн §7 и лестница эскалации §8;
  - `stuck-detection`.
  У скилов-знаний `user-invocable: false`.
- Модели по §5: дешёвые по умолчанию, Opus — ступень лестницы через параметр `model` у вызова Agent. Документация подтверждает, что он переопределяет frontmatter.

### Шаг 4. Шаблон и скилы `stacks/tanstack/` (M–L)

- `templates/tanstack/`: TanStack Start, Drizzle, PostgreSQL (`docker compose`), Playwright, Vitest, TS strict, `CLAUDE.md` проекта с конвенциями (он загружается, в отличие от `CLAUDE.md` в корне плагина), `.crew/.gitignore`. Актуальные версии пакетов проверяю в момент работы.
- Скилы профиля с `paths` (например `src/routes/**`), чтобы подгружались по месту, и `allowlist.json` пакетов профиля для `guard-packages`.
- Новый профиль добавляется папкой: `skills/stacks/<profile>/` + `templates/<profile>/` + запись в `userConfig.stack_profile.options`.

### Шаг 5. Команды `/new-project`, `/feature`, `/status` (L)

- Скилы в `skills/commands/<name>/SKILL.md`: `disable-model-invocation: true` (чтобы Claude не запускал `/new-project` сам), `argument-hint`, `model: sonnet`, `effort`.
- **Интервью.** Ведёт главный поток: у сабагентов `AskUserQuestion` нет. PM готовит блоки вопросов в `interview.md`. Оркестратор задаёт их через `AskUserQuestion`, если инструмент доступен (CLI, расширение), иначе берёт готовые ответы из `interview.md` (eval). Неотвеченное превращается в допущения, записанные в бриф, или в эскалацию `access`.
- Пайплайн по §7, состояние только в `.crew/`, фоновые сабагенты (режим по умолчанию) с ожиданием уведомлений о завершении. Финал — `report.md`, `status.md` с `phase: done`.
- `/status` работает без сабагентов: сводка из `status.md`, `tasks/`, `costs.log`, дешёвая модель.
- Если выберете workflow для цикла задач (решение 5.1), он появляется здесь: `workflows/task-loop.js`.

### Шаг 6. Eval-харнесс и 3 примера (L)

Гибрид (решение 5.4):
- **Компонентные evals — `claude plugin eval`** в `plugins/agent-crew/evals/`: срабатывание скилов, работа хуков, поведение `/status`, отказ на вредных командах. Дёшево, с baseline, подходит для CI (`--threshold`, `--max-cost-usd`, `--trust-plugin`).
- **Сквозные прогоны — свой раннер** в `evals/runner/`. По SPEC, но на актуальных флагах. Для каждой идеи и режима:
  1. временная папка из шаблона, `git init`, `docker compose up`;
  2. `claude --bare -p "<идея>" --output-format json --max-budget-usd <потолок> --permission-mode acceptEdits --allowedTools <одинаковый список для обоих режимов>` и `--plugin-dir plugins/agent-crew` для режима `plugin`;
  3. `total_cost_usd` и `duration_ms` берутся из JSON (§11: поле подтверждено);
  4. эскалации: раннер отвечает рекомендованным вариантом через `--resume` и считает это в `human_interventions`;
  5. после завершения копируются скрытые тесты и запускается Playwright;
  6. результат пишется в `results/<дата>.csv` с колонками из §11.
- **Честность сравнения:** одна и та же закреплённая модель (полный id), тот же режим прав, тот же потолок, у baseline идея и ответы интервью в промпте.
- **3 идеи с 5–10 скрытыми тестами каждая:** запись клиентов в барбершоп, мини-склад, учёт заказов пекарни.

### Шаг 7. Прогон, README, NOTES (M)

Прогон 3 × 2, CSV в `evals/results/`. README: установка (`/plugin marketplace add`, `/plugin install agent-crew@<marketplace>`, `claude plugin install … --config KEY=VALUE`), команды, конфиг, как добавить eval-идею, как добавить профиль стека. NOTES: расхождения и открытые вопросы. Сверка критериев §12 по пунктам.

---

## 4. Что в SPEC.md устарело или требует уточнения

| # | § | В SPEC | По документации (Claude Code 2.1.283) | Что делаем |
|---|---|---|---|---|
| O1 | 3 | `skills/core/`, `skills/stacks/tanstack/`, `skills/commands/` | По умолчанию ищется только `skills/<name>/SKILL.md`. Вложенные группы загрузятся, только если перечислить их в ключе `skills` манифеста (он **добавляется** к обычному поиску). Имя команды — последний сегмент, поэтому одинаковые имена папок в разных группах столкнутся. | Перечислить группы в `plugin.json`; держать имена скилов уникальными (или задавать `name`). Проверка — шаг 0. |
| O2 | 3, 7 | «команды» | `commands/` — устаревший формат, команды теперь скилы (в SPEC уже так). Скилы-команды должны иметь `disable-model-invocation: true`. | Так и делаем. |
| O3 | 5 | whitelist тулов; «проверь, можно ли задать effort» | `effort` **поддерживается** во frontmatter агента и скила. `tools`/`disallowedTools` — да. У **агентов плагина** игнорируются `permissionMode`, `hooks`, `mcpServers`, `initialPrompt`. Ограничения по путям («`src/`, UI-часть») через `tools` не выразить. | `effort` ставим. Зоны делаем хуком `zone-guard` по `agent_type`. |
| O4 | 5 | PM проводит интервью | Сабагентам **недоступен `AskUserQuestion`**. | Интервью ведёт главный поток; PM готовит вопросы и разбирает ответы. |
| O5 | 5 | «Оркестратор — основной агент» | Запустить агента плагина как главный поток можно через `settings.json` плагина (`agent`), но это действует на **все** сессии с включённым плагином. Есть `--agent` и опция SDK `agent` у хоста. | Решение 5.1. Рекомендую скилы-команды (работают везде) и файл `agents/orchestrator.md` только для хостов (`--agent`). |
| O6 | 7 | неявно: сабагенты синхронны | С v2.1.198 сабагенты по умолчанию **фоновые**, вложенность до 3 уровней, до 20 одновременно. У фоновых урезан набор инструментов, их итоги приходят уведомлением. | Промпты оркестрации учитывают асинхронность; там, где нужен результат сразу, ставим `background: false`. |
| O7 | 8 | «жёсткий потолок — параметр в конфиге плагина» | `userConfig` есть (тип `number`, `min`/`max`), но плагин **не видит расходов в долларах**. Жёсткий стоп есть только у хоста: `--max-budget-usd` (учитывает сабагентов) или SDK `maxBudgetUsd`. `pluginConfigs` читается только из user/managed-настроек. | D14, D15, D19. |
| O8 | 8 | «задача превысила долю бюджета» | Хуки знают токены только последнего запроса сабагента; у фоновых сабагентов нет и этого. | Хук `cost-estimate` по транскрипту в `SubagentStop`. Значения помечаются как оценка, их точность — в NOTES. |
| O9 | 9 | хуки как политика | Плагин **не может** поставлять правила `permissions`: из `settings.json` плагина действуют только `agent` и `subagentStatusLine`. Хуки — единственный механизм, в том числе для `allow`. Формат решения: `hookSpecificOutput.permissionDecision` (`allow / deny / ask / defer`); доступны exec-form `args`, env `CLAUDE_PLUGIN_ROOT / DATA / OPTION_*`, поле `agent_type`. | Добавляем `allow-policy` и гейтинг crew-сессий. |
| O10 | 9 | «без внешних зависимостей» | Для marketplace Claude Code сам ставит npm-зависимости плагина при копировании в кэш, но **не** для локального marketplace и не для SDK. Файлы вне каталога плагина не копируются. | Бандл контракта в `lib/` (раздел 2.1). |
| O11 | 9 | сеть: блокировать `curl`/`wget` | Есть ещё `WebFetch`, `node -e fetch`, `git clone`, `npx`… Хуки дают защиту по принципу best effort. | Хук плюс sandbox хоста (SDK `sandbox`, в раннере — контейнер). Ограничение описываем в README. |
| O12 | 11 | свой раннер baseline/plugin | Есть **`claude plugin eval`** (с v2.1.269): baseline-плечо, стоимость, пороги для CI. Ограничения: нет грейдеров на коде (скрытый Playwright не подключить), максимум 200 ходов и 1 час, sandbox с закрытой сетью, из env проходят только `EVAL_*`. | Гибрид (шаг 6). |
| O13 | 11 | «проверь поле стоимости» | `claude -p --output-format json` → `total_cost_usd` + разбивка по моделям. Для скриптов рекомендован `--bare`: без CLAUDE.md, пользовательских хуков и плагинов, то есть «голый» baseline. | Используем. |
| O14 | 11 | «головной режим» с заготовленными ответами | В `-p` без permission host `AskUserQuestion` недоступен; есть `defer` для хостов. | `interview.md` (D21); `defer` оставляем на будущее. |
| O15 | 12 | `claude plugin validate`, `/plugin marketplace add`, `/plugin install` | Всё есть. У `validate` есть `--strict`. Диалог `userConfig` появляется только в интерактивном `/plugin`; в shell значения передаются через `--config KEY=VALUE`. У marketplace есть зарезервированные имена. | Учитываем в README и CI. |
| O16 | 2 | «Не входит: IDE-расширение» | Расширение уже сделано отдельным продуктом. | В этом репо только контракт и совместимость; UI не трогаем. |
| O17 | 5 | хранитель: «сжатие истории» | У главного потока и сабагентов есть автокомпакция; сжать чужой контекст агент не может. | Хранитель ведёт `status.md`, глоссарий и сводки в `.crew/`, а не «историю». |
| O18 | — | модели Sonnet / Opus / Haiku | Алиасы работают, есть и `fable`. Алиас семейства разрешается в модель главного потока, если семейство совпадает. | В агентах — алиасы; в eval — полные id для воспроизводимости. |

**Новое, чего нет в SPEC, но полезно:**
- `bin/` — `crew` CLI (раздел 2.4);
- `paths` у стековых скилов;
- `isolation: worktree` — параллельные исполнители без конфликтов правок; снимает часть детектора «туда-обратно», но добавляет мерж — на потом;
- workflows — детерминированный цикл задач, решение 5.1;
- `UserPromptExpansion` — отметка crew-сессии;
- `dependencies` между плагинами — профиль стека мог бы стать отдельным плагином поверх ядра, но в v0 оставляем папку по SPEC;
- `maxTurns`, `memory`, `omitClaudeMd` у агентов.

---

## 5. Принятые решения (29.09.2026)

| # | Вопрос | Решение |
|---|---|---|
| 1 | Архитектура | Схема «пульт» из раздела A: агенты в официальном ассистенте на подписке пользователя, расширение — установка, запуск и прогресс. Режим API-ключа из расширения убран. |
| 2 | Порядок ассистентов | Сначала Claude Code; плагин сразу в переносимом формате; Codex — этап C после первого живого прогона. |
| 3 | Цикл задач (§7.7) | Оркестратор-LLM по скилу `orchestration`, счётчики в `.crew/`. Workflow-скрипты не используем: они только в Claude Code, а у Pro по умолчанию выключены. |
| 4 | Доставка контракта | Один репозиторий: расширение импортирует `crew-contract/` напрямую при сборке, плагин получает сгенерированный бандл в `lib/`. |
| 5 | Имена | Продукт «Agent Crew»; плагин `agent-crew`; издатель `whysargis`; репозиторий и marketplace — `Margaryan22/agent-crew`. Свободность имени в Marketplace проверить перед публикацией. |
| 6 | Хуки | Только в crew-сессиях. |
| 7 | Eval | Гибрид: `claude plugin eval` для частей и свой раннер для полных прогонов; позже раннер сравнит и Claude, и ChatGPT. |
| 8 | База данных в шаблоне | PostgreSQL в Docker Compose. |

## 6. Изменения плана из-за раздела A

- **Шаг 0.** Проверка 3 (`pluginConfigs` через SDK) больше не нужна расширению, остаётся только для раннера. Добавлено: работают ли ссылки `open?prompt=` и `install-plugin` официального расширения в VS Code и Cursor.
- **Шаг E, новый (после шага 5).** Переделка расширения в «пульт»:
  - убрать SDK-движок, чат-webview, `stage-sdk`, платформенные сборки и хранение ключа;
  - сделать панель прогресса по `crew-contract`: задачи, решения, эскалации с кнопкой «ответить в сессии», статус, отчёт, `access-checklist`;
  - запуск команд и установку плагина — ссылками официального расширения;
  - walkthrough: «установить Claude Code и войти → поставить плагин → новый проект».
- **Шаг C, новый (после шага 7).** Codex:
  - оверлей манифеста `extensions.com.openai`;
  - шаблоны агентов `.codex/agents/*.toml`;
  - адаптер хуков для `apply_patch`;
  - поддержка `openai.chatgpt` в расширении;
  - прогоны раннера через `codex exec`.
- **Бюджет (D14/D15).** Итоги в долларах пишет только eval-раннер (`source: headless`). В интерактивных сессиях на подписке остаются только оценки плагина (`source: estimate`), а расширение `costs.log` больше не пишет.

## Источники

- Plugins: [components](https://code.claude.com/docs/en/plugins/components), [manifest reference](https://code.claude.com/docs/en/plugins/manifest-reference), [marketplace reference](https://code.claude.com/docs/en/plugins/marketplace-reference), [CLI](https://code.claude.com/docs/en/plugins/cli-reference), [loading](https://code.claude.com/docs/en/plugins/loading), [evals](https://code.claude.com/docs/en/plugin-evals)
- [Subagents](https://code.claude.com/docs/en/sub-agents), [Skills](https://code.claude.com/docs/en/skills), [Hooks](https://code.claude.com/docs/en/hooks), [Workflows](https://code.claude.com/docs/en/workflows)
- [Headless](https://code.claude.com/docs/en/headless), [CLI reference](https://code.claude.com/docs/en/cli-reference), [Permission modes](https://code.claude.com/docs/en/permission-modes), [Settings reference](https://code.claude.com/docs/en/settings-reference)
