import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { argvText, parseShell } from '../scripts/lib/shell.mjs';

const names = (script) => parseShell(script).map((c) => argvText(c).join(' '));

describe('parseShell', () => {
  it('splits command lists and pipelines', () => {
    assert.deepEqual(names('a 1 && b 2 || c; d | e & f\ng'), ['a 1', 'b 2', 'c', 'd', 'e', 'f', 'g']);
    assert.deepEqual(names('(cd x && make) |& tee log'), ['cd x', 'make', 'tee log']);
  });

  it('handles quoting and escapes', () => {
    assert.deepEqual(names(`echo 'a b' "c d" e\\ f "x\\"y"`), ['echo a b c d e f x"y']);
    const [cmd] = parseShell(`git commit -m 'it''s' "done"`);
    assert.deepEqual(argvText(cmd), ['git', 'commit', '-m', 'its', 'done']);
  });

  it('marks variables and substitutions as dynamic and parses substitutions', () => {
    const cmds = parseShell('rm -rf "$HOME/x" $(echo /) `pwd` ${DIR} safe');
    const rm = cmds[0];
    assert.deepEqual(
      rm.argv.map((w) => w.dynamic),
      [false, false, true, true, true, true, false],
    );
    assert.deepEqual(cmds.slice(1).map((c) => argvText(c).join(' ')), ['echo /', 'pwd']);
    assert.equal(parseShell('echo $((1 + 2))')[0].argv[1].dynamic, true);
    assert.equal(parseShell('echo $')[0].argv[1].dynamic, false);
  });

  it('collects redirects and ignores descriptor duplication', () => {
    const [cmd] = parseShell('npm test > out.log 2>&1 2>> err.log &> all.log < in.txt');
    assert.deepEqual(argvText(cmd), ['npm', 'test']);
    assert.deepEqual(
      cmd.redirects.map((r) => `${r.op} ${r.target.text}`),
      ['> out.log', '>> err.log', '&> all.log', '< in.txt'],
    );
  });

  it('skips heredoc bodies and comments', () => {
    assert.deepEqual(names("cat > f.txt <<'EOF'\nrm -rf /\nEOF\necho done # rm -rf /"), ['cat', 'echo done']);
    assert.deepEqual(names('cat <<-END\n\trm -rf /\n\tEND\nls'), ['cat', 'ls']);
    assert.deepEqual(names('grep x <<< "rm -rf /"'), ['grep x']);
  });

  it('unwraps wrappers', () => {
    assert.deepEqual(names('FOO=1 sudo -u root env -i BAR=2 nice -n 5 nohup timeout 10 rm x'), ['rm x']);
    assert.deepEqual(names("bash -lc 'cd /; rm -rf tmp'"), ['cd /', 'rm -rf tmp']);
    assert.deepEqual(names('eval "git push" --force'), ['git push --force']);
    assert.deepEqual(names('if true; then rm a; fi'), ['true', 'rm a']);
    assert.deepEqual(names('command -v node'), ['node']);
  });

  it('marks xargs and find -exec commands', () => {
    const [x] = parseShell('ls | xargs -n 1 rm -f').slice(1);
    assert.deepEqual(argvText(x), ['rm', '-f']);
    assert.equal(x.argsFromStdin, true);
    const cmds = parseShell('find . -name "*.tmp" -exec rm -f {} \\; -exec touch y +');
    assert.deepEqual(cmds.map((c) => argvText(c).join(' ')), ['find . -name *.tmp -exec rm -f {} ; -exec touch y +', 'rm -f {}', 'touch y']);
    assert.equal(cmds[1].argv[2].dynamic, true);
  });

  it('taints commands whose script the outer shell expands', () => {
    const [cmd] = parseShell('sh -c "npm i $PKG"');
    assert.equal(cmd.tainted, true);
    assert.equal(cmd.argv[0].dynamic, false);
    assert.ok(cmd.argv.slice(1).every((w) => w.dynamic));
    assert.equal(parseShell("sh -c 'npm i x'")[0].tainted, undefined);
  });

  it('stops runaway nesting', () => {
    const deep = `${'bash -c "'.repeat(10)}rm -rf /${'"'.repeat(10)}`;
    assert.ok(parseShell(deep).length >= 1);
    assert.deepEqual(parseShell(''), []);
  });
});
