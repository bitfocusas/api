import { z } from 'zod';

/**
 * Standard error response schema that matches Fastify's error format
 */
export const ErrorResponseSchema = z.object({
  statusCode: z.number().int().describe('HTTP status code'),
  code: z.string().optional().describe('Error code'),
  error: z.string().describe('Error name'),
  message: z.string().describe('Error message'),
});

/**
 * Helper to create standard response schemas with error responses included
 *
 * @example
 * schema: {
 *   querystring: QuerySchema,
 *   response: createStandardResponses({
 *     200: SuccessResponseSchema,
 *   }),
 * }
 */
export function createStandardResponses<T extends Record<number, z.ZodTypeAny>>(
  responses: T,
): T & {
  400: typeof ErrorResponseSchema;
  500: typeof ErrorResponseSchema;
} {
  return {
    ...responses,
    400: ErrorResponseSchema.describe('Validation error'),
    500: ErrorResponseSchema.describe('Internal server error'),
  };
}

/**
 * Generic validation error response
 */
export class ValidationError extends Error {
  statusCode: number;
  details: Array<{ field: string; message: string }>;

  constructor(details: Array<{ field: string; message: string }>) {
    super('Validation failed');
    this.name = 'ValidationError';
    this.statusCode = 400;
    this.details = details;
  }
}

/**
 * Response validation error - indicates server returned data that doesn't match schema
 */
export class ResponseValidationError extends Error {
  statusCode: number;
  details: Array<{ field: string; message: string }>;

  constructor(details: Array<{ field: string; message: string }>) {
    super('Response validation failed - server returned invalid data');
    this.name = 'ResponseValidationError';
    this.statusCode = 500;
    this.details = details;
  }
}

/**
 * Error class for 404 Not Found responses
 */
export class NotFoundError extends Error {
  statusCode: number;
  details: undefined;

  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
    this.statusCode = 404;
  }
}

