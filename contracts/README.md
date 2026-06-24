# Rocket Launch Contracts

The active stack uses `AppleLaunchFactory`, `AppleMintVault`, and `AppleToken` naming from the original source, but the behavior is now configured for Rocket launches.

- `AppleLaunchFactory`: creates each Token and Mint Vault.
- `AppleMintVault`: handles BNB minting, whitelist mint slots, launch finalization, and refunds.
- `AppleToken`: handles trading tax, dividend accounting, and Rocket auto buyback.

## Rocket Auto Buyback

- `burnFeeBps` is routed into a buyback-burn bucket instead of direct token burn.
- The bucket is swapped into pending BNB during tax processing.
- `processAutoBuyback()` can be called by anyone.
- It only runs after 60 seconds have passed since the last run and available pending BNB is at least `0.02 BNB`.
- Each cycle processes 10% of available pending BNB.
- The processed amount follows the project split: 70% buyback burn to `0x...dEaD` and 30% reward-token buys for holder dividends.

Compile with:

```bash
npm run hardhat:compile
```
