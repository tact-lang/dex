import "../ammPool.tact";
import "../securityUtils/calculateJettonWallet.tact";
import "../math.tact";

message(0x96ff98f3) InitJettonVault {
    jettonMasterCode: Cell;
    jettonMasterData: Cell;
}

message(0xbfa68001) SwapRequest {
    destinationVault: Address;
}

// TEP-74 JettonNotify
message(0x7362d09c) JettonNotifyWithSwapRequest {
    queryId: Int as uint64;
    amount: Int as coins;
    sender: Address;
    eitherBit: Bool;
    init: InitJettonVault?;
    forwardPayload: SwapRequest;
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
    receive(msg: JettonNotifyWithSwapRequest) {
        if(!self.inited) {
            if(msg.init != null) {
                let myJettonWallet = calculateJettonWallet(myAddress(), msg.init!!.jettonMasterData, msg.init!!.jettonMasterCode, self.jettonMaster);
                if(myJettonWallet == msg.sender) {
                    self.inited = true;
                    self.jettonWallet = myJettonWallet;
                }
            }
        }
        require(self.inited, "Jetton vault not inited");
        require(sender() == self.jettonWallet, "Jetton vault not inited");
        let otherVault = msg.forwardPayload.destinationVault;
        let sortedAddresses = sortAddresses(myAddress(), otherVault);

        let poolAddress = contractAddress(initOf AmmPool(sortedAddresses.lower, sortedAddresses.higher, 0, 0));
        message(MessageParameters{
            value: 0,
            mode: SendRemainingValue,
            to: poolAddress,
            body: SwapIn{
                swapOutReceiver: msg.sender,
                amount: msg.amount,
            }.toCell(),
        })
    }
    receive(msg: SwapOut) {
        require(self.inited, "Jetton vault not inited");
        let sortedAddresses = sortAddresses(myAddress(), msg.inVault);
        let poolInit = initOf AmmPool(sortedAddresses.lower, sortedAddresses.higher, 0, 0);
        require(poolInit.hasSameBasechainAddress(sender()), "Sender must be pool");

        message(MessageParameters{
            to: self.jettonWallet!!,
            value: 0,
            mode: SendRemainingValue,
            body: JettonTransfer{
                queryId: 0,
                amount: 0,
                destination: msg.receiver,
                forwardTonAmount: 1,
                forwardPayload: emptySlice(),
            }.toCell(),
        })
    }
}
