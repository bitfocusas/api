import { describe, it, expect, vi, afterEach } from 'vitest'
import { config as dotenvConfig } from 'dotenv'
import { z } from '../../src/index'
import { REMOTE_IP, useTestServers } from '../helpers'

vi.mock('dotenv', () => ({ config: vi.fn() }))

describe('Configuration', () => {
	const createServer = useTestServers()

	afterEach(() => {
		vi.unstubAllEnvs()
		vi.mocked(dotenvConfig).mockClear()
	})

	describe('defaults', () => {
		it('should use built-in defaults when no config or env vars are set', () => {
			for (const key of [
				'PORT',
				'HOST',
				'LOG_LEVEL',
				'CORS_ORIGIN',
				'API_TOKEN',
				'RATE_LIMIT_MAX',
				'RATE_LIMIT_WINDOW',
				'METRICS_ENABLED',
			]) {
				vi.stubEnv(key, undefined)
			}
			vi.stubEnv('NODE_ENV', undefined)

			const server = createServer({ logLevel: undefined })

			expect(server.serverConfig).toMatchObject({
				port: 3000,
				host: '127.0.0.1',
				env: 'development',
				logLevel: 'info',
				corsOrigin: '*',
				apiToken: 'development-token-change-in-production',
				rateLimitMax: 100,
				rateLimitWindow: '15m',
				rateLimitAllow: [],
				apiTitle: 'API Documentation',
				apiDescription: 'API built with Fastify, Zod, and TypeScript',
				apiVersion: '1.0.0',
				apiTags: [],
			})
			expect(server.serverConfig.trustProxy).toBeUndefined()
			expect(server.serverConfig.fastify).toBeUndefined()
		})

		it('should enable metrics by default', () => {
			vi.stubEnv('METRICS_ENABLED', undefined)
			// The only metrics-enabled server in this file (prom-client uses a global registry)
			const server = createServer({ metricsEnabled: undefined })
			expect(server.serverConfig.metricsEnabled).toBe(true)
		})
	})

	describe('environment variables', () => {
		it('should read settings from environment variables', () => {
			vi.stubEnv('PORT', '8080')
			vi.stubEnv('HOST', '0.0.0.0')
			vi.stubEnv('NODE_ENV', 'production')
			vi.stubEnv('LOG_LEVEL', 'warn')
			vi.stubEnv('CORS_ORIGIN', 'https://example.com')
			vi.stubEnv('API_TOKEN', 'env-token')
			vi.stubEnv('RATE_LIMIT_MAX', '5')
			vi.stubEnv('RATE_LIMIT_WINDOW', '1h')
			vi.stubEnv('METRICS_ENABLED', 'false')

			const server = createServer({ logLevel: undefined, metricsEnabled: undefined })

			expect(server.serverConfig).toMatchObject({
				port: 8080,
				host: '0.0.0.0',
				env: 'production',
				logLevel: 'warn',
				corsOrigin: 'https://example.com',
				apiToken: 'env-token',
				rateLimitMax: 5,
				rateLimitWindow: '1h',
				metricsEnabled: false,
			})
		})

		it('should prefer explicit config over environment variables', () => {
			vi.stubEnv('PORT', '8080')
			vi.stubEnv('HOST', '0.0.0.0')
			vi.stubEnv('API_TOKEN', 'env-token')
			vi.stubEnv('RATE_LIMIT_MAX', '5')

			const server = createServer({ port: 9000, host: 'localhost', apiToken: 'cfg-token', rateLimitMax: 50 })

			expect(server.serverConfig).toMatchObject({
				port: 9000,
				host: 'localhost',
				apiToken: 'cfg-token',
				rateLimitMax: 50,
			})
		})

		it('should use API_TOKEN from the environment for authentication', async () => {
			vi.stubEnv('API_TOKEN', 'from-env')
			const server = createServer()
			server.createEndpoint({
				method: 'GET',
				url: '/p',
				authenticated: true,
				response: z.object({}),
				handler: async () => ({}),
			})

			const res = await server.instance.inject({ url: '/p', headers: { authorization: 'Bearer from-env' } })
			expect(res.statusCode).toBe(200)
		})

		it('should use RATE_LIMIT_MAX from the environment', async () => {
			vi.stubEnv('RATE_LIMIT_MAX', '1')
			const server = createServer()
			server.createEndpoint({
				method: 'GET',
				url: '/r',
				response: z.object({}),
				handler: async () => ({}),
			})

			expect((await server.instance.inject({ url: '/r', remoteAddress: REMOTE_IP })).statusCode).toBe(200)
			expect((await server.instance.inject({ url: '/r', remoteAddress: REMOTE_IP })).statusCode).toBe(429)
		})

		it('should not serve /metrics when METRICS_ENABLED=false', async () => {
			vi.stubEnv('METRICS_ENABLED', 'false')
			const server = createServer({ metricsEnabled: undefined })

			expect((await server.instance.inject({ url: '/metrics' })).statusCode).toBe(404)
		})
	})

	describe('dotenv', () => {
		it('should load .env by default', () => {
			createServer({ loadEnv: undefined })
			expect(dotenvConfig).toHaveBeenCalledTimes(1)
		})

		it('should not load .env when loadEnv is false', () => {
			createServer({ loadEnv: false })
			expect(dotenvConfig).not.toHaveBeenCalled()
		})
	})

	describe('logger', () => {
		it('should apply the configured log level', () => {
			const server = createServer({ logLevel: 'warn' })
			expect(server.instance.log.level).toBe('warn')
		})

		it('should start in development mode with pretty logging', async () => {
			const server = createServer({ env: 'development', logLevel: 'error' })
			await server.instance.ready()
			expect(server.serverConfig.env).toBe('development')
		})
	})

	describe('CORS', () => {
		it('should allow any origin by default', async () => {
			const server = createServer()
			server.createEndpoint({ method: 'GET', url: '/c', response: z.object({}), handler: async () => ({}) })

			const res = await server.instance.inject({ url: '/c', headers: { origin: 'https://anywhere.test' } })

			expect(res.headers['access-control-allow-origin']).toBe('*')
		})

		it('should answer preflight requests', async () => {
			const server = createServer()
			server.createEndpoint({ method: 'POST', url: '/c', response: z.object({}), handler: async () => ({}) })

			const res = await server.instance.inject({
				method: 'OPTIONS',
				url: '/c',
				headers: { origin: 'https://anywhere.test', 'access-control-request-method': 'POST' },
			})

			expect(res.statusCode).toBe(204)
			expect(res.headers['access-control-allow-origin']).toBe('*')
			expect(res.headers['access-control-allow-methods']).toContain('POST')
		})

		it('should restrict to a configured origin', async () => {
			const server = createServer({ corsOrigin: 'https://allowed.test' })
			server.createEndpoint({ method: 'GET', url: '/c', response: z.object({}), handler: async () => ({}) })

			const res = await server.instance.inject({ url: '/c', headers: { origin: 'https://other.test' } })

			expect(res.headers['access-control-allow-origin']).toBe('https://allowed.test')
		})
	})

	describe('trustProxy', () => {
		it('should resolve the client ip from X-Forwarded-For when enabled', async () => {
			const server = createServer({ trustProxy: true })
			server.instance.get('/ip', async (request) => ({ ip: request.ip }))

			const res = await server.instance.inject({ url: '/ip', headers: { 'x-forwarded-for': '203.0.113.5' } })

			expect(res.json()).toEqual({ ip: '203.0.113.5' })
			expect(server.serverConfig.trustProxy).toBe(true)
		})

		it('should ignore X-Forwarded-For by default', async () => {
			const server = createServer()
			server.instance.get('/ip', async (request) => ({ ip: request.ip }))

			const res = await server.instance.inject({ url: '/ip', headers: { 'x-forwarded-for': '203.0.113.5' } })

			expect(res.json()).toEqual({ ip: '127.0.0.1' })
		})
	})
})
