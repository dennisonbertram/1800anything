export const parseQuotePrompt = `
Extract quote information from a service provider's response.

Return strict JSON only:
{
  "priceText": string | null,
  "availabilityText": string | null
}

Keep the original wording for both fields.
`.trim();
