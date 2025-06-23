This section explains how to add and remove liquidity in T-Dex, enabling users to participate as liquidity providers and earn a share of trading fees.

## Overview

T-Dex uses a two-vault system for each pool (e.g., TON Vault and Jetton Vault). To add liquidity, you must deposit both assets into their respective vaults in the correct ratio. In return, you receive LP (liquidity provider) jettons, which represent your share of the pool. To withdraw liquidity, you burn your LP jettons and receive the underlying assets back.

## Adding Liquidity

### Prerequisites

- Both vaults (for each asset in the pool) must be deployed and initialized.
- The AMM pool must exist.
- You need the addresses of both vaults and the pool.

Note, that in many places all across the T-Dex, **left** and **right** adjectives used to describe asset vaults. Indeed, for determinism in on-chain operations and predictable addresses, vaults should be sorted and used based on their ordering. Vaults are sorted by their contracts addresses. TODO: link vault ordering from vaults docs

### Step-by-step

1. **Deploy the Liquidity Deposit Contract**  
   This contract coordinates the atomic addition of both assets. It is created for each deposit operation and destroyed after use.

TLB for storage and initial data is:

```tlb
_ leftVault:MsgAddress
  rightVault:MsgAddress
  leftSideAmount:Coins
  rightSideAmount:Coins
  depositor:MsgAddress
  contractId:uint64
  status:uint3
  leftAdditionalParams:(Maybe AdditionalParams)
  rightAdditionalParams:(Maybe AdditionalParams) = LiquidityDepositContractData;
```

`contractId` is on-chain salt, so several contracts with similar other parameters could exist. You can use current logical time as good enough salt. Note, that after the

`status` should always be 0 on deploy.

- 0 - liquidity provisioning not started
- 1 - left side is filled
- 2 - right side is filled
- 3 - both sides are filled

`leftAdditionalParams` and `rightAdditionalParams` should always be null on deploy. These fields are needed to store the payloads from the vaults, they are filled when `PartHasBeenDeposited` messages are accepted by the `LiquidityDepositContract`.

Initial data example on Typescript using Tact-generated wrappers:

```ts
const LPproviderContract = await LiquidityDepositContract.fromInit(
    sortedAddresses.lower, // sorted vaults addresses for determinism
    sortedAddresses.higher,
    amountLeft,
    amountRight,
    deployerWallet.address, // deployer is depositor
    0n, // 0 as contractId salt
    0n, // these 3 fields should always be "0, null, null" on deploy
    null,
    null,
)
```

2. **Deposit Asset A and Asset B**

    - Send a transfer to each vault (TON or Jetton) with a special payload referencing the Liquidity Deposit contract.
    - The payload must include:
        - The address of the Liquidity Deposit contract
        - The amount to deposit
        - (Optional) Minimum amount to accept, timeout, and callback payloads

For Jetton vaults, use a jetton transfer with a forward payload created by a helper like `createJettonVaultLiquidityDepositPayload`.  
For TON vaults, send a TON transfer with a similar payload.

TLB for adding liquidity:

```tlb
_ minAmountToDeposit:Coins
  lpTimeout:uint32
  payloadOnSuccess:(Maybe ^Cell)
  payloadOnFailure:(Maybe ^Cell) = AdditionalParams;

add_liquidity_part_ton#1b434676
    liquidityDepositContract:MsgAddress
    amountIn:Coins
    additionalParams:AdditionalParams = AddLiquidityPartTon;

add_liquidity_part_jetton#64c08bfc
    liquidityDepositContract:MsgAddress
    additionalParams:AdditionalParams
    proofType:(##8) {proofType = 0} = AddLiquidityJettonForwardPayload;
```

Each side (each asset) has its own `AdditionalParams`.

- `minAmountToDeposit` is minimal amount of this asset that you are willing to add to liquidity. It acts similar to the slippage in `exactIn` swaps. When given minimal amount on both assets, Amm pool tries to find ratio combination that will satisfy current constant product formula and add maximum possible amount (so the refund would be minimal). If it is not possible, both assets will be refunded to initial depositor.
- `lpTimeout` is an absolute Unix timestamp after which the transaction will not be executed (checked inside the AMM pool). Checks the **maximum** of both asset `lpTimeout` values.
- `payloadOnSuccess` is an optional reference cell, described [here](#payload-semantics)
- `payloadOnFailure` is an optional reference cell, described [here](#payload-semantics)

Same as with the [Jetton swap message](./swap.md#jetton-vault-swap-message), Jetton deposit liquidity message should be stored as inline forward payload in Jetton transfer notification.

3. **Vaults Notify the Liquidity Deposit Contract**  
   Each vault, upon receiving the deposit, sends a `PartHasBeenDeposited` message to the Liquidity Deposit contract.

4. **Liquidity Deposit Contract Notifies the AMM Pool**  
   Once both parts are received, the contract sends a message to the AMM pool to mint LP tokens.

5. **AMM Pool Mints LP Jettons**  
   The pool mints LP jettons to the depositor and, if necessary, returns any excess assets to the user if the deposit ratio was not exact.

Since T-Dex follows Uniswap V2 specification (TODO: add this section and cross-link to it), liquidity provisioning math is the same too.

If it is the first time liquidity is being added to the pool, than `sqrt(leftSideReceived * rightSideReceived)` lp token are minted to the depositor.

If it is **not** the first time, than minted lp tokens follow this formula:

```tact
 liquidityTokensToMint = min(
                muldiv(leftSideReceived, self.totalSupply, self.leftSideReserve -              leftSideReceived),
                muldiv(rightSideReceived, self.totalSupply, self.rightSideReserve - rightSideReceived),
            );
```

#### Example (Jetton Vault)

```typescript
const payload = createJettonVaultLiquidityDepositPayload(
    liquidityDepositContractAddress,
    /* proofCode, proofData, */ // for advanced use, TODO: add proof link
    minAmountToDeposit,
    lpTimeout,
    payloadOnSuccess,
    payloadOnFailure,
)
const depositLiquidityResult = await jettonWallet.sendTransfer(
    provider,
    sender,
    toNano("0.05"), // TON for fees
    jettonAmount,
    vaultAddress,
    responseAddress,
    null,
    toNano("0.01"),
    payload,
)
```

#### Example (TON Vault)

```typescript
const payload = createTonVaultLiquidityDepositPayload(
    liquidityDepositContractAddress,
    tonAmount,
    payloadOnSuccess,
    payloadOnFailure,
    minAmountToDeposit,
    lpTimeout,
)
// Send TON with this payload to the vault address
const res = await wallet.send({
    to: vault.address,
    value: tonAmount + toNano(0.2), // gas fee
    bounce: true,
    body: payload,
})
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
    successfulPayload,
)
await lpJettonWallet.sendBurn(
    provider,
    sender,
    toNano("0.05"), // TON for fees
    lpAmountToBurn,
    receiver,
    withdrawPayload,
)
```

### Notes

- You can specify minimum amounts to avoid receiving less than expected due to slippage.
- The withdrawal is atomic: you receive both assets or the operation fails.

## Summary

- **Add liquidity**: Deposit both assets to their vaults with a reference to the Liquidity Deposit contract. Receive LP jettons.
- **Remove liquidity**: Burn LP jettons with a withdrawal payload. Receive your share of both assets.

For more details, see the [Vaults documentation](../sources/contracts/vaults/vaultDoc.md) and the [AMM Pool contract](../sources/output/DEX_AmmPool.md).
