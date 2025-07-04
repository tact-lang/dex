//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import "../utils/math";
import "./messages";
import "../vaults/vault-interface";

// TODO This is here until Tact will have something like `dataOf Contract()`
struct AmmPoolData {
    leftVault: Address;
    rightVault: Address; // To be deterministic, rightVault address must be greater than leftVault address
    leftSideReserve: Int as coins;
    rightSideReserve: Int as coins;
    totalSupply: Int as coins;
    jettonContent: Cell?;
}

contract LiquidityDepositContract(
    leftVault: Address, // To be deterministic, leftVault address must be less than rightVault address
    rightVault: Address,
    leftSideAmount: Int as coins,
    rightSideAmount: Int as coins,
    lpTokensReceiver: Address, // This and the next field are kind of salt, so several similar contracts can exist
    contractId: Int as uint64,
    leftSideFilled: Bool,
    rightSideFilled: Bool,
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
        // If corresponding side is already filled - we don't care.
        // User shouldn't top up the same side again.
        if (sender == self.leftVault) {
            require(msg.amount == self.leftSideAmount, "LP Deposit: Left side cannot be filled with different amount");
            self.leftAdditionalParams = msg.additionalParams;
            self.leftSideFilled = true;
        } else if (sender == self.rightVault) {
            require(msg.amount == self.rightSideAmount, "LP Deposit: Right side cannot be filled with different amount");
            self.rightAdditionalParams = msg.additionalParams;
            self.rightSideFilled = true;
        }
        require(self.leftVault != self.rightVault, "LP Deposit: Vaults must be different");
        // Both sides are filled, we can deposit now.
        if (self.leftSideFilled && self.rightSideFilled) {
            // We must check, that this account was deployed with sorted vault, otherwise it could be a security issue
            let sortedAddresses = sortAddresses(self.leftVault, self.rightVault);
            require(sortedAddresses.lower == self.leftVault, "LP Deposit: Vaults MUST be sorted, to not break invariant");
            deploy(DeployParameters {
                value: 0,
                bounce: false, // 1. To pay storage fees of AmmPool. 2. We will destroy this contract, so bounce does not have sense.
                mode: SendRemainingBalance + SendDestroyIfZero, // We don't need to keep this contract alive
                init: StateInit {
                    code: msg.ammPoolCode,
                    data: AmmPoolData {
                        leftVault: self.leftVault,
                        rightVault: self.rightVault,
                        leftSideReserve: 0,
                        rightSideReserve: 0,
                        totalSupply: 0,
                        jettonContent: null,
                    }.toCell(),
                },
                body: LiquidityDeposit {
                    lpTokensReceiver: self.lpTokensReceiver,
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

    get fun status(): Status {
        return Status {
            leftSideFilled: self.leftSideFilled,
            rightSideFilled: self.rightSideFilled,
        };
    }
}

struct Status {
    leftSideFilled: Bool;
    rightSideFilled: Bool;
}
