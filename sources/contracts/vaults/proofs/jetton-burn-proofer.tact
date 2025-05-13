import "../../jettons/messages";

message(0xf442b42c) JettonBurnProofRequest {
    jettonMaster: Address;
    possibleJettonWallet: Address;
    action: Cell; // Actually it is JettonNotifyWithActionRequest, but is cheaper to store it as Cell
}

message(0xca093c02) JettonBurnRequest {
    possibleJettonWallet: Address;
}

message(0x3acc12eb) JettonBurnProofResponse {
    proofedJettonWallet: Address;
    action: Cell; // Actually it is JettonNotifyWithActionRequest, but is cheaper to store it as Cell
}

contract JettonBurnProofer(
    jettonMaster: Address,
    proofRequester: Address,
    possibleJettonWallet: Address,
    action: Cell?, // Actually it is JettonNotifyWithActionRequest, but is cheaper to store it as Cell
) {
    receive(msg: JettonBurnProofRequest) {
        require(sender() == self.proofRequester, "Jetton burn proof: Sender must be the proof requester");
        self.action = msg.action;
        self.possibleJettonWallet = msg.possibleJettonWallet;
        self.jettonMaster = msg.jettonMaster;

        message(MessageParameters {
            to: self.proofRequester,
            bounce: false,
            value: 0,
            mode: SendRemainingValue,
            body: JettonBurnRequest {
                possibleJettonWallet: msg.possibleJettonWallet,
            }.toCell(),
        });
    }

    receive(msg: JettonExcesses) {
        require(sender() == self.jettonMaster, "Jetton burn proof: JettonExcesses must be sent by the jetton master");
        // Jetton wallet is valid, we can send the action
        message(MessageParameters {
            to: self.proofRequester,
            // We don't need to bounce, because we will destroy the contract after sending the message
            bounce: false,
            value: 0,
            mode: SendRemainingBalance | SendDestroyIfZero,
            body: JettonBurnProofResponse {
                proofedJettonWallet: self.possibleJettonWallet,
                action: self.action!!,
            }.toCell(),
        });
    }
}
