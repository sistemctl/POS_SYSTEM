import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Rutas relativas para que funcione dentro de Electron (file://)
  base: './',
  resolve: {
    alias: {
      // Se usa el código fuente del paquete compartido (misma lógica de precios que la API)
      '@pos/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
