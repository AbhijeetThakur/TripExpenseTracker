import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        // Legacy keys (README uses GEMINI_API_KEY, FB_*)
        'import.meta.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'import.meta.env.FB_API_KEY': JSON.stringify(env.FB_API_KEY),
        'import.meta.env.FB_PROJECT_ID': JSON.stringify(env.FB_PROJECT_ID),
        'import.meta.env.FB_STORAGE_BUCKET': JSON.stringify(env.FB_STORAGE_BUCKET),
        'import.meta.env.FB_APP_ID': JSON.stringify(env.FB_APP_ID),

        // Back-compat for any remaining process.env usages (should be removable later)
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.FB_API_KEY': JSON.stringify(env.FB_API_KEY),
        'process.env.FB_PROJECT_ID': JSON.stringify(env.FB_PROJECT_ID),
        'process.env.FB_STORAGE_BUCKET': JSON.stringify(env.FB_STORAGE_BUCKET),
        'process.env.FB_APP_ID': JSON.stringify(env.FB_APP_ID),
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
