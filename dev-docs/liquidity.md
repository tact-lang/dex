
This section explains how to add and remove liquidity in T-Dex, enabling users to participate as liquidity providers and earn a share of trading fees.

## Overview

T-Dex uses a two-vault system for each pool (e.g., TON Vault and Jetton Vault). To add liquidity, you must deposit both assets into their respective vaults in the correct ratio. In return, you receive LP (liquidity provider) jettons, which represent your share of the pool. To withdraw liquidity, you burn your LP jettons and receive the underlying assets back.

## Adding Liquidity

### Prerequisites

- Both vaults (for each asset in the pool) must be deployed and initialized.
- The AMM pool must exist.
- You need the addresses of both vaults and the pool.

### Step-by-step

1. **Deploy the Liquidity Deposit Contract**  
   This contract coordinates the atomic addition of both assets. It is created for each deposit operation and destroyed after use.

2. **Deposit Asset A and Asset B**  
   - Send a transfer to each vault (TON or Jetton) with a special payload referencing the Liquidity Deposit contract.
   - The payload must include:
     - The address of the Liquidity Deposit contract
     - The amount to deposit
     - (Optional) Minimum amount to accept, timeout, and callback payloads

   For Jetton vaults, use a jetton transfer with a forward payload created by a helper like `createJettonVaultLiquidityDepositPayload`.  
   For TON vaults, send a TON transfer with a similar payload.

3. **Vaults Notify the Liquidity Deposit Contract**  
   Each vault, upon receiving the deposit, sends a `PartHasBeenDeposited` message to the Liquidity Deposit contract.

4. **Liquidity Deposit Contract Notifies the AMM Pool**  
   Once both parts are received, the contract sends a message to the AMM pool to mint LP tokens.

5. **AMM Pool Mints LP Jettons**  
   The pool mints LP jettons to the depositor and, if necessary, returns any excess assets to the user if the deposit ratio was not exact.

#### Example (Jetton Vault)

```typescript
const payload = createJettonVaultLiquidityDepositPayload(
    liquidityDepositContractAddress,
    /* proofCode, proofData, */ // for advanced use
    minAmountToDeposit,
    lpTimeout,
    payloadOnSuccess,
    payloadOnFailure
);
await jettonWallet.sendTransfer(
    provider,
    sender,
    toNano("0.05"), // TON for fees
    jettonAmount,
    vaultAddress,
    responseAddress,
    null,
    toNano("0.01"),
    payload
);
```

#### Example (TON Vault)

```typescript
const payload = createTonVaultLiquidityDepositPayload(
    liquidityDepositContractAddress,
    tonAmount,
    payloadOnSuccess,
    payloadOnFailure,
    minAmountToDeposit,
    lpTimeout
);
// Send TON with this payload to the vault address
```

### Notes

- If the deposit ratio does not match the current pool ratio, the pool will accept as much as possible and return the excess.
- The Liquidity Deposit contract ensures atomicity: either both assets are deposited, or the operation fails.

## Removing Liquidity (Withdrawing)

To withdraw your share, you must burn your LP jettons. The AMM pool will send the corresponding amounts of each asset back to you.

### Step-by-step

1. **Burn LP Jettons**
   - Use your LP jetton wallet to send a burn message with a special payload to the AMM pool.
   - The payload should specify:
     - Minimum amounts of each asset you are willing to receive (to protect against slippage)
     - Timeout
     - Receiver address
     - (Optional) Callback payload

2. **AMM Pool Processes Withdrawal**
   - The pool calculates the amounts to return based on your share.
   - If the minimums are met, the pool sends payouts from each vault to your address.
   - If not, the transaction is reverted.

#### Example

```typescript
const withdrawPayload = createWithdrawLiquidityBody(
    minAmountLeft,
    minAmountRight,
    timeout,
    receiver,
    successfulPayload
);
await lpJettonWallet.sendBurn(
    provider,
    sender,
    toNano("0.05"), // TON for fees
    lpAmountToBurn,
    receiver,
    withdrawPayload
);
```

### Notes

- You can specify minimum amounts to avoid receiving less than expected due to slippage.
- The withdrawal is atomic: you receive both assets or the operation fails.

## Summary

- **Add liquidity**: Deposit both assets to their vaults with a reference to the Liquidity Deposit contract. Receive LP jettons.
- **Remove liquidity**: Burn LP jettons with a withdrawal payload. Receive your share of both assets.

For more details, see the [Vaults documentation](../sources/contracts/vaults/vaultDoc.md) and the [AMM Pool contract](../sources/output/DEX_AmmPool.md).
