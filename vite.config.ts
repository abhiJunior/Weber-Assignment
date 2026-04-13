import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import federation from '@originjs/vite-plugin-federation'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    federation({
      name: 'unitCommandView',
      filename: 'remoteEntry.js',
      exposes: { './UnitCommandView': './src/App.tsx' },
      shared: ['react', 'react-dom', 'zustand', '@tanstack/react-query'],
    }),
  ],
  build: {
    target: 'esnext',
    minify: false,
  },
})
