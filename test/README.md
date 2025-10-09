# Test Suite

This directory contains comprehensive tests for the library. These tests are for **developers** working on the library itself.

## Structure

```
test/
├── unit/           # Unit tests for individual components
│   ├── validate.test.ts      # Tests for validation utilities
│   └── api-server.test.ts    # Tests for APIServer class
└── e2e/            # End-to-end tests based on examples
    ├── simple.example.test.ts       # Tests for simple example
    ├── basic.example.test.ts        # Tests for basic example
    └── custom-auth.example.test.ts  # Tests for custom auth example
```

## Test Results

**Current Status: ✅ 100% Pass Rate**

```
Test Files: 5 passed (5)
Tests:      65 passed (65)
```

### Coverage Breakdown

- **Unit Tests**: 38 tests
  - validate.ts: 14 tests
  - api-server.ts: 24 tests
  
- **E2E Tests**: 27 tests
  - simple example: 3 tests
  - basic example: 10 tests
  - custom-auth example: 14 tests

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with UI
npm run test:ui

# Run with coverage
npm run test:coverage

# Run only unit tests
npm run test:unit

# Run only e2e tests
npm run test:e2e
```

## What's Tested

### Unit Tests
- Validation utilities and error classes
- APIServer configuration and lifecycle
- Endpoint creation and routing
- Request/response validation
- Authentication (simple & custom validators)
- Error handling
- Swagger documentation
- Prometheus metrics

### End-to-End Tests
- All example scripts (`examples/simple.ts`, `examples/basic.ts`, `examples/custom-auth.ts`)
- Ensures examples remain functional and demonstrate correct usage

## Test Configuration

Tests use Vitest with the following configuration:
- **Environment**: Node.js
- **Timeout**: 10 seconds per test
- **Coverage**: v8 provider with text, JSON, and HTML reporters
- **Metrics**: Disabled in tests to avoid Prometheus registry collisions

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

## Continuous Integration

Tests are designed to run in CI environments:
- No external dependencies required
- All tests use ephemeral in-memory state
- Sequential execution prevents port conflicts
- Fast execution (< 2 seconds for full suite)

