// Runs dispatch.mjs the way Claude Code does: a separate process, hook input on stdin, hook
// output on stdout. No network: the package cases here never reach the registry.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { pluginRoot, tempDir, tempProject } from './helpers.mjs';

const golden = path.resolve(pluginRoot, '..', '..', 'crew-contract', 'fixtures', 'valid', '.crew');

const dispatch = path.join(pluginRoot, 'hooks', 'scripts', 'dispatch.mjs');
const hooksConfig = JSON.parse(readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8'));

function cleanEnv(extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(CREW_|CLAUDE_|EVAL_CREW_|CODEX_|PLUGIN_)/.test(k)) continue;
    env[k] = v;
  }
  // Most cases exercise the preset profile's zones; the `auto` stack has its own cases below.
  return { ...env, CLAUDE_PLUGIN_ROOT: pluginRoot, CLAUDE_PLUGIN_DATA: tempDir('crew-hook-data-'), CREW_STACK_PROFILE: 'tanstack', ...extra };
}

function run(event, input, { root, env = {} } = {}) {
  const res = spawnSync(process.execPath, [dispatch, event], {
    input: JSON.stringify({ cwd: root, hook_event_name: event, ...input }),
    env: cleanEnv({ CLAUDE_PROJECT_DIR: root, ...env }),
    encoding: 'utf8',
    timeout: 20000,
  });
  assert.equal(res.status, 0, res.stderr);
  return { output: res.stdout.trim() ? JSON.parse(res.stdout) : undefined, stderr: res.stderr };
}

function startCrewSession(root, session_id = 'sess-1') {
  const res = run('UserPromptExpansion', { session_id, command_name: 'agent-crew:new-project', transcript_path: '/tmp/t.jsonl' }, { root });
  return res.output;
}

function readJsonLines(file) {
  return readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
}

describe('hooks.json', () => {
  it('routes every event through dispatch.mjs in exec form', () => {
    const events = Object.keys(hooksConfig.hooks);
    assert.deepEqual(events.sort(), ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop', 'SubagentStart', 'SubagentStop', 'UserPromptExpansion']);
    for (const event of events) {
      for (const group of hooksConfig.hooks[event]) {
        for (const h of group.hooks) {
          assert.equal(h.command, 'node');
          assert.deepEqual(h.args, ['${CLAUDE_PLUGIN_ROOT}/hooks/scripts/dispatch.mjs', event]);
        }
      }
    }
  });
});

describe('outside crew sessions', () => {
  it('stays silent and writes nothing', () => {
    const root = tempProject();
    for (const event of ['SessionStart', 'PreToolUse', 'PostToolUse', 'SubagentStop']) {
      const { output } = run(event, { session_id: 'plain', tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }, { root });
      assert.equal(output, undefined, event);
    }
    assert.equal(run('UserPromptExpansion', { session_id: 'plain', command_name: 'review' }, { root }).output, undefined);
    assert.equal(run('UserPromptExpansion', { session_id: 'plain', command_name: 'other-plugin:new-project' }, { root }).output, undefined);
    assert.equal(existsSync(path.join(root, '.crew')), false);
  });

  it('fails open on bad input', () => {
    const res = spawnSync(process.execPath, [dispatch, 'PreToolUse'], { input: '{not json', env: cleanEnv(), encoding: 'utf8' });
    assert.equal(res.status, 0);
    assert.equal(res.stdout, '');
    assert.match(res.stderr, /invalid input/);
  });
});

describe('a plugin under a symlinked folder', () => {
  // Found in the first live run: the eval copy of the plugin sat in macOS's /var/folders (a
  // symlink to /private/var), the entry-point check failed, and every hook was a silent no-op.
  it('still runs its hooks', () => {
    const root = tempProject();
    const link = path.join(tempDir('crew-hook-link-'), 'plugin');
    symlinkSync(pluginRoot, link, 'dir');
    const res = spawnSync(process.execPath, [path.join(link, 'hooks', 'scripts', 'dispatch.mjs'), 'PreToolUse'], {
      input: JSON.stringify({ cwd: root, hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }),
      env: cleanEnv({ CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_ROOT: link, CREW_HOST: 'eval' }),
      encoding: 'utf8',
      timeout: 20000,
    });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(JSON.parse(res.stdout).hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(readJsonLines(path.join(root, '.crew', 'logs', 'hooks.jsonl')).length, 1);
  });
});

describe('an executor in its own git worktree (parallel_tasks=worktrees)', () => {
  const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8' });

  function projectWithWorktree() {
    const root = tempProject();
    mkdirSync(path.join(root, '.crew', 'tasks'), { recursive: true });
    writeFileSync(path.join(root, '.crew', 'tasks', 'T-001.md'), '---\nid: T-001\n---\n');
    mkdirSync(path.join(root, 'src', 'routes'), { recursive: true });
    writeFileSync(path.join(root, 'src', 'routes', 'index.tsx'), 'x');
    git(root, 'init', '-q');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'init');
    const tree = path.join(tempDir('crew-hook-wt-'), 'T-001');
    assert.equal(git(root, 'worktree', 'add', '-q', '-b', 'crew-T-001', tree).status, 0);
    return { root, tree };
  }

  it('judges files relative to the worktree and keeps .crew/ in the main checkout', () => {
    const { root, tree } = projectWithWorktree();
    const pre = (tool_input, agent, tool = 'Write') =>
      run('PreToolUse', { session_id: 's', cwd: tree, tool_name: tool, tool_input, agent_type: `agent-crew:${agent}` }, { root, env: { CREW_HOST: 'eval' } }).output.hookSpecificOutput;
    // The frontend zone (src/routes/**) applies inside the worktree…
    assert.equal(pre({ file_path: path.join(tree, 'src', 'routes', 'book.tsx'), content: 'x' }, 'frontend').permissionDecision, 'allow');
    assert.match(pre({ file_path: path.join(tree, 'src', 'db', 'schema.ts'), content: 'x' }, 'frontend').permissionDecisionReason, /src\/db\/schema\.ts is outside that zone/);
    // …its copy of .crew/ is not the run's state…
    assert.match(pre({ file_path: path.join(tree, '.crew', 'tasks', 'T-001.md'), content: 'x' }, 'frontend').permissionDecisionReason, /is a copy: the crew's state lives in the main checkout/);
    // …and the journal still goes to the main checkout.
    assert.ok(existsSync(path.join(root, '.crew', 'logs', 'hooks.jsonl')));
    assert.equal(existsSync(path.join(tree, '.crew', 'logs')), false);
  });

  it('lets only the orchestrator merge a finished task back', () => {
    const { root, tree } = projectWithWorktree();
    const bash = (command, extra = {}) => run('PreToolUse', { session_id: 's', tool_name: 'Bash', tool_input: { command }, ...extra }, { root, env: { CREW_HOST: 'eval' } }).output.hookSpecificOutput;
    assert.equal(bash('git merge --no-ff crew-T-001 -m "merge T-001"').permissionDecision, 'allow');
    assert.match(bash('git merge main', { cwd: tree, agent_type: 'agent-crew:frontend' }).permissionDecisionReason, /only the orchestrator merges branches/);
  });
});

describe('lessons from earlier runs', () => {
  it('reach the orchestrator and the agents they concern, from the project and from the plugin data', () => {
    const root = tempProject();
    const data = tempDir('crew-hook-data-');
    mkdirSync(path.join(root, '.crew'), { recursive: true });
    writeFileSync(path.join(data, 'lessons.md'), '# Lessons\n\n- [frontend] Check every screen at phone width before submitting. (2026-10-01)\n- [all] Read the stack rules before the first command. (2026-10-01)\n');
    writeFileSync(path.join(root, '.crew', 'lessons.md'), '- [db] Add new variables to .env in the same task as .env.example. (2026-10-01)\n- not a lesson line\n');
    const env = { CLAUDE_PLUGIN_DATA: data };
    const main = run('UserPromptExpansion', { session_id: 'l1', command_name: 'agent-crew:new-project' }, { root, env }).output.hookSpecificOutput.additionalContext;
    assert.match(main, /Lessons from earlier crew runs \(advice from past mistakes; the brief, the stack rules and the policy come first\)/);
    for (const text of ['frontend: Check every screen at phone width', 'Read the stack rules before the first command', 'db: Add new variables to .env']) assert.ok(main.includes(text), text);
    const sub = (agent) => run('SubagentStart', { session_id: 'l1', agent_type: `agent-crew:${agent}`, agent_id: 'a' }, { root, env }).output.hookSpecificOutput.additionalContext;
    assert.ok(sub('frontend').includes('Check every screen at phone width') && sub('frontend').includes('Read the stack rules'));
    assert.ok(!sub('frontend').includes('Add new variables'));
    assert.ok(sub('db').includes('Add new variables') && !sub('db').includes('phone width'));
  });
});

describe('crew commands', () => {
  it('continue and fix start a crew session like new-project and feature; status does not', () => {
    for (const command of ['continue', 'fix', 'feature', 'deploy']) {
      const root = tempProject();
      const out = run('UserPromptExpansion', { session_id: `s-${command}`, command_name: `agent-crew:${command}` }, { root }).output;
      assert.match(out.hookSpecificOutput.additionalContext, /Agent Crew session/, command);
      assert.ok(existsSync(path.join(root, '.crew', 'sessions', `s-${command}.json`)), command);
      // …so the policy is on in that session, also in a brand-new chat.
      assert.equal(run('PreToolUse', { session_id: `s-${command}`, tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }, { root }).output.hookSpecificOutput.permissionDecision, 'deny');
    }
    const root = tempProject();
    assert.equal(run('UserPromptExpansion', { session_id: 's-status', command_name: 'agent-crew:status' }, { root }).output, undefined);
    assert.equal(existsSync(path.join(root, '.crew')), false);
  });

  it('tells the orchestrator the model tier and review depth the user chose', () => {
    const root = tempProject();
    const ctx = run('UserPromptExpansion', { session_id: 's', command_name: 'agent-crew:new-project' }, { root, env: { CLAUDE_PLUGIN_OPTION_MODEL_TIER: 'economy', CLAUDE_PLUGIN_OPTION_REVIEW_DEPTH: 'qa-only' } }).output.hookSpecificOutput.additionalContext;
    assert.match(ctx, /model_tier=economy, review_depth=qa-only/);
  });
});

describe('spending cap', () => {
  const start = (env, input = {}) => {
    const root = tempProject();
    return run('UserPromptExpansion', { session_id: 'pay-1', command_name: 'agent-crew:new-project', ...input }, { root, env }).output.hookSpecificOutput.additionalContext;
  };

  it('is not mentioned on a subscription, and suggested when the session is paid per use', () => {
    assert.doesNotMatch(start({}), /Billing:/);
    assert.match(start({ ANTHROPIC_API_KEY: 'sk-test' }), /Billing: this session is paid per use \(an API key\) and no spending cap is set/);
    assert.match(start({ CLAUDE_CODE_USE_BEDROCK: '1' }), /a cloud provider account/);
    // The user set a cap, or a host (the eval runner) manages the budget: nothing to suggest.
    assert.doesNotMatch(start({ ANTHROPIC_API_KEY: 'sk-test', CLAUDE_PLUGIN_OPTION_BUDGET_CAP_USD: '50' }), /Billing:/);
    assert.doesNotMatch(start({ ANTHROPIC_API_KEY: 'sk-test', CREW_HOST: 'eval' }), /Billing:/);
  });

  it('knows the credit-billed model from the session start', () => {
    const root = tempProject();
    const data = tempDir('crew-hook-data-');
    const env = { CLAUDE_PLUGIN_DATA: data };
    // SessionStart is the only event that names the model; it comes before the crew command.
    assert.equal(run('SessionStart', { session_id: 'm-1', source: 'startup', model: 'claude-fable-5-1' }, { root, env }).output, undefined);
    const ctx = run('UserPromptExpansion', { session_id: 'm-1', command_name: 'agent-crew:new-project' }, { root, env }).output.hookSpecificOutput.additionalContext;
    assert.match(ctx, /Billing: this session is paid per use \(the model claude-fable-5-1, billed in usage credits\)/);
    const other = tempProject();
    run('SessionStart', { session_id: 'm-2', source: 'startup', model: 'claude-sonnet-5-5' }, { root: other, env });
    assert.doesNotMatch(run('UserPromptExpansion', { session_id: 'm-2', command_name: 'agent-crew:new-project' }, { root: other, env }).output.hookSpecificOutput.additionalContext, /Billing:/);
  });
});

describe('a stack without a preset (stack_profile=auto)', () => {
  const auto = { CREW_STACK_PROFILE: 'auto', CREW_HOST: 'eval' };
  const write = (root, file, content, agent) => run('PreToolUse', { session_id: 's', tool_name: 'Write', tool_input: { file_path: file, content }, ...(agent ? { agent_type: `agent-crew:${agent}` } : {}) }, { root, env: auto }).output?.hookSpecificOutput;

  it('gives code agents no zone until the architect writes the project policy', () => {
    const root = tempProject();
    assert.equal(write(root, 'app/page.tsx', 'x', 'frontend').permissionDecision, 'deny');
    assert.equal(write(root, '.crew/policy.json', '{}', 'architect').permissionDecision, 'allow');
    assert.equal(write(root, '.crew/stack/README.md', '# Stack', 'architect').permissionDecision, 'allow');
    assert.equal(write(root, '.crew/policy.json', '{}', 'frontend').permissionDecision, 'deny');
    mkdirSync(path.join(root, '.crew'), { recursive: true });
    writeFileSync(path.join(root, '.crew', 'policy.json'), JSON.stringify({ zones: { frontend: ['app/**'], backend: ['api/**', '.crew/**', '../x/**'] }, safeCommands: [['pnpm', 'test'], ['rm'], ['pnpm']], packages: { allow: ['next'] } }));
    assert.equal(write(root, 'app/page.tsx', 'x', 'frontend').permissionDecision, 'allow');
    assert.equal(write(root, 'api/users.py', 'x', 'backend').permissionDecision, 'allow');
    // Entries that reach into .crew/ or out of the project are ignored, the rest applies.
    assert.match(write(root, '.crew/brief.md', 'x', 'backend').permissionDecisionReason, /outside that zone/);
    const bash = (command) => run('PreToolUse', { session_id: 's', tool_name: 'Bash', tool_input: { command }, agent_type: 'agent-crew:backend' }, { root, env: auto }).output?.hookSpecificOutput?.permissionDecision;
    assert.equal(bash('pnpm test'), 'allow');
    assert.notEqual(bash('pnpm publish'), 'allow');
    assert.equal(bash('rm -rf /'), 'deny');
  });

  it('tells the architect at once what is wrong with the project policy', () => {
    const root = tempProject();
    mkdirSync(path.join(root, '.crew'), { recursive: true });
    const file = path.join(root, '.crew', 'policy.json');
    writeFileSync(file, JSON.stringify({ zones: { pm: ['src/**'], frontend: ['**'] }, safeCommands: [['curl', 'x']], protectedBranches: [] }));
    const post = () => run('PostToolUse', { session_id: 's', tool_name: 'Write', tool_input: { file_path: file }, agent_type: 'agent-crew:architect' }, { root, env: auto }).output;
    const blocked = post();
    assert.equal(blocked.decision, 'block');
    for (const text of ['"protectedBranches" is not a project setting', 'zones.pm: only architect, qa, frontend, backend, db', 'is the whole project', '"curl" is not a build, test or package tool']) assert.ok(blocked.reason.includes(text), text);
    writeFileSync(file, JSON.stringify({ zones: { frontend: ['app/**'] }, safeCommands: [['pnpm', 'test'], ['pytest']] }));
    assert.equal(post(), undefined);
    writeFileSync(file, '{broken');
    assert.match(post().reason, /not valid JSON/);
  });

  it('points agents at the project stack rules once they exist', () => {
    const root = tempProject();
    const ctx = () => run('SubagentStart', { session_id: 's', agent_type: 'agent-crew:backend', agent_id: 'a1' }, { root, env: auto }).output.hookSpecificOutput.additionalContext;
    assert.match(ctx(), /stack is not set up yet: the architect chooses or detects it and writes its rules to \.crew\/stack\//);
    mkdirSync(path.join(root, '.crew', 'stack'), { recursive: true });
    writeFileSync(path.join(root, '.crew', 'stack', 'README.md'), '# Stack\n');
    assert.match(ctx(), /read \.crew\/stack\/README\.md/);
    assert.doesNotMatch(ctx(), /tanstack/);
  });
});

describe('crew sessions', () => {
  it('a crew command writes the session marker and .crew/.gitignore and adds context', () => {
    const root = tempProject();
    const output = startCrewSession(root);
    assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptExpansion');
    assert.match(output.hookSpecificOutput.additionalContext, /Agent Crew session/);
    assert.match(output.hookSpecificOutput.additionalContext, /autonomy=full, stack_profile=tanstack, budget_cap_usd=0 \(no spending cap\)/);
    assert.doesNotMatch(output.hookSpecificOutput.additionalContext, /Billing:/);
    const marker = JSON.parse(readFileSync(path.join(root, '.crew', 'sessions', 'sess-1.json'), 'utf8'));
    assert.ok(existsSync(marker.data_dir), 'the marker tells the crew CLI where the plugin keeps its data');
    assert.deepEqual(
      { ...marker, started_at: 'x', data_dir: 'd' },
      {
        data_dir: 'd',
        session_id: 'sess-1',
        command: 'agent-crew:new-project',
        started_at: 'x',
        assistant: 'claude-code',
        transcript_path: '/tmp/t.jsonl',
        config: { autonomy: 'full', briefReviewMinutes: 10, budgetCapUsd: 0, stackProfile: 'tanstack', modelTier: 'balanced', reviewDepth: 'every-task', parallelTasks: 'same-folder', host: 'interactive' },
      },
    );
    assert.equal(readFileSync(path.join(root, '.crew', '.gitignore'), 'utf8'), 'logs/\nsessions/\n');
  });

  it('SessionStart reports the phase from status.md', () => {
    const root = tempProject();
    startCrewSession(root, 's2');
    writeFileSync(path.join(root, '.crew', 'status.md'), readFileSync(path.join(golden, 'status.md')));
    const { output } = run('SessionStart', { session_id: 's2', source: 'resume' }, { root, env: { CLAUDE_PLUGIN_OPTION_AUTONOMY: 'review' } });
    assert.match(output.hookSpecificOutput.additionalContext, /autonomy=review/);
    assert.match(output.hookSpecificOutput.additionalContext, /Current phase: tasks — Two of three tasks/);
  });

  it('PreToolUse denies with a reason and logs a digest, never the raw input', () => {
    const root = tempProject();
    startCrewSession(root);
    const { output } = run('PreToolUse', { session_id: 'sess-1', tool_name: 'Bash', tool_input: { command: 'rm -rf ~/secret-stuff' }, agent_type: 'agent-crew:backend' }, { root });
    assert.equal(output.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(output.hookSpecificOutput.permissionDecisionReason, /^Blocked by the agent-crew policy: rm target "~\/secret-stuff" is outside the project/);
    const log = readFileSync(path.join(root, '.crew', 'logs', 'hooks.jsonl'), 'utf8');
    assert.doesNotMatch(log, /rm -rf/);
    const [entry] = readJsonLines(path.join(root, '.crew', 'logs', 'hooks.jsonl'));
    assert.equal(entry.decision, 'deny');
    assert.equal(entry.tool, 'Bash');
    assert.equal(entry.agent_type, 'agent-crew:backend');
    assert.match(entry.input_digest, /^[0-9a-f]{24}$/);
  });

  it('PreToolUse allows zone writes, stays silent on undecided commands and honours CREW_HOST', () => {
    const root = tempProject();
    startCrewSession(root);
    const allow = run('PreToolUse', { session_id: 'sess-1', tool_name: 'Write', tool_input: { file_path: 'src/routes/index.tsx', content: 'x' }, agent_type: 'agent-crew:frontend' }, { root });
    assert.equal(allow.output.hookSpecificOutput.permissionDecision, 'allow');
    const none = run('PreToolUse', { session_id: 'sess-1', tool_name: 'Bash', tool_input: { command: 'python3 x.py' } }, { root });
    assert.equal(none.output, undefined);
    // Every tool call is logged (SPEC §9), even ones the policy has no opinion on.
    const read = run('PreToolUse', { session_id: 'sess-1', tool_name: 'WebFetch', tool_input: { url: 'https://tanstack.com/start' } }, { root });
    assert.equal(read.output, undefined);
    // An eval/SDK host has no marker but sets CREW_HOST.
    const host = run('PreToolUse', { session_id: 'no-marker', tool_name: 'Bash', tool_input: { command: 'git push --force' } }, { root, env: { CREW_HOST: 'eval' } });
    assert.equal(host.output.hookSpecificOutput.permissionDecision, 'deny');
    // Under `claude plugin eval` only EVAL_* variables reach the session.
    const evalHost = run('PreToolUse', { session_id: 'no-marker', tool_name: 'Bash', tool_input: { command: 'git push --force' } }, { root, env: { EVAL_CREW_HOST: '1' } });
    assert.equal(evalHost.output.hookSpecificOutput.permissionDecision, 'deny');
    const log = readJsonLines(path.join(root, '.crew', 'logs', 'hooks.jsonl'));
    assert.deepEqual(log.map((e) => `${e.tool}:${e.decision}`), ['Write:allow', 'Bash:none', 'WebFetch:none', 'Bash:deny', 'Bash:deny']);
  });

  it('PostToolUse blocks contract violations in .crew/ and journals edits elsewhere', () => {
    const root = tempProject();
    startCrewSession(root);
    mkdirSync(path.join(root, '.crew', 'tasks'), { recursive: true });
    const bad = path.join(root, '.crew', 'tasks', 'T-001-login.md');
    writeFileSync(bad, '---\nid: T-1\nstatus: whatever\n---\n# Login\n');
    const { output } = run('PostToolUse', { session_id: 'sess-1', tool_name: 'Write', tool_input: { file_path: bad, content: '' } }, { root });
    assert.equal(output.decision, 'block');
    assert.match(output.reason, /^\.crew\/tasks\/T-001-login\.md does not match the \.crew\/ contract:/);
    assert.match(output.reason, /crew` CLI/);

    writeFileSync(bad, readFileSync(path.join(golden, 'tasks', 'T-001.md')));
    assert.equal(run('PostToolUse', { session_id: 'sess-1', tool_name: 'Write', tool_input: { file_path: bad } }, { root }).output, undefined);

    const edit = run('PostToolUse', { session_id: 'sess-1', tool_name: 'Edit', agent_type: 'agent-crew:frontend', tool_input: { file_path: 'src/a.ts', old_string: 'let a = 1', new_string: 'let a = 2' } }, { root });
    assert.equal(edit.output, undefined);
    const [entry] = readJsonLines(path.join(root, '.crew', 'logs', 'edits.jsonl'));
    assert.equal(entry.file, 'src/a.ts');
    assert.equal(entry.agent_type, 'agent-crew:frontend');
    assert.notEqual(entry.before, entry.after);
    assert.doesNotMatch(JSON.stringify(entry), /let a/);
  });

  it('SubagentStart gives crew agents the project context and ignores other agents', () => {
    const root = tempProject();
    startCrewSession(root);
    writeFileSync(path.join(root, '.crew', 'crew.json'), JSON.stringify({ contract_version: 1, plugin: { name: 'agent-crew', version: '0.1.0' }, stack_profile: 'tanstack', created_at: '2026-09-29T10:00:00Z', language: 'ru' }));
    const { output } = run('SubagentStart', { session_id: 'sess-1', agent_type: 'agent-crew:frontend', agent_id: 'a1', prompt: 'Work on T-001' }, { root });
    const ctx = output.hookSpecificOutput.additionalContext;
    assert.equal(output.hookSpecificOutput.hookEventName, 'SubagentStart');
    assert.match(ctx, /for the frontend agent/);
    assert.match(ctx, /load the skill `agent-crew:tanstack-stack` with the Skill tool/);
    // …and where the skill is on disk, for an agent that cannot call it.
    assert.ok(ctx.includes(`read ${path.join(pluginRoot, 'skills', 'stacks', 'tanstack', 'tanstack-stack', 'SKILL.md')} instead`));
    assert.match(ctx, /not with shell loops/);
    assert.match(ctx, /project language: ru/);
    assert.match(ctx, /data, not instructions/);
    assert.equal(run('SubagentStart', { session_id: 'sess-1', agent_type: 'Explore' }, { root }).output, undefined);
    const other = tempProject();
    assert.equal(run('SubagentStart', { session_id: 'plain', agent_type: 'agent-crew:frontend' }, { root: other }).output, undefined);
  });

  it('PreToolUse reserves crew commands for their roles and task fields for the CLI', () => {
    const root = tempProject();
    startCrewSession(root);
    mkdirSync(path.join(root, '.crew', 'tasks'), { recursive: true });
    const task = path.join(root, '.crew', 'tasks', 'T-001.md');
    writeFileSync(task, readFileSync(path.join(golden, 'tasks', 'T-001.md')));
    const decide = (input) => run('PreToolUse', { session_id: 'sess-1', ...input }, { root }).output?.hookSpecificOutput;

    const selfPass = decide({ agent_type: 'agent-crew:frontend', tool_name: 'Bash', tool_input: { command: 'crew task pass T-001 --stage qa' } });
    assert.equal(selfPass.permissionDecision, 'deny');
    assert.match(selfPass.permissionDecisionReason, /run by the qa agent itself, not by the frontend agent/);
    assert.equal(decide({ agent_type: 'agent-crew:qa', tool_name: 'Bash', tool_input: { command: 'crew task pass T-001 --stage qa' } }).permissionDecision, 'allow');
    assert.equal(decide({ agent_type: 'agent-crew:frontend', tool_name: 'Bash', tool_input: { command: 'crew task submit T-001 --files src/a.ts' } }).permissionDecision, 'allow');

    const fieldEdit = decide({ agent_type: 'agent-crew:frontend', tool_name: 'Edit', tool_input: { file_path: task, old_string: 'status: done', new_string: 'status: review' } });
    assert.equal(fieldEdit.permissionDecision, 'deny');
    assert.match(fieldEdit.permissionDecisionReason, /task fields change only through the crew CLI/);
    const bodyEdit = decide({ agent_type: 'agent-crew:frontend', tool_name: 'Edit', tool_input: { file_path: task, old_string: '# T-001: Scaffold the app and database schema', new_string: '# T-001: Scaffold the app and database schema\n\nNotes: done.' } });
    assert.equal(bodyEdit.permissionDecision, 'allow');
    const create = decide({ tool_name: 'Write', tool_input: { file_path: path.join(root, '.crew', 'tasks', 'T-009.md'), content: '---\nid: T-009\n---\n' } });
    assert.match(create.permissionDecisionReason, /created with crew task new/);
  });

  it('Stop keeps the orchestrator going while tasks are ready, and only in crew sessions', () => {
    const root = tempProject();
    startCrewSession(root);
    const bin = path.join(pluginRoot, 'bin', 'crew');
    for (const argv of [['init'], ['status', 'set', 'phase=tasks'], ['task', 'new', '--title', 'Schema', '--owner', 'db']]) {
      const r = spawnSync(process.execPath, [bin, ...argv], { cwd: root, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
    }
    const { output } = run('Stop', { session_id: 'sess-1', stop_hook_active: false }, { root });
    assert.equal(output.decision, 'block');
    assert.match(output.reason, /^Agent Crew: tasks can still move \(ready: T-001\)/);
    assert.equal(run('Stop', { session_id: 'someone-else' }, { root }).output, undefined);
  });

  it('SubagentStop appends a cost estimate from the subagent transcript', () => {
    const root = tempProject();
    startCrewSession(root);
    const transcript = path.join(root, 'agent.jsonl');
    const usage = { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 10000, cache_creation_input_tokens: 400 };
    writeFileSync(
      transcript,
      [
        { type: 'user', message: { role: 'user', content: 'Work on T-007: booking form' } },
        { type: 'assistant', message: { id: 'm1', model: 'claude-sonnet-5-5', usage } },
        { type: 'assistant', message: { id: 'm1', model: 'claude-sonnet-5-5', usage } },
        { type: 'assistant', message: { id: 'm2', model: 'claude-sonnet-5-5', usage: { input_tokens: 10, output_tokens: 20 } } },
      ]
        .map((l) => JSON.stringify(l))
        .join('\n'),
    );
    const { output } = run('SubagentStop', { session_id: 'sess-1', agent_type: 'agent-crew:frontend', agent_transcript_path: transcript }, { root });
    assert.equal(output, undefined);
    const [entry] = readJsonLines(path.join(root, '.crew', 'costs.log'));
    assert.equal(entry.source, 'estimate');
    assert.equal(entry.task, 'T-007');
    assert.equal(entry.agent, 'frontend');
    assert.equal(entry.model, 'claude-sonnet-5-5');
    assert.deepEqual(entry.tokens, { input: 1010, output: 2020, cache_read: 10000, cache_write: 400 });
    // Sonnet 5.5: $2 in, $10 out, $0.20 cache read, cache write 1.25 × input
    const expected = (1010 * 2 + 2020 * 10 + 10000 * 0.2 + 400 * 2.5) / 1e6;
    assert.ok(Math.abs(entry.turn_cost_usd - expected) < 1e-9, `${entry.turn_cost_usd} vs ${expected}`);
    // Stopping again with the same transcript adds nothing (no double counting), but the task's
    // running estimate is refreshed once its file exists.
    mkdirSync(path.join(root, '.crew', 'tasks'), { recursive: true });
    writeFileSync(path.join(root, '.crew', 'tasks', 'T-007-booking.md'), readFileSync(path.join(golden, 'tasks', 'T-001.md'), 'utf8').replace('id: T-001', 'id: T-007'));
    run('SubagentStop', { session_id: 'sess-1', agent_type: 'agent-crew:frontend', agent_transcript_path: transcript }, { root });
    assert.equal(readJsonLines(path.join(root, '.crew', 'costs.log')).length, 1);
    assert.match(readFileSync(path.join(root, '.crew', 'tasks', 'T-007-booking.md'), 'utf8'), /spent_usd_estimate: 0\.03\n/);
    // A resumed subagent: only the new messages are estimated.
    writeFileSync(transcript, `${readFileSync(transcript, 'utf8')}\n${JSON.stringify({ type: 'assistant', message: { id: 'm3', model: 'claude-sonnet-5-5', usage: { input_tokens: 100, output_tokens: 50 } } })}`);
    run('SubagentStop', { session_id: 'sess-1', agent_type: 'agent-crew:frontend', agent_transcript_path: transcript }, { root });
    const entries = readJsonLines(path.join(root, '.crew', 'costs.log'));
    assert.equal(entries.length, 2);
    assert.deepEqual(entries[1].tokens, { input: 100, output: 50, cache_read: 0, cache_write: 0 });
  });
});
