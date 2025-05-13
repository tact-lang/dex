# Vaults

## Common Interface

- Vault must handle storage fees by itself.
- Any Vault must implement the following interface to interact with other system components:

### Sending Swap Request

Protocol for receiving funds that initiate Swap is implementation defined.

**NOTE:** This message must be sent with `bounceable` flag set to `false` to pay for AmmPool storage fees.

```tact
message(0xac2f5a38) SwapIn {
    amount: Int as uint256;
    minAmountOut: Int as uint256;
    timeout: Int as uint32; // Absolute unix timestamp
    swapOutReceiver: Address;
}
```

### Receiving a Payout Request

**NOTE:** This message must never fail on a correct swap chain, so AmmPool should set `bounceable` flag to `false` to pay for StorageFees of _vault_ contract

```tact
message(0x74f7a60) PayoutFromPool {
    inVault: Address; // For proofing purposes
    amount: Int as uint256;
    receiver: Address;
}
```

### Receiving a Request to Save Funds for Subsequent Liquidity Addition

Protocol for receiving funds that initiate Liquidity Provision is implementation defined.

It is the message that should be sent to the LiquidityDeposit contract

```tact
message(0xe7a3475f) PartHasBeenDeposited {
    depositor: Address;
    amount: Int as uint256;
    lpDeadline: Int as uint32;
}
```

### Proofing (Jetton Vault)

There are four kinds of proof of `jettonWallet`:

1. **TEP-89 proof** (discoverable)
2. **StateInit proof** (for non-vanity jettons)
3. **State proof for vanity jettons** (Proof for block)
4. **Jetton Burn proof** (We try to burn zero jettons and wait for excess from `JettonMaster`)
