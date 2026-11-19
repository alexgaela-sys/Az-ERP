import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(({ mode }) => {
  // The web build (Cloudflare Worker) is served from the domain root, so it
  // needs absolute asset paths ('/'). The desktop (Electron) build loads
  // dist/index.html via file://, where absolute paths resolve to disk root
  // and fail — it needs relative paths ('./'). Triggered by "--mode desktop"
  // (see package.json's "build:desktop" and .env.desktop).
  const isDesktop = mode === 'desktop';
  return {
    base: isDesktop ? './' : '/',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
