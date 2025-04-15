const SwapRequestOpcode: Int = 0xbfa68001;
struct SwapRequest {
    // We can specify destination vault here
    // Or we can specify ammPool address here, which I think is better
    destinationVault: Address;
    minAmountOut: Int as uint256;
    // amountIn is part of the jetton notification
    timeout: Int as uint32;
}

const VaultDepositOpcode: Int = 0x64c08bfc;
struct VaultDeposit {
    liquidityDepositContract: Address;
}
