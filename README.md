# Rocket Launchpad

Rocket Launchpad is a BNB Smart Chain mint launchpad built with Vite, React, and Hardhat.

## Highlights

- Whitelist mint vault with owner-managed batch allowlists.
- English launch UI with Rocket branding and financial professional theme.
- Default launch split: 50% buyback burn, 30% holder dividends, and 20% marketing routed to the Factory treasury address.
- Auto buyback checks every 60 seconds, processes 10% per cycle, and only runs when pending BNB is at least 0.02 BNB.
- New Token deployments route tax into BNB buyback burn, holder dividends, and marketing treasury flows.

## Commands

```bash
npm install
npm run hardhat:compile
npm run build
npm run dev
```

New contract behavior applies to newly deployed factories/tokens after compiling and deploying the updated contracts.
