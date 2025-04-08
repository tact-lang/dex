# Vaults

## Common Interface

Any Vault must implement the following interface to interact with other system components:

### Receiving a Payout Request

```tact
message(0x74f7a60) PayoutFromPool {
    inVault: Address; // For proofing purposes
    amount: Int as uint256;
    receiver: Address;
}
```

### Receiving a Request to Save Funds for Subsequent Liquidity Addition

(It depends on the specific pool)

(Message that should be sent to the LiquidityDeposit contract)

```tact
message(0xe7a3475f) PartHasBeenDeposited {
    depositor: Address;
    amount: Int as uint256;
}
```
