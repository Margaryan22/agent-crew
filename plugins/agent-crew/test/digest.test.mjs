import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { briefDigest, section, stackDigest, tableRows } from '../lib/digest.mjs';

const README = `# Stack

## Technologies
| Technology | Version | Used for | Rules | Docs |
|---|---|---|---|---|
| Next.js (App Router) | 16.3.8 | pages | [next.md](next.md) | https://nextjs.org/docs |
| Own session auth | - | sign-in | [auth.md](auth.md) | ADR-003 |

## Commands
| Purpose | Command |
|---|---|
| Set up | \`npm run setup\` |
| Unit tests | \`npm test\` |

## Layout and owners
| Path | Owner | Notes |
|---|---|---|
| \`src/app/**\` | frontend | routes |
| \`.env\` | db, backend | local settings |
| \`e2e/**\` | qa | |

## Conventions
1. Validate on the server.
2. No secrets in files.

## Which rules to read when
- A form → forms.md
`;

describe('digests for agents', () => {
  it('finds sections and table rows', () => {
    assert.equal(section('## A\nx\n## B\ny\n# C', ['b']), 'y');
    assert.equal(section('## A\nx', ['missing']), undefined);
    assert.deepEqual(tableRows('| a | b |\n|---|:--:|\n| 1 | 2 |\ntext\n| 3 | 4 |'), [['1', '2'], ['3', '4']]);
  });

  it('cuts the stack index down to what a role needs', () => {
    const backend = stackDigest(README, 'backend');
    assert.match(backend, /^Technologies: Next\.js \(App Router\) 16\.3\.8 → next\.md; Own session auth → auth\.md\.$/m);
    assert.match(backend, /^Commands: Set up: `npm run setup`; Unit tests: `npm test`\.$/m);
    assert.match(backend, /^Your folders: `\.env` \(local settings\)\.$/m);
    assert.match(backend, /Conventions:\n {2}1\. Validate on the server\.\n {2}2\. No secrets in files\./);
    assert.match(stackDigest(README, 'qa'), /Your folders: `e2e\/\*\*`\./);
    // A designer does not run commands and owns no code folder.
    assert.doesNotMatch(stackDigest(README, 'designer'), /Commands:|Your folders:/);
    assert.equal(stackDigest('# Stack\n', 'backend'), undefined);
    assert.match(stackDigest(README, 'backend', 60), / … \(the rest is in \.crew\/stack\/README\.md\)$/);
  });

  it('keeps the goal and the roles of the brief, not the criteria', () => {
    const brief = '---\nstatus: approved\n---\n# Brief\n\n## Goal\nA café collects\nfeedback.\n\n## Users and roles\n- Visitor\n- Owner\n\n## Acceptance criteria\n- AC-01 …';
    assert.equal(briefDigest(brief), 'Goal: A café collects feedback.\nUsers and roles: - Visitor - Owner');
    assert.equal(briefDigest('# Brief'), undefined);
  });
});
