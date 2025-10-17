import { APIServer, ValidationError, NotFoundError, z } from './dist';

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
  params: z.object({
    id: z.string(),
  }),
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
    const { id } = request.params;
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
  params: z.object({
    id: z.string(),
  }),
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
    const { id } = request.params;
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
  params: z.object({
    id: z.string(),
  }),
  response: z.object({
    message: z.string(),
  }),
  config: {
    description: 'Delete a user',
    tags: ['Users'],
  },
  handler: async (request) => {
    const { id } = request.params;
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