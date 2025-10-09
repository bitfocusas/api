# @bitfocusas/api

Type-safe REST API server with automatic validation and documentation.

## Why Use This?

- **Write less code** - Define endpoints with schemas, get validation + docs automatically
- **Type safety** - Full TypeScript inference from Zod schemas (request → handler → response)
- **Catch bugs early** - Request AND response validation at runtime
- **Flexible auth** - Simple tokens or custom validation with typed context (JWT, DB, etc.)
- **Zero config** - Swagger UI, rate limiting, CORS, metrics all included

Built on [Fastify](https://www.fastify.io/) (fast) and [Zod](https://zod.dev/) (type-safe validation).

## Installation

```bash
npm install @bitfocusas/api zod
```

## Quick Start

```typescript
import { APIServer, z } from '@bitfocusas/api';

const app = new APIServer({ port: 3000 });

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
// Visit http://localhost:3000/docs for Swagger UI
```

## 💡 Best Practices

### Type-Safe Response Returns

Use `satisfies` with `z.infer` for better TypeScript error messages and autocomplete:

```typescript
const ResponseSchema = z.object({ 
  message: z.string(),
  userId: z.number() 
});

app.createEndpoint({
  method: 'POST',
  url: '/users',
  body: z.object({ name: z.string() }),
  response: ResponseSchema,
  handler: async (request) => {
    // ✅ Good: TypeScript will show exactly which field is wrong
    return {
      message: 'User created',
      userId: 123
    } satisfies z.infer<typeof ResponseSchema>;

    // ❌ Without satisfies: Less helpful error messages (a lot of ugly zod-bonanza)
    // return { message: 'User created', userId: '123' }; 
  },
});
```

This catches type mismatches at compile time and provides better IDE support.

## 📚 Examples

Check out the [`examples/`](./examples) directory for complete working examples:

- **[simple.ts](./examples/simple.ts)** - Minimal setup, perfect for getting started
- **[basic.ts](./examples/basic.ts)** - User CRUD API with validation and error handling
- **[custom-auth.ts](./examples/custom-auth.ts)** - Custom authentication with typed context

Run any example:
```bash
npm run example:simple
npm run example:basic
npm run example:auth
```

See the [examples README](./examples/README.md) for detailed information about each example.

## API Reference

### `new APIServer(config?)`

Create a server instance.

```typescript
const app = new APIServer({
  port: 3000,                    // Server port (default: 3000)
  host: '127.0.0.1',            // Host (default: 127.0.0.1)
  apiTitle: 'My API',           // Swagger title
  apiToken: 'secret-token',      // Bearer token for auth (string or function)
  rateLimitMax: 100,            // Max requests per window (default: 100)
  rateLimitWindow: '15m',       // Rate limit window (default: 15m)
  metricsEnabled: true,         // Enable /metrics endpoint (default: true)
  corsOrigin: '*',              // CORS origin (default: *)
});
```

**Config via environment variables:**

```bash
PORT=3000
HOST=127.0.0.1
API_TOKEN=your-token
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=15m
METRICS_ENABLED=true
CORS_ORIGIN=*
```

### `app.createEndpoint(config)`

Define an endpoint with automatic validation and documentation.

```typescript
app.createEndpoint({
  method: 'POST',               // GET, POST, PUT, DELETE, PATCH
  url: '/users',                // URL path (can include :params)
  query: QuerySchema,           // Zod schema for query params
  body: BodySchema,            // Zod schema for request body
  response: ResponseSchema,     // Zod schema for response
  config: {                     // Optional Swagger metadata
    description: 'Create user',
    tags: ['Users'],
    summary: 'Create a new user',
  },
  handler: async (request, reply) => {
    // Fully typed request.query and request.body
    // Return value is validated against ResponseSchema
    return { /* response data */ };
  },
});
```

### `app.start()`

Start the server. Returns a Promise.

```typescript
await app.start();
```

### `app.stop()`

Stop the server gracefully.

```typescript
await app.stop();
```

### `app.setupGracefulShutdown()`

Setup SIGINT/SIGTERM handlers for graceful shutdown.

```typescript
app.setupGracefulShutdown();
await app.start();
```

### `app.authenticateToken`

Bearer token authentication middleware. Supports both simple string token validation and custom validation with typed context.

#### Simple Token Authentication

```typescript
const app = new APIServer({
  apiToken: 'secret-token',
});

// Protect routes
app.instance.register(async (scope) => {
  scope.addHook('onRequest', app.authenticateToken);
  
  app.createEndpoint({
    method: 'GET',
    url: '/admin',
    response: z.object({ secret: z.string() }),
    handler: async () => ({ secret: 'data' }),
  });
});

// Usage: curl -H "Authorization: Bearer secret-token" http://localhost:3000/admin
```

#### Custom Token Validation with Typed Context

```typescript
// Define your auth context type
interface AuthContext {
  userId: string;
  role: 'admin' | 'user';
  permissions: string[];
}

// Create server with custom validator
const app = new APIServer<AuthContext>({
  apiToken: async (token, request) => {
    // Your custom validation logic (e.g., check database, JWT, etc.)
    const user = await validateTokenInDatabase(token);
    
    if (!user) {
      return {
        valid: false,
        error: 'Invalid or expired token',
      };
    }
    
    // Return validated context
    return {
      valid: true,
      context: {
        userId: user.id,
        role: user.role,
        permissions: user.permissions,
      },
    };
  },
});

// Protected endpoint with access to auth context
app.instance.register(async (scope) => {
  scope.addHook('onRequest', app.authenticateToken);
  
  app.createEndpoint({
    method: 'GET',
    url: '/profile',
    response: z.object({ userId: z.string(), role: z.string() }),
    handler: async (request) => {
      // request.auth is fully typed as AuthContext
      const { userId, role } = request.auth!;
      return { userId, role };
    },
  });
});

// Usage: curl -H "Authorization: Bearer user-jwt-token" http://localhost:3000/profile
```

### `app.instance`

Access the underlying Fastify instance for advanced use cases.

```typescript
// Add custom hooks
app.instance.addHook('onRequest', async (request, reply) => {
  console.log(`${request.method} ${request.url}`);
});

// Register plugins
app.instance.register(yourPlugin);
```

## Error Handling

### `ValidationError`

Throw custom validation errors (returns 400):

```typescript
import { ValidationError } from '@bitfocusas/api';

throw new ValidationError([
  { field: 'body.email', message: 'Email already exists' },
  { field: 'body.age', message: 'Must be 18 or older' },
]);
```

### `NotFoundError`

Throw 404 errors:

```typescript
import { NotFoundError } from '@bitfocusas/api';

throw new NotFoundError('User not found');
```

## Complete Example

```typescript
import { APIServer, ValidationError, NotFoundError, z } from '@bitfocusas/api';

const app = new APIServer({
  port: 3000,
  apiTitle: 'User API',
  apiTags: [{ name: 'Users', description: 'User management' }],
});

// In-memory database
interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

const users: User[] = [];

// List users
app.createEndpoint({
  method: 'GET',
  url: '/users',
  query: z.object({
    limit: z.coerce.number().int().positive().max(100).default(10),
    offset: z.coerce.number().int().nonnegative().default(0),
  }),
  response: z.object({
    users: z.array(z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      createdAt: z.string(),
    })),
    total: z.number(),
  }),
  config: {
    description: 'List users with pagination',
    tags: ['Users'],
  },
  handler: async (request) => {
    const { limit, offset } = request.query;
    return {
      users: users.slice(offset, offset + limit),
      total: users.length,
    };
  },
});

// Get user by ID
app.createEndpoint({
  method: 'GET',
  url: '/users/:id',
  query: z.object({}),
  response: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    createdAt: z.string(),
  }),
  config: {
    description: 'Get a user by ID',
    tags: ['Users'],
  },
  handler: async (request) => {
    const { id } = request.params as { id: string };
    const user = users.find(u => u.id === id);
    
    if (!user) {
      throw new NotFoundError('User not found');
    }
    
    return user;
  },
});

// Create user
app.createEndpoint({
  method: 'POST',
  url: '/users',
  query: z.object({}),
  body: z.object({
    name: z.string().min(1).max(100),
    email: z.string().email(),
  }),
  response: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    createdAt: z.string(),
  }),
  config: {
    description: 'Create a new user',
    tags: ['Users'],
  },
  handler: async (request) => {
    const { name, email } = request.body;
    
    // Check email uniqueness
    if (users.some(u => u.email === email)) {
      throw new ValidationError([
        { field: 'body.email', message: 'Email already exists' },
      ]);
    }
    
    const newUser: User = {
      id: crypto.randomUUID(),
      name,
      email,
      createdAt: new Date().toISOString(),
    };
    
    users.push(newUser);
    return newUser;
  },
});

// Update user
app.createEndpoint({
  method: 'PUT',
  url: '/users/:id',
  query: z.object({}),
  body: z.object({
    name: z.string().min(1).max(100).optional(),
    email: z.string().email().optional(),
  }),
  response: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    createdAt: z.string(),
  }),
  config: {
    description: 'Update a user',
    tags: ['Users'],
  },
  handler: async (request) => {
    const { id } = request.params as { id: string };
    const updates = request.body;
    
    const userIndex = users.findIndex(u => u.id === id);
    if (userIndex === -1) {
      throw new NotFoundError('User not found');
    }
    
    // Check email uniqueness if updating email
    if (updates.email && users.some(u => u.email === updates.email && u.id !== id)) {
      throw new ValidationError([
        { field: 'body.email', message: 'Email already exists' },
      ]);
    }
    
    users[userIndex] = { ...users[userIndex], ...updates };
    return users[userIndex];
  },
});

// Delete user
app.createEndpoint({
  method: 'DELETE',
  url: '/users/:id',
  query: z.object({}),
  response: z.object({
    message: z.string(),
  }),
  config: {
    description: 'Delete a user',
    tags: ['Users'],
  },
  handler: async (request) => {
    const { id } = request.params as { id: string };
    const index = users.findIndex(u => u.id === id);
    
    if (index === -1) {
      throw new NotFoundError('User not found');
    }
    
    users.splice(index, 1);
    return { message: 'User deleted' };
  },
});

// Protected admin endpoint
app.instance.register(async (scope) => {
  scope.addHook('onRequest', app.authenticateToken);
  
  scope.route({
    method: 'GET',
    url: '/admin/stats',
    handler: async () => ({
      totalUsers: users.length,
      timestamp: new Date().toISOString(),
    }),
  });
});

app.setupGracefulShutdown();
await app.start();
```

## Built-in Features

- **Swagger UI** - Interactive API docs at `/docs`
- **Prometheus Metrics** - Monitoring data at `/metrics`
- **Rate Limiting** - 100 requests per 15 minutes by default
- **CORS** - Cross-origin requests enabled
- **Request Validation** - Query, body, and params validated with Zod
- **Response Validation** - Catches bugs where responses don't match schemas
- **Bearer Token Auth** - Built-in authentication middleware
- **Structured Logging** - Pino logger with pretty formatting in development

## Publishing to npm

```bash
# Login
npm login

# Build and publish
npm run build
npm publish --access public
```

Create `@bitfocusas` organization on npm first: https://www.npmjs.com/org/create

## Repository

- **GitHub**: https://github.com/bitfocusas/api
- **Issues**: https://github.com/bitfocusas/api/issues
- **Author**: William Viker <william@bitfocus.io>
- **License**: MIT
