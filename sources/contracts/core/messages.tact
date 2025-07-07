//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import "../vaults/vault-interface";
import "./liquidity-deposit";

message(0xac2f5a38) SwapIn {
    // The value trader sent to the pool.
    amount: Int as coins;
    receiver: Address;
    params: SwapParameters;
    // For multihop swaps
    multihopInfo: MultihopInfo? = null;
}

struct MultihopInfo {
    leftVault: Address;
    rightVault: Address;
    outVault: Address;
}

message(0x74f7a60) PayoutFromPool {
    otherVault: Address; // For proofing purposes
    amount: Int as coins;
    receiver: Address;
    payloadToForward: Cell? = null;
}

// We are using USDT-like mint opcode for liquidity deposit
// So this operation will be nicely displayed in Tonviewer
message(0x642b7d07) LiquidityDeposit {
    lpTokensReceiver: Address;
    contractId: Int as uint64;
    leftAmount: Int as coins;
    rightAmount: Int as coins;
    leftAdditionalParams: AdditionalParams;
    rightAdditionalParams: AdditionalParams;
}

// https://docs.uniswap.org/contracts/v2/reference/smart-contracts/router-02#removeliquidity
struct LiquidityWithdrawParameters {
    /// Minimal amount of left asset to receive
    leftAmountMin: Int as coins;
    /// Minimal amount of right asset to receive
    rightAmountMin: Int as coins;
    /// Absolute unix timestamp
    timeout: Int as uint32;
    /// Receiver of withdrawn jettons
    receiver: Address;
    /// Payload to forward with withdrawn tokens
    liquidityWithdrawPayload: Cell?;
}

// JettonBurnNotification
message(0x7bdd97de) LiquidityWithdrawViaBurnNotification {
    queryId: Int as uint64;
    amount: Int as coins;
    sender: Address;
    responseDestination: Address?;
    forwardPayload: LiquidityWithdrawParameters;
}

// For LP tokens minting
message(0x178d4519) MintViaJettonTransferInternal {
    queryId: Int as uint64;
    amount: Int as coins;
    sender: Address;
    sendAllTonsInNotifyFlag: Bool;
    responseDestination: Address?;
    forwardTonAmount: Int as coins;
    forwardPayload: Slice as remaining;
}

struct AdditionalParams {
    minAmountToDeposit: Int as coins;
    lpTimeout: Int as uint32;
    payloadOnSuccess: Cell? = null;
    payloadOnFailure: Cell? = null;
}
