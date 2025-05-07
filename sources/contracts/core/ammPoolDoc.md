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

**NOTE:** As we have two payloads for each size, so both payloads will be delivered to depositor
**NOTE:** As we have to lpTimeout, so max(leftTimeout, rightTimeout) will be chosen.
