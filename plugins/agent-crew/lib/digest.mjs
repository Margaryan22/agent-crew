// A role's digest of the stack rules and the brief, cut mechanically from their sections. The
// SubagentStart hook puts it into an agent's context, so ten agents do not each read the same two
// files in full. Hand-written, used by the hooks.

/** Body of a `## Name` section, by any of its names (case-insensitive); undefined when absent. */
export function section(markdown, names) {
  const lines = String(markdown ?? '').split('\n');
  const wanted = names.map((n) => n.toLowerCase());
  const start = lines.findIndex((l) => /^##\s+/.test(l) && wanted.includes(l.replace(/^##\s+/, '').trim().toLowerCase()));
  if (start < 0) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#{1,2}\s+/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
}

/** Rows of a Markdown table as arrays of cell texts, without the header and the separator. */
export function tableRows(text) {
  const rows = String(text ?? '')
    .split('\n')
    .filter((l) => l.trim().startsWith('|'))
    .map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
  return rows.filter((cells, i) => i > 0 && !cells.every((c) => /^:?-{2,}:?$/.test(c)));
}

function listItems(text, max) {
  return String(text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^(\d+\.|[-*])\s+/.test(l))
    .slice(0, max);
}

function clip(text, max, more) {
  return text.length <= max ? text : `${text.slice(0, max).replace(/\s+\S*$/, '')} … (${more})`;
}

const unlink = (cell) => cell.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

/**
 * What a role needs from .crew/stack/README.md: the technologies with their rule files, the
 * commands, the folders this role owns, the conventions.
 */
export function stackDigest(readme, role, max = 2200) {
  const out = [];
  const tech = tableRows(section(readme, ['Technologies']));
  if (tech.length) out.push(`Technologies: ${tech.map((r) => `${r[0]}${r[1] && r[1] !== '-' ? ` ${r[1]}` : ''}${r[3] ? ` → ${unlink(r[3])}` : ''}`).join('; ')}.`);
  const commands = tableRows(section(readme, ['Commands']));
  if (commands.length && !['pm', 'critic', 'designer', 'keeper'].includes(role)) out.push(`Commands: ${commands.map((r) => `${r[0]}: ${r[1]}`).join('; ')}.`);
  const owned = tableRows(section(readme, ['Layout and owners'])).filter((r) => (r[1] ?? '').toLowerCase().split(/[\s,/]+/).includes(role));
  if (owned.length) out.push(`Your folders: ${owned.map((r) => `${r[0]}${r[2] ? ` (${r[2]})` : ''}`).join('; ')}.`);
  const conventions = listItems(section(readme, ['Conventions', 'Core conventions']), 10);
  if (conventions.length) out.push(`Conventions:\n${conventions.map((c) => `  ${c}`).join('\n')}`);
  return out.length ? clip(out.join('\n'), max, 'the rest is in .crew/stack/README.md') : undefined;
}

/** The goal and the roles from .crew/brief.md; the acceptance criteria stay in the file. */
export function briefDigest(brief, max = 900) {
  const goal = section(brief, ['Goal', 'Цель']);
  const roles = section(brief, ['Users and roles', 'Пользователи и роли']);
  const out = [];
  if (goal) out.push(`Goal: ${goal.replace(/\s+/g, ' ')}`);
  if (roles) out.push(`Users and roles: ${roles.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ')}`);
  return out.length ? clip(out.join('\n'), max, 'the full brief is .crew/brief.md') : undefined;
}
