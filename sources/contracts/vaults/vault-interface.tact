import "../core/liquidity-deposit.tact";
import "../core/messages.tact";

struct SwapStep {
    pool: Address;
    // Here we don't specify swapType as it is always exactIn for multihop swaps
    minAmountOut: Int as coins;
    // Actually it is SwapStep, but Tact doesn't support recursive structs
    nextStep: Cell? = null;
}

const SwapRequestOpcode: Int = 0xbfa68001;
struct SwapRequest {
    pool: Address;
    // If receiver is not specified, then it will be the sender of TONs or Jettons
    receiver: Address?;
    // false - exactIn type. True - exactOut type.
    // Note, that exactOut type doesn't support multihop swaps.
    isExactOutType: Bool;
    // If swapType is exactIn, then limit is minAmountOut
    // If swapType is exactOut, then limit is maxAmountIn
    limit: Int as coins;
    // amountIn is part of the jetton notification
    timeout: Int as uint32;
    payloadOnSuccess: Cell? = null;
    payloadOnFailure: Cell? = null;

    nextStep: SwapStep? = null;
}

const LPDepositPartOpcode: Int = 0x64c08bfc;
struct LPDepositPart {
    // TODO: We should add an option to deploy liquidity deposit contract here
    liquidityDepositContract: Address;
    additionalParams: AdditionalParams;
}

message(0x698cba08) SwapRequestTon {
    amount: Int as coins;
    action: SwapRequest;
}

message(0x1b434676) AddLiquidityPartTon {
    liquidityDepositContract: Address;
    amountIn: Int as coins;
    additionalParams: AdditionalParams;
}

trait VaultInterface {
    receive(msg: PayoutFromPool) {
        self.handlePayout(msg);
    }

    abstract fun handlePayout(msg: PayoutFromPool);
}
