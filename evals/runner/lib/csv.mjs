// results/<date>.csv — SPEC §11 columns first, then details of the run.

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export const COLUMNS = [
  'idea_id',
  'mode',
  'hidden_tests_passed',
  'hidden_tests_total',
  'cost_usd',
  'duration_min',
  'escalations',
  'human_interventions',
  'model',
  'outcome',
  'rounds',
  'run_id',
  'started_at',
];

export function csvCell(value) {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(row) {
  return COLUMNS.map((c) => csvCell(row[c])).join(',');
}

export function appendRow(file, row) {
  mkdirSync(path.dirname(file), { recursive: true });
  if (!existsSync(file)) appendFileSync(file, `${COLUMNS.join(',')}\n`);
  appendFileSync(file, `${csvLine(row)}\n`);
}
