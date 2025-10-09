/**
 * Simple Example - Minimal Setup
 * 
 * This is the absolute minimum code needed to get started.
 * Perfect for quick prototyping and understanding the basics.
 * 
 * Run with: npx tsx examples/simple.ts
 */

import { APIServer, z } from '../src/index';

const app = new APIServer();

app.createEndpoint({
  method: 'GET',
  url: '/hello',
  query: z.object({ 
    name: z.string().optional().describe('Name to greet (optional, defaults to "World")'),
  }),
  response: z.object({ 
    message: z.string().describe('Personalized greeting message'),
  }),
  handler: async (request) => {
    return { message: `Hello, ${request.query.name || 'World'}!` };
  },
});

await app.start();

console.log('\n✅ Simple server is running!');
console.log('📝 Visit http://localhost:3000/docs for Swagger documentation');
console.log('\n💡 Try: curl http://localhost:3000/hello?name=Alice');

