import "../ammPool.tact";
import "../securityUtils/calculateJettonWallet.tact";
import "../math.tact";
import "../liquidityDeposit";

struct JettonMasterState {
    jettonMasterCode: Cell?;
    jettonMasterData: Cell?;
}

const SwapRequestOpcode: Int = 0xbfa68001;
message(SwapRequestOpcode) SwapRequest {
    destinationVault: Address;
}

const VaultDepositOpcode: Int = 0x64c08bfc;
message(VaultDepositOpcode) VaultDeposit {
    liquidityDepositContract: Address;
}

// TEP-74 JettonNotify
message(0x7362d09c) JettonNotifyWithActionRequest {
    queryId: Int as uint64;
    amount: Int as coins;
    sender: Address;
    eitherBit: Bool; // Should be 0, so other fields are stored inline
    init: JettonMasterState; // 2 refs max
    actionOpcode: Int as uint32;
    actionPayload: Cell; // Obligatory ref
}

message(0xf8a7ea5) JettonTransfer {
    queryId: Int as uint64;
    amount: Int as coins;
    destination: Address;
    responseDestination: Address?;
    customPayload: Cell?;
    forwardTonAmount: Int as coins;
    forwardPayload: Slice as remaining;
}

// Первый отправитель пруфает, что это он отправил правильные жетоны через прикладывание стейта жетон минтера
contract JettonVault(
    jettonMaster: Address,
    inited: Bool, // Should be deployed with false
    jettonWallet: Address?, // Should be deployed with null
) {
    receive(msg: JettonNotifyWithActionRequest) {
        if (!self.inited) {
            // Theoretically, data can be null, but I think it's not possible, so we won't accept such jettons
            if (msg.init.jettonMasterCode != null && msg.init.jettonMasterData != null) {
                let myJettonWallet = calculateJettonWallet(myAddress(), msg.init.jettonMasterData, msg.init.jettonMasterCode, self.jettonMaster);
                
                dump(myJettonWallet);
                dump(sender());
                dump("Calculated jetton wallet");
                

                dump(contractAddress(StateInit {
                    code: msg.init.jettonMasterCode!!,
                    data: msg.init.jettonMasterData!!,
                }));
                dump(self.jettonMaster);

                if (myJettonWallet == sender() &&
                    contractAddress(StateInit {
                        code: msg.init.jettonMasterCode!!,
                        data: msg.init.jettonMasterData!!,
                    }) == self.jettonMaster) {
                    self.inited = true;
                    self.jettonWallet = myJettonWallet;
                    dump("Inited");
                }
            }
        }
        require(self.inited, "Jetton vault not inited");
        require(sender() == self.jettonWallet, "Jetton vault not inited");

        if(msg.actionOpcode == SwapRequestOpcode) {
            handleSwapRequest(msg, SwapRequest.fromCell(msg.actionPayload));
        }
        else if(msg.actionOpcode == VaultDepositOpcode) {
            handleVaultDeposit(msg, VaultDeposit.fromCell(msg.actionPayload));
        }
    }

    receive() {}

    receive(msg: PayoutFromPool) {
        require(self.inited, "Jetton vault not inited");
        let sortedAddresses = sortAddresses(myAddress(), msg.inVault);
        let poolInit = initOf AmmPool(sortedAddresses.lower, sortedAddresses.higher, 0, 0);
        require(poolInit.hasSameBasechainAddress(sender()), "Sender must be pool");

        message(MessageParameters {
            to: self.jettonWallet!!,
            value: 0,
            mode: SendRemainingValue,
            body: JettonTransfer {
                queryId: 0,
                amount: 0,
                destination: msg.receiver,
                forwardTonAmount: 1,
                forwardPayload: emptySlice(),
            }.toCell(),
        });
    }

    get fun inited(): Bool {
        return self.inited;
    }
}

inline fun handleSwapRequest(msg: JettonNotifyWithActionRequest, action: SwapRequest) {
    let otherVault = action.destinationVault;
    let sortedAddresses = sortAddresses(myAddress(), otherVault);

    let poolAddress = contractAddress(initOf AmmPool(sortedAddresses.lower, sortedAddresses.higher, 0, 0));
    message(MessageParameters {
        value: 0,
        mode: SendRemainingValue,
        to: poolAddress,
        body: SwapIn {
            swapOutReceiver: msg.sender,
            amount: msg.amount,
        }.toCell(),
    });
}

inline fun handleVaultDeposit(msg: JettonNotifyWithActionRequest, action: VaultDeposit) {
    message(MessageParameters {
        to: action.liquidityDepositContract,
        value: 0,
        mode: SendRemainingValue,
        body: PartHasBeenDeposited{
            depositor: msg.sender,
            amount: msg.amount,
        }.toCell(),
    });
}