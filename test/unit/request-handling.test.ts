import { describe, it, expect, vi, afterEach } from 'vitest'
import { z, NotFoundError, ValidationError } from '../../src/index'
import { useTestServers } from '../helpers'

describe('Request handling', () => {
	const createServer = useTestServers()

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('HTTP methods', () => {
		it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const)('should route %s requests', async (method) => {
			const server = createServer()
			server.createEndpoint({
				method,
				url: '/resource',
				response: z.object({ method: z.string() }),
				handler: async (request) => ({ method: request.raw.method ?? '' }),
			})

			const res = await server.instance.inject({ method, url: '/resource' })

			expect(res.statusCode).toBe(200)
			expect(res.json()).toEqual({ method })
		})

		it('should return 404 for unregistered routes', async () => {
			const server = createServer()
			server.createEndpoint({
				method: 'GET',
				url: '/exists',
				response: z.object({}),
				handler: async () => ({}),
			})

			const res = await server.instance.inject({ method: 'POST', url: '/exists' })

			expect(res.statusCode).toBe(404)
			expect(res.json()).toEqual({
				statusCode: 404,
				error: 'Not Found',
				message: 'Route POST:/exists not found',
			})
		})
	})

	describe('Path parameters', () => {
		it('should pass parsed and coerced params to the handler', async () => {
			const server = createServer()
			const handler = vi.fn(async (request: { params: { id: number; slug: string } }) => request.params)
			server.createEndpoint({
				method: 'GET',
				url: '/items/:id/:slug',
				params: z.object({ id: z.coerce.number().int(), slug: z.string() }),
				response: z.object({ id: z.number(), slug: z.string() }),
				handler,
			})

			const res = await server.instance.inject({ url: '/items/42/hello-world' })

			expect(res.statusCode).toBe(200)
			expect(res.json()).toEqual({ id: 42, slug: 'hello-world' })
			expect(handler.mock.calls[0][0].params.id).toBe(42)
		})

		it('should reject invalid params with a Fastify validation error', async () => {
			const server = createServer()
			const handler = vi.fn(async () => ({ id: 1 }))
			server.createEndpoint({
				method: 'GET',
				url: '/items/:id',
				params: z.object({ id: z.coerce.number().int() }),
				response: z.object({ id: z.number() }),
				handler,
			})

			const res = await server.instance.inject({ url: '/items/abc' })

			expect(res.statusCode).toBe(400)
			const body = res.json()
			expect(body).toMatchObject({ statusCode: 400, code: 'FST_ERR_VALIDATION', error: 'Bad Request' })
			expect(body.message).toContain('params/id')
			expect(handler).not.toHaveBeenCalled()
		})

		it('should support enum params', async () => {
			const server = createServer()
			server.createEndpoint({
				method: 'GET',
				url: '/status/:state',
				params: z.object({ state: z.enum(['on', 'off']) }),
				response: z.object({ state: z.string() }),
				handler: async (request) => ({ state: request.params.state }),
			})

			expect((await server.instance.inject({ url: '/status/on' })).statusCode).toBe(200)
			expect((await server.instance.inject({ url: '/status/maybe' })).statusCode).toBe(400)
		})
	})

	describe('Query parameters', () => {
		it('should apply coercion and defaults', async () => {
			const server = createServer()
			server.createEndpoint({
				method: 'GET',
				url: '/search',
				query: z.object({
					limit: z.coerce.number().default(10),
					active: z.enum(['true', 'false']).optional(),
				}),
				response: z.object({ limit: z.number(), active: z.string().optional() }),
				handler: async (request) => request.query,
			})

			expect((await server.instance.inject({ url: '/search' })).json()).toEqual({ limit: 10 })
			expect((await server.instance.inject({ url: '/search?limit=25&active=true' })).json()).toEqual({
				limit: 25,
				active: 'true',
			})
		})

		it('should parse repeated query keys as arrays', async () => {
			const server = createServer()
			server.createEndpoint({
				method: 'GET',
				url: '/tags',
				query: z.object({ tag: z.array(z.string()) }),
				response: z.object({ tag: z.array(z.string()) }),
				handler: async (request) => request.query,
			})

			const res = await server.instance.inject({ url: '/tags?tag=a&tag=b' })

			expect(res.statusCode).toBe(200)
			expect(res.json()).toEqual({ tag: ['a', 'b'] })
		})

		it('should reject unknown query keys when a query schema is defined', async () => {
			const server = createServer()
			server.createEndpoint({
				method: 'GET',
				url: '/search',
				query: z.object({ q: z.string().optional() }),
				response: z.object({}),
				handler: async () => ({}),
			})

			const res = await server.instance.inject({ url: '/search?unknown=1' })

			expect(res.statusCode).toBe(400)
			expect(res.json()).toMatchObject({ code: 'FST_ERR_VALIDATION' })
			expect(res.json().message).toContain('unknown')
		})

		it('should reject any query keys when no query schema is defined', async () => {
			const server = createServer()
			server.createEndpoint({
				method: 'GET',
				url: '/plain',
				response: z.object({}),
				handler: async () => ({}),
			})

			expect((await server.instance.inject({ url: '/plain' })).statusCode).toBe(200)
			expect((await server.instance.inject({ url: '/plain?x=1' })).statusCode).toBe(400)
		})
	})

	describe('Request body', () => {
		it('should accept nested objects and arrays', async () => {
			const server = createServer()
			const Body = z.object({
				user: z.object({ name: z.string(), roles: z.array(z.enum(['admin', 'user'])) }),
				meta: z.record(z.string(), z.number()).optional(),
			})
			server.createEndpoint({
				method: 'POST',
				url: '/nested',
				body: Body,
				response: Body,
				handler: async (request) => request.body,
			})

			const payload = { user: { name: 'Ann', roles: ['admin'] }, meta: { a: 1 } }
			const res = await server.instance.inject({ method: 'POST', url: '/nested', payload })

			expect(res.statusCode).toBe(200)
			expect(res.json()).toEqual(payload)
		})

		it('should report the path of nested body errors', async () => {
			const server = createServer()
			server.createEndpoint({
				method: 'POST',
				url: '/nested',
				body: z.object({ user: z.object({ age: z.number() }) }),
				response: z.object({}),
				handler: async () => ({}),
			})

			const res = await server.instance.inject({
				method: 'POST',
				url: '/nested',
				payload: { user: { age: 'x' } },
			})

			expect(res.statusCode).toBe(400)
			expect(res.json().message).toContain('body/user/age')
		})

		it('should reject a missing body', async () => {
			const server = createServer()
			server.createEndpoint({
				method: 'POST',
				url: '/needs-body',
				body: z.object({ a: z.string() }),
				response: z.object({}),
				handler: async () => ({}),
			})

			const res = await server.instance.inject({ method: 'POST', url: '/needs-body' })

			expect(res.statusCode).toBe(400)
			expect(res.json()).toMatchObject({ statusCode: 400, code: 'FST_ERR_VALIDATION' })
		})

		it('should reject malformed JSON', async () => {
			const server = createServer()
			server.createEndpoint({
				method: 'POST',
				url: '/json',
				body: z.object({ a: z.string() }),
				response: z.object({}),
				handler: async () => ({}),
			})

			const res = await server.instance.inject({
				method: 'POST',
				url: '/json',
				payload: '{not json',
				headers: { 'content-type': 'application/json' },
			})

			expect(res.statusCode).toBe(400)
			expect(res.json()).toMatchObject({ code: 'FST_ERR_CTP_INVALID_JSON_BODY' })
		})

		it('should not apply strict mode to non-object body schemas', async () => {
			const server = createServer()
			server.createEndpoint({
				method: 'POST',
				url: '/list',
				body: z.array(z.number()),
				response: z.object({ sum: z.number() }),
				handler: async (request) => ({ sum: request.body.reduce((a, b) => a + b, 0) }),
			})

			const res = await server.instance.inject({ method: 'POST', url: '/list', payload: [1, 2, 3] })

			expect(res.statusCode).toBe(200)
			expect(res.json()).toEqual({ sum: 6 })
		})
	})

	describe('Library-level validation (after Fastify validation)', () => {
		// Fastify validates with the same schemas first, so these branches are only reachable
		// when something (e.g. a preHandler hook) changes the request after Fastify validation.
		it('should return 400 when query is invalid at handler time', async () => {
			const server = createServer()
			server.instance.addHook('preHandler', async (request) => {
				request.query = { limit: 'not-a-number' }
			})
			server.createEndpoint({
				method: 'GET',
				url: '/q',
				query: z.object({ limit: z.coerce.number().optional() }),
				response: z.object({}),
				handler: async () => ({}),
			})

			const res = await server.instance.inject({ url: '/q' })

			expect(res.statusCode).toBe(400)
			// `details` is dropped by the response serializer (ErrorResponseSchema is strict)
			expect(res.json()).toEqual({ statusCode: 400, error: 'Bad Request', message: 'Validation failed' })
		})

		it('should return 400 when body is invalid at handler time', async () => {
			const server = createServer()
			server.instance.addHook('preHandler', async (request) => {
				request.body = { a: 1 }
			})
			server.createEndpoint({
				method: 'POST',
				url: '/b',
				body: z.object({ a: z.string() }),
				response: z.object({}),
				handler: async () => ({}),
			})

			const res = await server.instance.inject({ method: 'POST', url: '/b', payload: { a: 'ok' } })

			expect(res.statusCode).toBe(400)
			expect(res.json()).toEqual({ statusCode: 400, error: 'Bad Request', message: 'Validation failed' })
		})

		it('should return 400 when params are invalid at handler time', async () => {
			const server = createServer()
			server.instance.addHook('preHandler', async (request) => {
				request.params = { id: 'abc' }
			})
			server.createEndpoint({
				method: 'GET',
				url: '/p/:id',
				params: z.object({ id: z.string().regex(/^\d+$/) }),
				response: z.object({}),
				handler: async () => ({}),
			})

			const res = await server.instance.inject({ url: '/p/123' })

			expect(res.statusCode).toBe(400)
			expect(res.json()).toEqual({ statusCode: 400, error: 'Bad Request', message: 'Validation failed' })
		})
	})

	describe('Response validation', () => {
		it('should return 500 and log when response has extra fields (strict)', async () => {
			const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
			const server = createServer()
			server.createEndpoint({
				method: 'GET',
				url: '/leaky',
				response: z.object({ id: z.string() }),
				// biome-ignore lint/suspicious/noExplicitAny: deliberately returning invalid data
				handler: async () => ({ id: '1', password: 'secret' }) as any,
			})

			const res = await server.instance.inject({ url: '/leaky' })

			expect(res.statusCode).toBe(500)
			expect(res.json()).toEqual({
				statusCode: 500,
				error: 'Internal Server Error',
				message: 'Response validation failed - server returned invalid data',
			})
			expect(res.body).not.toContain('secret')
			expect(errorSpy).toHaveBeenCalledWith('Response validation failed:', expect.stringContaining('/leaky'))
		})

		it('should return 500 when a non-object response is invalid', async () => {
			vi.spyOn(console, 'error').mockImplementation(() => {})
			const server = createServer()
			server.createEndpoint({
				method: 'GET',
				url: '/numbers',
				response: z.array(z.number()),
				// biome-ignore lint/suspicious/noExplicitAny: deliberately returning invalid data
				handler: async () => 'nope' as any,
			})

			const res = await server.instance.inject({ url: '/numbers' })

			expect(res.statusCode).toBe(500)
			expect(res.json().message).toBe('Response validation failed - server returned invalid data')
		})

		it('should serialize non-object responses', async () => {
			const server = createServer()
			server.createEndpoint({
				method: 'GET',
				url: '/numbers',
				response: z.array(z.number()),
				handler: async () => [1, 2, 3],
			})

			const res = await server.instance.inject({ url: '/numbers' })

			expect(res.statusCode).toBe(200)
			expect(res.headers['content-type']).toContain('application/json')
			expect(res.json()).toEqual([1, 2, 3])
		})

		it('should serialize optional and nullable fields', async () => {
			const server = createServer()
			server.createEndpoint({
				method: 'GET',
				url: '/opt',
				response: z.object({ a: z.string().optional(), b: z.string().nullable() }),
				handler: async () => ({ b: null }),
			})

			const res = await server.instance.inject({ url: '/opt' })

			expect(res.statusCode).toBe(200)
			expect(res.json()).toEqual({ b: null })
		})
	})

	describe('Errors thrown by handlers', () => {
		it('should map NotFoundError to 404', async () => {
			const server = createServer()
			server.createEndpoint({
				method: 'GET',
				url: '/missing',
				response: z.object({}),
				handler: async () => {
					throw new NotFoundError('Thing not found')
				},
			})

			const res = await server.instance.inject({ url: '/missing' })

			expect(res.statusCode).toBe(404)
			expect(res.json()).toEqual({ statusCode: 404, error: 'Not Found', message: 'Thing not found' })
		})

		it('should map ValidationError to 400', async () => {
			const server = createServer()
			server.createEndpoint({
				method: 'POST',
				url: '/v',
				body: z.object({ email: z.string() }),
				response: z.object({}),
				handler: async () => {
					throw new ValidationError([{ field: 'body.email', message: 'taken' }])
				},
			})

			const res = await server.instance.inject({ method: 'POST', url: '/v', payload: { email: 'a' } })

			expect(res.statusCode).toBe(400)
			// `details` is dropped by the response serializer (ErrorResponseSchema is strict)
			expect(res.json()).toEqual({ statusCode: 400, error: 'Bad Request', message: 'Validation failed' })
		})

		it('should pass other errors to the Fastify error handler as 500', async () => {
			const server = createServer()
			server.createEndpoint({
				method: 'GET',
				url: '/boom',
				response: z.object({}),
				handler: async () => {
					throw new Error('kaboom')
				},
			})

			const res = await server.instance.inject({ url: '/boom' })

			expect(res.statusCode).toBe(500)
			expect(res.json()).toEqual({ statusCode: 500, error: 'Internal Server Error', message: 'kaboom' })
		})

		it('should respect statusCode on other errors', async () => {
			const server = createServer()
			server.createEndpoint({
				method: 'GET',
				url: '/teapot',
				response: z.object({}),
				handler: async () => {
					throw Object.assign(new Error('short and stout'), { statusCode: 400 })
				},
			})

			const res = await server.instance.inject({ url: '/teapot' })

			expect(res.statusCode).toBe(400)
			expect(res.json()).toMatchObject({ statusCode: 400, message: 'short and stout' })
		})

		it('should support a custom Fastify error handler', async () => {
			const server = createServer()
			server.instance.setErrorHandler((error, _request, reply) => {
				reply.code(418).send({ statusCode: 418, error: 'Teapot', message: (error as Error).message })
			})
			server.createEndpoint({
				method: 'GET',
				url: '/custom',
				response: z.object({}),
				handler: async () => {
					throw new Error('custom')
				},
			})

			const res = await server.instance.inject({ url: '/custom' })

			expect(res.statusCode).toBe(418)
		})
	})

	describe('Handler request and reply', () => {
		it('should allow setting the status code and headers via reply', async () => {
			const server = createServer()
			server.createEndpoint({
				method: 'POST',
				url: '/created',
				response: z.object({ ok: z.boolean() }),
				handler: async (_request, reply) => {
					reply.code(201).header('x-custom', 'yes')
					return { ok: true }
				},
			})

			const res = await server.instance.inject({ method: 'POST', url: '/created' })

			expect(res.statusCode).toBe(201)
			expect(res.headers['x-custom']).toBe('yes')
			expect(res.json()).toEqual({ ok: true })
		})

		it('should expose own request properties and the raw request', async () => {
			const server = createServer()
			server.createEndpoint({
				method: 'GET',
				url: '/info',
				response: z.object({ id: z.string(), hasLog: z.boolean(), rawHeader: z.string() }),
				handler: async (request) => ({
					id: request.id,
					hasLog: typeof request.log?.info === 'function',
					rawHeader: String(request.raw.headers['x-test']),
				}),
			})

			const res = await server.instance.inject({ url: '/info', headers: { 'x-test': 'value' } })

			expect(res.statusCode).toBe(200)
			expect(res.json()).toEqual({ id: expect.any(String), hasLog: true, rawHeader: 'value' })
		})

		// Known issue: the handler receives a spread copy of the Fastify request, so properties
		// implemented as prototype getters (headers, ip, url, method, hostname, ...) are lost.
		// When this is fixed, flip `it.fails` to `it`.
		it.fails('should expose request.headers and request.ip in handlers', async () => {
			const server = createServer()
			server.createEndpoint({
				method: 'GET',
				url: '/headers',
				response: z.object({ header: z.string(), ip: z.string() }),
				handler: async (request) => ({ header: String(request.headers['x-test']), ip: request.ip }),
			})

			const res = await server.instance.inject({ url: '/headers', headers: { 'x-test': 'value' } })

			expect(res.statusCode).toBe(200)
			expect(res.json()).toEqual({ header: 'value', ip: '127.0.0.1' })
		})

		// Known issue: the library re-parses the already-transformed data from Fastify validation,
		// so schemas with .transform() fail. When this is fixed, flip `it.fails` to `it`.
		it.fails('should support zod transforms in body schemas', async () => {
			const server = createServer()
			server.createEndpoint({
				method: 'POST',
				url: '/transform',
				body: z.object({ s: z.string().transform((v) => v.length) }),
				response: z.object({ s: z.number() }),
				handler: async (request) => request.body,
			})

			const res = await server.instance.inject({ method: 'POST', url: '/transform', payload: { s: 'abc' } })

			expect(res.statusCode).toBe(200)
			expect(res.json()).toEqual({ s: 3 })
		})
	})
})
