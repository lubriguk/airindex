import path from 'node:path';
import { defineConfig } from 'vite';

const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error('A valid PORT environment variable is required.');
}
const basePath = process.env.BASE_PATH;
if (!basePath) throw new Error('BASE_PATH is required.');

export default defineConfig({
  base: basePath,
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: { host: '0.0.0.0', port, strictPort: true, allowedHosts: true },
  preview: { host: '0.0.0.0', port, allowedHosts: true },
});