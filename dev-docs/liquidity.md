# Liquidity management

This section explains how to add and remove liquidity in T-Dex, enabling users to participate as liquidity providers and earn a share of trading fees.

## Overview

T-Dex uses asset-abstraction system with vaults for each pool. This means that pool operates assets liquidity independently of vaults type (e.g., TON Vault and Jetton Vault). To add liquidity, you must deposit both assets into their respective vaults in the correct ratio. In return, you receive LP (liquidity provider) jettons, which represent your share of the pool. To withdraw liquidity, you burn your LP jettons and receive the underlying assets back.

## Adding Liquidity

### Prerequisites

- Both vaults (for each asset in the pool) must be deployed and initialized.
- You need the addresses of both vaults and the pool.

Note that throughout T-Dex documentation, the terms **left** and **right** are used to describe asset vaults. For determinism in on-chain operations and predictable addresses, vaults should be sorted and used based on their contract address ordering. (TODO: link vault ordering from vaults docs)

There are two ways one can deploy liquidity deposit contract.

The first one is to deploy liquidity deposit contract with standalone deploy message with state init attached and later only use plain `messages` to communicate liquidity deposit of asset parts.

The second option is to provide additional fields to the vault's liquidity deposit messages (`add_liquidity_part_ton#1b434676` or `lp_deposit_part#64c08bfc`), so they would deploy liquidity deposit contract themselves.

Note, that it is not recommended to use different approach for each one of the vaults - since TON is asynchronous, you can't make sure which liquidity deposit message will come first. So, if you attach state init only to one of the vault messages, it is possible to break an invariant and lose funds.

However, deploying lp provider in separate message and then depositing liquidity is totally fine as transactions in TON are sorted based on their LT.

### Step-by-step

1. First option: **Deploy the Liquidity Deposit Contract**  
   This contract coordinates the atomic addition of both assets. It is created for each deposit operation and destroyed after use.

TLB for storage and initial data:

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

- `contractId` is an on-chain salt, so several contracts with similar parameters can exist. You can use your wallet's logical time as a salt. After deployment, `status` should always be 0.
- `status` values:
    - 0: liquidity provisioning not started
    - 1: left side is filled
    - 2: right side is filled
    - 3: both sides are filled
- `leftAdditionalParams` and `rightAdditionalParams` should always be null on deploy. These fields are filled when `PartHasBeenDeposited` messages are accepted by the `LiquidityDepositContract`.

Initial data example in TypeScript using Tact-generated wrappers:

```ts
const LPproviderContract = await LiquidityDepositContract.fromInit(
    sortedAddresses.lower, // sorted vault addresses for determinism
    sortedAddresses.higher,
    amountLeft,
    amountRight,
    deployerWallet.address, // deployer is depositor
    0n, // contractId salt
    0n, // these 3 fields should always be "0, null, null" on deploy
    null,
    null,
)
```

Second option: Let vault `part_has_been_deposited#e7a3475f` messages to deploy liquidity deposit contract.

To enable this option, you should change deposit asset part.

    ```tlb
    _ otherVault:MsgAddress
        otherAmount:Coins
        contractId:uint64 = LiquidityDepositInitData;

    _ eitherBit:Bool
        liquidityDepositContract:MsgAddress
        initData:(Maybe LiquidityDepositInitData) = LiquidityDepositEitherAddress;
    ```

If you want to deploy the liquidity deposit contract yourself, set `eitherBit` to false and provide the `liquidityDepositContract` address, to which `PartHasBeenDeposited` messages will be sent.

However, if you want `PartHasBeenDeposited` messages to include the state init and deploy the liquidity deposit contract themselves, set `eitherBit` to true and attach the `LiquidityDepositInitData` struct.

- `otherVault` is the address of the other asset vault from which you are depositing liquidity.
- `otherAmount` is the amount of the other asset you want to deposit.
- `contractId` is an on-chain salt and can be any number (see the full description later).

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
    amountIn:Coins
    liquidityDepositContractData:LiquidityDepositEitherAddress
    additionalParams:AdditionalParams = AddLiquidityPartTon;

add_liquidity_part_jetton#64c08bfc
    liquidityDepositContractData:LiquidityDepositEitherAddress
    additionalParams:AdditionalParams
    proofType:(##8) {proofType = 0} = AddLiquidityJettonForwardPayload;
```

Read more about `proofType`, why it is needed and proof initialization here. (TODO: proof page link)

Each side (each asset) has its own `AdditionalParams`.

- `minAmountToDeposit` is the minimum amount of this asset you are willing to add to liquidity. It acts similarly to slippage in `exactIn` swaps. When minimum amounts are given for both assets, the AMM pool tries to find a ratio combination that satisfies the constant product formula and adds the maximum possible amount (so the refund is minimal). If this is not possible, both assets are refunded to the initial depositor.
- `lpTimeout` is an absolute Unix timestamp after which the transaction will not be executed (checked inside the AMM pool). The maximum of both assets `lpTimeout` values is used.
- `payloadOnSuccess` is an optional reference cell, described [here](#payload-semantics)
- `payloadOnFailure` is an optional reference cell, described [here](#payload-semantics)

As with the [Jetton swap message](./swap.md#jetton-vault-swap-message), the Jetton deposit liquidity message should be stored as an inline forward payload in the Jetton transfer notification.

3. **Vaults Notify the Liquidity Deposit Contract**  
   Each vault, upon receiving the deposit, sends a `PartHasBeenDeposited` message to the Liquidity Deposit contract.

4. **Liquidity Deposit Contract Notifies the AMM Pool**  
   Once both parts are received, the contract sends a message to the AMM pool to mint LP tokens.

5. **AMM Pool Mints LP Jettons**  
   The pool mints LP jettons to the depositor and, if necessary, returns any excess assets to the user if the deposit ratio was not exact.

T-Dex follows the Uniswap V2 specification (TODO: add this section and cross-link to it), so liquidity provisioning math is the same.

If it is the first time liquidity is being added to the pool, then `sqrt(leftSideReceived * rightSideReceived)` LP tokens are minted to the depositor.

If it is **not** the first time, minted LP tokens follow this formula:

```tact
liquidityTokensToMint = min(
    muldiv(leftSideReceived, self.totalSupply, self.leftSideReserve - leftSideReceived),
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
    toNano("0.6"), // TON for fees
    jettonAmount,
    vaultAddress,
    responseAddress,
    null,
    toNano("0.1"),
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
const depositLiquidityResult = await wallet.send({
    to: vault.address,
    value: tonAmount + toNano(0.5), // gas fee
    bounce: true,
    body: payload,
})
```

### Payload semantics

Similar to [Jetton swap message payloads](./swap.md#payload-semantics), you can attach `payloadOnSuccess` and `payloadOnFailure` to the liquidity deposit message as optional reference cells. These payloads allow you to interact with the protocol on-chain and use them as async callbacks or notifications after the liquidity deposit operation or refund.

If you attach them to the deposit message, one of these payloads (depending on the outcome) will be attached in the vault's `payout` message in case of refund (the TLB of how the asset is delivered after the vault payout is asset-dependent. TODO: add link to the vaults section with payout message structs) or it will be attached to the LP Jetton mint transfer notification (as a reference forward payload, TLB for this follows TEP-74).

**Failure payload** is attached to both payout refund messages when:

- Both deposit values are refunded because the timeout check failed
- Both deposit values are refunded because slippage is too high

**Success payload** is attached to the message when:

- Liquidity deposit is successful; both successful payloads are attached to the LP Jetton mint transfer notification

```tact
let successForwardPayload = beginCell()
    .storeBit(false) // Either bit equals 0
    .storeMaybeRef(msg.leftAdditionalParams.payloadOnSuccess)
    .storeMaybeRef(msg.rightAdditionalParams.payloadOnSuccess)
    .endCell()
    .beginParse();
```

- Liquidity deposit is successful, but some funds are refunded due to the constant product invariant; the success payload is attached to the vault payout message (TLB is asset-dependent)

If liquidity deposit is successful but one of the assets is refunded, the success payload from that asset's `AdditionalParams` will be attached to the refund payout message **and** both success payloads will be attached to the LP Jetton mint transfer notification.

## Removing Liquidity (Withdrawing)

To withdraw your share, you must burn your LP jettons. The AMM pool will send the corresponding amounts of each asset back to you.

### Step-by-step

1. **Burn LP Jettons**

    - Use your LP jetton wallet to send a burn message with a special payload to the AMM pool.
    - The payload should specify:
        - Minimum amounts of each asset you are willing to receive (to protect against slippage)
        - Timeout
        - Receiver address
        - (Optional) Successful payload

Note, that since jetton burn can be reverted from Jetton master (notification bounce reverts the Jetton wallet balance), there is no `failure payload` in this use-case.

TLB for liquidity withdrawal via LP jetton burn:

```tlb
_ leftAmountMin:Coins
  rightAmountMin:Coins
  timeout:uint32
  receiver:MsgAddress
  liquidityWithdrawPayload:(Maybe ^Cell) = LiquidityWithdrawParameters;

lp_withdraw_via_jetton_burn#595f07bc
    queryId:uint64
    amount:Coins
    responseDestination:MsgAddress
    customPayload:(Maybe ^Cell) = LPWithdrawViaJettonBurn;
```

Field explanations:

- `leftAmountMin`, `rightAmountMin`: minimum amounts of left/right assets to receive. They act like slippage for liquidity withdrawal.
- `timeout`: absolute unix timestamp for operation cancel.
- `receiver`: address to receive withdrawn assets.
- `liquidityWithdrawPayload`: optional payload to forward with withdrawn assets.

`LPWithdrawViaJettonBurn` follows TEP-74 for burning Jettons. However, `customPayload` should serialize to a `LiquidityWithdrawParameters` ref cell. If it is something else or `null`, liquidity withdrawal will be stopped. Also, since the LP Jetton wallet contract can handle bounces on burn from the Jetton minter (which is the AMM pool), all refunds and operation cancels (due to slippage, timeout, or other reasons) are done via throw+bounce.

2. **AMM Pool Processes Withdrawal**
    - The pool calculates the amounts to return based on your share.
    - If the minimums are met, the pool sends payouts from each vault to your address.
    - If not, the transaction is reverted.

If you provide `liquidityWithdrawPayload`, it will be attached to the payout message:

- For TON vault, it will be the whole body (empty if null).
- For Jetton vault, it will be serialized as a reference forward payload in the Jetton transfer notification.

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
    toNano("0.5"), // TON for fees
    lpAmountToBurn,
    receiver,
    withdrawPayload,
)
```

For more details and examples, see the [Vaults documentation](../sources/contracts/vaults/vaultDoc.md) and the [TypeScript testing environment](../sources/utils/environment.ts).
