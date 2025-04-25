message(0xac2f5a38) SwapIn {
    amount: Int as uint256;
    minAmountOut: Int as uint256;
    timeout: Int as uint32; // Absolute unix timestamp
    swapOutReceiver: Address;
    payloadOnSuccess: Cell? = null;
    payloadOnFailure: Cell? = null;
}

message(0x74f7a60) PayoutFromPool {
    otherVault: Address; // For proofing purposes
    amount: Int as uint256;
    receiver: Address;
    payloadToForward: Cell? = null;
}

message(0x6752aa52) LiquidityDeposit {
    depositor: Address;
    contractId: Int as uint64;
    leftAmount: Int as uint256;
    rightAmount: Int as uint256;
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
