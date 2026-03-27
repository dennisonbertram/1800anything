import 'dotenv/config';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { logger } from 'hono/logger';
import twilioRoutes from './routes/twilio.js';

const app = new Hono();
app.use('*', logger());
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.route('/', twilioRoutes);

const port = parseInt(process.env.PORT || '3000', 10);
console.log(`🚀 1800anything listening on port ${port}`);
serve({ fetch: app.fetch, port });
