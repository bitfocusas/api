/**
 * Basic Example - Simple User Creation API
 * 
 * This example demonstrates the core features:
 * - Creating an endpoint with validation
 * - Request/response schemas with Zod
 * - Custom validation errors
 * - Automatic Swagger documentation
 * 
 * Run with: npx tsx examples/basic.ts
 */

import { APIServer, ValidationError, z } from '../src/index';

// In-memory data store
const users: Array<{
  id: string;
  name: string;
  email: string;
  age?: number;
  createdAt: string;
}> = [];

// Create API server
const app = new APIServer({
  port: 3000,
  apiTitle: 'User API Example',
  apiDescription: 'Basic example API built with @bitfocusas/api',
  apiTags: [
    { name: 'Users', description: 'User management endpoints' },
  ],
});

// Define schemas
const CreateUserBody = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be less than 100 characters'),
  email: z.string().email('Invalid email address'),
  age: z.number().int().positive('Age must be a positive number').optional(),
});

const UserResponse = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  age: z.number().optional(),
  createdAt: z.string(),
});

// Create user endpoint
app.createEndpoint({
  method: 'POST',
  url: '/users',
  body: CreateUserBody,
  response: UserResponse,
  config: {
    description: 'Create a new user',
    tags: ['Users'],
    summary: 'Create user',
  },
  handler: async (request) => {
    const { name, email, age } = request.body;

    // Check if email already exists
    const existingUser = users.find((u) => u.email === email);
    if (existingUser) {
      throw new ValidationError([
        {
          field: 'body.email',
          message: 'User with this email already exists',
        },
      ]);
    }

    // Create new user
    const newUser = {
      id: crypto.randomUUID(),
      name,
      email,
      age,
      createdAt: new Date().toISOString(),
    };

    users.push(newUser);

    return newUser;
  },
});

// Get all users endpoint
app.createEndpoint({
  method: 'GET',
  url: '/users',
  response: z.object({
    users: z.array(UserResponse),
    total: z.number(),
  }),
  config: {
    description: 'Get all users',
    tags: ['Users'],
    summary: 'List users',
  },
  handler: async () => {
    return {
      users,
      total: users.length,
    };
  },
});

// Setup graceful shutdown
app.setupGracefulShutdown();

// Start the server
await app.start();

console.log('\n✅ Basic example server is running!');
console.log('\n💡 Try these commands:');
console.log('   # Create a user');
console.log('   curl -X POST http://localhost:3000/users -H "Content-Type: application/json" -d \'{"name":"John Doe","email":"john@example.com","age":30}\'');
console.log('\n   # Get all users');
console.log('   curl http://localhost:3000/users');

