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
import "../utils/gas-constants";
import "../core/lp-jettons/constants";

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
        // We don't put any gas constraints when vault is not initialized
        // Because with any proof type it is impossible to calculate exact fee, as in all kind of proofs we call the
        // jetton master and we don't know exact gas it may consume
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
        if (sender() != self.jettonWallet || !actionHandler(msg)) {
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
            require(false, "JettonVault: Sender must be jetton wallet or too low gas for action");
        }
    }

    receive(msg: TEP89DiscoveryResult) {
        let proxyStateInit = initOf TEP89DiscoveryProxy(self.jettonMaster, myAddress(), msg.expectedJettonWallet, msg.action, msg.discoveryId);
        require(proxyStateInit.hasSameBasechainAddress(sender()), "JettonVault: Sender must be a valid TEP-89 proxy");

        let action = JettonNotifyWithActionRequest.fromCell(msg.action);
        if (msg.expectedJettonWallet == msg.actualJettonWallet) {
            self.jettonWallet = msg.actualJettonWallet;
            commit();
        }
        if (msg.expectedJettonWallet != msg.actualJettonWallet || !actionHandler(action)) {
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
            require(false, "JettonVault: Expected and Actual wallets are not equal or gas for action is not enough");
        }
    }

    receive() {
        cashback(sender());
    }

    override fun handlePayout(msg: PayoutFromPool) {
        let sortedAddresses = sortAddresses(myAddress(), msg.otherVault);
        let poolInit = initOf AmmPool(sortedAddresses.lower, sortedAddresses.higher, 0, 0, 0, null);

        require(poolInit.hasSameBasechainAddress(sender()), "JettonVault: Sender must be pool");

        let ctx = context();
        // We estimate price of jetton transfer with 1 nanoton of in notify, so our estimation is more robust
        let remainingValue = ctx.value - priceOfJettonForward(ctx.readForwardFee(), 1);
        // If it is negative, it is better not to send any notify
        remainingValue = min(remainingValue, 0);
        message(MessageParameters {
            to: self.jettonWallet!!,
            value: 0,
            mode: SendRemainingValue,
            body: SendViaJettonTransfer {
                queryId: 0,
                amount: msg.amount,
                responseDestination: msg.receiver,
                destination: msg.receiver,
                forwardTonAmount: remainingValue,
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

inline fun actionHandler(msg: JettonNotifyWithActionRequest): Bool {
    if (msg.actionOpcode == SwapRequestOpcode) {
        let ctx = context();
        let action = SwapRequest.fromCell(msg.actionPayload);
        // If receiver is not specified, then it will be the sender of Jettons
        let receiver = action.receiver != null ? action.receiver!! : msg.sender;
        let hops = action.params.numberOfHops();

        // number of hops + 2 (for the last vault) * freeze limit = maximum possible storageFee
        // We don't count storage for current vault as JettonNotify was unbounceable and already paid our storage
        let protocolGasFee =
            (hops + 1) * (getFreezeLimit() + ctx.readForwardFee()) +
            getComputeFee(GasSwapRequestJettonVault, false) +
            getComputeFee(GasAmmPoolSwap, false) * hops +
            getComputeFee(GasPayoutFromAnyVault, false);

        let restOfValue = ctx.value - protocolGasFee;
        if (restOfValue < 0) {
            return false;
        }
        // Maybe the vault of the other side is not a JettonVault, but forward from any other Vault is cheaper
        let payoutGasFee = priceOfJettonForward(ctx.readForwardFee(), 1);

        if (parseStdAddress(sender().asSlice()).workchain != Basechain ||
            parseStdAddress(receiver.asSlice()).workchain != Basechain ||
            ctx.value <
            protocolGasFee +
            payoutGasFee) {
            return false;
        }
        message(MessageParameters {
            value: 0,
            bounce: false,
            mode: SendRemainingValue,
            to: action.pool,
            body: SwapIn {
                amount: msg.amount,
                receiver,
                params: action.params,
            }.toCell(),
        });
        return true;
    } else if (msg.actionOpcode == LPDepositPartOpcode) {
        let action = LPDepositPart.fromCell(msg.actionPayload);
        let ctx = context();
        // 1 to LP Deposit contract + 1 to Amm Pool
        // + 1 to LP Jetton Wallet + 1 for LP Jetton Notify + 1 Jetton excesses (this will be cheaper)
        // + 1 to Vault (possible excesses)
        // Note, that LP Provision could fail, but in this case there will be no LP Mint - related operations, but there will be 2 Vault payouts.
        // So it is safe to use 6 here.
        let protocolGasFee =
            6 * ctx.readForwardFee() +
            // Only for Amm Pool and Vault of excesses payout, because notify to this Vault was unbounceable, and LP Deposit Contract will be deployed in this message.
            getFreezeLimit() * 2 +
            getComputeFee(GasLPDepositPartJettonVault, false) +
            getComputeFee(GasLPDepositContract, false) +
            getComputeFee(GasAmmPoolLiquidityDeposit, false) +
            // For LP Jetton Wallet storage Fee
            minTonsForStorage +
            // Gas for transferring LP Jettons (this gas will be spent on JettonWallet)
            getComputeFee(gasForTransfer, false) +
            // There will be at most 1 payout from Vault
            getComputeFee(GasPayoutFromAnyVault, false) +
            // Price of forwarding excesses (might be Jettons might be not, but Jettons are the most expensive)
            priceOfJettonForward(ctx.readForwardFee(), 1);
        if (ctx.value < protocolGasFee) {
            return false;
        }

        if (!action.liquidityDepositContractData.eitherBit) {
            message(MessageParameters {
                to: action.liquidityDepositContractData.liquidityDepositContract!!,
                value: 0,
                mode: SendRemainingValue,
                body: PartHasBeenDeposited {
                    amount: msg.amount,
                    additionalParams: action.additionalParams,
                    ammPoolCode: codeOf AmmPool,
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
                action.lpTokensReceiver != null ? action.lpTokensReceiver!! : msg.sender,
                initData.contractId,
                false,
                false,
                null,
                null,
            );

            deploy(DeployParameters {
                init: depositorStateInit,
                mode: SendRemainingValue,
                value: 0,
                body: PartHasBeenDeposited {
                    amount: msg.amount,
                    additionalParams: action.additionalParams,
                    ammPoolCode: codeOf AmmPool,
                }.toCell(),
            });
        }
        return true;
    }
    return false;
}
