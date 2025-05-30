import "../../core/lp-jettons/messages";

// As TEP-89 does not support forwardPayload, we need to use a separate contract
// This contract will store the request and will validate the proof.
message(0xb6a69dbc) TEP89ProofRequest {}

message(0x7a1267fd) TEP89ProofResponse {
    requestLt: Int as uint64;
    possibleJettonWallet: Address;
    proofedJettonWallet: Address?;
    action: Cell;
}

// TEP-89 Proofer contains an action in state init, so we will have different proofer addresses for each action
// This helps to handle situation, when more than one action were sent to uninitialized jetton vault
contract TEP89Proofer(
    jettonMaster: Address,
    proofRequester: Address,
    possibleJettonWallet: Address,
    action: Cell, // Actually it is JettonNotifyWithActionRequest, but is cheaper to store it as Cell
    requestLt: Int as uint64, // Salt
) {
    receive(msg: TEP89ProofRequest) {
        require(sender() == self.proofRequester, "TEP89 proof: Sender must be the proof requester");

        message(MessageParameters {
            to: self.jettonMaster,
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
        // Jetton wallet is valid, we can send the action
        message(MessageParameters {
            to: self.proofRequester,
            // We don't need to bounce, because we will destroy the contract after sending the message
            bounce: false,
            value: 0,
            mode: SendRemainingBalance | SendDestroyIfZero,
            body: TEP89ProofResponse {
                requestLt: self.requestLt,
                possibleJettonWallet: self.possibleJettonWallet,
                proofedJettonWallet: msg.walletAddress,
                action: self.action,
            }.toCell(),
        });
    }

    bounced(msg: bounced<ProvideWalletAddress>) {
        message(MessageParameters {
            to: self.proofRequester,
            // We don't need to bounce, because we will destroy the contract after sending the message
            bounce: false,
            value: 0,
            mode: SendRemainingBalance | SendDestroyIfZero,
            body: TEP89ProofResponse {
                requestLt: self.requestLt,
                possibleJettonWallet: self.possibleJettonWallet,
                proofedJettonWallet: null,
                action: self.action,
            }.toCell(),
        });
    }
}
