/**
 * @bitfocusas/api - Fastify API server with Zod validation
 *
 * A type-safe, production-ready API library built with Fastify, Zod, and TypeScript.
 * Features strict request/response validation, automatic Swagger documentation,
 * and a powerful endpoint factory pattern for rapid development.
 *
 * @author William Viker <william@bitfocus.io>
 * @license MIT
 */

// Main API Server class
export {
	APIServer,
	type APIServerConfig,
	type EndpointConfig,
	type EndpointRateLimitConfig,
	type AuthValidationResult,
	type ApiTokenValidator,
	type LogLevel,
} from './api-server.js'

// Validation utilities and errors
export {
	ValidationError,
	NotFoundError,
	ResponseValidationError,
	ErrorResponseSchema,
	createStandardResponses,
} from './validate.js'

// Re-export Zod for convenience
export { z } from 'zod'
