import twilio from 'twilio';

export async function sendSms(to: string, body: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    console.log(`[messagingService] STUB SMS to ${to}: ${body}`);
    return;
  }

  try {
    const client = twilio(accountSid, authToken);
    await client.messages.create({
      body,
      from: fromNumber,
      to,
    });
    console.log(`[messagingService] SMS sent to ${to}`);
  } catch (error) {
    console.error(`[messagingService] Failed to send SMS to ${to}:`, error);
    throw error;
  }
}
