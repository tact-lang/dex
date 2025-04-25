import "../core/liquidity-deposit.tact";

const SwapRequestOpcode: Int = 0xbfa68001;
struct SwapRequest {
    // TODO: Think about what we want to specify here.
    // We want to specify destination vault here, or destination ammPool
    // Maybe we can even allow to specify anything
    destinationVault: Address;
    minAmountOut: Int as coins;
    // amountIn is part of the jetton notification
    timeout: Int as uint32;
    payloadOnSuccess: Cell? = null;
    payloadOnFailure: Cell? = null;
}

const LPDepositPartOpcode: Int = 0x64c08bfc;
struct LPDepositPart {
    // TODO: We should add an option to deploy liquidity deposit contract here
    liquidityDepositContract: Address;
    additionalParams: AdditionalParams;
}
