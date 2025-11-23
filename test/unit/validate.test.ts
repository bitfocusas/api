import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
	ValidationError,
	ResponseValidationError,
	NotFoundError,
	ErrorResponseSchema,
	createStandardResponses,
} from '../../src/validate'

describe('validate.ts', () => {
	describe('ErrorResponseSchema', () => {
		it('should validate a valid error response', () => {
			const validError = {
				statusCode: 400,
				error: 'Bad Request',
				message: 'Validation failed',
			}

			const result = ErrorResponseSchema.safeParse(validError)
			expect(result.success).toBe(true)
		})

		it('should validate error response with optional code', () => {
			const validError = {
				statusCode: 500,
				code: 'INTERNAL_ERROR',
				error: 'Internal Server Error',
				message: 'Something went wrong',
			}

			const result = ErrorResponseSchema.safeParse(validError)
			expect(result.success).toBe(true)
		})

		it('should reject invalid error response', () => {
			const invalidError = {
				statusCode: 'not-a-number',
				error: 'Bad Request',
			}

			const result = ErrorResponseSchema.safeParse(invalidError)
			expect(result.success).toBe(false)
		})
	})

	describe('createStandardResponses', () => {
		it('should create standard responses with 400 and 500 error schemas', () => {
			const SuccessSchema = z.object({ data: z.string() })
			const responses = createStandardResponses({
				200: SuccessSchema,
			})

			expect(responses[200]).toBe(SuccessSchema)
			expect(responses[400]).toBeDefined()
			expect(responses[500]).toBeDefined()
		})

		it('should include multiple success response codes', () => {
			const CreateSchema = z.object({ id: z.string() })
			const GetSchema = z.object({ data: z.array(z.any()) })

			const responses = createStandardResponses({
				200: GetSchema,
				201: CreateSchema,
			})

			expect(responses[200]).toBe(GetSchema)
			expect(responses[201]).toBe(CreateSchema)
			expect(responses[400]).toBeDefined()
			expect(responses[500]).toBeDefined()
		})
	})

	describe('ValidationError', () => {
		it('should create ValidationError with details', () => {
			const details = [
				{ field: 'email', message: 'Invalid email format' },
				{ field: 'age', message: 'Must be a positive number' },
			]

			const error = new ValidationError(details)

			expect(error.name).toBe('ValidationError')
			expect(error.message).toBe('Validation failed')
			expect(error.statusCode).toBe(400)
			expect(error.details).toEqual(details)
		})

		it('should be instance of Error', () => {
			const error = new ValidationError([])
			expect(error).toBeInstanceOf(Error)
		})

		it('should have correct statusCode', () => {
			const error = new ValidationError([{ field: 'test', message: 'test message' }])
			expect(error.statusCode).toBe(400)
		})
	})

	describe('ResponseValidationError', () => {
		it('should create ResponseValidationError with details', () => {
			const details = [
				{ field: 'userId', message: 'Required' },
				{ field: 'createdAt', message: 'Invalid date format' },
			]

			const error = new ResponseValidationError(details)

			expect(error.name).toBe('ResponseValidationError')
			expect(error.message).toBe('Response validation failed - server returned invalid data')
			expect(error.statusCode).toBe(500)
			expect(error.details).toEqual(details)
		})

		it('should be instance of Error', () => {
			const error = new ResponseValidationError([])
			expect(error).toBeInstanceOf(Error)
		})

		it('should have correct statusCode', () => {
			const error = new ResponseValidationError([{ field: 'test', message: 'test message' }])
			expect(error.statusCode).toBe(500)
		})
	})

	describe('NotFoundError', () => {
		it('should create NotFoundError with message', () => {
			const error = new NotFoundError('User not found')

			expect(error.name).toBe('NotFoundError')
			expect(error.message).toBe('User not found')
			expect(error.statusCode).toBe(404)
			expect(error.details).toBeUndefined()
		})

		it('should be instance of Error', () => {
			const error = new NotFoundError('Resource not found')
			expect(error).toBeInstanceOf(Error)
		})

		it('should have correct statusCode', () => {
			const error = new NotFoundError('Not found')
			expect(error.statusCode).toBe(404)
		})
	})
})
