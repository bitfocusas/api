// Smoke test for the compiled package, loaded the way consumers load it (CommonJS require of dist/).
// This catches problems vitest can't see, such as a dependency becoming ESM-only. Run after `yarn build`.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const pkg = require('../../package.json')
const root = path.join(__dirname, '../..')

async function main() {
	assert.ok(fs.existsSync(path.join(root, pkg.main)), `missing ${pkg.main}`)
	assert.ok(fs.existsSync(path.join(root, pkg.types)), `missing ${pkg.types}`)

	const lib = require(path.join(root, pkg.main))
	for (const name of ['APIServer', 'z', 'ValidationError', 'NotFoundError', 'ResponseValidationError']) {
		assert.ok(lib[name], `missing export ${name}`)
	}

	const { APIServer, z } = lib
	const server = new APIServer({ loadEnv: false, logLevel: 'error', metricsEnabled: true, apiToken: 'secret' })
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

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
