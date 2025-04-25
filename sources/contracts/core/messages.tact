message(0xac2f5a38) SwapIn {
    amount: Int as coins;
    minAmountOut: Int as coins;
    timeout: Int as uint32; // Absolute unix timestamp
    swapOutReceiver: Address;
    payloadOnSuccess: Cell? = null;
    payloadOnFailure: Cell? = null;
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
    depositor: Address;
    contractId: Int as uint64;
    leftAmount: Int as coins;
    rightAmount: Int as coins;
    leftAdditionalParams: AdditionalParams;
    rightAdditionalParams: AdditionalParams;
}

// JettonBurnNotification
message(0x7bdd97de) LiquidityWithdrawViaBurnNotification {
    queryId: Int as uint64;
    amount: Int as coins;
    sender: Address;
    responseDestination: Address?;
    // Payload to forward with withdrawn tokens
    forwardPayload: Cell?;
}

// For LP tokens minting
message(0x178d4519) MintViaJettonTransferInternal {
    queryId: Int as uint64;
    amount: Int as coins;
    sender: Address;
    responseDestination: Address?;
    forwardTonAmount: Int as coins;
    forwardPayload: Slice as remaining;
}
