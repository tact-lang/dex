# AmmPool Docs

## Liquidity Provision

This message is used to notify LP Deposit Contract that Vault successfully accepted liquidity.

```tact
message(0xe7a3475f) PartHasBeenDeposited {
    depositor: Address;
    amount: Int as uint256;
    additionalParams: AdditionalParams;
}

struct AdditionalParams {
    minAmountToDeposit: Int as uint256;
    lpTimeout: Int as uint32;
    payloadOnSuccess: Cell? = null;
    payloadOnFailure: Cell? = null;
}
```

We have 2 types of swaps -- exactIn and exactOut.

1. **ExactIn** The user specifies the amount of tokens they want to swap, and the contract calculates how much of the other token they will receive.
2. **ExactOut** The user specifies the amount of tokens they want to receive, and the contract calculates how much of the other token they need to swap.

However, exactOutSwaps can't be used in multihop swaps, so user shouldn't request exactOut swaps in multihop swaps.

## Token Flow in exactOut Swaps

In exactOut swaps, the token flow differs from exactIn swaps:

1. When a user requests an exactOut swap, they must send more tokens than might be needed to fulfill the desired output amount. This is because the exact input amount can only be calculated after evaluating the pool's reserves.

2. If the swap succeeds, the specified `desiredAmount` of output tokens are sent to the `receiver` address.

3. Any excess input tokens (tokens that weren't needed for the swap) are returned to the address specified in `params.cashbackAddress`. If no `cashbackAddress` is specified, the excess tokens are returned to the `receiver` address.

4. If there are no excess input tokens, the `params.cashbackAddress` will not receive any tokens.

This mechanism ensures users always get the exact number of output tokens they requested, while any excess input tokens are properly returned.
ExactOut swaps have these semantics because they are primarily designed for instantly exchanging and transferring a specific amount of tokens to someone. For example, if you need to send exactly 100 USDT to a recipient, you can use an exactOut swap to convert your TON to exactly 100 USDT and send it in one transaction. This approach can be used in the future for native implementation of convenient on-chain orders.

**NOTE:** As we have two payloads for each size, so both payloads will be delivered to depositor
**NOTE:** As we have to lpTimeout, so max(leftTimeout, rightTimeout) will be chosen.
