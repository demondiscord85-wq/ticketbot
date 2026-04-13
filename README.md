# Niro Market Ticket Bot

Discord ticket bot with:
- select menu ticket system
- role ping on ticket open
- close ticket button
- private ticket channels

## Setup

1. Install dependencies:
   npm install

2. Create `.env` file:
   TOKEN=YOUR_BOT_TOKEN
   CLIENT_ID=YOUR_BOT_CLIENT_ID
   GUILD_ID=YOUR_GUILD_ID

3. Edit `config.js` and add your category/channel IDs.

4. Deploy slash commands:
   node deploy-commands.js

5. Start bot:
   node index.js
