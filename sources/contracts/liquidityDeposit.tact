import "./ammPool.tact";

message(0xe7a3475f) PartHasBeenDeposited {
    depositor: Address,
    amount: Int as uint256,
}

contract LiquidityDepositContract(
    leftVault: Address, // To be deterministic, leftVault address must be less than rightVault address
    rightVault: Address,
    leftSide: Int as uint256,
    rightSide: Int as uint256,
    status: Int as uint2; // Should be deployed with 0.
    // 0 - not started
    // 1 - left side is filled
    // 2 - right side is filled
    // 3 - both sides are filled
) {
    receive(msg: PartHasBeenDeposited) {
        let sender = sender();
        require(sender == self.leftVault || sender == self.rightVault, "Sender must be a vault");
        if(sender == leftVault) {
            // TODO maybe here we should check that it is not already filled and revert on errors.
            require(msg.amount == self.leftSide, "Amount must be equal to leftSide");
            self.status |= 1;
        } else {
            // TODO maybe here we should check that it is not already filled and revert on errors.
            require(msg.amount == self.rightSide, "Amount must be equal to rightSide");
            self.status |= 2;
        }
        // Both sides are filled, we can deposit now.
        if(self.status == 3) {
            let poolAddress = contractAddress(initOf AmmPool(self.leftVault, self.rightVault, 0, 0));
            message(MessageParameters{
                value: 0,
                mode: SendRemainingValue,
                to: poolAddress,
                body: LiquidityDeposit{
                    leftAmount: self.leftSide,
                    rightAmount: self.rightSide,
                    depositor: msg.depositor,
                }.toCell(),
            });
        }
    }
}