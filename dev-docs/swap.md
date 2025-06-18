# Swaps

This section of dev-docs focuses on how to perform on-chain asset swaps on Tact dex. Swap essentially is sending asset that you want to swap to it's corresponsing vault and attaching message body with swap request details. Vault will then create swap-in message and send it to the Amm pool, which will handle the math and either return the funds if they don't pass the slippage or send payout message to the other vault (sometimes pool will perform this two actions together).

## Swap message

