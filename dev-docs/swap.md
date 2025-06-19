# Swaps

This section of dev-docs focuses on how to perform on-chain asset swaps on Tact dex. Swap essentially is sending asset that you want to swap to it's corresponding vault and attaching message body with swap request details. Vault will then create swap-in message and send it to the Amm pool, which will handle the math and either return the funds if they don't pass the slippage or send payout message to the other vault (sometimes pool will perform this two actions together).

## Prerequisites

In this section and further we will use `asset-in` naming for the asset that we want to swap, and `asset-out` for the asset that we want to get as the result of the swap

To perform swap, you need:

- Both asset-in and asset-out vaults to be deployed and inited (TODO: add links to doc vaults page)
- Some liquidity in this assets` corresponding pool (you can't swap without liquidity)
- Address of the asset-in vault
- Address of the target pool

TODO: add section from factory docs page about how to get this addresses

## Kinds of swaps

Tact dex support the total of 3 kinds of swaps:

1. `ExactIn` swaps
   This is default type of swaps that is supported on the major of other dexes. The semantics is that you send some amount in and specify the **minimum** amount out that you are willing to receive. The pool uses it's internal math and either perform the swap with amount out greater or even to the one you have specified or refunds the in-value back to you.
2. `ExactOut` swaps
   In this kind of swap instead of specifying the minimal out-value that you want to receive, you specify the exact out-value that you want to receive. Based on this, the pool will do one of the three possible actions:
    - just perform the swap if the value-in inside the amm equals exactly the value-out;
    - refund value-in to the sender if the value-in is less that what is needed for specified exact amount-out;
    - perform the swap _and_ refund some of the value-in to the sender - this would happen if constant product formula inside amm pool had shifted the other way and value-in is greater than what is needed for exact value-out;
3. `ExactIn multihop` swaps
    Someone can argue that this is not really 3rd kind but more like 2.5, because the semantics of these swaps is similar to exact-in swaps, the only difference is that after the successful swap value-out is sent not to the receiver, but to the another pool, as next swap message with `swap-params`.

## Swap message

Swap messages differ from one vault to another, however they have similar part that is called `SwapRequest`.

TLB for this common part looks like this:

```tlb
_ isExactOutType:Bool
  cashbackAddress:(Maybe MsgAddress)
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

- `isExactOutType` is a boolean field that
