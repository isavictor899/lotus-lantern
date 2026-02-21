import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Ensures the dev server handles internal routing
    historyApiFallback: true,
  },
  build: {
    // Vite defaults to 'dist' for Vercel
    outDir: 'dist',
  }
})
