# Rocket Launch Contracts

The active stack uses `AppleLaunchFactory`, `AppleMintVault`, and `AppleToken` naming from the original source, but the behavior is now configured for Rocket launches.

- `AppleLaunchFactory`: creates each Token and Mint Vault.
- `AppleMintVault`: handles BNB minting, whitelist mint slots, launch finalization, and refunds.
- `AppleToken`: handles trading tax, dividend accounting, and Rocket auto buyback.

## Forced Tax Split

`AppleLaunchFactory` forces every new launch to use the same project split, even if callers bypass the UI:

- `20%` marketing routed to the Factory `feeRecipient`.
- `56%` buyback-burn bucket.
- `24%` holder dividend bucket.
- `0%` LP bucket.

## Rocket Auto Buyback

- `burnFeeBps` is routed into a buyback-burn bucket instead of direct token burn.
- `dividendFeeBps` is swapped into the reward token and deposited into the holder dividend distributor during tax processing.
- The buyback-burn bucket is swapped into pending BNB during tax processing.
- `processAutoBuyback()` can be called by anyone.
- It only runs after 60 seconds have passed since the last run and available buyback pending BNB is at least `0.02 BNB`.
- Each cycle processes 10% of available buyback pending BNB and sends bought-back tokens to `0x...dEaD`.
- The `0.02 BNB` floor does not delay holder dividend deposits.

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
