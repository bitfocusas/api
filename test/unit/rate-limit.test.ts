import { describe, it, expect } from 'vitest'
import { z } from '../../src/index'
import { type AnyAPIServer, REMOTE_IP, useTestServers } from '../helpers'

describe('Rate limiting', () => {
	const createServer = useTestServers()

	function addEndpoint(server: AnyAPIServer, url: string, rateLimit?: false | { max: number; timeWindow?: string }) {
		server.createEndpoint({
			method: 'GET',
			url,
			response: z.object({ ok: z.boolean() }),
			rateLimit,
			handler: async () => ({ ok: true }),
		})
	}

	async function hit(server: AnyAPIServer, url: string, count: number, remoteAddress = REMOTE_IP) {
		const codes: number[] = []
		for (let i = 0; i < count; i++) {
			codes.push((await server.instance.inject({ url, remoteAddress })).statusCode)
		}
		return codes
	}

	it('should apply the global limit', async () => {
		const server = createServer({ rateLimitMax: 2, rateLimitWindow: '1m' })
		addEndpoint(server, '/limited')

		expect(await hit(server, '/limited', 4)).toEqual([200, 200, 429, 429])
	})

	it('should return a 429 body and draft-spec rate limit headers', async () => {
		const server = createServer({ rateLimitMax: 1, rateLimitWindow: '1m' })
		addEndpoint(server, '/limited')

		const ok = await server.instance.inject({ url: '/limited', remoteAddress: REMOTE_IP })
		expect(ok.headers).toMatchObject({
			'ratelimit-limit': '1',
			'ratelimit-remaining': '0',
			'ratelimit-reset': '60',
		})

		const limited = await server.instance.inject({ url: '/limited', remoteAddress: REMOTE_IP })
		expect(limited.statusCode).toBe(429)
		expect(limited.headers).toMatchObject({ 'ratelimit-limit': '1', 'retry-after': '60' })
		expect(limited.json()).toEqual({
			statusCode: 429,
			error: 'Too Many Requests',
			message: 'Rate limit exceeded, retry in 1 minute',
		})
	})

	it('should track clients independently', async () => {
		const server = createServer({ rateLimitMax: 1, rateLimitWindow: '1m' })
		addEndpoint(server, '/limited')

		expect(await hit(server, '/limited', 2, '10.0.0.1')).toEqual([200, 429])
		expect(await hit(server, '/limited', 1, '10.0.0.2')).toEqual([200])
	})

	it('should always allow 127.0.0.1', async () => {
		const server = createServer({ rateLimitMax: 1, rateLimitWindow: '1m' })
		addEndpoint(server, '/limited')

		expect(await hit(server, '/limited', 3, '127.0.0.1')).toEqual([200, 200, 200])
	})

	it('should allow addresses in rateLimitAllow', async () => {
		const server = createServer({ rateLimitMax: 1, rateLimitWindow: '1m', rateLimitAllow: ['10.9.9.9'] })
		addEndpoint(server, '/limited')

		expect(await hit(server, '/limited', 3, '10.9.9.9')).toEqual([200, 200, 200])
		expect(await hit(server, '/limited', 2, REMOTE_IP)).toEqual([200, 429])
	})

	it('should apply a per-endpoint limit', async () => {
		const server = createServer({ rateLimitMax: 100, rateLimitWindow: '1m' })
		addEndpoint(server, '/strict', { max: 1 })
		addEndpoint(server, '/normal')

		expect(await hit(server, '/strict', 2)).toEqual([200, 429])
		expect(await hit(server, '/normal', 2)).toEqual([200, 200])
	})

	it('should apply a per-endpoint time window', async () => {
		const server = createServer({ rateLimitMax: 100, rateLimitWindow: '1m' })
		addEndpoint(server, '/hourly', { max: 1, timeWindow: '1h' })

		const res = await server.instance.inject({ url: '/hourly', remoteAddress: REMOTE_IP })
		expect(res.headers['ratelimit-limit']).toBe('1')
		expect(res.headers['ratelimit-reset']).toBe('3600')
	})

	it('should disable limiting for an endpoint with rateLimit: false', async () => {
		const server = createServer({ rateLimitMax: 1, rateLimitWindow: '1m' })
		addEndpoint(server, '/unlimited', false)

		expect(await hit(server, '/unlimited', 3)).toEqual([200, 200, 200])
		const res = await server.instance.inject({ url: '/unlimited', remoteAddress: REMOTE_IP })
		expect(res.headers['ratelimit-limit']).toBeUndefined()
	})

	it('should use X-Forwarded-For when trustProxy is enabled', async () => {
		const server = createServer({ rateLimitMax: 1, rateLimitWindow: '1m', trustProxy: true })
		addEndpoint(server, '/limited')

		// Coming via a local proxy, but the real client address is not allowlisted
		const request = { url: '/limited', remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': '10.1.1.1' } }
		expect((await server.instance.inject(request)).statusCode).toBe(200)
		expect((await server.instance.inject(request)).statusCode).toBe(429)
	})

	it('should ignore X-Forwarded-For when trustProxy is not set', async () => {
		const server = createServer({ rateLimitMax: 1, rateLimitWindow: '1m' })
		addEndpoint(server, '/limited')

		const request = { url: '/limited', remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': '10.1.1.1' } }
		expect((await server.instance.inject(request)).statusCode).toBe(200)
		expect((await server.instance.inject(request)).statusCode).toBe(200)
	})
})
