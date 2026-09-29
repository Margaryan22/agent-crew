// PreToolUse policy (SPEC §9): deny dangerous commands, unvetted packages, network calls to
// unknown hosts, real secrets in .env and writes outside the agent's zone; allow work that the
// policy explicitly covers so hosts don't prompt for it; leave everything else to the host.

import path from 'node:path';
import { basename, parseShell } from './shell.mjs';
import { hostAllowed, roleOf, zonesFor } from './policy.mjs';
import { expandHome, isEnvSecretFile, isInside, matchesAny, secretKeysIn, tempDirs, toPosix } from './util.mjs';

/**
 * @typedef {{ decision: 'allow' | 'deny' | 'none', reasons: string[], role: string }} Verdict
 * @typedef {{
 *   root: string,
 *   policy: any,
 *   checkPackage: (name: string) => Promise<{ ok: boolean, reason?: string }>,
 *   currentBranch: (dir: string) => string | undefined,
 *   home?: string,
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

function checkGit(cmd, cwd, ctx) {
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
  if (argv[k]?.text !== 'push') return [];
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

const CURL_VALUE_FLAGS = new Set([
  '-o', '--output', '-H', '--header', '-d', '--data', '--data-raw', '--data-binary', '--data-urlencode', '-X', '--request', '-u', '--user',
  '-A', '--user-agent', '-e', '--referer', '-b', '--cookie', '-c', '--cookie-jar', '-F', '--form', '-T', '--upload-file', '-w', '--write-out',
  '-m', '--max-time', '--connect-timeout', '--retry', '-r', '--range', '-K', '--config', '--cacert', '--cert', '--key', '-E',
]);
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
  for (let k = 1; k < argv.length; k++) {
    const w = argv[k];
    if (w.text === '--url' || w.text === '-x' || w.text === '--proxy') {
      if (argv[k + 1]) urls.push(argv[k + 1]);
      k++;
    } else if (valueFlags.has(w.text)) {
      k++;
    } else if (!w.text.startsWith('-')) {
      urls.push(w);
    }
  }
  if (cmd.argsFromStdin) return [`${name} with URLs from xargs cannot be verified`];
  const reasons = [];
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
  const zones = zonesFor(role, ctx.policy);
  if (!matchesAny(rel, zones)) {
    reasons.push(`the ${role} agent may only write ${zones.length ? zones.join(', ') : 'nothing in the project'} — ${rel} is outside that zone. Hand this change to the agent that owns it.`);
  }
  return reasons.length ? { decision: 'deny', reasons, role } : { decision: 'allow', reasons: [`${rel} is inside the ${role} zone`], role };
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
      reasons.push(...checkGit(cmd, cwd, ctx));
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
