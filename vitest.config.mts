import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // These modules need the VS Code API; the integration suite covers them.
      exclude: ['src/extension.ts', 'src/secrets.ts', 'src/views/**', 'src/crew/watcher.ts'],
      reporter: ['text', 'html', 'json-summary'],
      thresholds: {
        'src/crew/parser.ts': { lines: 80, statements: 80, functions: 80, branches: 80 },
        'src/agent/events.ts': { lines: 80, statements: 80, functions: 80, branches: 80 },
        'src/license.ts': { lines: 80, statements: 80, functions: 80, branches: 80 },
      },
    },
  },
});
