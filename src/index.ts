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
  type AuthValidationResult,
  type ApiTokenValidator,
} from './api-server';

// Validation utilities and errors
export {
  ValidationError,
  NotFoundError,
  ResponseValidationError,
  ErrorResponseSchema,
  createStandardResponses,
} from './validate';

// Re-export Zod for convenience
export { z } from 'zod';

