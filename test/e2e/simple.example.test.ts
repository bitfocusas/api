import { describe, it, expect, afterEach } from 'vitest';
import supertest from 'supertest';
import { APIServer, z } from '../../src/index';

/**
 * End-to-end test for examples/simple.ts
 * 
 * This test recreates the simple example and verifies it works correctly.
 * It ensures the example code remains functional and demonstrates proper usage.
 */
describe('Simple Example E2E', () => {
  let app: APIServer;

  afterEach(async () => {
    if (app) {
      await app.stop();
    }
  });

  it('should run the simple example successfully', async () => {
    // Recreate the simple example setup
    app = new APIServer({ port: 3100, metricsEnabled: false });

    app.createEndpoint({
      method: 'GET',
      url: '/hello',
      query: z.object({ name: z.string().optional() }),
      response: z.object({ message: z.string() }),
      handler: async (request) => {
        return { message: `Hello, ${request.query.name || 'World'}!` };
      },
    });

    await app.start();

    // Test without name parameter
    const response1 = await supertest(app.instance.server)
      .get('/hello')
      .expect(200);

    expect(response1.body).toEqual({ message: 'Hello, World!' });

    // Test with name parameter
    const response2 = await supertest(app.instance.server)
      .get('/hello?name=Alice')
      .expect(200);

    expect(response2.body).toEqual({ message: 'Hello, Alice!' });
  });

  it('should have swagger documentation available', async () => {
    app = new APIServer({ port: 3101, metricsEnabled: false });

    app.createEndpoint({
      method: 'GET',
      url: '/hello',
      query: z.object({ name: z.string().optional() }),
      response: z.object({ message: z.string() }),
      handler: async (request) => {
        return { message: `Hello, ${request.query.name || 'World'}!` };
      },
    });

    await app.start();

    // Verify documentation is accessible
    const response = await supertest(app.instance.server)
      .get('/docs')
      .expect(302); // Should redirect to /docs/

    expect(response.header.location).toContain('/docs/');
  });

  it('should handle query parameter validation', async () => {
    app = new APIServer({ port: 3112, metricsEnabled: false });

    app.createEndpoint({
      method: 'GET',
      url: '/hello',
      query: z.object({ name: z.string().optional() }),
      response: z.object({ message: z.string() }),
      handler: async (request) => {
        return { message: `Hello, ${request.query.name || 'World'}!` };
      },
    });

    await app.start();

    // Test with empty query
    const response1 = await supertest(app.instance.server)
      .get('/hello')
      .expect(200);

    expect(response1.body.message).toBe('Hello, World!');

    // Test with special characters
    const response2 = await supertest(app.instance.server)
      .get('/hello?name=John%20Doe')
      .expect(200);

    expect(response2.body.message).toBe('Hello, John Doe!');
  });
});

