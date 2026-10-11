import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Dev server proxies /api to the backend, so no CORS or IP setup is needed in the browser.
export default defineConfig({ plugins: [react()], server: { port: 5173, proxy: { '/api': 'http://localhost:3001' } } });
