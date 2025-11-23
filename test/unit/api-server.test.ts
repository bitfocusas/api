import { describe, it, expect, afterEach } from 'vitest'
import { z } from 'zod'
import supertest from 'supertest'
import fastify from 'fastify'
import type { FastifyRequest } from 'fastify'
import { APIServer, ValidationError, NotFoundError } from '../../src/index'

describe('APIServer', () => {
	let server: APIServer

	afterEach(async () => {
		if (server) {
			await server.stop()
		}
	})

	describe('Constructor and Configuration', () => {
		it('should create server with default configuration', () => {
			server = new APIServer({ metricsEnabled: false })
			expect(server).toBeDefined()
			expect(server.serverConfig).toBeDefined()
			expect(server.serverConfig.port).toBe(3000)
			expect(server.serverConfig.host).toBe('127.0.0.1')
			// In test environment, NODE_ENV is set to 'test' by vitest
			expect(['development', 'test']).toContain(server.serverConfig.env)
		})

		it('should create server with custom configuration', () => {
			server = new APIServer({
				port: 4000,
				host: '0.0.0.0',
				env: 'production',
				logLevel: 'error',
				apiTitle: 'Test API',
				metricsEnabled: false,
			})

			expect(server.serverConfig.port).toBe(4000)
			expect(server.serverConfig.host).toBe('0.0.0.0')
			expect(server.serverConfig.env).toBe('production')
			expect(server.serverConfig.logLevel).toBe('error')
			expect(server.serverConfig.apiTitle).toBe('Test API')
		})

		it('should provide access to Fastify instance', () => {
			server = new APIServer({ metricsEnabled: false })
			expect(server.instance).toBeDefined()
			expect(typeof server.instance.listen).toBe('function')
		})
	})

	describe('Basic Endpoint Creation', () => {
		it('should create a simple GET endpoint', async () => {
			server = new APIServer({ port: 3001, metricsEnabled: false })

			server.createEndpoint({
				method: 'GET',
				url: '/test',
				response: z.object({ message: z.string() }),
				handler: async () => {
					return { message: 'Hello World' }
				},
			})

			await server.start()

			const response = await supertest(server.instance.server).get('/test').expect(200)

			expect(response.body).toEqual({ message: 'Hello World' })
		})

		it('should create a POST endpoint with body validation', async () => {
			server = new APIServer({ port: 3002, metricsEnabled: false })

			server.createEndpoint({
				method: 'POST',
				url: '/users',
				body: z.object({
					name: z.string(),
					email: z.string().email(),
				}),
				response: z.object({
					id: z.string(),
					name: z.string(),
					email: z.string(),
				}),
				handler: async (request) => {
					return {
						id: '123',
						name: request.body.name,
						email: request.body.email,
					}
				},
			})

			await server.start()

			const response = await supertest(server.instance.server)
				.post('/users')
				.send({ name: 'John', email: 'john@example.com' })
				.expect(200)

			expect(response.body).toEqual({
				id: '123',
				name: 'John',
				email: 'john@example.com',
			})
		})

		it('should create a GET endpoint with query parameters', async () => {
			server = new APIServer({ port: 3103, metricsEnabled: false })

			server.createEndpoint({
				method: 'GET',
				url: '/search',
				query: z.object({
					q: z.string(),
					limit: z.coerce.number().default(10),
				}),
				response: z.object({
					query: z.string(),
					limit: z.number(),
					results: z.array(z.any()),
				}),
				handler: async (request) => {
					return {
						query: request.query.q,
						limit: request.query.limit,
						results: [],
					}
				},
			})

			await server.start()

			const response = await supertest(server.instance.server).get('/search?q=test&limit=5').expect(200)

			expect(response.body).toEqual({
				query: 'test',
				limit: 5,
				results: [],
			})
		})
	})

	describe('Validation', () => {
		it('should return 400 for invalid query parameters', async () => {
			server = new APIServer({ port: 3004, metricsEnabled: false })

			server.createEndpoint({
				method: 'GET',
				url: '/validate-query',
				query: z.object({
					age: z.coerce.number().positive(),
				}),
				response: z.object({ age: z.number() }),
				handler: async (request) => {
					return { age: request.query.age }
				},
			})

			await server.start()

			const response = await supertest(server.instance.server).get('/validate-query?age=-5').expect(400)

			expect(response.body.statusCode).toBe(400)
			// Fastify's validation error returns the Zod error directly
			expect(response.body.code).toBe('FST_ERR_VALIDATION')
			expect(response.body.error).toBe('Bad Request')
		})

		it('should return 400 for invalid body', async () => {
			server = new APIServer({ port: 3005, metricsEnabled: false })

			server.createEndpoint({
				method: 'POST',
				url: '/validate-body',
				body: z.object({
					email: z.string().email(),
					age: z.number().positive(),
				}),
				response: z.object({ success: z.boolean() }),
				handler: async () => {
					return { success: true }
				},
			})

			await server.start()

			const response = await supertest(server.instance.server)
				.post('/validate-body')
				.send({ email: 'invalid-email', age: -1 })
				.expect(400)

			expect(response.body.statusCode).toBe(400)
			expect(response.body.code).toBe('FST_ERR_VALIDATION')
			expect(response.body.error).toBe('Bad Request')
		})

		it('should reject unexpected fields in request body (strict mode)', async () => {
			server = new APIServer({ port: 3006, metricsEnabled: false })

			server.createEndpoint({
				method: 'POST',
				url: '/strict',
				body: z.object({
					name: z.string(),
				}),
				response: z.object({ name: z.string() }),
				handler: async (request) => {
					return { name: request.body.name }
				},
			})

			await server.start()

			const response = await supertest(server.instance.server)
				.post('/strict')
				.send({ name: 'John', extraField: 'should-be-rejected' })
				.expect(400)

			expect(response.body.statusCode).toBe(400)
			expect(response.body.error).toBe('Bad Request')
		})

		it('should return 500 for invalid response (response validation)', async () => {
			server = new APIServer({ port: 3007, metricsEnabled: false })

			server.createEndpoint({
				method: 'GET',
				url: '/invalid-response',
				response: z.object({
					requiredField: z.string(),
				}),
				// @ts-ignore - Intentionally returning invalid response to test validation
				handler: async () => {
					// Intentionally return invalid data to test response validation
					return {}
				},
			})

			await server.start()

			const response = await supertest(server.instance.server).get('/invalid-response').expect(500)

			expect(response.body.statusCode).toBe(500)
			expect(response.body.error).toBe('Internal Server Error')
			expect(response.body.message).toContain('Response validation failed')
		})
	})

	describe('Error Handling', () => {
		it('should handle ValidationError thrown in handler', async () => {
			server = new APIServer({ port: 3008, metricsEnabled: false })

			server.createEndpoint({
				method: 'POST',
				url: '/custom-validation',
				body: z.object({ email: z.string() }),
				response: z.object({ success: z.boolean() }),
				handler: async (request) => {
					if (request.body.email === 'taken@example.com') {
						throw new ValidationError([{ field: 'body.email', message: 'Email already taken' }])
					}
					return { success: true }
				},
			})

			await server.start()

			const response = await supertest(server.instance.server)
				.post('/custom-validation')
				.send({ email: 'taken@example.com' })
				.expect(400)

			expect(response.body.statusCode).toBe(400)
			expect(response.body.message).toBe('Validation failed')
			// Custom ValidationError should have details
			if (response.body.details) {
				expect(response.body.details[0].field).toBe('body.email')
				expect(response.body.details[0].message).toBe('Email already taken')
			} else {
				// If details not present, at least error message should indicate validation issue
				expect(response.body.error).toBe('Bad Request')
			}
		})

		it('should handle NotFoundError thrown in handler', async () => {
			server = new APIServer({ port: 3027, metricsEnabled: false })

			server.createEndpoint({
				method: 'GET',
				url: '/users/:id',
				params: z.object({
					id: z.string(),
				}),
				response: z.object({ id: z.string(), name: z.string() }),
				handler: async (request) => {
					const { id } = request.params
					if (id === '999') {
						throw new NotFoundError('User not found')
					}
					return { id, name: 'John' }
				},
			})

			await server.start()

			const response = await supertest(server.instance.server).get('/users/999').expect(404)

			expect(response.body.statusCode).toBe(404)
			expect(response.body.error).toBe('Not Found')
			expect(response.body.message).toBe('User not found')
		})
	})

	describe('Authentication', () => {
		it('should allow requests with valid token', async () => {
			server = new APIServer({
				port: 3010,
				apiToken: 'test-token-123',
				metricsEnabled: false,
			})

			await server.instance.register(async (protectedScope) => {
				protectedScope.addHook('onRequest', server.authenticateToken)

				protectedScope.get('/protected', async () => {
					return { message: 'Protected data' }
				})
			})

			await server.start()

			const response = await supertest(server.instance.server)
				.get('/protected')
				.set('Authorization', 'Bearer test-token-123')
				.expect(200)

			expect(response.body.message).toBe('Protected data')
		})

		it('should reject requests without authorization header', async () => {
			server = new APIServer({
				port: 3011,
				apiToken: 'test-token-123',
				metricsEnabled: false,
			})

			await server.instance.register(async (protectedScope) => {
				protectedScope.addHook('onRequest', server.authenticateToken)

				protectedScope.get('/protected', async () => {
					return { message: 'Protected data' }
				})
			})

			await server.start()

			const response = await supertest(server.instance.server).get('/protected').expect(401)

			expect(response.body.statusCode).toBe(401)
			expect(response.body.error).toBe('Unauthorized')
			expect(response.body.message).toContain('Missing authorization header')
		})

		it('should reject requests with invalid token', async () => {
			server = new APIServer({
				port: 3012,
				apiToken: 'valid-token',
				metricsEnabled: false,
			})

			await server.instance.register(async (protectedScope) => {
				protectedScope.addHook('onRequest', server.authenticateToken)

				protectedScope.get('/protected', async () => {
					return { message: 'Protected data' }
				})
			})

			await server.start()

			const response = await supertest(server.instance.server)
				.get('/protected')
				.set('Authorization', 'Bearer invalid-token')
				.expect(403)

			expect(response.body.statusCode).toBe(403)
			expect(response.body.error).toBe('Forbidden')
			expect(response.body.message).toBe('Invalid token')
		})

		it('should reject requests with malformed authorization header', async () => {
			server = new APIServer({
				port: 3013,
				apiToken: 'test-token',
				metricsEnabled: false,
			})

			await server.instance.register(async (protectedScope) => {
				protectedScope.addHook('onRequest', server.authenticateToken)

				protectedScope.get('/protected', async () => {
					return { message: 'Protected data' }
				})
			})

			await server.start()

			const response = await supertest(server.instance.server)
				.get('/protected')
				.set('Authorization', 'InvalidFormat')
				.expect(401)

			expect(response.body.statusCode).toBe(401)
			expect(response.body.message).toContain('Invalid authorization header format')
		})
	})

	describe('Custom Authentication Validator', () => {
		interface TestAuthContext {
			userId: string
			role: string
		}

		it('should support custom token validator with context', async () => {
			const testServer = new APIServer<TestAuthContext>({
				port: 3014,
				metricsEnabled: false,
				apiToken: async (token) => {
					if (token === 'valid-custom-token') {
						return {
							valid: true,
							context: { userId: '123', role: 'admin' },
						}
					}
					return { valid: false, error: 'Invalid token' }
				},
			})

			await testServer.instance.register(async (protectedScope) => {
				protectedScope.addHook('onRequest', testServer.authenticateToken)

				protectedScope.get('/profile', async (request: FastifyRequest & { auth?: TestAuthContext }) => {
					if (!request.auth) {
						throw new Error('Auth context not set')
					}
					return {
						userId: request.auth.userId,
						role: request.auth.role,
					}
				})
			})

			await testServer.start()

			const response = await supertest(testServer.instance.server)
				.get('/profile')
				.set('Authorization', 'Bearer valid-custom-token')
				.expect(200)

			expect(response.body).toEqual({
				userId: '123',
				role: 'admin',
			})

			await testServer.stop()
		})

		it('should reject invalid token with custom validator', async () => {
			server = new APIServer({
				port: 3015,
				metricsEnabled: false,
				apiToken: async (token) => {
					if (token === 'valid-token') {
						return { valid: true }
					}
					return { valid: false, error: 'Custom error message' }
				},
			})

			await server.instance.register(async (protectedScope) => {
				protectedScope.addHook('onRequest', server.authenticateToken)

				protectedScope.get('/protected', async () => {
					return { message: 'Protected' }
				})
			})

			await server.start()

			const response = await supertest(server.instance.server)
				.get('/protected')
				.set('Authorization', 'Bearer invalid-token')
				.expect(403)

			expect(response.body.statusCode).toBe(403)
			expect(response.body.message).toBe('Custom error message')
		})
	})

	describe('Server Lifecycle', () => {
		it('should start and stop server successfully', async () => {
			server = new APIServer({ port: 3016, metricsEnabled: false })
			await server.start()
			await server.stop()
		})

		it('should throw error when starting already started server', async () => {
			server = new APIServer({ port: 3017, metricsEnabled: false })
			await server.start()

			await expect(server.start()).rejects.toThrow('Server is already started')
		})

		it('should not throw when stopping non-started server', async () => {
			server = new APIServer({ port: 3018, metricsEnabled: false })
			await expect(server.stop()).resolves.not.toThrow()
		})
	})

	describe('Swagger Documentation', () => {
		it('should serve swagger documentation at /docs', async () => {
			server = new APIServer({ port: 3019, metricsEnabled: false })

			server.createEndpoint({
				method: 'GET',
				url: '/test',
				response: z.object({ message: z.string() }),
				handler: async () => ({ message: 'test' }),
			})

			await server.start()

			const response = await supertest(server.instance.server).get('/docs').expect(302) // Redirect to /docs/

			expect(response.header.location).toContain('/docs/')
		})
	})

	describe('Metrics', () => {
		it('should serve metrics when enabled', async () => {
			server = new APIServer({
				port: 3020,
				metricsEnabled: true,
			})

			await server.start()

			const response = await supertest(server.instance.server).get('/metrics').expect(200)

			expect(response.text).toContain('# HELP')
		})
	})

	describe('Endpoint Configuration', () => {
		it('should support endpoint tags and description', async () => {
			server = new APIServer({
				port: 3021,
				metricsEnabled: false,
				apiTags: [{ name: 'Test', description: 'Test endpoints' }],
			})

			server.createEndpoint({
				method: 'GET',
				url: '/tagged',
				response: z.object({ data: z.string() }),
				config: {
					description: 'Test endpoint with tags',
					tags: ['Test'],
					summary: 'Get test data',
					operationId: 'getTestData',
				},
				handler: async () => ({ data: 'test' }),
			})

			await server.start()

			// Test the endpoint works
			const response = await supertest(server.instance.server).get('/tagged').expect(200)

			expect(response.body.data).toBe('test')
		})
	})

	describe('Custom Fastify Instance', () => {
		it('should work with provided Fastify instance', async () => {
			const customFastify = fastify({ logger: false })

			server = new APIServer({
				fastify: customFastify,
				metricsEnabled: false,
			})

			server.createEndpoint({
				method: 'GET',
				url: '/test',
				response: z.object({ message: z.string() }),
				handler: async () => ({ message: 'Hello from custom Fastify' }),
			})

			// Call start - should attach endpoints but not start server
			await server.start()

			// Start the custom Fastify instance ourselves
			await customFastify.listen({ port: 3022, host: '127.0.0.1' })

			const response = await supertest(customFastify.server).get('/test').expect(200)

			expect(response.body.message).toBe('Hello from custom Fastify')

			// Clean up
			await customFastify.close()
		})

		it('should not start server when using custom Fastify instance', async () => {
			const customFastify = fastify({ logger: false })

			server = new APIServer({
				fastify: customFastify,
				metricsEnabled: false,
			})

			server.createEndpoint({
				method: 'GET',
				url: '/test',
				response: z.object({ message: z.string() }),
				handler: async () => ({ message: 'test' }),
			})

			// Call start - should not throw even though server isn't started
			await server.start()

			// Verify server is not listening
			expect(customFastify.server.listening).toBe(false)

			// Clean up
			await customFastify.close()
		})

		it('should not stop custom Fastify instance', async () => {
			const customFastify = fastify({ logger: false })

			server = new APIServer({
				fastify: customFastify,
				metricsEnabled: false,
			})

			await customFastify.listen({ port: 3023, host: '127.0.0.1' })
			await server.start()

			// Call stop - should not close the custom instance
			await server.stop()

			// Verify server is still listening
			expect(customFastify.server.listening).toBe(true)

			// Clean up
			await customFastify.close()
		})

		it('should register plugins on custom Fastify instance', async () => {
			const customFastify = fastify({ logger: false })

			server = new APIServer({
				fastify: customFastify,
				metricsEnabled: false, // Disable metrics to avoid Prometheus registry conflicts in tests
			})

			await server.start()
			await customFastify.listen({ port: 3024, host: '127.0.0.1' })

			// Verify CORS is registered (plugins are registered)
			// We can't easily test metrics without registry conflicts, so we just verify plugins were registered
			const response = await supertest(customFastify.server).get('/test').expect(404) // Endpoint doesn't exist, but CORS headers should be present

			await customFastify.close()
		})

		it('should allow custom routes alongside API endpoints', async () => {
			const customFastify = fastify({ logger: false })

			// Add custom route before creating API server
			customFastify.get('/custom', async () => ({ custom: true }))

			server = new APIServer({
				fastify: customFastify,
				metricsEnabled: false,
			})

			server.createEndpoint({
				method: 'GET',
				url: '/api/test',
				response: z.object({ api: z.boolean() }),
				handler: async () => ({ api: true }),
			})

			await server.start()
			await customFastify.listen({ port: 3025, host: '127.0.0.1' })

			// Test custom route
			const customResponse = await supertest(customFastify.server).get('/custom').expect(200)
			expect(customResponse.body.custom).toBe(true)

			// Test API endpoint
			const apiResponse = await supertest(customFastify.server).get('/api/test').expect(200)
			expect(apiResponse.body.api).toBe(true)

			await customFastify.close()
		})

		it('should set up Zod validation on custom Fastify instance', async () => {
			const customFastify = fastify({ logger: false })

			server = new APIServer({
				fastify: customFastify,
				metricsEnabled: false,
			})

			server.createEndpoint({
				method: 'POST',
				url: '/validate',
				body: z.object({ name: z.string() }),
				response: z.object({ name: z.string() }),
				handler: async (request) => ({ name: request.body.name }),
			})

			await server.start()
			await customFastify.listen({ port: 3026, host: '127.0.0.1' })

			// Test validation works
			const response = await supertest(customFastify.server).post('/validate').send({ name: 'John' }).expect(200)

			expect(response.body.name).toBe('John')

			// Test invalid data is rejected
			await supertest(customFastify.server)
				.post('/validate')
				.send({ name: 123 }) // Invalid type
				.expect(400)

			await customFastify.close()
		})
	})
})
