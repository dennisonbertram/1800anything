import OpenAI from 'openai';
import { query } from '../db/client.js';
import type { Message, ExtractedData, Task, User } from '../types.js';
import { getMessages, updateTask, storeMessage } from './taskService.js';
import { sendSms } from './messagingService.js';
import * as sourcingService from './sourcingService.js';

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

export async function extractTaskData(messages: Message[]): Promise<ExtractedData> {
  console.log(`[agentService] extractTaskData: ${messages.length} messages`);

  const openai = getOpenAI();
  if (!openai) {
    console.log('[agentService] STUB mode: returning stub extracted data');
    return {
      description: 'Service request (stub)',
      location: null,
      has_enough_info: false,
      missing_fields: ['location'],
    };
  }

  const conversationParts = messages.map((m) => {
    const role = m.direction === 'inbound' ? 'User' : 'Assistant';
    const mediaNote =
      Array.isArray(m.media_urls) && m.media_urls.length > 0
        ? ` [Media: ${m.media_urls.join(', ')}]`
        : '';
    return `${role}: ${m.content}${mediaNote}`;
  });

  const conversationText = conversationParts.join('\n');

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are extracting structured data for a home service request.
Analyze the conversation and return JSON:
{
  "description": "brief description of the problem",
  "location": "location if mentioned, or null",
  "has_enough_info": true/false,
  "missing_fields": ["list of missing required fields"]
}
Rules:
- has_enough_info = true ONLY if we have BOTH: some description of the problem AND some location (zip, city, or address)
- If image/video URLs are present, assume the description can be inferred from the media
- Be generous - partial info is fine for v1`,
      },
      {
        role: 'user',
        content: conversationText,
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error('[agentService] OpenAI returned empty content');
  }

  const parsed = JSON.parse(content) as ExtractedData;
  return parsed;
}

export function generateClarifyingQuestion(extracted: ExtractedData): string {
  if (extracted.missing_fields.includes('location')) {
    return "What's your zip code or city?";
  }
  if (extracted.missing_fields.includes('description')) {
    return 'Can you describe the problem you need help with?';
  }
  return 'Any other details that would help us find the right person?';
}

export async function processTask(taskId: string): Promise<void> {
  console.log(`[agentService] processTask: ${taskId}`);

  try {
    const taskResult = await query<Task>('SELECT * FROM tasks WHERE id = $1', [taskId]);
    const task = taskResult.rows[0];
    if (!task) {
      console.error(`[agentService] Task not found: ${taskId}`);
      return;
    }

    // FIX 6: Only process tasks in intake or clarifying state
    if (task.state !== 'intake' && task.state !== 'clarifying') {
      console.log(`[agentService] Task ${taskId} is in state '${task.state}', skipping processTask`);
      return;
    }

    const messages = await getMessages(taskId);
    const extracted = await extractTaskData(messages);

    console.log(`[agentService] extracted data:`, extracted);

    if (!extracted.has_enough_info) {
      const question = generateClarifyingQuestion(extracted);

      const userResult = await query<User>('SELECT * FROM users WHERE id = $1', [task.user_id]);
      const user = userResult.rows[0];
      if (!user) {
        console.error(`[agentService] User not found for task: ${taskId}`);
        return;
      }

      await sendSms(user.phone_number, question);
      await storeMessage(taskId, 'outbound', question);
      await updateTask(taskId, { state: 'clarifying' });

      console.log(`[agentService] Sent clarifying question to ${user.phone_number}`);
    } else {
      await updateTask(taskId, {
        description: extracted.description,
        location: extracted.location ?? undefined,
        state: 'sourcing',
      });

      const updatedTaskResult = await query<Task>('SELECT * FROM tasks WHERE id = $1', [taskId]);
      const updatedTask = updatedTaskResult.rows[0];
      if (!updatedTask) {
        console.error(`[agentService] Updated task not found: ${taskId}`);
        return;
      }

      await sourcingService.sourceProviders(updatedTask);
      await sourcingService.contactProviders(updatedTask);
      await updateTask(taskId, { state: 'quoting' });

      console.log(`[agentService] Task ${taskId} moved to quoting state`);
    }
  } catch (error) {
    console.error(`[agentService] processTask error for task ${taskId}:`, error);
  }
}
