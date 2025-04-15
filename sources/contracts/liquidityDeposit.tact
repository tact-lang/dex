import "./ammPool.tact";

message(0xe7a3475f) PartHasBeenDeposited {
    depositor: Address;
    amount: Int as uint256;
}

contract LiquidityDepositContract(
    leftVault: Address, // To be deterministic, leftVault address must be less than rightVault address
    rightVault: Address,
    leftSideAmount: Int as uint256,
    rightSideAmount: Int as uint256,
    depositor: Address, // This and the next field are kind of salt, so several similar contracts can exist
    contractId: Int as uint64,
    status: Int as uint3, // Should be deployed with 0.
    // 0 - not started
    // 1 - left side is filled
    // 2 - right side is filled
    // 3 - both sides are filled
) {
    receive(msg: PartHasBeenDeposited) {
        let sender = sender();
        require(sender == self.leftVault || sender == self.rightVault, "Sender must be a vault");
        if (sender == self.leftVault) {
            // TODO maybe here we should check that it is not already filled and revert on errors.
            require(msg.amount == self.leftSideAmount, "Amount must be equal to leftSide");
            require(msg.depositor == self.depositor, "Depositor must be the same");
            self.status |= 1;
        } else {
            // TODO maybe here we should check that it is not already filled and revert on errors.
            require(msg.amount == self.rightSideAmount, "Amount must be equal to rightSide");
            require(msg.depositor == self.depositor, "Depositor must be the same");
            self.status |= 2;
        }
        // Both sides are filled, we can deposit now.
        if (self.status == 3) {
            deploy(DeployParameters {
                value: 0,
                mode: SendRemainingBalance + SendDestroyIfZero, // We don't need to keep this contract alive
                init: initOf AmmPool(self.leftVault, self.rightVault, 0, 0, 0),
                body: LiquidityDeposit {
                    leftAmount: self.leftSideAmount,
                    rightAmount: self.rightSideAmount,
                    depositor: self.depositor,
                    contractId: self.contractId,
                }.toCell(),
            });
        }
    }

    receive() {}

    get fun status(): Int {
        return self.status;
    }
}
