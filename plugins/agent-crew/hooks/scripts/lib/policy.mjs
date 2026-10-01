// Loads hooks/policy.core.json and merges the stack's policy on top: a preset profile's
// (skills/stacks/<profile>/policy.json), and the project's own (.crew/policy.json), which the
// architect writes for a stack the plugin has no preset for.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const PROJECT_POLICY = '.crew/policy.json';

/** Roles a project policy may give write zones to: the ones that write the project's code. */
const PROJECT_ROLES = ['architect', 'qa', 'frontend', 'backend', 'db'];
const PROJECT_KEYS = ['$comment', 'zones', 'safeCommands', 'packages'];

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function mergePolicy(core, profile = {}) {
  const zones = { ...core.zones };
  for (const [role, globs] of Object.entries(profile.zones ?? {})) zones[role] = [...(zones[role] ?? []), ...globs];
  return {
    ...core,
    protectedBranches: profile.protectedBranches ?? core.protectedBranches,
    network: { ...core.network, allowHosts: [...core.network.allowHosts, ...(profile.network?.allowHosts ?? [])] },
    packages: { ...core.packages, ...(profile.packages ?? {}), allow: [...core.packages.allow, ...(profile.packages?.allow ?? [])] },
    zones,
    safeCommands: [...core.safeCommands, ...(profile.safeCommands ?? [])],
    prices: core.prices,
  };
}

function zoneProblem(glob) {
  if (typeof glob !== 'string' || !glob.trim()) return 'must be a non-empty string';
  const g = glob.replace(/\\/g, '/');
  if (g.startsWith('/') || /^[A-Za-z]:/.test(g) || g.startsWith('~')) return 'must be relative to the project';
  if (g.split('/').includes('..')) return 'must not contain ".."';
  if (/^\.(crew|git)(\/|$)/.test(g)) return 'must not reach into .crew/ or .git/';
  if (/^\*+(\/\*+)*$/.test(g)) return 'is the whole project — name folders or files';
  return undefined;
}

/**
 * What is wrong with a project policy, as sentences for the agent that wrote it. A project policy
 * only adds to the core one: write zones for the code-writing roles, safe commands of the stack's
 * own tools, and packages. Protected branches, secret rules, network hosts and the core's denials
 * are not its to change.
 */
export function projectPolicyProblems(json, core) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return ['.crew/policy.json must be a JSON object'];
  const problems = [];
  for (const key of Object.keys(json)) if (!PROJECT_KEYS.includes(key)) problems.push(`"${key}" is not a project setting (allowed: zones, safeCommands, packages.allow)`);

  const zones = json.zones ?? {};
  if (typeof zones !== 'object' || Array.isArray(zones)) problems.push('"zones" must map a role to a list of globs');
  else {
    for (const [role, globs] of Object.entries(zones)) {
      if (!PROJECT_ROLES.includes(role)) problems.push(`zones.${role}: only ${PROJECT_ROLES.join(', ')} get project zones`);
      else if (!Array.isArray(globs)) problems.push(`zones.${role} must be a list of globs`);
      else for (const g of globs) if (zoneProblem(g)) problems.push(`zones.${role}: "${g}" ${zoneProblem(g)}`);
    }
  }

  const tools = new Set(core.projectCommands?.tools ?? []);
  const alone = new Set(core.projectCommands?.alone ?? []);
  const commands = json.safeCommands ?? [];
  if (!Array.isArray(commands)) problems.push('"safeCommands" must be a list of command prefixes such as ["npm", "run"]');
  else {
    for (const c of commands) {
      const shown = JSON.stringify(c);
      if (!Array.isArray(c) || !c.length || c.length > 3 || c.some((t) => typeof t !== 'string' || !/^[\w./:@-]+$/.test(t))) problems.push(`safeCommands: ${shown} must be 1–3 plain words`);
      else if (!tools.has(c[0])) problems.push(`safeCommands: ${shown} — "${c[0]}" is not a build, test or package tool the policy knows`);
      else if (c.length < 2 && !alone.has(c[0])) problems.push(`safeCommands: ${shown} is too broad — add the subcommand, e.g. ["${c[0]}", "test"]`);
    }
  }

  const packages = json.packages ?? {};
  if (typeof packages !== 'object' || Array.isArray(packages) || Object.keys(packages).some((k) => k !== 'allow')) problems.push('"packages" takes only "allow": a list of package names');
  else if (packages.allow !== undefined && (!Array.isArray(packages.allow) || packages.allow.some((n) => typeof n !== 'string' || !/^(@[\w.-]+\/)?[\w.-]+$/.test(n)))) problems.push('packages.allow must be a list of package names');
  return problems;
}

/** The usable part of a project policy: entries with a problem are dropped, the rest applies. */
export function sanitizeProjectPolicy(json, core) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return {};
  const ok = (part) => projectPolicyProblems(part, core).length === 0;
  const zones = {};
  if (json.zones && typeof json.zones === 'object' && !Array.isArray(json.zones)) {
    for (const [role, globs] of Object.entries(json.zones)) {
      if (!PROJECT_ROLES.includes(role) || !Array.isArray(globs)) continue;
      const kept = globs.filter((g) => !zoneProblem(g));
      if (kept.length) zones[role] = kept;
    }
  }
  const safeCommands = Array.isArray(json.safeCommands) ? json.safeCommands.filter((c) => ok({ safeCommands: [c] })) : [];
  const allow = Array.isArray(json.packages?.allow) ? json.packages.allow.filter((n) => ok({ packages: { allow: [n] } })) : [];
  return { zones, safeCommands, packages: { allow } };
}

/**
 * @param {string} pluginRoot
 * @param {string} stackProfile a preset name, or `auto`
 * @param {string} [root] the project; its .crew/policy.json is merged last
 */
export function loadPolicy(pluginRoot, stackProfile, root) {
  const core = readJson(path.join(pluginRoot, 'hooks', 'policy.core.json'));
  const profileFile = path.join(pluginRoot, 'skills', 'stacks', stackProfile, 'policy.json');
  let policy = mergePolicy(core, existsSync(profileFile) ? readJson(profileFile) : {});
  const projectFile = root ? path.join(root, PROJECT_POLICY) : undefined;
  if (projectFile && existsSync(projectFile)) {
    try {
      policy = mergePolicy(policy, sanitizeProjectPolicy(readJson(projectFile), core));
    } catch {
      // unreadable or half-written: the core and preset policy still apply
    }
  }
  return policy;
}

/** The stack this project runs on: what crew init recorded, else the session's setting. */
export function stackOf(root, config) {
  try {
    const manifest = readJson(path.join(root, '.crew', 'crew.json'));
    if (typeof manifest.stack_profile === 'string' && manifest.stack_profile) return manifest.stack_profile;
  } catch {
    // no manifest yet
  }
  return config.stackProfile;
}

/**
 * `agent-crew:frontend` → `frontend`; main thread → `orchestrator`. Agents from other plugins
 * (`other:frontend`) and unknown agents get the orchestrator's zone, never a crew role's.
 */
export function roleOf(agentType, policy, plugin = 'agent-crew') {
  if (!agentType) return 'orchestrator';
  const [prefix, name] = agentType.includes(':') ? agentType.split(':', 2) : [plugin, agentType];
  return prefix === plugin && name && name !== '*' && Object.hasOwn(policy.zones, name) ? name : 'orchestrator';
}

export function zonesFor(role, policy) {
  return [...(policy.zones['*'] ?? []), ...(policy.zones[role] ?? [])];
}

/** Roles whose own zone covers a project path: who a blocked write should be handed to. */
export function ownersOf(rel, policy, matches) {
  return Object.entries(policy.zones)
    .filter(([role, globs]) => role !== '*' && matches(rel, globs))
    .map(([role]) => role);
}

export function hostAllowed(host, policy) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return policy.network.allowHosts.some((pattern) => {
    const p = pattern.toLowerCase();
    return p.startsWith('*.') ? h.endsWith(p.slice(1)) || h === p.slice(2) : h === p;
  });
}

/**
 * Why this session is paid per use, or undefined when nothing says so (a subscription). Claude
 * Code tells hooks neither the billing mode nor — outside SessionStart — the model, so this is a
 * best guess from the credentials in the environment and the model the session started with.
 */
export function payPerUseReason(env, model, policy) {
  if ((env.ANTHROPIC_API_KEY ?? '').trim() || (env.ANTHROPIC_AUTH_TOKEN ?? '').trim()) return 'an API key';
  for (const key of ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) {
    if (/^(1|true|yes)$/i.test((env[key] ?? '').trim())) return 'a cloud provider account';
  }
  const name = String(model ?? '').toLowerCase();
  const hit = name && (policy.payPerUse?.models ?? []).find((p) => name.includes(String(p).toLowerCase()));
  return hit ? `the model ${model}, billed in usage credits` : undefined;
}
