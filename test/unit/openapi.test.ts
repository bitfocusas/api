import { describe, it, expect } from 'vitest'
import { z } from '../../src/index'
import { type AnyAPIServer, useTestServers } from '../helpers'

// biome-ignore lint/suspicious/noExplicitAny: OpenAPI documents are loosely typed
type OpenAPIDoc = any

describe('OpenAPI / Swagger', () => {
	const createServer = useTestServers()

	async function getSpec(server: AnyAPIServer): Promise<OpenAPIDoc> {
		const res = await server.instance.inject({ url: '/docs/json' })
		expect(res.statusCode).toBe(200)
		return res.json()
	}

	describe('document metadata', () => {
		it('should use defaults for info and security schemes', async () => {
			const server = createServer({ env: 'production' })
			const spec = await getSpec(server)

			expect(spec.openapi).toBe('3.1.0')
			expect(spec.info).toEqual({
				title: 'API Documentation',
				description: 'API built with Fastify, Zod, and TypeScript',
				version: '1.0.0',
			})
			expect(spec.components.securitySchemes).toEqual({
				bearerAuth: {
					type: 'http',
					scheme: 'bearer',
					bearerFormat: 'JWT',
					description: 'Enter your bearer token',
				},
			})
			expect(spec.servers).toEqual([{ url: '/', description: 'Production server' }])
		})

		it('should use custom title, description, version and tags', async () => {
			const tags = [
				{ name: 'Users', description: 'User things' },
				{ name: 'Admin', description: 'Admin things' },
			]
			const server = createServer({
				apiTitle: 'My API',
				apiDescription: 'Does stuff',
				apiVersion: '2.3.4',
				apiTags: tags,
			})
			const spec = await getSpec(server)

			expect(spec.info).toEqual({ title: 'My API', description: 'Does stuff', version: '2.3.4' })
			expect(spec.tags).toEqual(tags)
		})

		it('should advertise a localhost server in development', async () => {
			const server = createServer({ env: 'development', port: 4567 })
			const spec = await getSpec(server)

			expect(spec.servers).toEqual([{ url: 'http://localhost:4567', description: 'Development server' }])
		})
	})

	describe('operations', () => {
		it('should generate operationIds from url and method', async () => {
			const server = createServer()
			server.createEndpoint({
				method: 'GET',
				url: '/thing/get_v1',
				response: z.object({}),
				handler: async () => ({}),
			})
			server.createEndpoint({
				method: 'POST',
				url: '/Users/Create',
				response: z.object({}),
				handler: async () => ({}),
			})
			server.createEndpoint({
				method: 'DELETE',
				url: '/users/:id',
				params: z.object({ id: z.string() }),
				response: z.object({}),
				handler: async () => ({}),
			})
			const spec = await getSpec(server)

			expect(spec.paths['/thing/get_v1'].get.operationId).toBe('thing_get_v1_get')
			expect(spec.paths['/Users/Create'].post.operationId).toBe('users_create_post')
			// Path params are kept verbatim in the generated id
			expect(spec.paths['/users/{id}'].delete.operationId).toBe('users_:id_delete')
		})

		it('should allow overriding operationId and set route metadata', async () => {
			const server = createServer()
			server.createEndpoint({
				method: 'GET',
				url: '/meta',
				response: z.object({}),
				config: {
					operationId: 'customOp',
					description: 'A description',
					summary: 'A summary',
					tags: ['Tag1', 'Tag2'],
					deprecated: true,
				},
				handler: async () => ({}),
			})
			const op = (await getSpec(server)).paths['/meta'].get

			expect(op).toMatchObject({
				operationId: 'customOp',
				description: 'A description',
				summary: 'A summary',
				tags: ['Tag1', 'Tag2'],
				deprecated: true,
			})
		})

		it('should document query and path parameters', async () => {
			const server = createServer()
			server.createEndpoint({
				method: 'GET',
				url: '/items/:id',
				params: z.object({ id: z.string().describe('Item id') }),
				query: z.object({ limit: z.coerce.number().default(10), q: z.string() }),
				response: z.object({}),
				handler: async () => ({}),
			})
			const params = (await getSpec(server)).paths['/items/{id}'].get.parameters

			expect(params).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ in: 'path', name: 'id', required: true }),
					expect.objectContaining({ in: 'query', name: 'limit', required: false }),
					expect.objectContaining({ in: 'query', name: 'q', required: true }),
				]),
			)
			expect(params).toHaveLength(3)
		})

		it('should document a strict request body for non-GET methods', async () => {
			const server = createServer()
			server.createEndpoint({
				method: 'PUT',
				url: '/things',
				body: z.object({ name: z.string(), count: z.number().optional() }),
				response: z.object({}),
				handler: async () => ({}),
			})
			const op = (await getSpec(server)).paths['/things'].put

			expect(op.requestBody.required).toBe(true)
			expect(op.requestBody.content['application/json'].schema).toEqual({
				type: 'object',
				properties: { name: { type: 'string' }, count: { type: 'number' } },
				required: ['name'],
				additionalProperties: false,
			})
		})

		it('should document 200, 400 and 500 responses for public endpoints', async () => {
			const server = createServer()
			server.createEndpoint({
				method: 'GET',
				url: '/public',
				response: z.object({ ok: z.boolean() }),
				handler: async () => ({ ok: true }),
			})
			const op = (await getSpec(server)).paths['/public'].get

			expect(Object.keys(op.responses).sort()).toEqual(['200', '400', '500'])
			expect(op.responses['200'].content['application/json'].schema).toEqual({
				type: 'object',
				properties: { ok: { type: 'boolean' } },
				required: ['ok'],
				additionalProperties: false,
			})
			expect(op.responses['400'].description).toBe('Validation error')
			expect(op.responses['500'].description).toBe('Internal server error')
			expect(op.responses['400'].content['application/json'].schema.required).toEqual([
				'statusCode',
				'error',
				'message',
			])
			expect(op.responses['400'].content['application/json'].schema.properties.details).toMatchObject({
				type: 'array',
				items: { type: 'object', required: ['field', 'message'] },
			})
			expect(op.security).toBeUndefined()
		})

		it('should document 401, 403 and bearer security for authenticated endpoints', async () => {
			const server = createServer()
			server.createEndpoint({
				method: 'GET',
				url: '/private',
				authenticated: true,
				response: z.object({}),
				handler: async () => ({}),
			})
			const op = (await getSpec(server)).paths['/private'].get

			expect(Object.keys(op.responses).sort()).toEqual(['200', '400', '401', '403', '500'])
			expect(op.responses['401'].description).toBe('Unauthorized - Missing or invalid authorization header')
			expect(op.responses['403'].description).toBe('Forbidden - Invalid or expired token')
			expect(op.security).toEqual([{ bearerAuth: [] }])
		})

		it('should document non-object response schemas', async () => {
			const server = createServer()
			server.createEndpoint({
				method: 'GET',
				url: '/list',
				response: z.array(z.string()),
				handler: async () => [],
			})
			const op = (await getSpec(server)).paths['/list'].get

			expect(op.responses['200'].content['application/json'].schema).toEqual({
				type: 'array',
				items: { type: 'string' },
			})
		})

		it('should not include docs or metrics routes in the spec', async () => {
			const server = createServer()
			server.createEndpoint({
				method: 'GET',
				url: '/only',
				response: z.object({}),
				handler: async () => ({}),
			})
			const spec = await getSpec(server)

			expect(Object.keys(spec.paths)).toEqual(['/only'])
		})
	})

	describe('Swagger UI', () => {
		it('should serve the UI at /docs', async () => {
			const server = createServer()
			const res = await server.instance.inject({ url: '/docs' })

			expect(res.statusCode).toBe(200)
			expect(res.headers['content-type']).toContain('text/html')
			expect(res.body).toContain('swagger')
		})

		it('should serve the spec as YAML', async () => {
			const server = createServer()
			const res = await server.instance.inject({ url: '/docs/yaml' })

			expect(res.statusCode).toBe(200)
			expect(res.headers['content-type']).toContain('yaml')
			expect(res.body).toContain('openapi: 3.1.0')
		})

		it('should serve static assets with a CSP header', async () => {
			const server = createServer()
			const res = await server.instance.inject({ url: '/docs/static/swagger-ui.css' })

			expect(res.statusCode).toBe(200)
			expect(res.headers['content-security-policy']).toContain("default-src 'self'")
		})
	})
})
