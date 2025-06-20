# Swaps

This section of dev-docs focuses on how to perform on-chain asset swaps on Tact dex. Swap essentially is sending asset that you want to swap to it's corresponding vault and attaching message body with swap request details. Vault will then create swap-in message and send it to the Amm pool, which will handle the math and either return the funds if they don't pass the slippage or send payout message to the other vault (sometimes pool will perform this two actions together).

## Prerequisites

In this section and further we will use `asset-in` naming for the asset that we want to swap, and `asset-out` for the asset that we want to get as the result of the swap

To perform swap, you need:

- Both asset-in and asset-out vaults to be deployed and inited (TODO: add links to doc vaults page)
- Some liquidity in these assets corresponding pool (you can't swap without liquidity)
- Address of the asset-in vault
- Address of the target pool

TODO: add section from factory docs page about how to get this addresses

## Kinds of swaps

Tact dex support the total of 3 kinds of swaps:

1. `ExactIn` swaps
   This is default type of swaps that is supported on the major of other dexes. The semantics is that you send some amount-in and specify the **minimum** amount-out that you are willing to receive. The pool uses it's internal math and either perform the swap with amount-out greater or equal to the one you have specified or refunds the in-value back to you.
2. `ExactOut` swaps
   In this kind of swap instead of specifying the minimal out-value that you want to receive, you specify the **exact** out-value that you want to receive. Based on this, the pool will do one of the three possible actions:
    - just perform the swap if the value-in inside the amm equals exactly the value-out;
    - refund value-in to the sender if the value-in is less that what is needed for specified exact amount-out;
    - perform the swap _and_ refund some of the value-in to the sender - this would happen if constant product formula inside amm pool had shifted the other way and value-in is greater than what is needed for exact value-out;
3. `ExactIn multihop` swaps
   Someone can argue that this is not really 3rd kind but more like 2.5, because the semantics of these swaps is similar to exact-in swaps, the only difference is that after the successful swap, value-out is sent not to the receiver, but to the another pool, as next swap message with `swap-params`. As the result, it is possible to perform chain of swaps all inside single transaction trace inside the dex. Important aspect is that if the i-th swap in chain fails (e.g. slippage), the pool will send the result of the last successful swap to the receiver (so for example, if the chain we want to swap is TON -> USDT -> TON and USDT -> TON swap fails because course changed, the user will receive USDT as the swap result);

## Swap message

Swap messages differ from one vault to another, however they have similar part that is called `SwapRequest`.

### Swap request struct

TLB for this common part looks like this:

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

Let's break down the meaning of fields in these structs:

- `pool` is straight-forward address of the Amm pool contract for your asset-in and asset-out.

- `receiver` is an optional address field for the receiver of the swap result. If the sender leaves it as null, it will default to the senders' address.

- `params` is inline struct that holds parameters of the swap, now we will look at the fields inside it.

- `isExactOutType` is a boolean field that specifies [swap type](#kinds-of-swaps). True - swap is `exactOut`, false - swap is `exactIn` or `exactIn multihop`.

- `cashbackAddress` is an optional address field (to set it to null, use `address_none`) that is needed only for `exactOut` swaps. This is the address, where unused tokens will be sent. If the swapType is `exactIn`, this value is ignored. If the swapType is `exactOut`, but this value is null, then unused tokens will be sent to the `receiver` address.

- `desiredAmount` - if swapType is `exactIn`, then `desiredAmount` is minimal amount trader is willing to receive as the result of the swap (amount-out). If swapType is `exactOut`, then `desiredAmount` is the exact value-out that trader wants to receive.

- `timeout` - absolute unix timestamp after which the transaction won't be executed (checked inside the amm pool). Can be specified as 0 to disable timeout check.

- `payloadOnSuccess` is optional reference cell, described [here](#payload-semantics)

- `payloadOnFailure` is optional reference cell, described [here](#payload-semantics)

- `nextStep` is optional inline struct for multihop swaps, described [here](#multihop-swaps)

Given this common struct, we can look at how different vault swap messages are created.

### Jetton vault swap message

You need to construct swap message in such way if you want to swap jettons to some other asset.

To create jetton swap message, `forwardPayload` in jetton transfer should be stored **inline** and look like this:

```tlb
_#bfa68001 swapRequest:^SwapRequest proofType {proofType = 0} = SwapRequestForwardPayload;
```

Proof type is part of general jetton vault notification message struct, in Tact it is:

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

So, for simple transfer, you should just store 0 as uint8 after the `SwapRequest` ref cell.

Then, you need to send jetton transfer message with such forward payload to the jetton vault.

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
    vault.address, // where to send jettons to
    walletOwner.address, // excesses address ()
    null, // custom payload
    toNano(0.5), // forward ton amount
    swapForwardPayload, // should be stored inline, meaning
    // builder.storeBit(0).storeSlice(payload)
)
```

You can check more details on swap serialization inside [test helpers](../sources/utils/testUtils.ts).

### Ton vault swap message

You need to construct swap message in such way if you want to swap ton to some other asset.

TLB for ton swap message is quite simple:

```tlb
swap_request_ton#698cba08
    amount:Coins
    action:SwapRequest = SwapRequestTon;
```

`Amount` is the amount that you want to swap. In you are wondering, why there is no `amount` field in jetton swap message, it's because amount is already specified (and handled) in the jetton notification.

Note, that the value that you attach to the swap message with `SwapRequestTon` should be always be greater than `amount`, because of blockchain fees.

## Multihop swaps

To send multihop swap, you will need to send `exactIn` swap with filled `swapStep` field:

```tlb
_ pool:MsgAddress
  minAmountOut:Coins
  nextStep:(Maybe ^SwapStep) = SwapStep;
```

This field is the beginning of the linked list, where every next node is next swap step in the swap chain. `pool` is the next pool that you want to send your asset to, note that specified pool should include previous step asset as one of its own (in other words you can't do swap chain TON -> USDT and then BOLT -> TON, since you can only send USDT to some other pool with USDT as one of the assets in it).

## Payload semantics

In Tact dex it is possible to attach `payloadOnSuccess` and `payloadOnFailure` to swap messages as optional reference cells. These payloads serve as a way to interact with protocol on-chain and use them as async callbacks or notifications after swaps and/or refunds.

If the user attached them to the swap message, one of this payloads (depended on what action has happened) will be attached in vaults `payout` message (TLB of how the asset is delivered after the vault payout is asset-dependent TODO: add link to vaults section with payout message structs).

**Failure payload** is attached to the payout message when:

- Swap value-in is refunded back to the sender because timeout check failed
- Swap value-in is refunded back to the sender because there is no liquidity in the pool yet
- Swap value-in is refunded back to the sender because swap type is `exactIn` and value-out is less than the sender wants (slippage doesn't pass)
- Swap value-in is refunded back to the sender because swap type is `exactOut` and desired amount-out is greater than pool reserves
- Swap value-in is refunded back to the sender because swap type is `exactOut` and value-in is insufficient for specified exact value-out

**Success payload** is attached to the payout message when:

- Swap is successful, amount-out is sent to the receiver
- Swap is successful, swap type is `exactOut` and value-in is more than is needed for specified exact amount-out, so excesses of value-in are refunded to the `cashbackAddress` (`payloadOnSuccess` will be attached both to this refund payout message **and** to the value-out payout message)
