//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import "../core/amm-pool";
import "../utils/math";
import "./vault-interface";
import "../core/messages";
// for compilation
import "./ton-vault";
import "./proofs/check-proof";
import "./proofs/tep-89-discovery-proxy";
import "../core/liquidity-deposit";
import "../utils/utils";

// TEP-74 JettonNotify, but with forwardPayload serialized as expected fields
message(0x7362d09c) JettonNotifyWithActionRequest {
    queryId: Int as uint64;
    amount: Int as coins;
    sender: Address;
    eitherBit: Bool; // Should be 0, so other fields are stored inline
    actionOpcode: Int as uint32;
    actionPayload: Cell; // Obligatory ref
    proofType: Int as uint8; // 0 - No proof attached, 1 - TEP-89, 2 - StateInit, 3 - State, 4 - Jetton Burn
    proof: Slice as remaining;
}

// TEP-74 JettonTransfer with better DEX naming
message(0xf8a7ea5) SendViaJettonTransfer {
    queryId: Int as uint64;
    amount: Int as coins;
    destination: Address;
    responseDestination: Address?;
    customPayload: Cell?;
    forwardTonAmount: Int as coins;
    forwardPayload: Slice as remaining;
}

// First sender proves that it sent the correct jetton via attaching the jetton master init state
contract JettonVault(
    jettonMaster: Address,
    jettonWallet: Address?, // Should be deployed with null
) with VaultInterface {
    receive(msg: JettonNotifyWithActionRequest) {
        if (self.jettonWallet == null) {
            // This function proofs that jetton wallet is valid
            // This function throws if proof is invalid
            try {
                checkProof(self.jettonMaster, msg.proofType, msg.proof, msg.toCell());
            } catch (error) {
                message(MessageParameters {
                    mode: SendRemainingValue | SendIgnoreErrors,
                    body: SendViaJettonTransfer {
                        queryId: msg.queryId,
                        amount: msg.amount,
                        destination: msg.sender,
                        responseDestination: msg.sender,
                        customPayload: null,
                        forwardTonAmount: 1,
                        forwardPayload: sliceWithOneZeroBit(),
                    }.toCell(),
                    value: 0,
                    to: sender(),
                    bounce: true,
                });
                commit();
                throw(error);
            }
            self.jettonWallet = sender();

            // We can save jettonWallet address to the storage, as the proof succeeded
            setData(self.toCell());
            commit();
        }
        // Maybe someone messed up with address, so let's try to send jettons back
        if (sender() != self.jettonWallet) {
            message(MessageParameters {
                mode: SendRemainingValue | SendIgnoreErrors,
                body: SendViaJettonTransfer {
                    queryId: msg.queryId,
                    amount: msg.amount,
                    destination: msg.sender,
                    responseDestination: msg.sender,
                    customPayload: null,
                    forwardTonAmount: 1,
                    forwardPayload: sliceWithOneZeroBit(),
                }.toCell(),
                value: 0,
                to: sender(),
                bounce: true,
            });
            commit();
            require(false, "JettonVault: Sender must be jetton wallet");
        }
        actionHandler(msg);
    }

    receive(msg: TEP89DiscoveryResult) {
        let proxyStateInit = initOf TEP89DiscoveryProxy(self.jettonMaster, myAddress(), msg.expectedJettonWallet, msg.action, msg.discoveryId);
        require(proxyStateInit.hasSameBasechainAddress(sender()), "JettonVault: Sender must be a valid TEP-89 proxy");

        let action = JettonNotifyWithActionRequest.fromCell(msg.action);
        if (msg.expectedJettonWallet == msg.actualJettonWallet) {
            self.jettonWallet = msg.actualJettonWallet;
            actionHandler(action);
        } else {
            message(MessageParameters {
                mode: SendRemainingValue | SendIgnoreErrors,
                body: SendViaJettonTransfer {
                    queryId: action.queryId,
                    amount: action.amount,
                    destination: action.sender,
                    responseDestination: action.sender,
                    customPayload: null,
                    forwardTonAmount: 1,
                    forwardPayload: sliceWithOneZeroBit(),
                }.toCell(),
                value: 0,
                to: msg.expectedJettonWallet,
                bounce: true,
            });

            commit();
            require(false, "JettonVault: Expected and Actual wallets are not equal");
        }
    }

    receive() {
        cashback(sender());
    }

    override fun handlePayout(msg: PayoutFromPool) {
        let sortedAddresses = sortAddresses(myAddress(), msg.otherVault);
        let poolInit = initOf AmmPool(sortedAddresses.lower, sortedAddresses.higher, 0, 0, 0, null);

        require(poolInit.hasSameBasechainAddress(sender()), "JettonVault: Sender must be pool");

        message(MessageParameters {
            to: self.jettonWallet!!,
            value: 0,
            mode: SendRemainingValue,
            body: SendViaJettonTransfer {
                queryId: 0,
                amount: msg.amount,
                responseDestination: msg.receiver,
                destination: msg.receiver,
                // TODO: We probably want to maximize forwardTonAmount, or user should specify it.....
                forwardTonAmount: 1,
                forwardPayload: beginCell().storeMaybeRef(msg.payloadToForward).endCell().beginParse(),
                customPayload: null,
            }.toCell(),
        });
    }

    get fun inited(): Bool {
        return self.jettonWallet != null;
    }

    get fun jettonWallet(): Address? {
        return self.jettonWallet;
    }
}

inline fun actionHandler(msg: JettonNotifyWithActionRequest) {
    if (msg.actionOpcode == SwapRequestOpcode) {
        handleSwapRequest(msg, SwapRequest.fromCell(msg.actionPayload));
        return;
    } else if (msg.actionOpcode == LPDepositPartOpcode) {
        handleLPDepositPart(msg, LPDepositPart.fromCell(msg.actionPayload));
        return;
    }

    require(false, "JettonVault: Invalid action opcode");
}

inline fun handleSwapRequest(msg: JettonNotifyWithActionRequest, action: SwapRequest) {
    message(MessageParameters {
        value: 0,
        bounce: false,
        mode: SendRemainingValue,
        to: action.pool,
        body: SwapIn {
            amount: msg.amount,
            // If receiver is not specified, then it will be the sender of Jettons
            receiver: action.receiver != null ? action.receiver!! : msg.sender,
            params: action.params,
        }.toCell(),
    });
}

inline fun handleLPDepositPart(msg: JettonNotifyWithActionRequest, action: LPDepositPart) {
    if (!action.liquidityDepositContractData.eitherBit) {
        message(MessageParameters {
            to: action.liquidityDepositContractData.liquidityDepositContract!!,
            value: 0,
            mode: SendRemainingValue,
            body: PartHasBeenDeposited {
                depositor: msg.sender,
                amount: msg.amount,
                additionalParams: action.additionalParams,
            }.toCell(),
        });
    } else {
        let initData = action.liquidityDepositContractData.initData!!;

        let sorted = sortAddressesAndCoins(
            myAddress(),
            initData.otherVault,
            msg.amount,
            initData.otherAmount,
        );

        let depositorStateInit = initOf LiquidityDepositContract(
            sorted.lower,
            sorted.higher,
            sorted.lowerCoins,
            sorted.higherCoins,
            msg.sender,
            initData.contractId,
            0,
            null,
            null,
        );

        deploy(DeployParameters {
            init: depositorStateInit,
            mode: SendRemainingValue,
            value: 0,
            body: PartHasBeenDeposited {
                depositor: msg.sender,
                amount: msg.amount,
                additionalParams: action.additionalParams,
            }.toCell(),
        });
    }
}
