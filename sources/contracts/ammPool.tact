import "./liquidityDeposit";

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

contract AmmPool(
    leftVault: Address,
    rightVault: Address, // To be deterministic, rightVault address must be greater than leftVault address
    leftSide: Int as uint256, // Should be deployed with 0
    rightSide: Int as uint256, // Should be deployed with 0
) {
    receive(msg: LiquidityDeposit) {
        let liquidityDepositContractInit = initOf LiquidityDepositContract(self.leftVault, 
            self.rightVault, 
            msg.leftAmount, 
            msg.rightAmount, 
            msg.depositor,
            msg.contractId,
            0
        );
        
        require(liquidityDepositContractInit.hasSameBasechainAddress(sender()), "Liquidity provisor should be liquidity contract");
        require(msg.leftAmount > 0, "You can't add 0 tokens on one side");
        
        // Both sides are 0 in this case.
        if(self.leftSide == 0) { 
            self.leftSide = msg.leftAmount;
            self.rightSide = msg.rightAmount;
            return;
        }

        // Liquidity provide contract does not allow to add 0 tokens on one side.
        // Probably the rate has changed, so we must remove excessed right tokens.
        if(msg.rightAmount / msg.leftAmount > self.rightSide / self.leftSide) {
            let expectedRightAmount = muldiv(msg.leftAmount, self.rightSide, self.leftSide);
            message(MessageParameters{
                value: 0,
                mode: SendRemainingValue,
                to: self.rightVault,
                body: PayoutFromPool{
                    inVault: self.leftVault,
                    amount: msg.rightAmount - expectedRightAmount,
                    receiver: msg.depositor,
                }.toCell(),
            });
        }
        else {
            let expectedLeftAmount = muldiv(msg.rightAmount, self.leftSide, self.rightSide);
            message(MessageParameters{
                value: 0,
                mode: SendRemainingValue,
                to: self.leftVault,
                body: PayoutFromPool{
                    inVault: self.rightVault,
                    amount: msg.leftAmount - expectedLeftAmount,
                    receiver: msg.depositor,
                }.toCell(),
            });
        }

        // TODO: Mint LP tokens
    }

    const PoolFee: Int = 3; // 0.3%
    receive(msg: SwapIn) {
        let sender = sender();
        require(sender == self.leftVault || sender == self.rightVault, "Sender must be a vault");
        let inVault = emptyAddress();
        let outVault = emptyAddress();
        let inBalance = 0;
        let outBalance = 0;
        let vaultOrderSwap = false;
        if(sender == self.leftVault) {
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
        
        let amountInWithFee = muldiv(msg.amount, 1000 - self.PoolFee, 1000);
        let newAmountIn = inBalance + amountInWithFee;
        let newAmountOut = muldiv(outBalance, inBalance, newAmountIn);
        let amountToPay = outBalance - newAmountOut;

        message(MessageParameters{
            value: 0,
            mode: SendRemainingValue,
            to: outVault,
            body: PayoutFromPool{
                inVault: inVault,
                amount: amountToPay,
                receiver: msg.swapOutReceiver,
            }.toCell(),
        });

        if(vaultOrderSwap) {
            self.leftSide = newAmountOut;
            self.rightSide = newAmountIn;
        } else {
            self.leftSide = newAmountIn;
            self.rightSide = newAmountOut;
        }
    }
}

asm fun emptyAddress(): Address { b{00} PUSHSLICE}

asm fun muldiv(x: Int, y: Int, z: Int): Int { MULDIV }
