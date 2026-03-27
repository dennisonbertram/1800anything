import { query } from '../db/client.js';
import type { Task, Provider } from '../types.js';
import { sendSms } from './messagingService.js';
import { storeMessage } from './taskService.js';

const STUB_PROVIDERS = [
  { name: "Mike's Plumbing", phone_number: '+15551234567', source: 'stub' },
  { name: 'QuickFix Home Services', phone_number: '+15559876543', source: 'stub' },
  { name: 'AllPro Maintenance', phone_number: '+15555551234', source: 'stub' },
];

export async function sourceProviders(task: Task): Promise<Provider[]> {
  console.log(`[sourcingService] sourceProviders for task: ${task.id}`);

  const providers: Provider[] = [];

  for (const stub of STUB_PROVIDERS) {
    const result = await query<Provider>(
      `INSERT INTO providers (name, phone_number, source)
       VALUES ($1, $2, $3)
       ON CONFLICT (phone_number) DO UPDATE SET name = EXCLUDED.name
       RETURNING *`,
      [stub.name, stub.phone_number, stub.source]
    );
    if (result.rows[0]) {
      providers.push(result.rows[0]);
    }
  }

  console.log(`[sourcingService] Sourced ${providers.length} providers`);
  return providers;
}

export async function contactProviders(task: Task): Promise<void> {
  console.log(`[sourcingService] contactProviders for task: ${task.id}`);

  const result = await query<Provider>(
    `SELECT * FROM providers WHERE source = 'stub'`
  );
  const providers = result.rows;

  for (const provider of providers) {
    const message = `New job request:\n${task.description}\nLocation: ${task.location ?? 'Not specified'}\n\nAre you available? Rough quote?`;

    try {
      await sendSms(provider.phone_number, message);
      await storeMessage(task.id, 'outbound', message);

      // FIX 1: Track which providers were contacted for which task
      await query(
        `INSERT INTO task_providers (task_id, provider_id)
         VALUES ($1, $2)
         ON CONFLICT (task_id, provider_id) DO NOTHING`,
        [task.id, provider.id]
      );

      console.log(`[sourcingService] Contacted provider: ${provider.name}`);
    } catch (error) {
      console.error(`[sourcingService] Failed to contact provider ${provider.name}:`, error);
    }
  }
}
