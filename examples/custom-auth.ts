/**
 * Custom Authentication Example
 * 
 * This example demonstrates how to use custom token validation
 * with typed authentication context that gets passed to your handlers.
 * 
 * Features:
 * - Custom token validation function
 * - Typed authentication context
 * - Role-based access control
 * - Permission checking
 * 
 * Run with: npx tsx examples/custom-auth.ts
 */

import { APIServer, z } from '../src/index';

// Define your authentication context type
interface AuthContext {
  userId: string;
  username: string;
  role: 'admin' | 'user';
  permissions: string[];
}

// Simulated database of tokens (in production, use JWT, database, etc.)
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

// Create API server with custom auth validator
const app = new APIServer<AuthContext>({
  port: 3000,
  apiTitle: 'Custom Auth Example',
  apiDescription: 'API with custom token validation and typed context',
  
  // Custom token validator function
  apiToken: async (token, request) => {
    console.log(`Validating token for ${request.method} ${request.url}`);
    
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
app.instance.register(async (protectedScope) => {
  // Add authentication middleware to all routes in this scope
  protectedScope.addHook('onRequest', app.authenticateToken);
  
  // Profile endpoint - uses auth context
  app.createEndpoint({
    method: 'GET',
    url: '/profile',
    response: z.object({
      userId: z.string(),
      username: z.string(),
      role: z.string(),
      permissions: z.array(z.string()),
    }),
    config: {
      description: 'Get current user profile from auth context',
      tags: ['Protected'],
    },
    handler: async (request, reply) => {
      // request.auth is fully typed as AuthContext
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
    },
  });
  
  // Admin-only endpoint
  app.createEndpoint({
    method: 'DELETE',
    url: '/admin/users/:userId',
    response: z.object({ message: z.string() }),
    config: {
      description: 'Admin-only endpoint for deleting users',
      tags: ['Admin'],
    },
    handler: async (request, reply) => {
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
    },
  });
  
  // Check permissions example
  app.createEndpoint({
    method: 'POST',
    url: '/data',
    body: z.object({ content: z.string() }),
    response: z.object({ message: z.string() }),
    config: {
      description: 'Create data - requires write permission',
      tags: ['Protected'],
    },
    handler: async (request, reply) => {
      if (!request.auth) {
        return reply.code(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Authentication required',
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
        message: `Data created by ${request.auth.username}: ${request.body.content}`,
      };
    },
  });
});

// Setup graceful shutdown
app.setupGracefulShutdown();

// Start the server
await app.start();

console.log('\n✅ Server started with custom authentication!');
console.log('\n📝 Try these commands:');
console.log('\n1. Public endpoint (no auth):');
console.log('   curl http://localhost:3000/public');
console.log('\n2. Protected endpoint with user token:');
console.log('   curl -H "Authorization: Bearer user-token-456" http://localhost:3000/profile');
console.log('\n3. Protected endpoint with admin token:');
console.log('   curl -H "Authorization: Bearer admin-token-123" http://localhost:3000/profile');
console.log('\n4. Admin-only endpoint (requires admin token):');
console.log('   curl -X DELETE -H "Authorization: Bearer admin-token-123" http://localhost:3000/admin/users/123');
console.log('\n5. Permission check (user token - should fail):');
console.log('   curl -X POST -H "Authorization: Bearer user-token-456" -H "Content-Type: application/json" -d \'{"content":"test"}\' http://localhost:3000/data');
console.log('\n6. Permission check (admin token - should succeed):');
console.log('   curl -X POST -H "Authorization: Bearer admin-token-123" -H "Content-Type: application/json" -d \'{"content":"test"}\' http://localhost:3000/data');
console.log('\n7. Invalid token:');
console.log('   curl -H "Authorization: Bearer invalid-token" http://localhost:3000/profile');

