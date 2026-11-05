import { describe, it, expect, vi } from 'vitest'
import fastify from 'fastify'
import type { FastifyRequest } from 'fastify'
import { z, type ApiTokenValidator } from '../../src/index'
import { type AnyAPIServer, bearer, DEFAULT_TOKEN, useTestServers } from '../helpers'

describe('Authentication', () => {
	const createServer = useTestServers()

	function addProtected(server: AnyAPIServer, handler = vi.fn(async () => ({ ok: true }))) {
		server.createEndpoint({
			method: 'GET',
			url: '/protected',
			authenticated: true,
			response: z.object({ ok: z.boolean() }),
			handler,
		})
		return handler
	}

	describe('static token', () => {
		it('should accept the default token when none is configured', async () => {
			const server = createServer()
			addProtected(server)

			const res = await server.instance.inject({ url: '/protected', headers: bearer(DEFAULT_TOKEN) })

			expect(res.statusCode).toBe(200)
		})

		it('should accept a configured token and reject the default one', async () => {
			const server = createServer({ apiToken: 'secret' })
			addProtected(server)

			expect((await server.instance.inject({ url: '/protected', headers: bearer('secret') })).statusCode).toBe(
				200,
			)
			expect(
				(await server.instance.inject({ url: '/protected', headers: bearer(DEFAULT_TOKEN) })).statusCode,
			).toBe(403)
		})

		it.each([
			['missing header', undefined, 401, 'Missing authorization header'],
			['wrong scheme', 'Basic abc', 401, 'Invalid authorization header format. Expected: Bearer <token>'],
			[
				'lowercase scheme',
				`bearer ${DEFAULT_TOKEN}`,
				401,
				'Invalid authorization header format. Expected: Bearer <token>',
			],
			['no token', 'Bearer', 401, 'Invalid authorization header format. Expected: Bearer <token>'],
			[
				'extra parts',
				`Bearer ${DEFAULT_TOKEN} extra`,
				401,
				'Invalid authorization header format. Expected: Bearer <token>',
			],
			[
				'double space',
				`Bearer  ${DEFAULT_TOKEN}`,
				401,
				'Invalid authorization header format. Expected: Bearer <token>',
			],
			['wrong token', 'Bearer nope', 403, 'Invalid token'],
		])('should reject %s', async (_name, authorization, statusCode, message) => {
			const server = createServer()
			const handler = addProtected(server)

			const res = await server.instance.inject({
				url: '/protected',
				headers: authorization ? { authorization } : {},
			})

			expect(res.statusCode).toBe(statusCode)
			expect(res.json()).toEqual({
				statusCode,
				error: statusCode === 401 ? 'Unauthorized' : 'Forbidden',
				message,
			})
			expect(handler).not.toHaveBeenCalled()
		})

		it('should not require auth on endpoints without authenticated: true', async () => {
			const server = createServer({ apiToken: 'secret' })
			server.createEndpoint({
				method: 'GET',
				url: '/public',
				response: z.object({}),
				handler: async () => ({}),
			})

			expect((await server.instance.inject({ url: '/public' })).statusCode).toBe(200)
		})

		it('should authenticate before validating the request', async () => {
			const server = createServer()
			server.createEndpoint({
				method: 'POST',
				url: '/protected',
				authenticated: true,
				body: z.object({ a: z.string() }),
				response: z.object({}),
				handler: async () => ({}),
			})

			// Fastify validation runs before preHandler, so a bad body without auth is a 400
			const res = await server.instance.inject({ method: 'POST', url: '/protected', payload: { a: 1 } })
			expect(res.statusCode).toBe(400)

			const unauth = await server.instance.inject({ method: 'POST', url: '/protected', payload: { a: 'x' } })
			expect(unauth.statusCode).toBe(401)
		})
	})

	describe('production defaults', () => {
		it('should not accept the development token in production', () => {
			vi.stubEnv('API_TOKEN', undefined)
			const server = createServer({ env: 'production' })

			expect(server.serverConfig.apiToken).toBeUndefined()
			expect(() => addProtected(server)).toThrow(
				'GET /protected: authenticated endpoints require apiToken (or API_TOKEN) to be set in production',
			)
			vi.unstubAllEnvs()
		})

		it('should treat any NODE_ENV other than production as development', () => {
			vi.stubEnv('NODE_ENV', 'test')
			const server = createServer()

			expect(server.serverConfig.env).toBe('development')
			expect(server.serverConfig.apiToken).toBe(DEFAULT_TOKEN)
			vi.unstubAllEnvs()
		})

		it('should use API_TOKEN in production', async () => {
			vi.stubEnv('API_TOKEN', 'prod-secret')
			const server = createServer({ env: 'production' })
			addProtected(server)

			expect(
				(await server.instance.inject({ url: '/protected', headers: bearer('prod-secret') })).statusCode,
			).toBe(200)
			expect(
				(await server.instance.inject({ url: '/protected', headers: bearer(DEFAULT_TOKEN) })).statusCode,
			).toBe(403)
			vi.unstubAllEnvs()
		})

		it('should fail closed when authenticateToken is used without a token configured', async () => {
			vi.stubEnv('API_TOKEN', undefined)
			const server = createServer({ env: 'production' })
			server.instance.register(async (scope) => {
				scope.addHook('onRequest', server.authenticateToken)
				scope.get('/admin', async () => ({ admin: true }))
			})

			const res = await server.instance.inject({ url: '/admin', headers: bearer(DEFAULT_TOKEN) })

			expect(res.statusCode).toBe(500)
			expect(res.json()).toEqual({
				statusCode: 500,
				error: 'Internal Server Error',
				message: 'Authentication is not configured',
			})
			vi.unstubAllEnvs()
		})
	})

	describe('custom validator', () => {
		it('should pass the token and request to the validator', async () => {
			const validator = vi.fn<ApiTokenValidator<{ user: string }>>(() => ({
				valid: true,
				context: { user: 'a' },
			}))
			const server = createServer<{ user: string }>({ apiToken: validator })
			addProtected(server)

			await server.instance.inject({ url: '/protected', headers: bearer('tok-123') })

			expect(validator).toHaveBeenCalledTimes(1)
			const [token, request] = validator.mock.calls[0]
			expect(token).toBe('tok-123')
			expect((request as FastifyRequest).headers.authorization).toBe('Bearer tok-123')
		})

		it('should support async validators and attach context to request.auth', async () => {
			const server = createServer<{ userId: number }>({
				apiToken: async (token) => {
					await new Promise((resolve) => setTimeout(resolve, 1))
					return token === 'good' ? { valid: true, context: { userId: 7 } } : { valid: false }
				},
			})
			server.createEndpoint({
				method: 'GET',
				url: '/me',
				authenticated: true,
				response: z.object({ userId: z.number() }),
				handler: async (request) => ({ userId: request.auth?.userId ?? -1 }),
			})

			const ok = await server.instance.inject({ url: '/me', headers: bearer('good') })
			expect(ok.statusCode).toBe(200)
			expect(ok.json()).toEqual({ userId: 7 })

			const bad = await server.instance.inject({ url: '/me', headers: bearer('bad') })
			expect(bad.statusCode).toBe(403)
			expect(bad.json()).toEqual({ statusCode: 403, error: 'Forbidden', message: 'Invalid token' })
		})

		it('should use the error message from the validator', async () => {
			const server = createServer({ apiToken: () => ({ valid: false, error: 'Token expired' }) })
			addProtected(server)

			const res = await server.instance.inject({ url: '/protected', headers: bearer('x') })

			expect(res.statusCode).toBe(403)
			expect(res.json().message).toBe('Token expired')
		})

		it('should leave request.auth undefined when no context is returned', async () => {
			const server = createServer<{ a: string }>({ apiToken: () => ({ valid: true }) })
			server.createEndpoint({
				method: 'GET',
				url: '/me',
				authenticated: true,
				response: z.object({ hasAuth: z.boolean() }),
				handler: async (request) => ({ hasAuth: request.auth !== undefined }),
			})

			const res = await server.instance.inject({ url: '/me', headers: bearer('x') })

			expect(res.json()).toEqual({ hasAuth: false })
		})

		it('should not call the validator when the header is invalid', async () => {
			const validator = vi.fn(() => ({ valid: true }))
			const server = createServer({ apiToken: validator })
			addProtected(server)

			await server.instance.inject({ url: '/protected' })
			await server.instance.inject({ url: '/protected', headers: { authorization: 'Token x' } })

			expect(validator).not.toHaveBeenCalled()
		})

		it('should return 500 when the validator throws', async () => {
			const server = createServer({
				apiToken: () => {
					throw new Error('db down')
				},
			})
			const handler = addProtected(server)

			const res = await server.instance.inject({ url: '/protected', headers: bearer('x') })

			expect(res.statusCode).toBe(500)
			expect(handler).not.toHaveBeenCalled()
		})
	})

	describe('authenticateToken as a hook', () => {
		it('should protect plain Fastify routes in a scope', async () => {
			const server = createServer({ apiToken: 'secret' })
			server.instance.register(async (scope) => {
				scope.addHook('onRequest', server.authenticateToken)
				scope.get('/admin', async () => ({ admin: true }))
			})

			expect((await server.instance.inject({ url: '/admin' })).statusCode).toBe(401)
			expect((await server.instance.inject({ url: '/admin', headers: bearer('nope') })).statusCode).toBe(403)

			const ok = await server.instance.inject({ url: '/admin', headers: bearer('secret') })
			expect(ok.statusCode).toBe(200)
			expect(ok.json()).toEqual({ admin: true })
		})

		it('should work with a user-provided Fastify instance', async () => {
			const app = fastify({ logger: false })
			const server = createServer({ fastify: app, apiToken: 'secret' })
			addProtected(server)

			expect((await app.inject({ url: '/protected' })).statusCode).toBe(401)
			expect((await app.inject({ url: '/protected', headers: bearer('secret') })).statusCode).toBe(200)
		})
	})
})
