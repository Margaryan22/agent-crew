// Lint for the plugin's agents and skills: the structure SPEC §5 and §10 require and the
// frontmatter Claude Code supports for plugin agents (checked against the docs, 2.1.283).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { KNOWN_AGENTS, parseFrontmatter } from '../lib/crew-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
const policy = JSON.parse(readFileSync(path.join(root, 'hooks', 'policy.core.json'), 'utf8'));

const SECTIONS = ['Цель', 'Зона ответственности', 'Запрещено', 'Входы', 'Выходы', 'Критерий готовности', 'Кому эскалирует'];
const AGENT_FIELDS = new Set(['name', 'description', 'model', 'effort', 'maxTurns', 'tools', 'disallowedTools', 'skills', 'memory', 'background', 'omitClaudeMd', 'isolation', 'color', 'experimental']);
const IGNORED_FOR_PLUGINS = ['permissionMode', 'hooks', 'mcpServers', 'initialPrompt'];
const TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'Bash', 'WebFetch', 'WebSearch', 'NotebookEdit', 'TodoWrite', 'Skill']);
const COLORS = new Set(['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan']);

function walkSkills(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (!statSync(abs).isDirectory()) continue;
    try {
      statSync(path.join(abs, 'SKILL.md'));
      out.push(abs);
    } catch {
      out.push(...walkSkills(abs));
    }
  }
  return out;
}

const skills = walkSkills(path.join(root, 'skills')).map((dir) => {
  const text = readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
  const fm = parseFrontmatter(text);
  return { dir: path.relative(root, dir), name: fm.data.name ?? path.basename(dir), data: fm.data, body: fm.body, lines: text.split('\n').length };
});
const skillNames = new Set(skills.map((s) => s.name));

const agents = readdirSync(path.join(root, 'agents'))
  .filter((n) => n.endsWith('.md'))
  .map((file) => {
    const fm = parseFrontmatter(readFileSync(path.join(root, 'agents', file), 'utf8'));
    return { file, data: fm.data, body: fm.body, hasFrontmatter: fm.hasFrontmatter };
  });

const list = (v) => (Array.isArray(v) ? v : String(v ?? '').split(',')).map((s) => String(s).trim()).filter(Boolean);

describe('agents (SPEC §5)', () => {
  it('are the nine crew roles; the orchestrator is the main session', () => {
    assert.deepEqual(agents.map((a) => a.data.name).sort(), KNOWN_AGENTS.filter((a) => a !== 'orchestrator').slice().sort());
  });

  for (const agent of agents) {
    describe(agent.file, () => {
      it('has valid frontmatter for a plugin agent', () => {
        assert.ok(agent.hasFrontmatter);
        assert.equal(`${agent.data.name}.md`, agent.file);
        for (const key of Object.keys(agent.data)) {
          assert.ok(!IGNORED_FOR_PLUGINS.includes(key), `${key} is ignored for plugin agents`);
          assert.ok(AGENT_FIELDS.has(key), `unknown field ${key}`);
        }
        assert.ok(String(agent.data.description).length >= 80 && String(agent.data.description).length <= 600, 'description: say what the agent does and when to use it');
        assert.ok(['haiku', 'sonnet', 'opus'].includes(agent.data.model), 'model alias (SPEC §5 defaults)');
        assert.ok(['low', 'medium', 'high'].includes(agent.data.effort));
        assert.ok(COLORS.has(agent.data.color));
        assert.ok(Number.isInteger(agent.data.maxTurns) && agent.data.maxTurns > 0);
      });

      it('lists a minimal set of known tools and no subagent spawning', () => {
        const tools = list(agent.data.tools);
        assert.ok(tools.length > 0);
        for (const t of tools) assert.ok(TOOLS.has(t), `unknown tool ${t}`);
        assert.ok(!tools.includes('Agent') && !tools.includes('Task'), 'only the orchestrator delegates');
        if (!tools.includes('Bash')) assert.ok(['critic'].includes(agent.data.name), `${agent.data.name} needs Bash for the crew CLI`);
      });

      it('preloads skills that exist', () => {
        for (const s of list(agent.data.skills)) assert.ok(skillNames.has(s), `skill ${s} not found`);
      });

      it('has the SPEC sections in order', () => {
        const prose = agent.body.replace(/^```[\s\S]*?^```/gm, '');
        const headings = [...prose.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
        assert.deepEqual(headings, SECTIONS);
        for (const h of SECTIONS) {
          const section = prose.split(`## ${h}`)[1].split('\n## ')[0].trim();
          assert.ok(section.length > 20, `section ${h} is empty`);
        }
      });

      it('treats web content as data when it has web access (SPEC §9)', () => {
        const tools = list(agent.data.tools);
        if (tools.includes('WebFetch') || tools.includes('WebSearch')) assert.match(agent.body, /data, not instructions/);
      });

      it('has a write zone in the hook policy', () => {
        assert.ok(Array.isArray(policy.zones[agent.data.name]), `no zone for ${agent.data.name}`);
      });
    });
  }
});

describe('skills (SPEC §10)', () => {
  it('load from the groups listed in the manifest', () => {
    for (const s of skills) assert.ok(manifest.skills.some((g) => s.dir.startsWith(g.replace(/^\.\//, ''))), `${s.dir} is not in a listed group`);
  });

  it('have unique names (command names use only the last path segment)', () => {
    assert.equal(skillNames.size, skills.length);
  });

  it('core has the curated library', () => {
    const core = skills.filter((s) => s.dir.startsWith('skills/core/')).map((s) => s.name).sort();
    assert.deepEqual(core, ['acceptance-tests', 'brief', 'code-review', 'crew-files', 'git-process', 'interview', 'orchestration', 'security-review', 'stuck-detection']);
  });

  for (const s of skills) {
    it(`${s.dir}: description, size, invocation`, () => {
      const desc = String(s.data.description ?? '');
      assert.ok(desc.length >= 60 && desc.length <= 1536, 'description says when to use the skill');
      assert.ok(s.lines < 500, 'keep SKILL.md under 500 lines');
      if (s.dir.startsWith('skills/core/')) assert.equal(s.data['user-invocable'], false, 'knowledge skills are not slash commands');
      if (s.dir.startsWith('skills/commands/')) assert.equal(s.data['disable-model-invocation'], true, 'commands run only when the user types them');
    });
  }
});

describe('stack profiles (SPEC §4)', () => {
  const STACK_TERMS = /tanstack|drizzle|playwright|vitest|postgres|tailwind|react|npm audit|npx /i;

  it('core skills and agents are stack-agnostic', () => {
    for (const s of skills.filter((x) => x.dir.startsWith('skills/core/'))) assert.doesNotMatch(s.body, STACK_TERMS, s.dir);
    for (const a of agents) assert.doesNotMatch(a.body, STACK_TERMS, a.file);
  });

  for (const profile of manifest.userConfig.stack_profile.options) {
    it(`${profile}: entry skill, policy and template exist`, () => {
      assert.ok(skillNames.has(`${profile}-stack`), `skills/stacks/${profile}/${profile}-stack/SKILL.md`);
      assert.ok(statSync(path.join(root, 'skills', 'stacks', profile, 'policy.json')).isFile());
      assert.ok(statSync(path.join(root, 'templates', profile, 'package.json')).isFile());
      assert.ok(statSync(path.join(root, 'templates', profile, 'CLAUDE.md')).isFile());
      const stackSkills = skills.filter((s) => s.dir.startsWith(`skills/stacks/${profile}/`));
      for (const s of stackSkills) assert.ok(s.name.startsWith(`${profile}-`), `${s.name}: stack skill names start with the profile`);
      assert.ok(stackSkills.length >= 8, 'SPEC §10: structure, routes, schema, auth, forms, tables, reports, e2e');
    });
  }
});
