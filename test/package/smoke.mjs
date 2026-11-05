// Smoke test for the compiled package, loaded the way consumers load it (by package name, via its exports).
// This catches problems vitest can't see, such as broken ESM interop with a CommonJS dependency.
// Run after `yarn build`.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

async function main() {
	// Self-reference by package name, so the `exports` map is what gets tested
	const lib = await import('@bitfocusas/api')
	for (const name of ['APIServer', 'z', 'ValidationError', 'NotFoundError', 'ResponseValidationError']) {
		assert.ok(lib[name], `missing export ${name}`)
	}

	// CommonJS consumers can require() the ESM build on Node 24+
	assert.equal(require('@bitfocusas/api').APIServer, lib.APIServer)

	const { APIServer, z } = lib
	const server = new APIServer({ logLevel: 'error', metricsEnabled: true, apiToken: 'secret' })
	server.createEndpoint({
		method: 'POST',
		url: '/echo/:id',
		params: z.object({ id: z.coerce.number() }),
		body: z.object({ msg: z.string() }),
		response: z.object({ id: z.number(), msg: z.string() }),
		authenticated: true,
		handler: async (request) => ({ id: request.params.id, msg: request.body.msg }),
	})

	try {
		const auth = { authorization: 'Bearer secret' }
		let res = await server.instance.inject({
			method: 'POST',
			url: '/echo/5',
			payload: { msg: 'hi' },
			headers: auth,
		})
		assert.equal(res.statusCode, 200, res.body)
		assert.deepEqual(res.json(), { id: 5, msg: 'hi' })

		res = await server.instance.inject({ method: 'POST', url: '/echo/5', payload: { msg: 1 }, headers: auth })
		assert.equal(res.statusCode, 400)

		res = await server.instance.inject({ method: 'POST', url: '/echo/5', payload: { msg: 'hi' } })
		assert.equal(res.statusCode, 401)

		res = await server.instance.inject({ url: '/docs/json' })
		assert.equal(res.statusCode, 200)
		assert.ok(res.json().paths['/echo/{id}'])

		res = await server.instance.inject({ url: '/metrics' })
		assert.equal(res.statusCode, 200)
	} finally {
		await server.instance.close()
	}

	console.log('dist smoke test passed')
}

await main()
