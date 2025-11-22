import cors from '@fastify/cors';
import fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import rateLimit from '@fastify/rate-limit';
import metricsPlugin from 'fastify-metrics';
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createStandardResponses, ValidationError, ResponseValidationError, NotFoundError } from './validate';
import { config as dotenvConfig } from 'dotenv';

/**
 * Helper function to apply strict validation to a Zod schema
 * Only applies strict() to object schemas that support it
 */
function applyStrict<T extends z.ZodTypeAny>(schema: T): T {
  if (schema instanceof z.ZodObject) {
    return schema.strict() as unknown as T;
  }
  return schema;
}

/**
 * Generate operationId from URL path and HTTP method
 * Converts /thing/get_v1 with GET method to thing_get_v1
 */
function generateOperationId(url: string, method: string): string {
  const cleanUrl = url.replace(/^\//, '').toLowerCase();
  const pathPart = cleanUrl.replace(/\//g, '_');
  const methodPart = method.toLowerCase();
  return `${pathPart}_${methodPart}`;
}

/**
 * Result from a custom API token validator function
 */
export interface AuthValidationResult<TContext = unknown> {
  /** Whether the token is valid */
  valid: boolean;
  /** Optional context data to attach to the request (only if valid is true) */
  context?: TContext;
  /** Optional error message (only if valid is false) */
  error?: string;
}

/**
 * Custom API token validator function type
 * @param token - The bearer token extracted from the Authorization header
 * @param request - The Fastify request object for additional validation context
 * @returns Promise resolving to validation result with optional typed context
 */
export type ApiTokenValidator<TContext = unknown> = (
  token: string,
  request: FastifyRequest,
) => Promise<AuthValidationResult<TContext>> | AuthValidationResult<TContext>;

/**
 * Configuration options for the API server
 */
export interface APIServerConfig<TAuthContext = unknown> {
  /** 
   * Optional Fastify instance to use instead of creating a new one.
   * If provided, the library will attach to your existing Fastify instance
   * and you'll be responsible for starting/stopping it.
   * If not provided, the library will create and manage its own instance.
   */
  fastify?: FastifyInstance;
  /** Server port (default: 3000) - Only used if fastify is not provided */
  port?: number;
  /** Server host (default: 127.0.0.1) - Only used if fastify is not provided */
  host?: string;
  /** Environment (default: development) */
  env?: 'development' | 'production';
  /** Log level (default: info) - Only used if fastify is not provided */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  /** CORS origin (default: *) */
  corsOrigin?: string;
  /** Trusted proxies */
  trustProxy?: string | string[] | boolean;
  /** 
   * Bearer token for authentication or custom validator function
   * - String: Simple token comparison (default: development-token-change-in-production)
   * - Function: Custom validation logic with typed context
   */
  apiToken?: string | ApiTokenValidator<TAuthContext>;
  /** Rate limit max requests per window (default: 100) */
  rateLimitMax?: number;
  /** Rate limit time window (default: 15m) */
  rateLimitWindow?: string;
  /** Rate limit allow ip addresses */
  rateLimitAllow?: string[];
  /** Enable Prometheus metrics endpoint at /metrics (default: true) */
  metricsEnabled?: boolean;
  /** API title for Swagger docs (default: API Documentation) */
  apiTitle?: string;
  /** API description for Swagger docs */
  apiDescription?: string;
  /** API version for Swagger docs (default: 1.0.0) */
  apiVersion?: string;
  /** Tags for Swagger docs grouping */
  apiTags?: Array<{ name: string; description: string }>;
  /** Load environment variables from .env file (default: true) */
  loadEnv?: boolean;
}

/**
 * Configuration for an API endpoint
 */
export interface EndpointConfig<
  TQuery extends z.ZodTypeAny = z.ZodUndefined,
  TBody extends z.ZodTypeAny = z.ZodUndefined,
  TParams extends z.ZodTypeAny = z.ZodUndefined,
  TResponse extends z.ZodTypeAny = z.ZodVoid,
  TAuthContext = undefined,
> {
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /** URL path */
  url: string;
  /** Zod schema for query parameters */
  query?: TQuery;
  /** Zod schema for request body */
  body?: TBody;
  /** Zod schema for URL path parameters */
  params?: TParams;
  /** Zod schema for successful response (usually 200) */
  response: TResponse;
  /** Additional route configuration */
  config?: {
    description?: string;
    tags?: string[];
    summary?: string;
    operationId?: string;
    deprecated?: boolean;
  };
  /** 
   * Whether this endpoint requires authentication
   * If true, adds Bearer token security requirement and 401/403 responses
   * Also automatically applies authentication middleware
   */
  authenticated?: boolean;
  /** The actual handler function with fully typed parameters */
  handler: (
    request: FastifyRequest & {
      query: TQuery extends z.ZodTypeAny ? z.infer<TQuery> : undefined;
      body: TBody extends z.ZodTypeAny ? z.infer<TBody> : undefined;
      params: TParams extends z.ZodTypeAny ? z.infer<TParams> : undefined;
      auth?: TAuthContext;
    },
    reply: FastifyReply,
  ) => Promise<z.infer<TResponse>>;
}

/**
 * APIServer - A type-safe, production-ready API server powered by Fastify and Zod
 *
 * @example
 * ```typescript
 * import { APIServer } from '@bitfocusas/api';
 * import { z } from 'zod';
 *
 * const app = new APIServer({
 *   port: 3000,
 *   apiTitle: 'My API',
 * });
 *
 * app.createEndpoint({
 *   method: 'GET',
 *   url: '/users',
 *   query: z.object({ limit: z.coerce.number().default(10) }),
 *   response: z.object({ users: z.array(z.any()) }),
 *   handler: async (request) => {
 *     return { users: [] };
 *   },
 * });
 *
 * await app.start();
 * ```
 */
export class APIServer<TAuthContext = undefined> {
  private fastify: FastifyInstance;
  private config: Required<Omit<APIServerConfig<TAuthContext>, 'apiToken' | 'fastify' | 'trustProxy'>> & { 
    apiToken: string | ApiTokenValidator<TAuthContext>;
    fastify?: FastifyInstance;
    trustProxy?: string | string[] | boolean;
  };
  private started: boolean = false;
  private ownsFastifyInstance: boolean = false;

  constructor(config: APIServerConfig<TAuthContext> = {}) {
    // Load environment variables if requested
    if (config.loadEnv !== false) {
      dotenvConfig();
    }

    // Check if user provided their own Fastify instance
    if (config.fastify) {
      // Use provided Fastify instance
      this.fastify = config.fastify;
      this.ownsFastifyInstance = false;
      
      // Set up Zod validation on the provided instance
      this.fastify.setValidatorCompiler(validatorCompiler);
      this.fastify.setSerializerCompiler(serializerCompiler);
    } else {
      // Create our own Fastify instance
      this.ownsFastifyInstance = true;
      
      // Merge with defaults, prioritizing config over env vars
      const logLevel = (config.logLevel ?? process.env.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error';
      
      // Configure pretty logging for development if pino-pretty is available
      let loggerTransport: { target: string; options: Record<string, unknown> } | undefined = undefined;
      const env = (config.env ?? process.env.NODE_ENV ?? 'development') as 'development' | 'production';
      if (env === 'development') {
        try {
          // Check if pino-pretty is available (it's a devDependency)
          require.resolve('pino-pretty');
          loggerTransport = {
            target: 'pino-pretty',
            options: {
              translateTime: 'HH:MM:ss Z',
              ignore: 'pid,hostname',
            },
          };
        } catch {
          // pino-pretty not available, use default JSON logging
          // This is fine in production or if pino-pretty isn't installed
        }
      }

      // Initialize Fastify
      this.fastify = fastify({
        logger: {
          level: logLevel,
          transport: loggerTransport,
        },
        ajv: {
          customOptions: {
            strict: 'log',
            keywords: ['kind', 'modifier'],
          },
        },
        trustProxy: config.trustProxy,
      });

      // Set up Zod validation
      this.fastify.setValidatorCompiler(validatorCompiler);
      this.fastify.setSerializerCompiler(serializerCompiler);
    }

    // Merge with defaults, prioritizing config over env vars
    this.config = {
      fastify: config.fastify,
      port: config.port ?? parseInt(process.env.PORT || '3000', 10),
      host: config.host ?? process.env.HOST ?? '127.0.0.1',
      env: (config.env ?? process.env.NODE_ENV ?? 'development') as 'development' | 'production',
      logLevel: (config.logLevel ?? process.env.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error',
      corsOrigin: config.corsOrigin ?? process.env.CORS_ORIGIN ?? '*',
      trustProxy: config.trustProxy,
      apiToken: config.apiToken ?? process.env.API_TOKEN ?? 'development-token-change-in-production',
      rateLimitMax: config.rateLimitMax ?? parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
      rateLimitWindow: config.rateLimitWindow ?? process.env.RATE_LIMIT_WINDOW ?? '15m',
      rateLimitAllow: config.rateLimitAllow ?? [],
      metricsEnabled: config.metricsEnabled ?? (process.env.METRICS_ENABLED !== 'false'),
      apiTitle: config.apiTitle ?? 'API Documentation',
      apiDescription: config.apiDescription ?? 'API built with Fastify, Zod, and TypeScript',
      apiVersion: config.apiVersion ?? '1.0.0',
      apiTags: config.apiTags ?? [],
      loadEnv: config.loadEnv ?? true,
    };

    // Register plugins at root level - these must be registered before any routes
    this.registerPlugins();
  }

  /**
   * Register all plugins (CORS, rate limiting, swagger, metrics)
   * These are registered at the root level before routes are added
   */
  private registerPlugins(): void {
    // CORS
    this.fastify.register(cors, {
      origin: this.config.corsOrigin,
    });

    // Rate Limiting
    this.fastify.register(rateLimit, {
      max: this.config.rateLimitMax,
      timeWindow: this.config.rateLimitWindow,
      cache: 10000,
      allowList: ['127.0.0.1', ...this.config.rateLimitAllow],
      redis: undefined,
      skipOnError: true,
      nameSpace: 'faz:',
      continueExceeding: true,
      enableDraftSpec: true,
      addHeadersOnExceeding: {
        'x-ratelimit-limit': true,
        'x-ratelimit-remaining': true,
        'x-ratelimit-reset': true,
      },
      addHeaders: {
        'x-ratelimit-limit': true,
        'x-ratelimit-remaining': true,
        'x-ratelimit-reset': true,
        'retry-after': true,
      },
    });

    // Prometheus Metrics
    if (this.config.metricsEnabled) {
      this.fastify.register(metricsPlugin, {
        endpoint: '/metrics',
        name: 'faz_api',
        routeMetrics: {
          enabled: true,
          registeredRoutesOnly: true,
          groupStatusCodes: true,
        },
      });
    }

    // Swagger documentation - must be registered before routes
    this.fastify.register(swagger, {
      openapi: {
        openapi: '3.1.0',
        info: {
          title: this.config.apiTitle,
          description: this.config.apiDescription,
          version: this.config.apiVersion,
        },
        servers: [
          {
            url: this.config.env === 'development' ? `http://localhost:${this.config.port}` : '/',
            description: this.config.env === 'development' ? 'Development server' : 'Production server',
          },
        ],
        tags: this.config.apiTags,
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
              description: 'Enter your bearer token',
            },
          },
        },
      },
      transform: jsonSchemaTransform,
    });

    this.fastify.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: true,
        syntaxHighlight: {
          activate: true,
          theme: 'monokai',
        },
      },
      staticCSP: true,
      transformStaticCSP: (header) => header,
    });
  }

  /**
   * Get the underlying Fastify instance
   * Useful for advanced customization
   */
  get instance(): FastifyInstance {
    return this.fastify;
  }

  /**
   * Get the server configuration
   */
  get serverConfig(): Readonly<Required<Omit<APIServerConfig<TAuthContext>, 'fastify' | 'trustProxy'>> & { fastify?: FastifyInstance; trustProxy?: string | string[] | boolean }> {
    return this.config;
  }

  /**
   * Create and register an endpoint
   *
   * @example
   * ```typescript
   * app.createEndpoint({
   *   method: 'POST',
   *   url: '/users',
   *   body: z.object({ name: z.string(), email: z.string().email() }),
   *   response: z.object({ id: z.string(), name: z.string() }),
   *   handler: async (request) => {
   *     const { name, email } = request.body;
   *     return { id: '123', name };
   *   },
   * });
   * ```
   */
  createEndpoint<
    TQuery extends z.ZodTypeAny = z.ZodUndefined,
    TBody extends z.ZodTypeAny = z.ZodUndefined,
    TParams extends z.ZodTypeAny = z.ZodUndefined,
    TResponse extends z.ZodTypeAny = z.ZodVoid,
  >(endpointConfig: EndpointConfig<TQuery, TBody, TParams, TResponse, TAuthContext>): void {
    // Validate request data (query and body) before handler execution
    const validatedHandler = async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Validate query parameters
        let validatedQuery: TQuery extends z.ZodTypeAny ? z.infer<TQuery> : undefined =
          undefined as TQuery extends z.ZodTypeAny ? z.infer<TQuery> : undefined;
        if (endpointConfig.query) {
          const strictQuery = applyStrict(endpointConfig.query);
          const queryResult = strictQuery.safeParse(request.query);
          if (!queryResult.success) {
            throw new ValidationError(
              queryResult.error.errors.map((err: z.ZodIssue) => ({
                field: `query.${err.path.join('.')}`,
                message: err.message,
              })),
            );
          }
          validatedQuery = queryResult.data;
        }

        // Validate body parameters
        let validatedBody: TBody extends z.ZodTypeAny ? z.infer<TBody> : undefined =
          undefined as TBody extends z.ZodTypeAny ? z.infer<TBody> : undefined;
        if (endpointConfig.body) {
          const strictBody = applyStrict(endpointConfig.body);
          const bodyResult = strictBody.safeParse(request.body);
          if (!bodyResult.success) {
            throw new ValidationError(
              bodyResult.error.errors.map((err: z.ZodIssue) => ({
                field: `body.${err.path.join('.')}`,
                message: err.message,
              })),
            );
          }
          validatedBody = bodyResult.data;
        }

        // Validate path parameters
        let validatedParams: TParams extends z.ZodTypeAny ? z.infer<TParams> : undefined =
          undefined as TParams extends z.ZodTypeAny ? z.infer<TParams> : undefined;
        if (endpointConfig.params) {
          const strictParams = applyStrict(endpointConfig.params);
          const paramsResult = strictParams.safeParse(request.params);
          if (!paramsResult.success) {
            throw new ValidationError(
              paramsResult.error.errors.map((err: z.ZodIssue) => ({
                field: `params.${err.path.join('.')}`,
                message: err.message,
              })),
            );
          }
          validatedParams = paramsResult.data;
        }

        // Create typed request object
        const typedRequest = {
          ...request,
          query: validatedQuery,
          body: validatedBody,
          params: validatedParams,
          auth: (request as FastifyRequest & { auth?: TAuthContext }).auth,
        } as FastifyRequest & {
          query: TQuery extends z.ZodTypeAny ? z.infer<TQuery> : undefined;
          body: TBody extends z.ZodTypeAny ? z.infer<TBody> : undefined;
          params: TParams extends z.ZodTypeAny ? z.infer<TParams> : undefined;
          auth?: TAuthContext;
        };

        // Execute the handler
        const result = await endpointConfig.handler(typedRequest, reply);

        // Validate response before sending
        const strictResponse = applyStrict(endpointConfig.response);
        const responseResult = strictResponse.safeParse(result);
        if (!responseResult.success) {
          console.error(
            'Response validation failed:',
            JSON.stringify(
              {
                url: request.url,
                method: request.method,
                errors: responseResult.error.errors,
                response: result,
              },
              null,
              2,
            ),
          );
          throw new ResponseValidationError(
            responseResult.error.errors.map((err: z.ZodIssue) => ({
              field: err.path.join('.') || 'root',
              message: err.message,
            })),
          );
        }
        return result;
      } catch (error) {
        // Handle NotFoundError
        if (error instanceof NotFoundError) {
          return reply.code(404).send({
            statusCode: 404,
            error: 'Not Found',
            message: error.message,
          });
        }

        // Handle validation errors
        if (error instanceof ValidationError) {
          const response = {
            statusCode: 400,
            error: 'Bad Request',
            message: 'Validation failed',
            details: error.details,
          };
          return reply.code(400).send(response);
        }

        // Handle response validation errors
        if (error instanceof ResponseValidationError) {
          const response = {
            statusCode: 500,
            error: 'Internal Server Error',
            message: 'Response validation failed - server returned invalid data',
            details: error.details,
          };
          return reply.code(500).send(response);
        }

        // Re-throw other errors to be handled by Fastify's error handler
        throw error;
      }
    };

    // Generate operationId automatically from URL and method
    const autoGeneratedOperationId = generateOperationId(endpointConfig.url, endpointConfig.method);
    const operationId = endpointConfig.config?.operationId || autoGeneratedOperationId;

    // Prepare response schemas including auth errors if needed
    const responses: Record<string, z.ZodTypeAny> = {
      200: applyStrict(endpointConfig.response),
    };

    // Add auth error responses if endpoint requires authentication
    if (endpointConfig.authenticated) {
      responses[401] = z.object({
        statusCode: z.number().describe('HTTP status code'),
        error: z.string().describe('Error name'),
        message: z.string().describe('Error message'),
      }).describe('Unauthorized - Missing or invalid authorization header');
      
      responses[403] = z.object({
        statusCode: z.number().describe('HTTP status code'),
        error: z.string().describe('Error name'),
        message: z.string().describe('Error message'),
      }).describe('Forbidden - Invalid or expired token');
    }

    // Register the route with Fastify after plugins are loaded
    // We use after() to ensure this route is registered after swagger is ready
    this.fastify.after(() => {
      this.fastify.route({
        method: endpointConfig.method,
        url: endpointConfig.url,
        schema: {
          deprecated: endpointConfig.config?.deprecated,
          description: endpointConfig.config?.description,
          tags: endpointConfig.config?.tags,
          summary: endpointConfig.config?.summary,
          operationId,
          querystring: endpointConfig.query ? applyStrict(endpointConfig.query) : undefined,
          params: endpointConfig.params ? applyStrict(endpointConfig.params) : undefined,
          // Only add body schema for methods that support it
          ...(endpointConfig.method !== 'GET' && endpointConfig.body
            ? { body: applyStrict(endpointConfig.body) }
            : {}),
          response: createStandardResponses(responses),
          // Add security requirement if authenticated
          ...(endpointConfig.authenticated ? { security: [{ bearerAuth: [] }] } : {}),
        },
        // Apply authentication middleware if required
        ...(endpointConfig.authenticated ? { preHandler: this.authenticateToken } : {}),
        handler: validatedHandler,
      });
    });
  }

  /**
   * Register authentication middleware
   * Use this to protect specific routes
   *
   * @example
   * ```typescript
   * // Protect all routes under /api/admin
   * app.instance.register(async (protectedScope) => {
   *   protectedScope.addHook('onRequest', app.authenticateToken);
   *   // Register protected endpoints here
   * });
   * ```
   */
  authenticateToken = async (
    request: FastifyRequest & { auth?: TAuthContext },
    reply: FastifyReply,
  ): Promise<void> => {
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      return reply.code(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Missing authorization header',
      });
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return reply.code(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid authorization header format. Expected: Bearer <token>',
      });
    }

    const token = parts[1];

    // Check if apiToken is a function (custom validator) or string (simple comparison)
    if (typeof this.config.apiToken === 'function') {
      // Custom validation with context
      const result = await this.config.apiToken(token, request);
      
      if (!result.valid) {
        return reply.code(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: result.error || 'Invalid token',
        });
      }

      // Attach auth context to request
      if (result.context !== undefined) {
        request.auth = result.context;
      }
    } else {
      // Simple string comparison
      if (token !== this.config.apiToken) {
        return reply.code(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Invalid token',
        });
      }
    }

    // Token is valid, continue to route handler
  };

  /**
   * Start the API server
   * 
   * If you provided your own Fastify instance via the config, this method
   * will not start the server (you're responsible for starting it yourself).
   * If the library created its own instance, this will start it.
   * 
   * @returns Promise that resolves when server is ready (or immediately if using provided instance)
   */
  async start(): Promise<void> {
    if (this.started) {
      throw new Error('Server is already started');
    }

    // If user provided their own Fastify instance, don't start it
    if (!this.ownsFastifyInstance) {
      this.started = true;
      console.log(`
✅ API server attached to your Fastify instance!
📝 API Documentation: http://localhost:${this.config.port}/docs
${this.config.metricsEnabled ? `📊 Metrics: http://localhost:${this.config.port}/metrics` : ''}
🔒 Rate Limit: ${this.config.rateLimitMax} requests per ${this.config.rateLimitWindow}
      `);
      return;
    }

    try {
      // Start server (we own the instance)
      await this.fastify.listen({
        port: this.config.port,
        host: this.config.host,
      });

      this.started = true;

      console.log(`
🚀 Server is running!
📝 API Documentation: http://localhost:${this.config.port}/docs
${this.config.metricsEnabled ? `📊 Metrics: http://localhost:${this.config.port}/metrics` : ''}
🔒 Rate Limit: ${this.config.rateLimitMax} requests per ${this.config.rateLimitWindow}
      `);
    } catch (err) {
      console.error('Failed to start server:', err);
      throw err;
    }
  }

  /**
   * Stop the API server gracefully
   * 
   * If you provided your own Fastify instance via the config, this method
   * will not close it (you're responsible for closing it yourself).
   * If the library created its own instance, this will close it.
   */
  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    // If user provided their own Fastify instance, don't close it
    if (!this.ownsFastifyInstance) {
      this.started = false;
      return;
    }

    await this.fastify.close();
    this.started = false;
  }

  /**
   * Setup graceful shutdown handlers
   * This is optional but recommended for production
   */
  setupGracefulShutdown(): void {
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
    signals.forEach((signal) => {
      process.on(signal, async () => {
        console.log(`\n${signal} received, closing server...`);
        await this.stop();
        process.exit(0);
      });
    });
  }
}

