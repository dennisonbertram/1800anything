# Current Intent

## What
1800anything — an SMS-based on-demand service marketplace.

## Why
Enable users to get home service quotes by simply texting a phone number. No app download, no browsing, no accounts beyond phone number.

## How
Twilio webhook receives SMS → AI agent extracts problem details → sources local providers → collects quotes → presents options → handles payment → confirms booking.

## Non-Goals
- No frontend UI
- No auth beyond phone
- No ratings/reviews
- No escrow
- No multiple task types
