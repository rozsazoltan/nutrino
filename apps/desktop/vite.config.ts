import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolveVersionInfo } from '../../scripts/version-info.mjs';

export default defineConfig(() => {
  const versionInfo = resolveVersionInfo();
  return {
    plugins: [vue()],
    clearScreen: false,
    define: {
      __NUTRINO_RELEASE_VERSION__: JSON.stringify(versionInfo.releaseVersion),
      __NUTRINO_DEV_VERSION__: JSON.stringify(versionInfo.devVersion),
    },
    server: {
      host: '127.0.0.1',
      port: 1420,
      strictPort: true,
      watch: {
        ignored: [
          '**/src-tauri/target/**',
          '**/src-tauri/gen/**',
          '**/target/**',
        ],
      },
    },
    envPrefix: ['VITE_', 'TAURI_'],
    build: {
      target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
      minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
      sourcemap: !!process.env.TAURI_ENV_DEBUG,
    },
  };
});
