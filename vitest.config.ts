import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';

export default defineConfig({
    // svelteTesting() resolves Svelte's browser build and auto-cleans rendered components
    plugins: [sveltekit(), svelteTesting()],
    test: {
        watch: false,
        include: ['src/**/*.test.ts'],
        // Pure engine/graph tests run in node; component & store tests opt into
        // jsdom with a `// @vitest-environment jsdom` comment.
        environment: 'node',
        setupFiles: ['./src/lib/test/setup.ts'],
    },
});
