import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs work both on localhost and under
  // https://<account>.github.io/mistvale-farm/.
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5178,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4178,
    strictPort: true,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 800,
  },
});
