import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Separate entry point: the default/Legacy Vite configuration stays untouched.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  if (mode !== 'v2' || env.VITE_APP_ENV !== 'test' ||
      env.VITE_API10_URL !== 'https://desarrollotecnologicoar.com/api27' ||
      env.VITE_API5_ENABLED !== 'false' || env.VITE_API5_URL !== '') {
    throw new Error('V2_CONFIG: use mode v2, TEST, exact API27 URL and API5 disabled');
  }
  return {
    plugins: [react()],
    base: '/work-orders-v2/',
    build: { outDir: 'dist/v2', emptyOutDir: true, sourcemap: false },
    server: { host: '127.0.0.1', port: 5174, strictPort: true },
    preview: { host: '127.0.0.1', port: 4174, strictPort: true },
  };
});
