// PreToolUse policy (SPEC §9): deny dangerous commands, unvetted packages, network calls to
// unknown hosts, real secrets in .env and writes outside the agent's zone; allow work that the
// policy explicitly covers so hosts don't prompt for it; leave everything else to the host.

import path from 'node:path';
import { basename, parseShell } from './shell.mjs';
import { hostAllowed, ownersOf, roleOf, zonesFor } from './policy.mjs';
import { expandHome, isEnvSecretFile, isInside, matchesAny, secretKeysIn, tempDirs, toPosix } from './util.mjs';

/**
 * @typedef {{ decision: 'allow' | 'deny' | 'none', reasons: string[], role: string }} Verdict
 * @typedef {{
 *   root: string,
 *   policy: any,
 *   checkPackage: (name: string) => Promise<{ ok: boolean, reason?: string }>,
 *   currentBranch: (dir: string) => string | undefined,
 *   home?: string,
 *   parseFrontmatter?: (text: string) => { data: Record<string, unknown> },
 *   readFile?: (abs: string) => string | undefined,
 * }} RuleContext
 */

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const OUTPUT_REDIRECTS = new Set(['>', '>>', '>|', '&>', '&>>']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);
const NPM_INSTALL = new Set(['install', 'i', 'in', 'ins', 'inst', 'insta', 'instal', 'isnt', 'isnta', 'isntal', 'add']);

// ---------------------------------------------------------------------------
// Paths

/** Resolves a shell word against the tracked cwd; undefined when it can't be known statically. */
function resolveWord(word, cwd, home) {
  if (word.dynamic) return undefined;
  const expanded = expandHome(word.text, home);
  if (path.isAbsolute(expanded)) return path.resolve(expanded);
  if (cwd === undefined) return undefined;
  return path.resolve(cwd, expanded);
}

function allowedOutsideRoot(abs, input) {
  if (abs === '/dev/null' || abs.startsWith('/dev/fd/') || abs === '/dev/stdout' || abs === '/dev/stderr') return true;
  return tempDirs(input).some((d) => isInside(abs, d));
}

// ---------------------------------------------------------------------------
// Individual Bash rules; each returns deny reasons.

const FIND_TESTS = new Set(
  ['name', 'iname', 'path', 'ipath', 'wholename', 'iwholename', 'regex', 'iregex', 'lname', 'ilname', 'type', 'xtype', 'empty', 'newer', 'mtime', 'mmin', 'ctime', 'cmin', 'atime', 'amin', 'size', 'user', 'group', 'perm', 'links', 'inum', 'samefile'].map((t) => `-${t}`),
);

function checkRemoval(cmd, name, cwd, ctx, input) {
  const words = cmd.argv.slice(1);
  let recursive = name === 'find';
  let force = false;
  const targets = [];
  let options = true;
  // `find . -delete` wipes the project; `find . -name '*.log' -delete` only what matches.
  const findFiltered = name === 'find' && words.some((w) => FIND_TESTS.has(w.text));
  for (const w of words) {
    if (options && w.text === '--') {
      options = false;
      continue;
    }
    if (options && /^-[A-Za-z]+$/.test(w.text) && name !== 'find') {
      if (/[rR]/.test(w.text)) recursive = true;
      if (w.text.includes('f')) force = true;
      continue;
    }
    if (options && w.text.startsWith('--') && name !== 'find') {
      if (w.text === '--recursive') recursive = true;
      if (w.text === '--force') force = true;
      if (w.text === '--no-preserve-root') return [`${name} --no-preserve-root is never allowed`];
      continue;
    }
    if (name === 'find' && /^[-(!]/.test(w.text)) break; // find: paths come before the expression
    targets.push(w);
  }
  if (name === 'find' && !targets.length) targets.push({ text: '.', dynamic: false });
  const reasons = [];
  if (cmd.argsFromStdin && (recursive || force)) reasons.push(`${name} with targets from xargs cannot be verified to stay inside the project`);
  for (const t of targets) {
    const abs = resolveWord(t, cwd, ctx.home);
    if (abs === undefined) {
      reasons.push(`${name} target "${t.text}" can't be resolved before running (variable, substitution or unknown directory)`);
    } else if (abs === path.resolve(ctx.root) && (name === 'find' ? !findFiltered : recursive)) {
      reasons.push(`${name} would delete the whole project directory`);
    } else if (!isInside(abs, ctx.root) && !allowedOutsideRoot(abs, input)) {
      reasons.push(`${name} target "${t.text}" is outside the project (${ctx.root})`);
    }
  }
  return reasons;
}

function checkGit(cmd, cwd, ctx, role) {
  const argv = cmd.argv;
  let k = 1;
  let dir = cwd;
  while (k < argv.length && argv[k].text.startsWith('-')) {
    const t = argv[k].text;
    if (t === '-C') {
      dir = argv[k + 1] ? resolveWord(argv[k + 1], cwd, ctx.home) : undefined;
      k += 2;
    } else if (t === '-c' || t === '--git-dir' || t === '--work-tree' || t === '--namespace') {
      k += 2;
    } else {
      k++;
    }
  }
  if (argv[k]?.text !== 'push') return checkGitWorktree(argv.slice(k).map((w) => w.text), role);
  const protectedBranches = ctx.policy.protectedBranches;
  const reasons = [];
  const positional = [];
  for (const w of argv.slice(k + 1)) {
    if (w.dynamic) {
      reasons.push(`git push argument "${w.text}" can't be resolved before running`);
      continue;
    }
    const t = w.text;
    if (t === '-f' || t === '--force' || t.startsWith('--force-with-lease') || t === '--force-if-includes' || (/^-[a-z]+$/.test(t) && t.includes('f'))) {
      reasons.push('git push --force is not allowed');
    } else if (t === '--mirror' || t === '--all') {
      reasons.push(`git push ${t} would push ${protectedBranches.join('/')}`);
    } else if (t === '--delete' || t === '-d') {
      positional.push({ delete: true });
    } else if (!t.startsWith('-')) {
      positional.push(t);
    }
  }
  const deleting = positional.some((p) => typeof p === 'object');
  const [, ...refspecs] = positional.filter((p) => typeof p === 'string');
  const targets = [];
  if (!refspecs.length) {
    if (dir === undefined) return [...reasons, 'git push target branch cannot be determined'];
    const branch = ctx.currentBranch(dir);
    if (!branch) return [...reasons, 'could not determine the current branch for git push'];
    targets.push(branch);
  }
  for (const spec of refspecs) {
    if (spec.startsWith('+')) reasons.push(`git push refspec "${spec}" is a force push`);
    const clean = spec.replace(/^\+/, '');
    let dst = clean.includes(':') ? clean.split(':').pop() : clean;
    if (dst === 'HEAD' || dst === '') dst = dir === undefined ? undefined : ctx.currentBranch(dir);
    if (dst === undefined) reasons.push(`git push target of "${spec}" cannot be determined`);
    else targets.push(dst.replace(/^refs\/heads\//, ''));
  }
  for (const t of targets) {
    if (protectedBranches.includes(t)) reasons.push(`git push ${deleting ? '--delete ' : ''}to ${t} is not allowed; push a feature branch instead`);
  }
  return reasons;
}

/**
 * Several agents share one checkout, so git commands that discard, hide or sweep up other
 * agents' uncommitted work are blocked (git-process skill). Branch changes and staging
 * everything are left to the orchestrator.
 */
function checkGitWorktree(args, role) {
  const [sub, ...rest] = args;
  const has = (...flags) => rest.some((t) => flags.includes(t));
  const shortHas = (letter) => rest.some((t) => /^-[a-zA-Z]+$/.test(t) && t.includes(letter));
  const lead = role === 'orchestrator';
  const others = "other agents' uncommitted work in this checkout";
  switch (sub) {
    case 'stash':
      return ['list', 'show'].includes(rest[0]) ? [] : [`git stash would hide ${others}`];
    case 'reset':
      return has('--hard', '--merge', '--keep') ? [`git reset ${rest.find((t) => ['--hard', '--merge', '--keep'].includes(t))} would discard ${others}`] : [];
    case 'clean':
      return has('-n', '--dry-run') ? [] : [`git clean would delete ${others}`];
    case 'restore':
      return has('--staged', '-S') && !has('--worktree', '-W') ? [] : [`git restore would discard ${others}; commit or fix files instead`];
    case 'checkout':
      if (has('--', '.', '-f', '--force', '-p', '--patch') || rest.some((t) => t.startsWith(':'))) return [`git checkout of files would discard ${others}`];
      return lead ? [] : ['only the orchestrator switches branches (git-process skill)'];
    case 'switch':
      return lead ? [] : ['only the orchestrator switches branches (git-process skill)'];
    case 'branch':
      return lead || !(has('-d', '-D', '--delete', '-m', '-M', '--move', '-c', '-C', '--copy', '-f', '--force') || rest.some((t) => !t.startsWith('-'))) ? [] : ['only the orchestrator creates, renames or deletes branches'];
    case 'add':
      return lead || !(has('-A', '--all', '-u', '--update', '.', ':/', '*') || shortHas('A') || shortHas('u')) ? [] : [`stage only your task's files by path (git add -- <files>); git add ${rest.join(' ')} would sweep up ${others}`];
    case 'commit': {
      const reasons = [];
      if (has('--amend')) reasons.push('git commit --amend is not allowed: HEAD may be another agent\'s commit; make a new commit');
      if (has('--no-verify') || shortHas('n')) reasons.push("don't bypass the project's commit hooks with --no-verify");
      if (!lead && (has('--all') || shortHas('a'))) reasons.push(`git commit -a would commit ${others}; stage your files by path`);
      return reasons;
    }
    case 'rebase':
    case 'filter-branch':
    case 'filter-repo':
      return [`git ${sub} rewrites history; crew runs never rewrite history`];
    case 'worktree':
      return lead || ['list'].includes(rest[0]) ? [] : ['only the orchestrator manages worktrees'];
    default:
      return [];
  }
}

const CURL_VALUE_FLAGS = new Set([
  '-o', '--output', '-H', '--header', '-d', '--data', '--data-raw', '--data-binary', '--data-urlencode', '-X', '--request', '-u', '--user',
  '-A', '--user-agent', '-e', '--referer', '-b', '--cookie', '-c', '--cookie-jar', '-F', '--form', '-T', '--upload-file', '-w', '--write-out',
  '-m', '--max-time', '--connect-timeout', '--retry', '-r', '--range', '-K', '--config', '--cacert', '--cert', '--key', '-E',
  // More flags that take a value; without them the value ("--retry-delay 1") was read as a host.
  '--retry-delay', '--retry-max-time', '--max-redirs', '--limit-rate', '--rate', '-C', '--continue-at', '-D', '--dump-header', '--trace', '--trace-ascii',
  '--stderr', '--json', '--data-ascii', '--form-string', '--url-query', '--oauth2-bearer', '--proxy-user', '-U', '--cert-type', '--key-type', '--pass',
  '--capath', '--ciphers', '--local-port', '-z', '--time-cond', '--noproxy', '--netrc-file', '--output-dir', '--max-filesize', '-y', '--speed-time',
  '-Y', '--speed-limit', '--keepalive-time', '--expect100-timeout', '--proto', '--proto-redir', '--tls-max', '--happy-eyeballs-timeout-ms',
]);
/** Flags that send the request somewhere other than the URL's host: the allowlist cannot vouch for them. */
const CURL_REROUTING_FLAGS = ['--resolve', '--connect-to', '--unix-socket', '--abstract-unix-socket', '--socks4', '--socks4a', '--socks5', '--socks5-hostname', '--preproxy', '--proxy1.0', '--doh-url', '--dns-servers', '--interface'];
const WGET_VALUE_FLAGS = new Set(['-O', '--output-document', '-o', '--output-file', '-P', '--directory-prefix', '-U', '--user-agent', '--header', '-t', '--tries', '-T', '--timeout', '-e', '--execute']);

function hostOf(text) {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  try {
    return new URL(withScheme).hostname;
  } catch {
    return undefined;
  }
}

function checkNetwork(cmd, name, ctx) {
  const valueFlags = name === 'wget' ? WGET_VALUE_FLAGS : CURL_VALUE_FLAGS;
  const urls = [];
  const argv = cmd.argv;
  const rerouted = [];
  for (let k = 1; k < argv.length; k++) {
    const w = argv[k];
    const [flag, inline] = w.text.startsWith('--') && w.text.includes('=') ? [w.text.slice(0, w.text.indexOf('=')), w.text.slice(w.text.indexOf('=') + 1)] : [w.text, undefined];
    if (name === 'curl' && CURL_REROUTING_FLAGS.includes(flag)) {
      rerouted.push(flag);
      if (inline === undefined) k++;
    } else if (flag === '--url' || flag === '-x' || flag === '--proxy') {
      if (inline !== undefined) urls.push({ ...w, text: inline });
      else if (argv[k + 1]) urls.push(argv[k + 1]);
      if (inline === undefined) k++;
    } else if (inline !== undefined) {
      // --flag=value: the value belongs to the flag
    } else if (valueFlags.has(w.text)) {
      k++;
    } else if (!w.text.startsWith('-')) {
      urls.push(w);
    }
  }
  if (cmd.argsFromStdin) return [`${name} with URLs from xargs cannot be verified`];
  const reasons = rerouted.map((flag) => `${name} ${flag} sends the request to a host the network allowlist cannot check`);
  for (const u of urls) {
    if (u.dynamic) {
      reasons.push(`${name} URL "${u.text}" can't be resolved before running`);
      continue;
    }
    const host = hostOf(u.text);
    if (!host) reasons.push(`${name} target "${u.text}" is not a valid URL`);
    else if (!hostAllowed(host, ctx.policy)) reasons.push(`${name} to ${host} is not allowed (network allowlist: ${ctx.policy.network.allowHosts.join(', ')})`);
  }
  return reasons;
}

/** Parses an npm package spec; returns { name } for registry packages or { invalid } otherwise. */
export function parsePackageSpec(spec) {
  if (/^(git\+|git:|github:|gitlab:|bitbucket:|https?:|file:|link:|workspace:|\.{0,2}\/|~\/)/i.test(spec) || spec.endsWith('.tgz') || spec.endsWith('.tar.gz')) {
    return { invalid: `"${spec}" is not a registry package (git, URL and local specs are not allowed)` };
  }
  if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(#.*)?$/.test(spec) && !spec.startsWith('@')) return { invalid: `"${spec}" looks like a GitHub shorthand, not a registry package` };
  const alias = /^(?:@[^/@]+\/)?[^@]+@npm:(.+)$/.exec(spec);
  const target = alias ? alias[1] : spec;
  const m = /^(@[a-z0-9._~-]+\/[a-z0-9._~-]+|[a-z0-9._~-]+)(?:@.*)?$/i.exec(target);
  if (!m) return { invalid: `"${spec}" is not a valid package name` };
  return { name: m[1].toLowerCase() };
}

function packageArgs(argv, start) {
  const names = [];
  const reasons = [];
  for (let k = start; k < argv.length; k++) {
    const w = argv[k];
    const t = w.text;
    if (/^--(registry|userconfig|globalconfig)(=|$)/.test(t) || /^--@[^:]+:registry/.test(t)) {
      reasons.push(`custom registries (${t.split('=')[0]}) are not allowed`);
      if (!t.includes('=')) k++;
      continue;
    }
    if (t.startsWith('-')) continue;
    if (w.dynamic) {
      reasons.push(`package "${t}" can't be resolved before running`);
      continue;
    }
    const parsed = parsePackageSpec(t);
    if (parsed.invalid) reasons.push(parsed.invalid);
    else names.push(parsed.name);
  }
  return { names, reasons };
}

/** Returns { reasons, vetted } where vetted is true when the command only installs/executes vetted packages. */
async function checkPackages(cmd, name, ctx) {
  const argv = cmd.argv;
  let collected;
  let npx = false;
  const sub = argv[1]?.text;
  if (name === 'npx' || name === 'bunx' || (name === 'bun' && sub === 'x')) {
    npx = true;
    const start = name === 'bun' ? 2 : 1;
    const specs = [];
    // With -p/--package the first operand is a bin name from those packages, not a package.
    let explicit = false;
    for (let k = start; k < argv.length; k++) {
      const t = argv[k].text;
      if (t === '-p' || t === '--package') {
        if (argv[k + 1]) specs.push(argv[k + 1]);
        explicit = true;
        k++;
      } else if (t.startsWith('--package=')) {
        specs.push({ ...argv[k], text: t.slice('--package='.length) });
        explicit = true;
      } else if (t === '--') {
        if (argv[k + 1] && !explicit) specs.push(argv[k + 1]);
        break;
      } else if (!t.startsWith('-')) {
        if (!explicit) specs.push(argv[k]);
        break;
      }
    }
    collected = packageArgs(specs, 0);
  } else if ((name === 'pnpm' || name === 'yarn') && sub === 'dlx') {
    npx = true;
    const first = argv.slice(2).find((w) => !w.text.startsWith('-'));
    collected = packageArgs(first ? [first] : [], 0);
  } else if (name === 'npm' && sub === 'exec') {
    npx = true;
    const first = argv.slice(2).find((w) => !w.text.startsWith('-'));
    collected = packageArgs(first ? [first] : [], 0);
  } else if (name === 'yarn' && sub === 'global') {
    return { reasons: ['global installs change the user\'s machine; add the package to the project instead'], vetted: false };
  } else if ((name === 'npm' && NPM_INSTALL.has(sub)) || ((name === 'pnpm' || name === 'bun') && ['add', 'install', 'i'].includes(sub)) || (name === 'yarn' && sub === 'add')) {
    if (argv.slice(2).some((w) => w.text === '-g' || w.text === '--global' || w.text === '--location=global')) {
      return { reasons: ['global installs change the user\'s machine; add the package to the project instead'], vetted: false };
    }
    collected = packageArgs(argv, 2);
  } else {
    return { reasons: [], vetted: false };
  }
  const reasons = [...collected.reasons];
  const allow = new Set(ctx.policy.packages.allow.map((p) => p.toLowerCase()));
  for (const pkg of collected.names) {
    if (allow.has(pkg)) continue;
    // Tools the stack already declares are fine to run via npx without a registry check.
    const verdict = await ctx.checkPackage(pkg);
    if (!verdict.ok) reasons.push(`${verdict.reason}. Ask the user before adding it, or add it to the stack profile's allowlist.`);
  }
  return { reasons, vetted: reasons.length === 0 && (collected.names.length > 0 || !npx) };
}

const WRITE_COMMANDS = new Set(['cp', 'mv', 'install', 'ln', 'tee', 'touch', 'mkdir', 'truncate', 'dd', 'sed']);
const WRITE_VALUE_FLAGS = {
  cp: ['-t', '--target-directory', '-S', '--suffix'],
  mv: ['-t', '--target-directory', '-S', '--suffix'],
  install: ['-t', '--target-directory', '-m', '--mode', '-o', '--owner', '-g', '--group', '-S', '--suffix'],
  ln: ['-t', '--target-directory', '-S', '--suffix'],
  mkdir: ['-m', '--mode'],
  touch: ['-r', '--reference', '-d', '--date', '-t'],
  truncate: ['-s', '--size', '-r', '--reference'],
  sed: ['-e', '--expression', '-f', '--file', '-l', '--line-length'],
};

/**
 * Files a shell command writes, for the commands that commonly write outside the project:
 * cp/mv/install/ln (destination), tee/touch/mkdir/truncate (every operand), dd (of=) and
 * sed -i (edited files). Deny resolved targets outside the project; unresolved ones only lose
 * automatic approval.
 */
function checkWriteTargets(cmd, name, cwd, ctx, input) {
  const valueFlags = new Set(WRITE_VALUE_FLAGS[name] ?? []);
  const operands = [];
  let targetDir;
  let inPlace = false;
  let scriptGiven = false;
  let options = true;
  const argv = cmd.argv;
  for (let k = 1; k < argv.length; k++) {
    const w = argv[k];
    const t = w.text;
    if (options && t === '--') {
      options = false;
    } else if (options && t.startsWith('-') && t !== '-') {
      const [flag, inline] = t.startsWith('--') ? t.split(/=(.*)/s, 2) : [t.slice(0, 2), t.length > 2 ? t.slice(2) : undefined];
      if (name === 'sed' && (flag === '-i' || flag === '--in-place' || /^-[nEsrzu]*i/.test(t))) inPlace = true;
      if (name === 'sed' && (flag === '-e' || flag === '--expression' || flag === '-f' || flag === '--file')) scriptGiven = true;
      if (valueFlags.has(flag)) {
        const value = inline !== undefined && inline !== '' ? { ...w, text: inline } : argv[++k];
        if ((flag === '-t' || flag === '--target-directory') && name !== 'touch') targetDir = value;
      }
    } else {
      operands.push(w);
    }
  }

  let targets = [];
  if (name === 'dd') {
    targets = operands.filter((w) => w.text.startsWith('of=')).map((w) => ({ ...w, text: w.text.slice(3) }));
  } else if (name === 'sed') {
    if (inPlace) targets = scriptGiven ? operands : operands.slice(1);
  } else if (['cp', 'mv', 'install', 'ln'].includes(name)) {
    if (targetDir) targets = [targetDir];
    else if (operands.length >= 2) targets = [operands[operands.length - 1]];
  } else {
    targets = operands;
  }

  const reasons = [];
  let unresolved = cmd.argsFromStdin === true;
  for (const t of targets) {
    const abs = resolveWord(t, cwd, ctx.home);
    if (abs === undefined) unresolved = true;
    else if (!isInside(abs, ctx.root) && !allowedOutsideRoot(abs, input)) reasons.push(`${name} would write ${t.text}, which is outside the project (${ctx.root})`);
    // The secret check only sees Write/Edit content, so shell writes to .env never skip the host's prompt.
    else if (isEnvSecretFile(abs)) unresolved = true;
  }
  return { reasons, unresolved };
}

/**
 * State-changing `crew` commands are reserved for the roles that own them (policy.crewCommands),
 * so an executor can't pass its own review or rewrite the plan.
 */
function checkCrewCommand(argvText, role, policy) {
  const table = policy.crewCommands ?? {};
  const words = argvText.slice(1).filter((w) => !w.startsWith('-'));
  const two = `${words[0]} ${words[1]}`;
  const key = Array.isArray(table[two]) ? two : Array.isArray(table[words[0]]) ? words[0] : undefined;
  if (!key) return [];
  const allowed = table[key];
  if (allowed.includes('$stage')) {
    const k = argvText.findIndex((w) => w === '--stage' || w.startsWith('--stage='));
    const stage = k < 0 ? undefined : argvText[k].includes('=') ? argvText[k].split('=')[1] : argvText[k + 1];
    return stage && stage === role ? [] : [`crew ${key} --stage ${stage ?? '…'} is run by the ${stage ?? 'reviewing'} agent itself, not by the ${role} agent`];
  }
  return allowed.includes(role) ? [] : [`crew ${key} is reserved for the ${allowed.join(' and ')} agent${allowed.length > 1 ? 's' : ''}; the ${role} agent can't run it`];
}

function matchesSafe(argvText, policy) {
  return policy.safeCommands.some((prefix) => prefix.every((p, idx) => (idx === 0 ? basename(argvText[0]) === p : argvText[idx] === p)));
}

// ---------------------------------------------------------------------------

/** @param {any} input @param {RuleContext} ctx @returns {Promise<Verdict>} */
export async function evaluatePreToolUse(input, ctx) {
  const role = roleOf(input.agent_type, ctx.policy);
  const tool = input.tool_name;
  const toolInput = input.tool_input ?? {};
  const cwd = path.resolve(input.cwd ?? ctx.root);

  if (WRITE_TOOLS.has(tool)) return evaluateWrite(tool, toolInput, role, cwd, ctx, input);
  if (tool === 'Bash') return evaluateBash(String(toolInput.command ?? ''), role, cwd, ctx, input);
  return { decision: 'none', reasons: [], role };
}

function evaluateWrite(tool, toolInput, role, cwd, ctx, input) {
  const file = toolInput.file_path ?? toolInput.notebook_path;
  if (typeof file !== 'string' || !file) return { decision: 'none', reasons: [], role };
  const abs = path.resolve(cwd, expandHome(file, ctx.home));
  const reasons = [];
  if (!isInside(abs, ctx.root)) {
    if (!allowedOutsideRoot(abs, input)) reasons.push(`${tool} to ${file} is outside the project (${ctx.root})`);
    return reasons.length ? { decision: 'deny', reasons, role } : { decision: 'none', reasons, role };
  }
  const rel = toPosix(path.relative(ctx.root, abs));
  if (isEnvSecretFile(abs)) {
    const text = tool === 'Write' ? String(toolInput.content ?? '') : tool === 'MultiEdit' ? (toolInput.edits ?? []).map((e) => e?.new_string ?? '').join('\n') : String(toolInput.new_string ?? '');
    const keys = secretKeysIn(text);
    if (keys.length) reasons.push(`${rel} would contain real secrets (${keys.join(', ')}). Write placeholders and list what is needed in .crew/access-checklist.md`);
  }
  reasons.push(...checkCrewFields(tool, toolInput, abs, rel, ctx));
  const zones = zonesFor(role, ctx.policy);
  if (!matchesAny(rel, zones)) {
    // Name the owner: without it the first live run escalated a .env edit to the human although two agents could have made it.
    const owners = ownersOf(rel, ctx.policy, matchesAny).filter((r) => r !== role && r !== 'orchestrator');
    const who = owners.length ? `the ${owners.length > 1 ? `${owners.slice(0, -1).join(', ')} or ${owners.at(-1)}` : owners[0]} agent` : 'the architect, who decides where it belongs';
    const next = role === 'orchestrator' ? `Delegate this change to ${who}` : `Do not work around it: say in your result that ${rel} needs this change, and the orchestrator will hand it to ${who}`;
    reasons.push(`the ${role} agent may only write ${zones.length ? zones.join(', ') : 'nothing in the project'} — ${rel} is outside that zone. ${next}.`);
  }
  return reasons.length ? { decision: 'deny', reasons, role } : { decision: 'allow', reasons: [`${rel} is inside the ${role} zone`], role };
}

const CLI_OWNED = /^\.crew\/(tasks|escalations)\/[^/]+\.md$/i;

/** The file text after a Write/Edit/MultiEdit, or undefined when it can't be predicted. */
function proposedText(tool, toolInput, current) {
  if (tool === 'Write') return String(toolInput.content ?? '');
  const edits = tool === 'Edit' ? [toolInput] : tool === 'MultiEdit' ? (toolInput.edits ?? []) : undefined;
  if (!edits || current === undefined) return undefined;
  let text = current;
  for (const e of edits) {
    if (typeof e?.old_string !== 'string' || typeof e?.new_string !== 'string' || !text.includes(e.old_string)) return undefined;
    text = e.replace_all ? text.split(e.old_string).join(e.new_string) : text.replace(e.old_string, () => e.new_string);
  }
  return text;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

/**
 * Task and escalation frontmatter belongs to the crew CLI (PLAN.md §1.1): agents may edit the
 * body of these files, but creating them or changing their fields goes through `crew`.
 */
function checkCrewFields(tool, toolInput, abs, rel, ctx) {
  const m = CLI_OWNED.exec(rel);
  if (!m || !ctx.parseFrontmatter || !ctx.readFile) return [];
  const kind = m[1] === 'tasks' ? 'task' : 'escalation';
  const current = ctx.readFile(abs);
  if (current === undefined) {
    return [`new ${kind} files are created with ${kind === 'task' ? 'crew task new' : 'crew escalate'}, which allocates the id and writes valid fields`];
  }
  const next = proposedText(tool, toolInput, current);
  if (next === undefined) return [];
  const before = stableJson(ctx.parseFrontmatter(current).data);
  const after = stableJson(ctx.parseFrontmatter(next).data);
  if (before === after) return [];
  return [
    kind === 'task'
      ? `task fields change only through the crew CLI (crew task start | submit | pass | reject | fail, or crew task set for the orchestrator); edit only the text below the frontmatter`
      : `escalation fields change only through the crew CLI (crew escalation answer | resolve | cancel); edit only the text below the frontmatter`,
  ];
}

async function evaluateBash(command, role, startCwd, ctx, input) {
  const commands = parseShell(command);
  const reasons = [];
  let allSafe = commands.length > 0;
  let cwd = startCwd;

  for (const cmd of commands) {
    // Redirects first: `> ~/.bashrc` has no command word but still writes a file.
    for (const r of cmd.redirects) {
      if (!OUTPUT_REDIRECTS.has(r.op)) continue;
      const abs = resolveWord(r.target, cwd, ctx.home);
      if (abs === undefined) {
        allSafe = false;
      } else if (!isInside(abs, ctx.root) && !allowedOutsideRoot(abs, input)) {
        reasons.push(`redirecting output to ${r.target.text} writes outside the project`);
      } else if (isEnvSecretFile(abs)) {
        reasons.push(`writing ${path.basename(abs)} through the shell is not allowed; use the Write tool with placeholder values`);
      }
    }

    if (!cmd.argv.length) {
      allSafe = false;
      continue;
    }
    const argv0 = cmd.argv[0];
    const name = basename(argv0.text);
    const argvText = cmd.argv.map((w) => w.text);
    if (argv0.dynamic) {
      allSafe = false;
      continue;
    }
    if (name === 'cd' || name === 'pushd') {
      const target = cmd.argv[1];
      cwd = target ? resolveWord(target, cwd, ctx.home) : undefined;
      continue;
    }
    if (name === 'popd') {
      cwd = undefined;
      continue;
    }

    let safeHere = !cmd.tainted && matchesSafe(argvText, ctx.policy);
    // `node file.js` runs project code; `node -e/-p/-r` runs arbitrary code and gets no automatic approval.
    if (name === 'node' && argvText.slice(1).some((t) => /^(-e|--eval|-p|--print|-r|--require|--import)(=|$)/.test(t))) safeHere = false;
    if (['rm', 'rmdir', 'unlink', 'shred'].includes(name) || (name === 'find' && argvText.some((t) => t === '-delete'))) {
      reasons.push(...checkRemoval(cmd, name, cwd, ctx, input));
      safeHere = false;
    } else if (name === 'git') {
      reasons.push(...checkGit(cmd, cwd, ctx, role));
    } else if (name === 'curl' || name === 'wget') {
      reasons.push(...checkNetwork(cmd, name, ctx));
      safeHere = false;
    } else if (['npm', 'npx', 'pnpm', 'yarn', 'bun', 'bunx'].includes(name) && !(safeHere && (name === 'npx' || name === 'bunx'))) {
      // `npx <tool on the safe list>` runs the project's own dependency; anything else is vetted.
      const { reasons: pkgReasons, vetted } = await checkPackages(cmd, name, ctx);
      reasons.push(...pkgReasons);
      safeHere = safeHere || vetted;
    } else if (SHELLS.has(name) && cmd.argv.length === 1) {
      reasons.push(`piping commands into ${name} is not allowed; run the commands directly`);
    } else if (name === 'crew') {
      reasons.push(...checkCrewCommand(argvText, role, ctx.policy));
    }
    if (WRITE_COMMANDS.has(name)) {
      const writes = checkWriteTargets(cmd, name, cwd, ctx, input);
      reasons.push(...writes.reasons);
      if (writes.unresolved) safeHere = false;
    }
    if (!safeHere) allSafe = false;
  }

  if (reasons.length) return { decision: 'deny', reasons: [...new Set(reasons)], role };
  return allSafe ? { decision: 'allow', reasons: ['every command is on the safe list'], role } : { decision: 'none', reasons: [], role };
}
