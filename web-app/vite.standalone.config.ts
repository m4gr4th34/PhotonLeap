import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Standalone build.
 * - base './' for ZIP: works from file:// or double-click.
 * - base '/<repo>/' for GitHub Pages: https://<user>.github.io/<repo>/
 *   Set VITE_BASE in CI (e.g. VITE_BASE: '/${{ github.event.repository.name }}/').
 */
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    copyPublicDir: true,
  },
})
