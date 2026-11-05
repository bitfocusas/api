import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { APIServer, z } from '../../src/index'

// fastify-metrics uses prom-client's global registry, so only one metrics-enabled
// server can exist per process. Share a single instance for this file.
describe('Prometheus metrics', () => {
	let server: APIServer

	beforeAll(async () => {
		server = new APIServer({ logLevel: 'error', loadEnv: false, metricsEnabled: true })
		server.createEndpoint({
			method: 'GET',
			url: '/items/:id',
			params: z.object({ id: z.string() }),
			response: z.object({ id: z.string() }),
			handler: async (request) => ({ id: request.params.id }),
		})
		await server.instance.ready()
	})

	afterAll(async () => {
		await server.instance.close()
	})

	it('should serve metrics in Prometheus text format', async () => {
		const res = await server.instance.inject({ url: '/metrics' })

		expect(res.statusCode).toBe(200)
		expect(res.headers['content-type']).toContain('text/plain')
		expect(res.body).toContain('# HELP')
		expect(res.body).toContain('process_cpu_user_seconds_total')
	})

	it('should record route metrics by route pattern with grouped status codes', async () => {
		await server.instance.inject({ url: '/items/1' })
		await server.instance.inject({ url: '/items/2' })

		const res = await server.instance.inject({ url: '/metrics' })

		expect(res.body).toMatch(
			/http_request_duration_seconds_count\{method="GET",route="\/items\/:id",status_code="2xx"\} 2/,
		)
		expect(res.body).toContain('http_request_summary_seconds')
	})

	it('should not record metrics for unregistered routes', async () => {
		await server.instance.inject({ url: '/does-not-exist' })

		const res = await server.instance.inject({ url: '/metrics' })

		expect(res.body).not.toContain('/does-not-exist')
	})

	it('should not list /metrics in the OpenAPI spec', async () => {
		const spec = (await server.instance.inject({ url: '/docs/json' })).json()

		expect(Object.keys(spec.paths)).toEqual(['/items/{id}'])
	})
})
