import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['test/**/*.test.ts'],
		// Fastify/pino logs go straight to stdout, so silence them via the env var the library reads
		env: { LOG_LEVEL: 'silent' },
		// Only show console output (e.g. the start() banner) for failing tests
		silent: 'passed-only',
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			include: ['src/**/*.ts'],
			thresholds: {
				statements: 95,
				branches: 90,
				functions: 95,
				lines: 95,
			},
		},
		typecheck: {
			enabled: true,
			include: ['test/types/**/*.test-d.ts'],
			tsconfig: './tsconfig.test.json',
		},
		testTimeout: 10000,
		// Run tests sequentially to avoid port conflicts
		fileParallelism: false,
		maxConcurrency: 1,
	},
})
