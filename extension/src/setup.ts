// "Check Setup": the tools a crew-built project needs on this machine besides Claude Code —
// Node.js 22+, git, and Docker for the local database.

export interface ToolCheck {
  name: string;
  ok: boolean;
  detail: string;
  /** What to do when it fails. */
  fix?: string;
}

export type Exec = (command: string, args: string[]) => Promise<{ ok: boolean; stdout: string }>;

export const MIN_NODE_MAJOR = 22;

export function nodeMajor(version: string): number | undefined {
  const m = /v?(\d+)\.\d+/.exec(version.trim());
  return m ? Number(m[1]) : undefined;
}

export async function checkTools(exec: Exec): Promise<ToolCheck[]> {
  const [node, git, docker, daemon] = await Promise.all([
    exec('node', ['--version']),
    exec('git', ['--version']),
    exec('docker', ['--version']),
    exec('docker', ['info', '--format', '{{.ServerVersion}}']),
  ]);
  const major = node.ok ? nodeMajor(node.stdout) : undefined;
  const checks: ToolCheck[] = [
    major !== undefined && major >= MIN_NODE_MAJOR
      ? { name: 'Node.js', ok: true, detail: node.stdout.trim() }
      : {
          name: 'Node.js',
          ok: false,
          detail: node.ok ? `${node.stdout.trim()} is too old` : 'not found',
          fix: `Install Node.js ${MIN_NODE_MAJOR} or newer (https://nodejs.org).`,
        },
    git.ok ? { name: 'git', ok: true, detail: git.stdout.trim() } : { name: 'git', ok: false, detail: 'not found', fix: 'Install git (https://git-scm.com).' },
  ];
  if (!docker.ok) {
    checks.push({ name: 'Docker', ok: false, detail: 'not found', fix: 'Install Docker Desktop or OrbStack — the project runs PostgreSQL in Docker.' });
  } else if (!daemon.ok) {
    checks.push({ name: 'Docker', ok: false, detail: `${docker.stdout.trim()}, but the engine is not running`, fix: 'Start Docker Desktop (or OrbStack).' });
  } else {
    checks.push({ name: 'Docker', ok: true, detail: `engine ${daemon.stdout.trim()}` });
  }
  return checks;
}
