//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import "./tep-89-discovery-proxy";
import "../../utils/utils";

struct JettonMasterState {
    jettonMasterCode: Cell?;
    jettonMasterData: Cell?;
}

const PROOF_NO_PROOF_ATTACHED: Int = 0;
const PROOF_TEP89: Int = 1;
const PROOF_STATE_INIT: Int = 2;
const PROOF_STATE_TO_THE_BLOCK: Int = 3;
const PROOF_JETTON_BURN: Int = 4;

inline fun checkProof(jettonMaster: Address, proofType: Int, proof: Slice, msgCell: Cell): Bool {
    if (proofType == PROOF_TEP89) {
        let proxyStateInit = initOf TEP89DiscoveryProxy(
            jettonMaster,
            myAddress(),
            sender(),
            msgCell,
            curLt(),
        );

        deploy(DeployParameters {
            mode: SendRemainingValue,
            value: 0,
            // Doesn't really matter, so just for consistency - all internal protocol messages are not bounceable
            bounce: false,
            init: proxyStateInit,
        });
        // We don't need to save state init, so we just need to exit() quickly
        exit();
    } else if (proofType == PROOF_STATE_INIT) {
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
        return true;
    } else if (proofType == PROOF_STATE_TO_THE_BLOCK) {
        require(false, "JettonVault: State proof is not supported");
        return true;
    } else if (proofType == PROOF_JETTON_BURN) {
        require(false, "JettonVault: Burn proof is not supported");
        return true;
    }
    return false;
}
