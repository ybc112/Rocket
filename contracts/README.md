# Rocket Launch Contracts

The active stack uses `AppleLaunchFactory`, `AppleMintVault`, and `AppleToken` naming from the original source, but the behavior is now configured for Rocket launches.

- `AppleLaunchFactory`: creates each Token and Mint Vault.
- `AppleMintVault`: handles BNB minting, whitelist mint slots, launch finalization, and refunds.
- `AppleToken`: handles trading tax, dividend accounting, and Rocket auto buyback.

## Forced Tax Split

`AppleLaunchFactory` forces every new launch to use the same project split, even if callers bypass the UI:

- `20%` marketing routed to the Factory `feeRecipient`.
- `50%` buyback-burn bucket.
- `30%` DOGE holder dividend bucket.
- `0%` LP bucket.

## Rocket Auto Buyback

- `burnFeeBps` is routed into a buyback-burn bucket instead of direct token burn.
- `dividendFeeBps` is routed into the auto pool for DOGE holder rewards.
- The buyback-burn bucket is swapped into pending BNB during tax processing.
- User sell transactions trigger the on-chain automation path; no keeper wallet is required for normal operation.
- `processAutoBuyback()` can still be called by anyone as a manual fallback.
- It only waits for the 60-second interval; there is no `0.02 BNB` floor.
- Each cycle processes 10% of available auto-pool BNB.
- The processed amount follows the forced auto split: buyback burn to `0x...dEaD` and DOGE rewards for holder dividends.

## Opening Price Level

`AppleMintVault` treats the launch slider as an opening-price level, not a literal LP-token percentage.

- `50%` is the standard launch price: sale tokens and LP tokens are balanced.
- Below `50%` opens lower than mint price.
- Above `50%` opens higher than mint price.
- The vault automatically calculates how many tokens stay in the LP reserve so that the LP opening price follows the selected level.

Compile with:

```bash
npm run hardhat:compile
```
