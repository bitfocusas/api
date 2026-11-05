import { describe, it, expect } from 'vitest'
import { z as zod } from 'zod'
import * as lib from '../../src/index'

describe('Public exports', () => {
	it('should export the documented runtime API', () => {
		expect(Object.keys(lib).sort()).toEqual(
			[
				'APIServer',
				'ErrorResponseSchema',
				'NotFoundError',
				'ResponseValidationError',
				'ValidationError',
				'createStandardResponses',
				'z',
			].sort(),
		)
	})

	it('should re-export the same zod instance as the peer dependency', () => {
		expect(lib.z).toBe(zod)
		expect(lib.z.object({}) instanceof zod.ZodObject).toBe(true)
	})
})
