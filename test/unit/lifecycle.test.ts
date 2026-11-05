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
			const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
			const server = createServer({ port: 0, host: '127.0.0.1' })
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
			expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Server is running'))
		})

		it('should mention metrics in the startup message only when enabled', async () => {
			const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
			const server = createServer({ port: 0, rateLimitMax: 42, rateLimitWindow: '2m' })

			await server.start()

			const message = logSpy.mock.calls.flat().join('\n')
			expect(message).not.toContain('Metrics')
			expect(message).toContain('42 requests per 2m')
		})

		it('should reject starting twice', async () => {
			vi.spyOn(console, 'log').mockImplementation(() => {})
			const server = createServer({ port: 0 })

			await server.start()

			await expect(server.start()).rejects.toThrow('Server is already started')
		})

		it('should reject and log when the port is in use', async () => {
			vi.spyOn(console, 'log').mockImplementation(() => {})
			const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
			const first = createServer({ port: 0 })
			await first.start()
			const { port } = first.instance.server.address() as AddressInfo

			const second = createServer({ port })

			await expect(second.start()).rejects.toMatchObject({ code: 'EADDRINUSE' })
			expect(errorSpy).toHaveBeenCalledWith('Failed to start server:', expect.anything())
		})

		it('should close the instance on stop and allow stopping twice', async () => {
			vi.spyOn(console, 'log').mockImplementation(() => {})
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
			const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
			const app = fastify({ logger: false })
			const listenSpy = vi.spyOn(app, 'listen')
			const closeSpy = vi.spyOn(app, 'close')
			const server = createServer({ fastify: app })

			await server.start()
			expect(listenSpy).not.toHaveBeenCalled()
			expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('attached to your Fastify instance'))
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
			vi.spyOn(console, 'log').mockImplementation(() => {})
			const handlers = new Map<string, () => Promise<void>>()
			vi.spyOn(process, 'on').mockImplementation(((event: string, handler: () => Promise<void>) => {
				handlers.set(event, handler)
				return process
			}) as typeof process.on)
			const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as typeof process.exit)

			const server = createServer({ port: 0 })
			await server.start()
			server.setupGracefulShutdown()

			expect([...handlers.keys()].sort()).toEqual(['SIGINT', 'SIGTERM'])

			const stopSpy = vi.spyOn(server, 'stop')
			await handlers.get('SIGTERM')?.()

			expect(stopSpy).toHaveBeenCalledTimes(1)
			expect(server.instance.server.listening).toBe(false)
			expect(exitSpy).toHaveBeenCalledWith(0)
		})
	})
})
