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
      exclude: ['src/extension.ts', 'src/assistant.ts', 'src/views/**', 'src/crew/watcher.ts', 'src/log.ts'],
      reporter: ['text', 'html', 'json-summary'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 80 },
    },
  },
});
