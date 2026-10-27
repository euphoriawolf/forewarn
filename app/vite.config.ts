import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

// No agents() plugin: it only adds decorator support for @callable, which this app does not use.
export default defineConfig({ plugins: [react(), cloudflare()] });
