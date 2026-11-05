# Test Suite

This directory contains comprehensive tests for the library. These tests are for **developers** working on the library itself.

## Structure

```
test/
├── helpers.ts                  # useTestServers() + auth helpers shared by unit tests
├── unit/
│   ├── validate.test.ts        # Error classes and schema helpers
│   ├── api-server.test.ts      # General APIServer behaviour (real listening servers)
│   ├── request-handling.test.ts# Params/query/body parsing, response validation, error mapping
│   ├── auth.test.ts            # Static token, custom validators, authenticateToken hook
│   ├── rate-limit.test.ts      # Global/per-endpoint limits, allow list, trustProxy
│   ├── openapi.test.ts         # Generated OpenAPI document and Swagger UI
│   ├── config.test.ts          # Defaults, env vars, CORS, logger, trustProxy
│   ├── lifecycle.test.ts       # start/stop, custom Fastify instance, graceful shutdown
│   ├── metrics.test.ts         # Prometheus /metrics (one metrics server per file)
│   └── exports.test.ts         # Public runtime exports
├── types/
│   └── endpoint.test-d.ts      # Type inference tests (run by vitest typecheck)
├── e2e/                        # Tests mirroring the examples/ scripts
└── package/
    └── smoke.cjs               # Requires the built dist/ via CommonJS (run after build)
```

These tests pin the library's current observable behaviour (status codes, error bodies, headers,
OpenAPI output) so that dependency updates which change it are caught. Two known issues are
recorded as `it.fails` in `request-handling.test.ts`; flip them to `it` once fixed.

## Running Tests

```bash
yarn test            # all vitest tests, including type tests
yarn test:coverage   # with coverage (thresholds enforced)
yarn test:unit       # unit tests only
yarn test:e2e        # e2e tests only
yarn test:types      # type tests only
yarn typecheck       # tsc over src, tests and examples
yarn lint            # biome
yarn build && yarn test:dist   # smoke test the compiled package
```

CI (`.github/workflows/ci.yml`) runs all of the above on Node 24 and 26, on every push/PR and
weekly (no lockfile is committed, so the weekly run picks up newly published dependency versions).

## Notes

- Prefer `server.instance.inject()` over binding ports; `useTestServers()` closes servers after each test.
- Use `remoteAddress` other than `127.0.0.1` (e.g. `REMOTE_IP`) when testing rate limiting, as localhost is always allowed.
- fastify-metrics uses prom-client's global registry, so only one `metricsEnabled` server can exist per test file.

## Writing Tests

### Best Practices

1. **Use unique ports** for each test to avoid conflicts
2. **Disable metrics** in test configurations (`metricsEnabled: false`)
3. **Clean up servers** in `afterEach` hooks
4. **Use meaningful test names** that describe what is being tested
5. **Test both success and failure cases**
6. **Verify error messages and status codes**

### Example Test

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import supertest from 'supertest';
import { APIServer, z } from '../../src/index';

describe('My Feature', () => {
  let server: APIServer;

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
  });

  it('should do something', async () => {
    server = new APIServer({ 
      port: 3000,
      metricsEnabled: false // Important!
    });

    server.createEndpoint({
      method: 'GET',
      url: '/test',
      response: z.object({ result: z.string() }),
      handler: async () => ({ result: 'success' }),
    });

    await server.start();

    const response = await supertest(server.instance.server)
      .get('/test')
      .expect(200);

    expect(response.body.result).toBe('success');
  });
});
```
