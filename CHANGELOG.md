# Changelog

# [2.0.0](https://github.com/bitfocusas/api/compare/v1.2.2...v2.0.0) (2026-11-06)

* feat!: ship as ESM only ([4beafda](https://github.com/bitfocusas/api/commit/4beafdaa1c4cf7923931881c746d23fee704c6bd))
* fix!: log through Fastify's logger and drop colons from operationIds ([2ec0afe](https://github.com/bitfocusas/api/commit/2ec0afed2716f58acd38f159b0dc3d2439d3b7b0))
* fix!: safer defaults for authentication and rate limiting ([3cb83ff](https://github.com/bitfocusas/api/commit/3cb83ff58e5394b9248193710f6cf1fa2858d027))
* fix!: use Fastify's validated request in handlers and unify validation errors ([4727d7b](https://github.com/bitfocusas/api/commit/4727d7bbf7ec5beca59878d40e60f2ec667a5375))
* feat!: drop dotenv and require Node.js 24 ([c3a5850](https://github.com/bitfocusas/api/commit/c3a58501a041a7824a792f0cf8f8c14ad16b70dc))

### Bug Fixes

* **deps:** update runtime dependencies to latest ([68893e8](https://github.com/bitfocusas/api/commit/68893e8fab936376674f6c59a098ed61a9475024))

### BREAKING CHANGES

* defining a `body` schema on a GET endpoint now throws.
* fastify-metrics now uses @prometheus-io/client instead of prom-client. Custom metrics registered on prom-client's global registry no longer appear at /metrics; use `server.instance.metrics.client` instead.
* generated operationIds for routes with path parameters have changed, which renames methods in generated API clients.
* in production, `authenticated: true` endpoints throw unless apiToken or API_TOKEN is set, and the development token is rejected.
* Node.js 24 or later is now required.
* request validation errors are now `{ statusCode, error, message: 'Validation failed', details: [{ field, message }] }` instead of Fastify's `{ code: 'FST_ERR_VALIDATION', message: 'body/a ...' }`.
* requests from 127.0.0.1 are now rate limited; add it to `rateLimitAllow` to restore the old behaviour.
* start() no longer prints a banner to stdout; the details are logged at info level instead.
* the `loadEnv` option has been removed and `.env` files are no longer loaded automatically.
* the package is ESM-only and has an `exports` map, so deep imports such as `@bitfocusas/api/dist/...` no longer resolve. CommonJS consumers can still `require('@bitfocusas/api')` on Node 24.

## [1.2.2](/compare/v1.2.1...v1.2.2) (2025-12-17)

## [Unreleased]

### Features

* Add support for optional Fastify instance - you can now bring your own Fastify instance and attach the API server to it, or continue using the default behavior where the library creates its own instance

## [1.1.3](https://github.com/bitfocusas/api/compare/v1.1.2...v1.1.3) (2025-10-17)

## [1.1.2](https://github.com/bitfocusas/api/compare/v1.1.1...v1.1.2) (2025-10-09)

## [1.1.1](https://github.com/bitfocusas/api/compare/v1.1.0...v1.1.1) (2025-10-09)

# [1.1.0](https://github.com/bitfocusas/api/compare/v1.0.1...v1.1.0) (2025-10-09)


### Features

* add endpoint-level authentication support ([6f9507c](https://github.com/bitfocusas/api/commit/6f9507cc35d4f612c7b9f23d39bf838dfa319a92))

## [1.0.1](https://github.com/bitfocusas/api/compare/v1.0.0...v1.0.1) (2025-10-09)
