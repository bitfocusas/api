import { afterEach } from 'vitest'
import { APIServer, type APIServerConfig } from '../src/index'

export const DEFAULT_TOKEN = 'development-token-change-in-production'

/** A non-allowlisted address, so the rate limiter applies to injected requests */
export const REMOTE_IP = '10.0.0.1'

// biome-ignore lint/suspicious/noExplicitAny: accept servers with any auth context
export type AnyAPIServer = APIServer<any>

/**
 * Create servers with deterministic defaults (logging is silenced via LOG_LEVEL in vitest.config.mts) and close them after each test.
 * Requests are made with `instance.inject()`, so no ports are bound.
 */
export function useTestServers() {
	const servers: AnyAPIServer[] = []

	afterEach(async () => {
		for (const server of servers.splice(0)) {
			await server.instance.close()
		}
	})

	return function createServer<TAuthContext = undefined>(
		config: APIServerConfig<TAuthContext> = {},
	): APIServer<TAuthContext> {
		const server = new APIServer<TAuthContext>({
			metricsEnabled: false,
			...config,
		})
		servers.push(server)
		return server
	}
}

export function bearer(token: string = DEFAULT_TOKEN) {
	return { authorization: `Bearer ${token}` }
}
