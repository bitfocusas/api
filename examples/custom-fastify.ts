/**
 * Custom Fastify Instance Example
 *
 * This example demonstrates how to use @bitfocusas/api with your own
 * Fastify instance. This is useful when you want to:
 * - Integrate with an existing Fastify application
 * - Have more control over Fastify configuration
 * - Share a Fastify instance across multiple modules
 * - Use custom Fastify plugins before attaching the API server
 *
 * Run with: npx tsx examples/custom-fastify.ts
 */

import fastify from 'fastify'
import { APIServer, z } from '../src/index'

// Create your own Fastify instance with custom configuration
const customFastify = fastify({
	logger: {
		level: 'info',
		transport: {
			target: 'pino-pretty',
			options: {
				translateTime: 'HH:MM:ss Z',
				ignore: 'pid,hostname',
				colorize: true,
			},
		},
	},
	// Add any other Fastify options you need
	disableRequestLogging: false,
})

// Register your own plugins before attaching the API server
customFastify.register(async (instance) => {
	// Example: Add a custom hook
	instance.addHook('onRequest', async (request, _reply) => {
		request.log.info({ url: request.url, method: request.method }, 'Incoming request')
	})

	// Example: Add a custom route
	instance.get('/health', async () => {
		return { status: 'ok', timestamp: new Date().toISOString() }
	})
})

// Create API server with your existing Fastify instance
const app = new APIServer({
	fastify: customFastify, // 🔑 Pass your Fastify instance here
	apiTitle: 'Custom Fastify Example',
	apiDescription: 'API server attached to a custom Fastify instance',
	apiTags: [{ name: 'Users', description: 'User management endpoints' }],
})

// Define your endpoints as usual
app.createEndpoint({
	method: 'GET',
	url: '/users',
	query: z.object({
		limit: z.coerce.number().int().positive().max(100).default(10).describe('Maximum number of users to return'),
	}),
	response: z.object({
		users: z.array(
			z.object({
				id: z.string().describe('User ID'),
				name: z.string().describe('User name'),
				email: z.string().describe('User email'),
			}),
		),
		total: z.number().describe('Total number of users'),
	}),
	config: {
		description: 'List users with pagination',
		tags: ['Users'],
	},
	handler: async (request) => {
		// Simulated user data
		const users = [
			{ id: '1', name: 'Alice', email: 'alice@example.com' },
			{ id: '2', name: 'Bob', email: 'bob@example.com' },
			{ id: '3', name: 'Charlie', email: 'charlie@example.com' },
		]

		const { limit } = request.query
		return {
			users: users.slice(0, limit),
			total: users.length,
		}
	},
})

app.createEndpoint({
	method: 'POST',
	url: '/users',
	body: z.object({
		name: z.string().min(1).describe('User name'),
		email: z.string().email().describe('User email'),
	}),
	response: z.object({
		id: z.string().describe('Created user ID'),
		name: z.string().describe('User name'),
		email: z.string().describe('User email'),
		createdAt: z.string().describe('Creation timestamp'),
	}),
	config: {
		description: 'Create a new user',
		tags: ['Users'],
	},
	handler: async (request) => {
		const { name, email } = request.body

		// In a real app, you'd save to database
		return {
			id: crypto.randomUUID(),
			name,
			email,
			createdAt: new Date().toISOString(),
		}
	},
})

// Setup graceful shutdown
app.setupGracefulShutdown()

// Call app.start() to attach endpoints (but it won't start the server)
// You're responsible for starting your Fastify instance
await app.start()

// Start your Fastify instance yourself
const port = 3000
const host = '127.0.0.1'

await customFastify.listen({ port, host })

console.log('\n✅ Server started with custom Fastify instance!')
console.log(`📝 API Documentation: http://localhost:${port}/docs`)
console.log(`🏥 Health check: http://localhost:${port}/health`)
console.log('\n💡 Try these commands:')
console.log('   # Health check (custom route)')
console.log(`   curl http://localhost:${port}/health`)
console.log('\n   # List users')
console.log(`   curl http://localhost:${port}/users?limit=2`)
console.log('\n   # Create user')
console.log(
	`   curl -X POST http://localhost:${port}/users -H "Content-Type: application/json" -d '{"name":"John Doe","email":"john@example.com"}'`,
)
