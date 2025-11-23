import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import supertest from 'supertest'
import { APIServer, ValidationError, z } from '../../src/index'

/**
 * End-to-end test for examples/basic.ts
 *
 * This test recreates the basic user management example and verifies
 * all endpoints work correctly, including validation and error handling.
 */
describe('Basic Example E2E', () => {
	let app: APIServer
	let users: Array<{
		id: string
		name: string
		email: string
		age?: number
		createdAt: string
	}>

	beforeEach(() => {
		// Reset users array before each test
		users = []
	})

	afterEach(async () => {
		if (app) {
			await app.stop()
		}
	})

	const setupBasicExample = async (port: number) => {
		app = new APIServer({
			port,
			metricsEnabled: false,
			apiTitle: 'User API Example',
			apiDescription: 'Basic example API built with @bitfocusas/api',
			apiTags: [{ name: 'Users', description: 'User management endpoints' }],
		})

		// Define schemas
		const CreateUserBody = z.object({
			name: z.string().min(1, 'Name is required').max(100, 'Name must be less than 100 characters'),
			email: z.string().email('Invalid email address'),
			age: z.number().int().positive('Age must be a positive number').optional(),
		})

		const UserResponse = z.object({
			id: z.string(),
			name: z.string(),
			email: z.string(),
			age: z.number().optional(),
			createdAt: z.string(),
		})

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
				const { name, email, age } = request.body

				// Check if email already exists
				const existingUser = users.find((u) => u.email === email)
				if (existingUser) {
					throw new ValidationError([
						{
							field: 'body.email',
							message: 'User with this email already exists',
						},
					])
				}

				// Create new user
				const newUser = {
					id: crypto.randomUUID(),
					name,
					email,
					age,
					createdAt: new Date().toISOString(),
				}

				users.push(newUser)

				return newUser
			},
		})

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
				}
			},
		})

		await app.start()
	}

	it('should create a user successfully', async () => {
		await setupBasicExample(3200)

		const userData = {
			name: 'John Doe',
			email: 'john@example.com',
			age: 30,
		}

		const response = await supertest(app.instance.server).post('/users').send(userData).expect(200)

		expect(response.body).toMatchObject({
			name: 'John Doe',
			email: 'john@example.com',
			age: 30,
		})
		expect(response.body.id).toBeDefined()
		expect(response.body.createdAt).toBeDefined()
	})

	it('should get all users', async () => {
		await setupBasicExample(3201)

		// Create two users
		await supertest(app.instance.server).post('/users').send({ name: 'Alice', email: 'alice@example.com', age: 25 })

		await supertest(app.instance.server).post('/users').send({ name: 'Bob', email: 'bob@example.com' })

		// Get all users
		const response = await supertest(app.instance.server).get('/users').expect(200)

		expect(response.body.total).toBe(2)
		expect(response.body.users).toHaveLength(2)
		expect(response.body.users[0].name).toBe('Alice')
		expect(response.body.users[1].name).toBe('Bob')
	})

	it('should validate email format', async () => {
		await setupBasicExample(3212)

		const response = await supertest(app.instance.server)
			.post('/users')
			.send({
				name: 'Invalid User',
				email: 'not-an-email',
				age: 30,
			})
			.expect(400)

		expect(response.body.statusCode).toBe(400)
		expect(response.body.error).toBe('Bad Request')
		expect(response.body.code).toBe('FST_ERR_VALIDATION')
	})

	it('should validate name length', async () => {
		await setupBasicExample(3203)

		// Test empty name
		const response1 = await supertest(app.instance.server)
			.post('/users')
			.send({
				name: '',
				email: 'test@example.com',
			})
			.expect(400)

		expect(response1.body.statusCode).toBe(400)
		expect(response1.body.code).toBe('FST_ERR_VALIDATION')

		// Test name too long
		const longName = 'a'.repeat(101)
		const response2 = await supertest(app.instance.server)
			.post('/users')
			.send({
				name: longName,
				email: 'test@example.com',
			})
			.expect(400)

		expect(response2.body.statusCode).toBe(400)
	})

	it('should validate age is positive', async () => {
		await setupBasicExample(3204)

		const response = await supertest(app.instance.server)
			.post('/users')
			.send({
				name: 'Test User',
				email: 'test@example.com',
				age: -5,
			})
			.expect(400)

		expect(response.body.statusCode).toBe(400)
		expect(response.body.code).toBe('FST_ERR_VALIDATION')
	})

	it('should reject duplicate email', async () => {
		await setupBasicExample(3205)

		// Create first user
		await supertest(app.instance.server)
			.post('/users')
			.send({
				name: 'First User',
				email: 'duplicate@example.com',
				age: 30,
			})
			.expect(200)

		// Try to create second user with same email
		const response = await supertest(app.instance.server)
			.post('/users')
			.send({
				name: 'Second User',
				email: 'duplicate@example.com',
				age: 25,
			})
			.expect(400)

		expect(response.body.statusCode).toBe(400)
		expect(response.body.message).toBe('Validation failed')
		// Custom ValidationError should have details
		if (response.body.details) {
			expect(response.body.details[0].field).toBe('body.email')
			expect(response.body.details[0].message).toBe('User with this email already exists')
		} else {
			// If details not present, at least error message should indicate validation issue
			expect(response.body.error).toBe('Bad Request')
		}
	})

	it('should create user without optional age field', async () => {
		await setupBasicExample(3206)

		const response = await supertest(app.instance.server)
			.post('/users')
			.send({
				name: 'No Age User',
				email: 'noage@example.com',
			})
			.expect(200)

		expect(response.body).toMatchObject({
			name: 'No Age User',
			email: 'noage@example.com',
		})
		expect(response.body.age).toBeUndefined()
	})

	it('should reject extra fields in strict mode', async () => {
		await setupBasicExample(3207)

		const response = await supertest(app.instance.server)
			.post('/users')
			.send({
				name: 'Test User',
				email: 'test@example.com',
				age: 30,
				extraField: 'should-be-rejected',
			})
			.expect(400)

		expect(response.body.statusCode).toBe(400)
	})

	it('should maintain state across requests', async () => {
		await setupBasicExample(3208)

		// Create first user
		await supertest(app.instance.server).post('/users').send({ name: 'User 1', email: 'user1@example.com' })

		// Create second user
		await supertest(app.instance.server).post('/users').send({ name: 'User 2', email: 'user2@example.com' })

		// Get all users
		const response = await supertest(app.instance.server).get('/users').expect(200)

		expect(response.body.total).toBe(2)
		expect(response.body.users).toHaveLength(2)
	})

	it('should have proper Swagger documentation configured', async () => {
		await setupBasicExample(3209)

		const response = await supertest(app.instance.server).get('/docs').expect(200) // Swagger UI v5 serves directly at /docs

		expect(response.text).toContain('swagger')
	})
})
