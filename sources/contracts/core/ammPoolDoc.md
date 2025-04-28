# AmmPool Docs

## Liquidity Provision

This message is used to notify LP Deposit Contract, that Vault successfully accepted liquidity.

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

**NOTE:** As we have 2 payloads for each size, so both payloads will be delivered to depositor
**NOTE:** As we have to lpTimeout, so max(leftTimeout, rightTimeout) will be chosen.
