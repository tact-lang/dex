import "../core/amm-pool";
import "../utils/calculate-jetton-wallet";
import "../math";
import "./vault-interface";
import "../core/messages.tact";
// for compilation
import "./ton-vault.tact";

struct JettonMasterState {
    jettonMasterCode: Cell?;
    jettonMasterData: Cell?;
}

// TEP-74 JettonNotify, but with forwardPayload serialized as expected fields
message(0x7362d09c) JettonNotifyWithActionRequest {
    queryId: Int as uint64;
    amount: Int as coins;
    sender: Address;
    eitherBit: Bool; // Should be 0, so other fields are stored inline
    init: JettonMasterState; // 2 refs max
    actionOpcode: Int as uint32;
    actionPayload: Cell; // Obligatory ref
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
    inited: Bool, // Should be deployed with false
    jettonWallet: Address?, // Should be deployed with null
) with VaultInterface {
    receive(msg: JettonNotifyWithActionRequest) {
        if (!self.inited) {
            // Theoretically, data can be null, but I think it's not possible, so we won't accept such jettons
            if (msg.init.jettonMasterCode != null && msg.init.jettonMasterData != null) {
                // on-chain hack, dependent on the jetton minter state init
                let myJettonWallet = calculateJettonWallet(myAddress(), msg.init.jettonMasterData, msg.init.jettonMasterCode, self.jettonMaster);

                if (myJettonWallet == sender() &&
                    contractAddress(StateInit {
                        code: msg.init.jettonMasterCode!!,
                        data: msg.init.jettonMasterData!!,
                    }) == self.jettonMaster) {
                    self.inited = true;
                    self.jettonWallet = myJettonWallet;
                }
            }
        }
        require(self.inited, "JettonVault: Not inited");
        require(sender() == self.jettonWallet, "JettonVault: Sender must be jetton wallet");

        if (msg.actionOpcode == SwapRequestOpcode) {
            handleSwapRequest(msg, SwapRequest.fromCell(msg.actionPayload));
        }
        if (msg.actionOpcode == LPDepositPartOpcode) {
            handleLPDepositPart(msg, LPDepositPart.fromCell(msg.actionPayload));
        }
    }

    receive() {}

    override fun handlePayout(msg: PayoutFromPool) {
        require(self.inited, "JettonVault: Not inited");

        let sortedAddresses = sortAddresses(myAddress(), msg.otherVault);
        let poolInit = initOf AmmPool(sortedAddresses.lower, sortedAddresses.higher, 0, 0, 0);

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
        return self.inited;
    }

    get fun jettonWallet(): Address? {
        return self.jettonWallet;
    }
}

asm fun sliceWithOneZeroBit(): Slice {
    b{0} PUSHSLICE
}

inline fun handleSwapRequest(msg: JettonNotifyWithActionRequest, action: SwapRequest) {
    let otherVault = action.destinationVault;
    let sortedAddresses = sortAddresses(myAddress(), otherVault);

    let poolAddress = contractAddress(initOf AmmPool(sortedAddresses.lower, sortedAddresses.higher, 0, 0, 0));
    message(MessageParameters {
        value: 0,
        bounce: false,
        mode: SendRemainingValue,
        to: poolAddress,
        body: SwapIn {
            swapOutReceiver: msg.sender,
            amount: msg.amount,
            minAmountOut: action.minAmountOut,
            timeout: action.timeout,
            payloadOnSuccess: action.payloadOnSuccess,
            payloadOnFailure: action.payloadOnFailure,
        }.toCell(),
    });
}

inline fun handleLPDepositPart(msg: JettonNotifyWithActionRequest, action: LPDepositPart) {
    message(MessageParameters {
        to: action.liquidityDepositContract,
        value: 0,
        mode: SendRemainingValue,
        body: PartHasBeenDeposited {
            depositor: msg.sender,
            amount: msg.amount,
            additionalParams: action.additionalParams,
        }.toCell(),
    });
}
