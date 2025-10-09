import { describe, it, expect, afterEach } from 'vitest';
import supertest from 'supertest';
import { APIServer, z } from '../../src/index';

/**
 * End-to-end test for examples/custom-auth.ts
 * 
 * This test recreates the custom authentication example and verifies:
 * - Custom token validation with typed context
 * - Role-based access control
 * - Permission checking
 * - Protected and public endpoints
 */
describe('Custom Auth Example E2E', () => {
  let app: APIServer<AuthContext>;

  // Define authentication context type
  interface AuthContext {
    userId: string;
    username: string;
    role: 'admin' | 'user';
    permissions: string[];
  }

  // Simulated token database
  const tokenDatabase: Record<string, AuthContext> = {
    'admin-token-123': {
      userId: '1',
      username: 'admin',
      role: 'admin',
      permissions: ['read', 'write', 'delete'],
    },
    'user-token-456': {
      userId: '2',
      username: 'john',
      role: 'user',
      permissions: ['read'],
    },
  };

  afterEach(async () => {
    if (app) {
      await app.stop();
    }
  });

  const setupCustomAuthExample = async (port: number) => {
    app = new APIServer<AuthContext>({
      port,
      metricsEnabled: false,
      apiTitle: 'Custom Auth Example',
      apiDescription: 'API with custom token validation and typed context',

      // Custom token validator function
      apiToken: async (token, request) => {
        // Look up token in database
        const authContext = tokenDatabase[token];

        if (!authContext) {
          return {
            valid: false,
            error: 'Invalid or expired token',
          };
        }

        // Return the validated context
        return {
          valid: true,
          context: authContext,
        };
      },
    });

    // Public endpoint (no auth required)
    app.createEndpoint({
      method: 'GET',
      url: '/public',
      response: z.object({ message: z.string() }),
      config: {
        description: 'Public endpoint accessible without authentication',
        tags: ['Public'],
      },
      handler: async () => {
        return { message: 'This is a public endpoint!' };
      },
    });

    // Protected endpoints with authentication
    await app.instance.register(async (protectedScope) => {
      // Add authentication middleware to all routes in this scope
      protectedScope.addHook('onRequest', app.authenticateToken);

      // Profile endpoint - uses auth context
      protectedScope.get('/profile', async (request, reply) => {
        if (!request.auth) {
          return reply.code(401).send({
            statusCode: 401,
            error: 'Unauthorized',
            message: 'Authentication required',
          });
        }

        const { userId, username, role, permissions } = request.auth;

        return {
          userId,
          username,
          role,
          permissions,
        };
      });

      // Admin-only endpoint
      protectedScope.delete('/admin/users/:userId', async (request, reply) => {
        if (!request.auth) {
          return reply.code(401).send({
            statusCode: 401,
            error: 'Unauthorized',
            message: 'Authentication required',
          });
        }

        // Check if user has admin role
        if (request.auth.role !== 'admin') {
          return reply.code(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: 'Admin access required',
          });
        }

        const userId = (request.params as { userId: string }).userId;
        return {
          message: `User ${userId} deleted by ${request.auth.username}`,
        };
      });

      // Check permissions example
      protectedScope.post('/data', async (request, reply) => {
        if (!request.auth) {
          return reply.code(401).send({
            statusCode: 401,
            error: 'Unauthorized',
            message: 'Authentication required',
          });
        }

        const body = request.body as { content?: string };
        if (!body || !body.content) {
          return reply.code(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message: 'Missing content field',
          });
        }

        // Check if user has write permission
        if (!request.auth.permissions.includes('write')) {
          return reply.code(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: 'Write permission required',
          });
        }

        return {
          message: `Data created by ${request.auth.username}: ${body.content}`,
        };
      });
    });

    await app.start();
  };

  describe('Public Endpoints', () => {
    it('should access public endpoint without authentication', async () => {
      await setupCustomAuthExample(3300);

      const response = await supertest(app.instance.server)
        .get('/public')
        .expect(200);

      expect(response.body).toEqual({
        message: 'This is a public endpoint!',
      });
    });
  });

  describe('Authentication', () => {
    it('should access profile with valid user token', async () => {
      await setupCustomAuthExample(3301);

      const response = await supertest(app.instance.server)
        .get('/profile')
        .set('Authorization', 'Bearer user-token-456')
        .expect(200);

      expect(response.body).toEqual({
        userId: '2',
        username: 'john',
        role: 'user',
        permissions: ['read'],
      });
    });

    it('should access profile with valid admin token', async () => {
      await setupCustomAuthExample(3312);

      const response = await supertest(app.instance.server)
        .get('/profile')
        .set('Authorization', 'Bearer admin-token-123')
        .expect(200);

      expect(response.body).toEqual({
        userId: '1',
        username: 'admin',
        role: 'admin',
        permissions: ['read', 'write', 'delete'],
      });
    });

    it('should reject invalid token', async () => {
      await setupCustomAuthExample(3303);

      const response = await supertest(app.instance.server)
        .get('/profile')
        .set('Authorization', 'Bearer invalid-token')
        .expect(403);

      expect(response.body.statusCode).toBe(403);
      expect(response.body.error).toBe('Forbidden');
      expect(response.body.message).toBe('Invalid or expired token');
    });

    it('should reject missing authorization header', async () => {
      await setupCustomAuthExample(3304);

      const response = await supertest(app.instance.server)
        .get('/profile')
        .expect(401);

      expect(response.body.statusCode).toBe(401);
      expect(response.body.error).toBe('Unauthorized');
      expect(response.body.message).toContain('Missing authorization header');
    });
  });

  describe('Role-Based Access Control', () => {
    it('should allow admin to delete users', async () => {
      await setupCustomAuthExample(3305);

      const response = await supertest(app.instance.server)
        .delete('/admin/users/123')
        .set('Authorization', 'Bearer admin-token-123')
        .expect(200);

      expect(response.body.message).toBe('User 123 deleted by admin');
    });

    it('should deny user access to admin endpoint', async () => {
      await setupCustomAuthExample(3306);

      const response = await supertest(app.instance.server)
        .delete('/admin/users/123')
        .set('Authorization', 'Bearer user-token-456')
        .expect(403);

      expect(response.body.statusCode).toBe(403);
      expect(response.body.error).toBe('Forbidden');
      expect(response.body.message).toBe('Admin access required');
    });
  });

  describe('Permission Checking', () => {
    it('should allow user with write permission to create data', async () => {
      await setupCustomAuthExample(3307);

      const response = await supertest(app.instance.server)
        .post('/data')
        .set('Authorization', 'Bearer admin-token-123')
        .send({ content: 'test data' })
        .expect(200);

      expect(response.body.message).toBe('Data created by admin: test data');
    });

    it('should deny user without write permission', async () => {
      await setupCustomAuthExample(3308);

      const response = await supertest(app.instance.server)
        .post('/data')
        .set('Authorization', 'Bearer user-token-456')
        .send({ content: 'test data' })
        .expect(403);

      expect(response.body.statusCode).toBe(403);
      expect(response.body.error).toBe('Forbidden');
      expect(response.body.message).toBe('Write permission required');
    });

    it('should require authentication for permission-protected endpoint', async () => {
      await setupCustomAuthExample(3309);

      const response = await supertest(app.instance.server)
        .post('/data')
        .send({ content: 'test data' })
        .expect(401);

      expect(response.body.statusCode).toBe(401);
      expect(response.body.error).toBe('Unauthorized');
      expect(response.body.message).toBeDefined();
    });
  });

  describe('Complete Auth Flow', () => {
    it('should demonstrate complete authentication workflow', async () => {
      await setupCustomAuthExample(3310);

      // 1. Access public endpoint (no auth)
      const publicResponse = await supertest(app.instance.server)
        .get('/public')
        .expect(200);
      expect(publicResponse.body.message).toBe('This is a public endpoint!');

      // 2. Try protected endpoint without auth (fail)
      await supertest(app.instance.server)
        .get('/profile')
        .expect(401);

      // 3. Access with valid token (success)
      const profileResponse = await supertest(app.instance.server)
        .get('/profile')
        .set('Authorization', 'Bearer admin-token-123')
        .expect(200);
      expect(profileResponse.body.username).toBe('admin');

      // 4. Admin access (success)
      const adminResponse = await supertest(app.instance.server)
        .delete('/admin/users/456')
        .set('Authorization', 'Bearer admin-token-123')
        .expect(200);
      expect(adminResponse.body.message).toContain('deleted by admin');

      // 5. Permission check (success)
      const dataResponse = await supertest(app.instance.server)
        .post('/data')
        .set('Authorization', 'Bearer admin-token-123')
        .send({ content: 'important data' })
        .expect(200);
      expect(dataResponse.body.message).toContain('Data created by admin');
    });
  });

  describe('Edge Cases', () => {
    it('should handle malformed authorization header', async () => {
      await setupCustomAuthExample(3311);

      const response = await supertest(app.instance.server)
        .get('/profile')
        .set('Authorization', 'InvalidFormat')
        .expect(401);

      expect(response.body.statusCode).toBe(401);
      expect(response.body.error).toBe('Unauthorized');
    });

    it('should validate request body on protected endpoints', async () => {
      await setupCustomAuthExample(3412);

      const response = await supertest(app.instance.server)
        .post('/data')
        .set('Authorization', 'Bearer admin-token-123')
        .send({ wrongField: 'test' })
        .expect(400);

      expect(response.body.statusCode).toBe(400);
      expect(response.body.error).toBe('Bad Request');
    });

    it('should maintain auth context across multiple requests', async () => {
      await setupCustomAuthExample(3313);

      // First request
      const response1 = await supertest(app.instance.server)
        .get('/profile')
        .set('Authorization', 'Bearer user-token-456')
        .expect(200);
      expect(response1.body.username).toBe('john');

      // Second request with same token
      const response2 = await supertest(app.instance.server)
        .get('/profile')
        .set('Authorization', 'Bearer user-token-456')
        .expect(200);
      expect(response2.body.username).toBe('john');
    });
  });
});

