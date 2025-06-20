//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import "./tep-89-discovery-proxy";
import "./block-proof";
import "../../utils/utils";

const PROOF_NO_PROOF_ATTACHED: Int = 0;
const PROOF_TEP89: Int = 1;
const PROOF_STATE_INIT: Int = 2;
const PROOF_STATE_TO_THE_BLOCK: Int = 3;

inline fun checkProof(jettonMaster: Address, proofType: Int, proof: Slice, msgCell: Cell) {
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
        // We don't need to save state, so we just need to exit() quickly
        exit();
    } else if (proofType == PROOF_STATE_INIT) {
        let init = StateInit.fromSlice(proof);
        let myJettonWallet = calculateJettonWallet(myAddress(), init.data, init.code, jettonMaster);
        require(
            myJettonWallet == sender() &&
            contractAddress(StateInit {
                code: init.code,
                data: init.data,
            }) == jettonMaster,
            "JettonVault: Invalid state init proof",
        );
    } else if (proofType == PROOF_STATE_TO_THE_BLOCK) {
        let stateProof = StateProof.fromSlice(proof);
        let init = getJettonMasterState(stateProof, jettonMaster);
        let myJettonWallet = calculateJettonWallet(myAddress(), init.data, init.code, jettonMaster);
        require(myJettonWallet == sender(), "JettonVault: Invalid block state proof");
    } else {
        require(false, "JettonVault: Unsupported proof type");
    }
}
