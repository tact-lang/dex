import "./liquidityDeposit";
import "./utils/utils";
import "./jettons/utils";
import "./jettons/jetton-wallet";

message(0xac2f5a38) SwapIn {
    amount: Int as uint256;
    swapOutReceiver: Address;
}

message(0x74f7a60) PayoutFromPool {
    inVault: Address; // For proofing purposes
    amount: Int as uint256;
    receiver: Address;
}

message(0x6752aa52) LiquidityDeposit {
    leftAmount: Int as uint256;
    rightAmount: Int as uint256;
    depositor: Address;
    contractId: Int as uint64;
}

// JettonBurnNotification
message(0x7bdd97de) LiquidityWithdrawViaBurnNotification {
    queryId: Int as uint64;
    amount: Int as coins;
    sender: Address;
    responseDestination: Address?;
}

// For LP tokens minting
message(0x178d4519) MintViaJettonTransferInternal {
    queryId: Int as uint64;
    amount: Int as coins;
    sender: Address;
    responseDestination: Address?;
    forwardTonAmount: Int as coins;
    forwardPayload: Slice as remaining;
}

contract AmmPool(
    leftVault: Address,
    rightVault: Address, // To be deterministic, rightVault address must be greater than leftVault address
    leftSide: Int as uint256, // Should be deployed with 0
    rightSide: Int as uint256, // Should be deployed with 0
    // LP tokens-related fields
    totalSupply: Int as coins, // Should be deployed with 0
) {
    receive() {}

    receive(msg: LiquidityDeposit) {
        let liquidityDepositContractInit = initOf LiquidityDepositContract(
            self.leftVault,
            self.rightVault,
            msg.leftAmount,
            msg.rightAmount,
            msg.depositor,
            msg.contractId,
            0,
        );

        require(liquidityDepositContractInit.hasSameBasechainAddress(sender()), "Liquidity provisor should be liquidity contract");
        require(msg.leftAmount > 0, "You can't add 0 tokens on one side");
        
        let leftSideReceived = msg.leftAmount;
        let rightSideReceived = msg.rightAmount;
        // Both sides are 0 in this case.
        if (self.leftSide == 0) {
            self.leftSide = msg.leftAmount;
            self.rightSide = msg.rightAmount;
        } else {
            // Liquidity provide contract does not allow to add 0 tokens on one side.
            // Probably the rate has changed, so we must remove excessed right tokens.
            if (msg.rightAmount / msg.leftAmount > self.rightSide / self.leftSide) {
                let expectedRightAmount = muldiv(msg.leftAmount, self.rightSide, self.leftSide);
                rightSideReceived = expectedRightAmount;
                message(MessageParameters {
                    value: 0,
                    mode: SendRemainingValue,
                    to: self.rightVault,
                    body: PayoutFromPool {
                        inVault: self.leftVault,
                        amount: msg.rightAmount - expectedRightAmount,
                        receiver: msg.depositor,
                    }.toCell(),
                });
            } else {
                let expectedLeftAmount = muldiv(msg.rightAmount, self.leftSide, self.rightSide);
                leftSideReceived = expectedLeftAmount;
                message(MessageParameters {
                    value: 0,
                    mode: SendRemainingValue,
                    to: self.leftVault,
                    body: PayoutFromPool {
                        inVault: self.rightVault,
                        amount: msg.leftAmount - expectedLeftAmount,
                        receiver: msg.depositor,
                    }.toCell(),
                });
            }
        }

        //TODO Consider checking overflow
        let liquidityTokensToMint = sqrt(leftSideReceived * rightSideReceived);

        self.totalSupply += liquidityTokensToMint;

        // TODO: We should add custom payload to the messages
        let forwardPayload = beginCell().storeUint(0, 1).storeUint(0, 64).endCell().beginParse();
        checkEitherForwardPayload(forwardPayload);

        self.totalSupply += liquidityTokensToMint;

        //Mint LP tokens
        deploy(DeployParameters {
            value: 0,
            bounce: true,
            mode: SendRemainingValue,
            init: getJettonWalletInit(msg.depositor),
            body: MintViaJettonTransferInternal {
                queryId: 0,
                amount: liquidityTokensToMint,
                sender: myAddress(),
                responseDestination: msg.depositor,
                forwardTonAmount: 0, // TODO: We should maximize forwardTonAmount, and attach custom payload to the messages
                forwardPayload: forwardPayload,
            }.toCell(),
        });
    }

    receive(msg: LiquidityWithdrawViaBurnNotification) {
        let sender = parseStdAddress(sender().asSlice());
        let wallet = getJettonBasechainWalletByOwner(msg.sender);

        // Workchain 0 is basechain
        require(sender.workchain == Basechain && sender.address == wallet.hash!!, "Invalid sender of JettonBurn notification");

        let amountOfLeftToPay = muldiv(msg.amount, self.leftSide, self.totalSupply);
        let amountOfRightToPay = muldiv(msg.amount, self.rightSide, self.totalSupply);

        self.totalSupply -= msg.amount;
        let halfOfMsgValue = context().value / 2;

        // Preserve original balance (more, if we have storage debt)
        nativeReserve(myStorageDue(), ReserveAddOriginalBalance | ReserveExact);

        message(MessageParameters {
            to: self.leftVault,
            value: halfOfMsgValue,
            mode: SendDefaultMode | SendBounceIfActionFail,
            body: PayoutFromPool {
                inVault: self.rightVault,
                amount: amountOfLeftToPay,
                receiver: msg.sender,
            }.toCell(),
        });

        message(MessageParameters {
            to: self.rightVault,
            value: 0,
            mode: SendRemainingBalance,
            body: PayoutFromPool {
                inVault: self.leftVault,
                amount: amountOfRightToPay,
                receiver: msg.sender,
            }.toCell(),
        });
    }

    // TODO: Add Discoverable functionality

    const PoolFee: Int = 3; // 0.3%

    receive(msg: SwapIn) {
        let sender = sender();
        require(sender == self.leftVault || sender == self.rightVault, "Sender must be a vault");

        let inVault = emptyAddress();
        let outVault = emptyAddress();
        let inBalance = 0;
        let outBalance = 0;
        let vaultOrderSwap = false;
        if (sender == self.leftVault) {
            inVault = self.leftVault;
            outVault = self.rightVault;
            inBalance = self.leftSide;
            outBalance = self.rightSide;
        } else {
            inVault = self.rightVault;
            outVault = self.leftVault;
            inBalance = self.rightSide;
            outBalance = self.leftSide;
            vaultOrderSwap = true;
        }

        //TODO We should check 0 liquidity case

        let amountInWithFee = muldiv(msg.amount, 1000 - self.PoolFee, 1000);
        let newAmountIn = inBalance + amountInWithFee;
        let newAmountOut = muldiv(outBalance, inBalance, newAmountIn);
        let amountToPay = outBalance - newAmountOut;

        message(MessageParameters {
            value: 0,
            mode: SendRemainingValue,
            to: outVault,
            body: PayoutFromPool {
                inVault: inVault,
                amount: amountToPay,
                receiver: msg.swapOutReceiver,
            }.toCell(),
        });

        if (vaultOrderSwap) {
            self.leftSide = newAmountOut;
            self.rightSide = newAmountIn;
        } else {
            self.leftSide = newAmountIn;
            self.rightSide = newAmountOut;
        }
    }

    get fun getLeftSide(): Int {
        return self.leftSide;
    }

    get fun getRightSide(): Int {
        return self.rightSide;
    }

    get fun get_wallet_address(ownerAddress: Address): Address {
        return getJettonWalletByOwner(ownerAddress);
    }
}

inline fun getJettonWalletInit(address: Address): StateInit {
    return initOf JettonWallet(0, address, myAddress());
}

inline fun getJettonWalletByOwner(jettonWalletOwner: Address): Address {
    return contractAddress(getJettonWalletInit(jettonWalletOwner));
}

inline fun getJettonBasechainWalletByOwner(jettonWalletOwner: Address): BasechainAddress {
    return contractBasechainAddress(getJettonWalletInit(jettonWalletOwner));
}
