# Examples

This directory contains working examples demonstrating different features of `@bitfocusas/api`.

## 🚀 Quick Start

All examples can be run directly using `tsx`:

```bash
# Simple example - minimal setup
npm run example:simple

# Basic example - user CRUD with validation
npm run example:basic

# Custom auth example - JWT/token validation with typed context
npm run example:auth
```

Or run them directly:

```bash
npx tsx examples/simple.ts
npx tsx examples/basic.ts
npx tsx examples/custom-auth.ts
```

## 📚 Available Examples

### 1. **simple.ts** - Hello World

The absolute minimum code to get started. Perfect for understanding the basics.

**Features:**

- Minimal configuration
- Simple GET endpoint
- Query parameter validation
- Auto-generated Swagger docs

**Run:** `npm run example:simple`

---

### 2. **basic.ts** - User Management API

A more complete example with CRUD operations and validation.

**Features:**

- POST and GET endpoints
- Request/response validation
- Custom validation errors
- In-memory data store
- Swagger documentation

**Run:** `npm run example:basic`

**Try it:**

```bash
# Create a user
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"name":"John Doe","email":"john@example.com","age":30}'

# Get all users
curl http://localhost:3000/users
```

---

### 3. **custom-auth.ts** - Authentication & Authorization

Advanced example showing custom token validation with typed context.

**Features:**

- Custom token validation function
- Typed authentication context
- Role-based access control (RBAC)
- Permission checking
- Public and protected endpoints

**Run:** `npm run example:auth`

**Try it:**

```bash
# Public endpoint (no auth)
curl http://localhost:3000/public

# Protected endpoint with user token
curl -H "Authorization: Bearer user-token-456" \
  http://localhost:3000/profile

# Admin-only endpoint
curl -X DELETE \
  -H "Authorization: Bearer admin-token-123" \
  http://localhost:3000/admin/users/123
```

**Tokens in this example:**

- `admin-token-123` - Admin user with full permissions
- `user-token-456` - Regular user with read-only access

---

## 💡 Tips

1. **Visit Swagger UI**: All examples include auto-generated docs at `http://localhost:3000/docs`

2. **Enable Metrics**: Check Prometheus metrics at `http://localhost:3000/metrics`

3. **Debug Logging**: Set environment variable for detailed logs:

   ```bash
   LOG_LEVEL=debug npx tsx examples/basic.ts
   ```

4. **Custom Port**: Change the port via environment variable:

   ```bash
   PORT=4000 npx tsx examples/simple.ts
   ```

## 🎓 Learning Path

We recommend exploring the examples in this order:

1. **simple.ts** → Learn the basics
2. **basic.ts** → Understand validation and error handling
3. **custom-auth.ts** → Master authentication patterns

## 📖 More Information

For detailed API documentation, see the main [README.md](../README.md) in the project root.
