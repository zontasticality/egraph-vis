import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
    plugins: [sveltekit()],
    test: {
        // Disable watch mode by default
        watch: false,
        // Other useful defaults
        // globals: true,
        // environment: 'jsdom',
    },
});
