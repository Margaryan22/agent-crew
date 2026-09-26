// Mocha entry point for scripts/test-untrusted.mjs (extensionTestsPath).
import path from 'node:path';
import Mocha from 'mocha';

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'bdd', timeout: 60_000, color: true });
  mocha.addFile(path.join(__dirname, 'untrusted.test.js'));
  return new Promise((resolve, reject) => {
    mocha.run((failures) => (failures ? reject(new Error(`${failures} test(s) failed`)) : resolve()));
  });
}
