import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // works on iPhones with iOS 14 and newer, plus older Android Chrome
  build: { target: ['es2020', 'safari14', 'chrome87', 'firefox78'], cssTarget: ['safari14', 'chrome87'] },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4000' },
  },
});
