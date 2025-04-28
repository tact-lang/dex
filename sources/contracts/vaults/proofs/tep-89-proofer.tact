import "../../jettons/messages";

// As TEP-89 does not support forwardPayload, we need to use a separate contract
// This contract will store the request and will validate the proof.
message(0xb6a69dbc) TEP89ProofRequest {
    jettonMaster: Address;
    possibleJettonWallet: Address;
    action: Cell; // Actually it is JettonNotifyWithActionRequest, but is cheaper to store it as Cell
}

message(0x7a1267fd) TEP89ProofResponse {
    proofedJettonWallet: Address;
    action: Cell;
}

contract TEP89Proofer(
    jettonMaster: Address,
    proofRequester: Address,
    possibleJettonWallet: Address,
    action: Cell?, // Actually it is JettonNotifyWithActionRequest, but is cheaper to store it as Cell
) {
    receive(msg: TEP89ProofRequest) {
        require(sender() == self.proofRequester, "TEP89 proof: Sender must be the proof requester");
        self.action = msg.action;
        self.possibleJettonWallet = msg.possibleJettonWallet;
        self.jettonMaster = msg.jettonMaster;
        message(MessageParameters {
            to: msg.jettonMaster,
            bounce: true, // So we can save some tons (we won't pay storage fees for JettonMaster)
            value: 0,
            mode: SendRemainingValue,
            body: ProvideWalletAddress {
                queryId: 0,
                ownerAddress: self.proofRequester,
                // We could ask to provide address, but it is cheaper to store it in data
                includeAddress: false,
            }.toCell(),
        });
    }

    receive(msg: TakeWalletAddress) {
        require(sender() == self.jettonMaster, "TEP89 proof: TakeWalletAddress must be sent by the jetton master");
        require(msg.walletAddress == self.possibleJettonWallet, "TEP89 proof: Wallet address does not match");
        // Jetton wallet is valid, we can send the action
        message(MessageParameters {
            to: self.proofRequester,
            // We don't need to bounce, because we will destroy the contract after sending the message
            bounce: false,
            value: 0,
            mode: SendRemainingBalance + SendDestroyIfZero,
            body: TEP89ProofResponse {
                proofedJettonWallet: msg.walletAddress,
                action: self.action!!,
            }.toCell(),
        });
    }
}
