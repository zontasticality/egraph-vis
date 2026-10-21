import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Connect, type Plugin } from 'vite';

/**
 * Cross-origin isolation gives the execution-time benchmark a fine clock:
 * browsers coarsen performance.now() to 100 µs (Chrome) or more without it.
 * Every response needs the headers (pages, and the worker scripts they start),
 * so they are set by a middleware in front of everything else.
 */
const isolate: Connect.NextHandleFunction = (_req, res, next) => {
	res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
	res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
	next();
};

const crossOriginIsolation: Plugin = {
	name: 'cross-origin-isolation',
	configureServer: server => void server.middlewares.use(isolate),
	configurePreviewServer: server => void server.middlewares.use(isolate)
};

export default defineConfig({
	plugins: [crossOriginIsolation, sveltekit()]
});
