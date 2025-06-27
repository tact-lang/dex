# Swaps

This section of the dev-docs focuses on how to perform on-chain asset swaps on T-Dex. A swap essentially involves sending the asset you want to swap to its corresponding vault and attaching a message body with the swap request details. The vault will then create a swap-in message and send it to the AMM pool, which will handle the math and either return the funds if they do not pass the slippage check or send a payout message to the other vault (sometimes the pool will perform both actions together).

## Prerequisites

In this section and beyond, we will use `asset-in` to refer to the asset you want to swap, and `asset-out` for the asset you want to receive as the result of the swap.

To perform a swap, you need:

- Both asset-in and asset-out vaults to be deployed and initialized (TODO: add links to the vaults documentation page)
- Sufficient liquidity in the corresponding pool (you cannot swap without liquidity)
- The address of the asset-in vault
- The address of the target pool

TODO: add section from the factory docs page about how to obtain these addresses

## Kinds of swaps

T-Dex supports a total of three kinds of swaps:

1. `ExactIn` swaps
   This is the default type of swap supported by most other DEXes. The semantics are that you send some amount-in and specify the **minimum** amount-out you are willing to receive. The pool uses its internal math and either performs the swap with an amount-out greater than or equal to what you specified, or refunds the in-value back to you.
2. `ExactOut` swaps
   In this kind of swap, instead of specifying the minimum out-value you want to receive, you specify the **exact** out-value you want to receive. Based on this, the pool will do one of three possible actions:
    - Just perform the swap if the value-in inside the AMM equals exactly the value-out;
    - Refund value-in to the sender if the value-in is less than what is needed for the specified exact amount-out;
    - Perform the swap _and_ refund some of the value-in to the sender—this would happen if the constant product formula inside the AMM pool shifted the other way and value-in is greater than what is needed for the exact value-out;
3. `ExactIn multihop` swaps
   Some might argue that this is not really a third kind but more like 2.5, because the semantics of these swaps are similar to exact-in swaps. The only difference is that after a successful swap, the value-out is sent not to the receiver, but to another pool, as the next swap message with `swap-params`. As a result, it is possible to perform a chain of swaps all inside a single transaction trace within the DEX. An important aspect is that if the i-th swap in the chain fails (e.g., due to slippage), the pool will send the result of the last successful swap to the receiver (for example, if the chain you want to swap is TON -> USDT -> TON and the USDT -> TON swap fails because the rate changed, the user will receive USDT as the swap result).

## Swap message

Swap messages differ from one vault to another, but they share a similar part called `SwapRequest`.

### Swap request struct

The TLB for this common part looks like this:

```tlb
_ isExactOutType:Bool
  cashbackAddress:MsgAddress
  desiredAmount:Coins
  timeout:uint32
  payloadOnSuccess:(Maybe ^Cell)
  payloadOnFailure:(Maybe ^Cell)
  nextStep:(Maybe SwapStep) = SwapParameters;

_ pool:MsgAddress
  receiver:(Maybe MsgAddress)
  params:SwapParameters = SwapRequest;
```

Let's break down the meaning of the fields in these structs:

- `pool` is the address of the AMM pool contract for your asset-in and asset-out.

- `receiver` is an optional address field for the receiver of the swap result. If the sender leaves it as null, it will default to the sender's address.

- `params` is an inline struct that holds the parameters of the swap. We will now look at the fields inside it.

- `isExactOutType` is a boolean field that specifies the [swap type](#kinds-of-swaps). True means the swap is `exactOut`, false means the swap is `exactIn` or `exactIn multihop`.

- `cashbackAddress` is an optional address field (to set it to null, use `address_none`) that is needed only for `exactOut` swaps. This is the address where unused tokens will be sent. If the swap type is `exactIn`, this value is ignored. If the swap type is `exactOut` but this value is null, then unused tokens will be sent to the `receiver` address.

- `desiredAmount`— if the swap type is `exactIn`, then `desiredAmount` is the minimum amount the trader is willing to receive as the result of the swap (amount-out). If the swap type is `exactOut`, then `desiredAmount` is the exact value-out that the trader wants to receive.

- `timeout`— an absolute Unix timestamp after which the transaction will not be executed (checked inside the AMM pool). Can be specified as 0 to disable the timeout check.

- `payloadOnSuccess` is an optional reference cell, described [here](#payload-semantics)

- `payloadOnFailure` is an optional reference cell, described [here](#payload-semantics)

- `nextStep` is an optional inline struct for multihop swaps, described [here](#multihop-swaps)

Given this common struct, we can look at how different vault swap messages are created.

### Jetton vault swap message

You need to construct the swap message in this way if you want to swap jettons for another asset.

To create a jetton swap message, the `forwardPayload` in the jetton transfer should be stored **inline** and look like this:

```tlb
_#bfa68001 swapRequest:^SwapRequest proofType:(##8) {proofType = 0} = SwapRequestForwardPayload;
```

Proof type is part of the general jetton vault notification message struct. In Tact it is:

```tact
message(0x7362d09c) JettonNotifyWithActionRequest {
    queryId: Int as uint64;
    amount: Int as coins;
    sender: Address;
    eitherBit: Bool; // Should be 0, so other fields are stored inline
    actionOpcode: Int as uint32;
    actionPayload: Cell; // Obligatory ref
    proofType: Int as uint8; // 0 - No proof attached, 1 - TEP-89, 2 - StateInit, 3 - State, 4 - Jetton Burn
    proof: Slice as remaining;
```

So, for a simple transfer, you should just store 0 as uint8 after the `SwapRequest` ref cell.

Then, you need to send a jetton transfer message with such a forward payload to the jetton vault.

```ts
const swapForwardPayload = createJettonVaultSwapRequest(
    destinationPool,
    isExactOutType,
    desiredAmount,
    timeout,
    cashbackAddress,
    payloadOnSuccess,
    payloadOnFailure,
    nextStep,
    receiver,
)
const swapResult = await userJettonWallet.sendTransfer(
    walletOwner.getSender(),
    toNano(1), // attached ton value
    jettonSwapAmount,
    vault.address, // where to send jettons
    walletOwner.address, // excesses address
    null, // custom payload
    toNano(0.5), // forward ton amount
    swapForwardPayload, // should be stored inline, meaning
    // builder.storeBit(0).storeSlice(payload)
)
```

You can check more details on swap serialization inside [test helpers](../sources/utils/testUtils.ts).

### Ton vault swap message

You need to construct the swap message in this way if you want to swap TON for another asset.

The TLB for the TON swap message is quite simple:

```tlb
swap_request_ton#698cba08
    amount:Coins
    action:SwapRequest = InMsgBody;
```

`Amount` is the amount you want to swap. If you are wondering why there is no `amount` field in the jetton swap message, it is because the amount is already specified (and handled) in the jetton notification.

Note that the value you attach to the swap message with `SwapRequestTon` should always be greater than `amount`, because of blockchain fees. TODO: link to the fees paragraph

## Multihop swaps

To send a multihop swap, you will need to send an `exactIn` swap with the `swapStep` field filled:

```tlb
_ pool:MsgAddress
  minAmountOut:Coins
  nextStep:(Maybe ^SwapStep) = SwapStep;
```

This field is the beginning of a linked list, where each next node is the next swap step in the swap chain. `pool` is the next pool to which you want to send your asset. Note that the specified pool should include the previous step's asset as one of its own (in other words, you cannot do a swap chain TON -> USDT and then BOLT -> TON, since you can only send USDT to another pool that has USDT as one of its assets).

## Payload semantics

In T-Dex, it is possible to attach `payloadOnSuccess` and `payloadOnFailure` to swap messages as optional reference cells. These payloads serve as a way to interact with the protocol on-chain and use them as async callbacks or notifications after swaps and/or refunds.

If the user attaches them to the swap message, one of these payloads (depending on what action has happened) will be attached in the vault's `payout` message (the TLB of how the asset is delivered after the vault payout is asset-dependent. TODO: add link to the vaults section with payout message structs).

**Failure payload** is attached to the payout message when:

- Swap value-in is refunded back to the sender because the timeout check failed
- Swap value-in is refunded back to the sender because there is no liquidity in the pool yet
- Swap value-in is refunded back to the sender because the swap type is `exactIn` and value-out is less than the sender wants (slippage does not pass)
- Swap value-in is refunded back to the sender because the swap type is `exactOut` and the desired amount-out is greater than pool reserves
- Swap value-in is refunded back to the sender because the swap type is `exactOut` and value-in is insufficient for the specified exact value-out

**Success payload** is attached to the payout message when:

- The swap is successful and amount-out is sent to the receiver
- The swap is successful, the swap type is `exactOut`, and value-in is more than is needed for the specified exact amount-out, so the excess value-in is refunded to the `cashbackAddress` (`payloadOnSuccess` will be attached both to this refund payout message **and** to the value-out payout message)
