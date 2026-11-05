import { describe, it, expect, vi, afterEach } from 'vitest'
import type { AddressInfo } from 'node:net'
import fastify from 'fastify'
import { z } from '../../src/index'
import { useTestServers } from '../helpers'

describe('Server lifecycle', () => {
	const createServer = useTestServers()

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('managed instance', () => {
		it('should listen on the configured host and port and serve requests', async () => {
			const server = createServer({ port: 0, host: '127.0.0.1' })
			const logSpy = vi.spyOn(server.instance.log, 'info')
			server.createEndpoint({
				method: 'GET',
				url: '/ping',
				response: z.object({ pong: z.boolean() }),
				handler: async () => ({ pong: true }),
			})

			await server.start()

			const address = server.instance.server.address() as AddressInfo
			expect(address.address).toBe('127.0.0.1')
			const res = await fetch(`http://127.0.0.1:${address.port}/ping`)
			expect(res.status).toBe(200)
			expect(await res.json()).toEqual({ pong: true })
			expect(logSpy).toHaveBeenCalledWith(
				{
					docs: `http://127.0.0.1:${address.port}/docs`,
					rateLimit: '100 requests per 15m',
				},
				'API server is running',
			)
		})

		it('should mention metrics in the startup message only when enabled', async () => {
			const server = createServer({ port: 0, rateLimitMax: 42, rateLimitWindow: '2m' })
			const logSpy = vi.spyOn(server.instance.log, 'info')

			await server.start()

			const [details] = logSpy.mock.calls.find(([, message]) => message === 'API server is running') ?? []
			expect(details).not.toHaveProperty('metrics')
			expect(details).toMatchObject({ rateLimit: '42 requests per 2m' })
		})

		it('should reject starting twice', async () => {
			const server = createServer({ port: 0 })

			await server.start()

			await expect(server.start()).rejects.toThrow('Server is already started')
		})

		it('should reject and log when the port is in use', async () => {
			const first = createServer({ port: 0 })
			await first.start()
			const { port } = first.instance.server.address() as AddressInfo

			const second = createServer({ port })
			const errorSpy = vi.spyOn(second.instance.log, 'error')

			await expect(second.start()).rejects.toMatchObject({ code: 'EADDRINUSE' })
			expect(errorSpy).toHaveBeenCalledWith({ err: expect.any(Error) }, 'Failed to start server')
		})

		it('should close the instance on stop and allow stopping twice', async () => {
			const server = createServer({ port: 0 })
			await server.start()
			expect(server.instance.server.listening).toBe(true)

			await server.stop()
			expect(server.instance.server.listening).toBe(false)

			await expect(server.stop()).resolves.toBeUndefined()
		})

		it('should be a no-op to stop a server that was never started', async () => {
			const server = createServer()
			const closeSpy = vi.spyOn(server.instance, 'close')

			await server.stop()

			expect(closeSpy).not.toHaveBeenCalled()
		})
	})

	describe('user-provided Fastify instance', () => {
		it('should not listen or close the provided instance', async () => {
			const app = fastify({ logger: false })
			const logSpy = vi.spyOn(app.log, 'info')
			const listenSpy = vi.spyOn(app, 'listen')
			const closeSpy = vi.spyOn(app, 'close')
			const server = createServer({ fastify: app })

			await server.start()
			expect(listenSpy).not.toHaveBeenCalled()
			expect(logSpy).toHaveBeenCalledWith(expect.any(Object), 'API server attached to Fastify instance')
			await expect(server.start()).rejects.toThrow('Server is already started')

			await server.stop()
			expect(closeSpy).not.toHaveBeenCalled()
			expect(server.instance).toBe(app)
			expect(server.serverConfig.fastify).toBe(app)
		})

		it('should register endpoints and docs on the provided instance', async () => {
			const app = fastify({ logger: false })
			const server = createServer({ fastify: app })
			server.createEndpoint({
				method: 'POST',
				url: '/echo',
				body: z.object({ msg: z.string() }),
				response: z.object({ msg: z.string() }),
				handler: async (request) => request.body,
			})
			app.get('/native', async () => ({ native: true }))

			expect((await app.inject({ method: 'POST', url: '/echo', payload: { msg: 'hi' } })).json()).toEqual({
				msg: 'hi',
			})
			expect((await app.inject({ method: 'POST', url: '/echo', payload: { msg: 1 } })).statusCode).toBe(400)
			expect((await app.inject({ url: '/native' })).json()).toEqual({ native: true })
			expect((await app.inject({ url: '/docs/json' })).json().paths).toHaveProperty('/echo')
		})

		it('should allow the user to start and stop the provided instance', async () => {
			const app = fastify({ logger: false })
			const server = createServer({ fastify: app })
			server.createEndpoint({ method: 'GET', url: '/x', response: z.object({}), handler: async () => ({}) })

			await app.listen({ port: 0, host: '127.0.0.1' })
			const { port } = app.server.address() as AddressInfo
			expect((await fetch(`http://127.0.0.1:${port}/x`)).status).toBe(200)
		})
	})

	describe('setupGracefulShutdown', () => {
		it('should register SIGINT and SIGTERM handlers that stop the server and exit', async () => {
			const handlers = new Map<string, () => Promise<void>>()
			vi.spyOn(process, 'on').mockImplementation(((event: string, handler: () => Promise<void>) => {
				handlers.set(event, handler)
				return process
			}) as typeof process.on)
			const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as typeof process.exit)

			const server = createServer({ port: 0 })
			await server.start()
			server.setupGracefulShutdown()

			expect([...handlers.keys()].filter((event) => event.startsWith('SIG')).sort()).toEqual([
				'SIGINT',
				'SIGTERM',
			])

			const stopSpy = vi.spyOn(server, 'stop')
			await handlers.get('SIGTERM')?.()

			expect(stopSpy).toHaveBeenCalledTimes(1)
			expect(server.instance.server.listening).toBe(false)
			expect(exitSpy).toHaveBeenCalledWith(0)
		})
	})
})
