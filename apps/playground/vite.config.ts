import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  worker: {
    format: 'es'
  },
  build: {
    outDir: 'dist',
    license: { fileName: 'library-licenses.txt' },
    sourcemap: true
  }
});
