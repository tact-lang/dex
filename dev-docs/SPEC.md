# DEX Development Specification

## Error Messages Format

### Prefixing Requirements with Contract Name

All `require` statements must include the contract name as a prefix in error messages. This helps with debugging and quickly identifying which contract threw an error.

**❌ Don't:**

```tact
require(false, "Liquidity provision failed due to timeout");
```

**✅ Do:**

```tact
require(false, "Pool: Liquidity provision failed due to timeout");
```

This practice significantly simplifies debugging, as developers can immediately identify the source contract without needing to switch between contract files and test files repeatedly.

## Message Handling

### Internal Protocol Messages

#### Unbounceable Messages Requirement

All internal messages within the protocol **must** be sent as unbounceable messages. The DEX protocol explicitly does not handle bounced messages as a design decision because:

1. In the case of DEX operations, the bounce message body is too small to include the address of the funds recipient
2. Handling bounces adds complexity that can be avoided with proper design

#### StorageFee Handling

Using unbounceable internal messages provides a significant advantage for handling storage fees:

- When an unbounceable internal message is received, funds are automatically spent to cover storage fees
- This eliminates the need for:
    - Using `rawReserve` in every message handler
    - Complex storage fee calculations
    - Additional code to ensure contract storage is paid for

This approach results in cleaner, more efficient code with simplified message handling logic.

## More about StorageFee Handling

- There are no any fees handling in `factory` contract, as adding this will increase gas consumption but won't provide any benefits. (Factory contract can't break any invariants)
