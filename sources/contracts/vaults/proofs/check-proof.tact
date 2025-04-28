import "./tep-89-proofer.tact";
import "./tep-89-proofer";
import "./calculate-jetton-wallet";

struct JettonMasterState {
    jettonMasterCode: Cell?;
    jettonMasterData: Cell?;
}

// 0 - No proof attached, 1 - TEP-89, 2 - StateInit, 3 - State, 4 - Jetton Burn
inline fun checkProof(jettonMaster: Address, proofType: Int, proof: Slice, msgCell: Cell) {
    if (proofType == 1) {
        let prooferStateInit = initOf TEP89Proofer(
            jettonMaster,
            myAddress(),
            sender(),
            null,
        );
        deploy(DeployParameters {
            mode: SendRemainingValue,
            value: 0,
            // Doesn't really matter, so just for consistency - all internal protocol messages are not bounceable
            bounce: false,
            init: prooferStateInit,
            body: TEP89ProofRequest {
                jettonMaster,
                possibleJettonWallet: sender(),
                action: msgCell,
            }.toCell(),
        });
        throw(0);
    } else if (proofType == 2) {
        let init = JettonMasterState.fromSlice(proof);
        let myJettonWallet = calculateJettonWallet(myAddress(), init.jettonMasterData, init.jettonMasterCode, jettonMaster);
        require(
            myJettonWallet == sender() &&
            contractAddress(StateInit {
                code: init.jettonMasterCode!!,
                data: init.jettonMasterData!!,
            }) == jettonMaster,
            "JettonVault: StateInit proof is invalid",
        );
        return;
    } else if (proofType == 3) {
        require(false, "JettonVault: State proof is not supported");
        return;
    } else if (proofType == 4) {
        require(false, "JettonVault: Burn proof is not supported");
        return;
    }
    require(false, "JettonVault: Invalid proof type");
}
