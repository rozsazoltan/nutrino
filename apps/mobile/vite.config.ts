import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const devHost = process.env.TAURI_DEV_HOST || process.env.NUTRINO_ANDROID_DEV_HOST || '0.0.0.0';
const devApiBaseUrl = process.env.NUTRINO_DEV_API_BASE_URL || (devHost !== '0.0.0.0' ? `http://${devHost}:8090/api/v1` : '');

export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  define: {
    __NUTRINO_DEV_HOST__: JSON.stringify(devHost),
    __NUTRINO_DEV_API_BASE_URL__: JSON.stringify(devApiBaseUrl),
  },
  server: {
    host: '0.0.0.0',
    port: 1421,
    strictPort: true,
    hmr: devHost === '0.0.0.0' ? undefined : {
      protocol: 'ws',
      host: devHost,
      port: 1421,
    },
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
});
