// Loads hooks/policy.core.json and merges the stack profile's policy on top.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

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

/** @param {string} pluginRoot @param {string} stackProfile */
export function loadPolicy(pluginRoot, stackProfile) {
  const core = readJson(path.join(pluginRoot, 'hooks', 'policy.core.json'));
  const profileFile = path.join(pluginRoot, 'skills', 'stacks', stackProfile, 'policy.json');
  return mergePolicy(core, existsSync(profileFile) ? readJson(profileFile) : {});
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

export function hostAllowed(host, policy) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return policy.network.allowHosts.some((pattern) => {
    const p = pattern.toLowerCase();
    return p.startsWith('*.') ? h.endsWith(p.slice(1)) || h === p.slice(2) : h === p;
  });
}
