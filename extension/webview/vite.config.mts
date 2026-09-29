import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

// Single JS + CSS file with stable names: the extension references dist/webview/chat.{js,css}.
export default defineConfig({
  root,
  plugins: [react()],
  base: './',
  build: {
    outDir: fileURLToPath(new URL('../dist/webview', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    modulePreload: false,
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: fileURLToPath(new URL('./src/main.tsx', import.meta.url)),
      output: {
        entryFileNames: 'chat.js',
        chunkFileNames: 'chat-[name].js',
        assetFileNames: (asset) => ((asset.names ?? []).some((n) => n.endsWith('.css')) ? 'chat.css' : '[name][extname]'),
      },
    },
  },
});
