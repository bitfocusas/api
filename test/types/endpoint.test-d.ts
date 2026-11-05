import { describe, it, expectTypeOf } from 'vitest'
import type { FastifyInstance, FastifyReply } from 'fastify'
import {
	APIServer,
	createStandardResponses,
	type ErrorResponseSchema,
	z,
	type APIServerConfig,
	type ApiTokenValidator,
	type AuthValidationResult,
	type EndpointConfig,
} from '../../src/index'

describe('createEndpoint type inference', () => {
	const server = new APIServer()

	it('should infer query, body and params from schemas', () => {
		server.createEndpoint({
			method: 'POST',
			url: '/items/:id',
			params: z.object({ id: z.coerce.number() }),
			query: z.object({ verbose: z.boolean().optional(), limit: z.coerce.number().default(10) }),
			body: z.object({ name: z.string(), tags: z.array(z.string()) }),
			response: z.object({ ok: z.boolean() }),
			handler: async (request, reply) => {
				expectTypeOf(request.params).toEqualTypeOf<{ id: number }>()
				expectTypeOf(request.query).toEqualTypeOf<{ verbose?: boolean | undefined; limit: number }>()
				expectTypeOf(request.body).toEqualTypeOf<{ name: string; tags: string[] }>()
				expectTypeOf(reply).toEqualTypeOf<FastifyReply>()
				return { ok: true }
			},
		})
	})

	it('should infer undefined for omitted schemas', () => {
		server.createEndpoint({
			method: 'GET',
			url: '/plain',
			response: z.object({}),
			handler: async (request) => {
				expectTypeOf(request.query).toEqualTypeOf<undefined>()
				expectTypeOf(request.body).toEqualTypeOf<undefined>()
				expectTypeOf(request.params).toEqualTypeOf<undefined>()
				return {}
			},
		})
	})

	it('should require the handler to return the response type', () => {
		server.createEndpoint({
			method: 'GET',
			url: '/typed',
			response: z.object({ id: z.string() }),
			// @ts-expect-error - id must be a string
			handler: async () => ({ id: 1 }),
		})

		server.createEndpoint({
			method: 'GET',
			url: '/array',
			response: z.array(z.number()),
			handler: async () => [1, 2],
		})
	})

	it('should only allow supported methods', () => {
		server.createEndpoint({
			// @ts-expect-error - HEAD is not supported
			method: 'HEAD',
			url: '/x',
			response: z.object({}),
			handler: async () => ({}),
		})
	})

	it('should type rateLimit options', () => {
		expectTypeOf<EndpointConfig['rateLimit']>().toEqualTypeOf<
			false | { max: number; timeWindow?: string } | undefined
		>()
	})
})

describe('auth context typing', () => {
	type Ctx = { userId: string; roles: string[] }

	it('should type request.auth from the validator', () => {
		const validator: ApiTokenValidator<Ctx> = async (token) => ({
			valid: token.length > 0,
			context: { userId: token, roles: [] },
		})
		const server = new APIServer<Ctx>({ apiToken: validator })

		server.createEndpoint({
			method: 'GET',
			url: '/me',
			authenticated: true,
			response: z.object({ userId: z.string() }),
			handler: async (request) => {
				expectTypeOf(request.auth).toEqualTypeOf<Ctx | undefined>()
				return { userId: request.auth?.userId ?? '' }
			},
		})
	})

	it('should accept sync and async validators', () => {
		expectTypeOf<() => AuthValidationResult<Ctx>>().toExtend<ApiTokenValidator<Ctx>>()
		expectTypeOf<() => Promise<AuthValidationResult<Ctx>>>().toExtend<ApiTokenValidator<Ctx>>()
	})

	it('should accept a string token or validator in config', () => {
		expectTypeOf<APIServerConfig<Ctx>['apiToken']>().toEqualTypeOf<string | ApiTokenValidator<Ctx> | undefined>()
	})
})

describe('server API types', () => {
	it('should expose the Fastify instance and lifecycle methods', () => {
		const server = new APIServer()
		expectTypeOf(server.instance).toEqualTypeOf<FastifyInstance>()
		expectTypeOf(server.start).returns.toEqualTypeOf<Promise<void>>()
		expectTypeOf(server.stop).returns.toEqualTypeOf<Promise<void>>()
		expectTypeOf(server.serverConfig.port).toEqualTypeOf<number>()
	})

	it('should merge standard error responses', () => {
		const responses = createStandardResponses({ 200: z.object({ ok: z.boolean() }) })
		expectTypeOf(responses[400]).toEqualTypeOf<typeof ErrorResponseSchema>()
		expectTypeOf(responses[500]).toEqualTypeOf<typeof ErrorResponseSchema>()
		expectTypeOf<z.infer<(typeof responses)[200]>>().toEqualTypeOf<{ ok: boolean }>()
	})
})
