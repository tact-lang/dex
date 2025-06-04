import "./amm-pool";
import "../utils/math";
import "./messages";

contract LiquidityDepositContract(
    leftVault: Address, // To be deterministic, leftVault address must be less than rightVault address
    rightVault: Address,
    leftSideAmount: Int as coins,
    rightSideAmount: Int as coins,
    depositor: Address, // This and the next field are kind of salt, so several similar contracts can exist
    contractId: Int as uint64,
    status: Int as uint3, // Should be deployed with 0.
    // 0 - not started
    // 1 - left side is filled
    // 2 - right side is filled
    // 3 - both sides are filled
    // These fields are needed to store the payloads from the vaults
    leftAdditionalParams: AdditionalParams?, // Should be deployed with null
    rightAdditionalParams: AdditionalParams?, // Should be deployed with null
) {
    receive(msg: PartHasBeenDeposited) {
        let sender = sender();
        if (sender == self.leftVault) {
            // TODO maybe here we should check that it is not already filled and revert on errors.
            require(msg.amount == self.leftSideAmount, "LP Deposit: Amount must be equal to leftSide");
            require(msg.depositor == self.depositor, "LP Deposit: Depositor must be the same");
            self.leftAdditionalParams = msg.additionalParams;
            self.status |= 1;
        }
        if (sender == self.rightVault) {
            // TODO maybe here we should check that it is not already filled and revert on errors.
            require(msg.amount == self.rightSideAmount, "LP Deposit: Amount must be equal to rightSide");
            require(msg.depositor == self.depositor, "LP Deposit: Depositor must be the same");
            self.rightAdditionalParams = msg.additionalParams;
            self.status |= 2;
        }
        // Both sides are filled, we can deposit now.
        if (self.status == 3) {
            // We must check, that this account was deployed with sorted vault, otherwise it could be a security issue
            let sortedAddresses = sortAddresses(self.leftVault, self.rightVault);
            require(sortedAddresses.lower == self.leftVault, "LP Deposit: Vaults MUST be sorted, to not break invariant");
            deploy(DeployParameters {
                value: 0,
                bounce: false, // 1. To pay storage fees of AmmPool. 2. We will destroy this contract, so bounce does not have sense.
                mode: SendRemainingBalance + SendDestroyIfZero, // We don't need to keep this contract alive
                init: initOf AmmPool(self.leftVault, self.rightVault, 0, 0, 0, null),
                body: LiquidityDeposit {
                    depositor: self.depositor,
                    contractId: self.contractId,
                    leftAmount: self.leftSideAmount,
                    rightAmount: self.rightSideAmount,
                    leftAdditionalParams: self.leftAdditionalParams!!,
                    rightAdditionalParams: self.rightAdditionalParams!!,
                }.toCell(),
            });
        }
    }

    receive() {
        cashback(sender());
    }

    get fun status(): Int {
        return self.status;
    }
}
