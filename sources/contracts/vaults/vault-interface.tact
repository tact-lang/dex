//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import "../core/messages.tact";

struct SwapStep {
    pool: Address;
    // Here we don't specify swapType as it is always exactIn for multihop swaps
    // therefore desiredAmount here is named minAmountOut
    minAmountOut: Int as coins;
    // Actually it is SwapStep too, but Tact doesn't support recursive structs
    nextStep: Cell? = null;
}

const SwapRequestOpcode: Int = 0xbfa68001;
struct SwapRequest {
    pool: Address;
    // If receiver is not specified, then it will be the sender of the asset
    receiver: Address?;
    params: SwapParameters;
}

struct SwapParameters {
    // false - exactIn type. True - exactOut type.
    // Note, that exactOut type doesn't support multihop swaps.
    // If you specify nextStep for exactOut swap, it will be ignored.
    isExactOutType: Bool;
    // This value is needed only for exactOut swaps.
    // This is the address, where unused tokens will be sent.
    // If the swapType is exactIn, this value is ignored.
    // If the swapType is exactOut but this value is null, then unused tokens will be sent to the receiver.
    cashbackAddress: Address? = null;
    // If swapType is exactIn, then desiredAmount is minimal amount trader can receive
    // If swapType is exactOut, then desiredAmount is exactValue trader wants to get
    desiredAmount: Int as coins;
    // Absolute unix timestamp
    timeout: Int as uint32;
    payloadOnSuccess: Cell? = null;
    payloadOnFailure: Cell? = null;

    nextStep: SwapStep? = null;
}

extends inline fun numberOfHops(self: SwapParameters): Int {
    // If there is no nextStep, or it is exactOut swap, then we will have only one swap on first AmmPool.
    if (self.nextStep == null || self.isExactOutType == true) {
        return 1;
    } else {
        // 1 usual swap + 1 next step + nextStep's depth
        return self.nextStep!!.nextStep.depth() + 2;
    }
}

message(0x2d8b123a) PayoutFromTonVault {
    body: Cell?;
}

struct LiquidityDepositInitData {
    otherVault: Address;
    otherAmount: Int as coins;
    contractId: Int as uint64;
}

struct LiquidityDepositEitherAddress {
    eitherBit: Bool;
    liquidityDepositContract: Address?;
    initData: LiquidityDepositInitData?;
}

const LPDepositPartOpcode: Int = 0x64c08bfc;
struct LPDepositPart {
    liquidityDepositContractData: LiquidityDepositEitherAddress;
    additionalParams: AdditionalParams;
    // If this field is null, then the LP tokens will be sent to the sender of the message
    lpTokensReceiver: Address?;
}

message(0x698cba08) SwapRequestTon {
    amount: Int as coins;
    action: SwapRequest;
}

message(0x1b434676) AddLiquidityPartTon {
    amountIn: Int as coins;
    liquidityDepositContractData: LiquidityDepositEitherAddress;
    additionalParams: AdditionalParams;
    // If this field is null, then the LP tokens will be sent to the sender of the message
    lpTokensReceiver: Address?;
}

message(0xe7a3475f) PartHasBeenDeposited {
    amount: Int as coins;
    additionalParams: AdditionalParams;
    // This field is needed to not add a (LP-Deposit -> AmmPool) dependency
    ammPoolCode: Cell;
}

trait VaultInterface {
    receive(msg: PayoutFromPool) {
        self.handlePayout(msg);
    }

    abstract inline fun handlePayout(msg: PayoutFromPool);
}
