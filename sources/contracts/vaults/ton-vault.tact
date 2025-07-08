//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import "./vault-interface";
import "../utils/math";
import "../core/messages.tact";
import "../core/amm-pool";
import "../utils/utils";
import "../utils/gas-constants";
import "../core/lp-jettons/constants";
import "../core/liquidity-deposit";

message(0xf8a7ea5) ReturnJettonsViaJettonTransfer {
    queryId: Int as uint64;
    amount: Int as coins;
    destination: Address;
    responseDestination: Address?;
    customPayload: Cell?;
    forwardTonAmount: Int as coins;
    forwardPayload: Slice as remaining;
}

message(0x7362d09c) UnexpectedJettonNotification {
    queryId: Int as uint64;
    amount: Int as coins;
    sender: Address;
    forwardPayload: Slice as remaining;
}

contract TonVault() with VaultInterface {
    override fun handlePayout(msg: PayoutFromPool) {
        let sortedAddresses = sortAddresses(myAddress(), msg.otherVault);
        let poolInit = initOf AmmPool(sortedAddresses.lower, sortedAddresses.higher, 0, 0, 0, null);

        require(poolInit.hasSameBasechainAddress(sender()), "TonVault: Sender must be pool");
        // -> (fee) -> (ton vault) -> [(0.2) + amount 10 ton]
        message(MessageParameters {
            to: msg.receiver,
            value: msg.amount,
            mode: SendRemainingValue,
            bounce: false,
            body: PayoutFromTonVault {
                body: msg.payloadToForward,
            }.toCell(),
        });
    }

    receive(msg: SwapRequestTon) {
        // TODO: exact tests for this
        let amountForFees = context().value - msg.amount;
        let receiver = msg.action.receiver != null ? msg.action.receiver!! : sender();
        // In TON Vault we can simply bounce and the value will be returned to the sender
        let hops = msg.action.params.numberOfHops();
        let fwdFee = context().readForwardFee();

        let protocolGasFee =
            // number of hops + 2 (this and the last vault) * freeze limit = maximum possible storageFee

            (hops + 2) * getFreezeLimit() +
            (hops + 1) * fwdFee +
            getComputeFee(GasSwapRequestJettonVault, false) +
            getComputeFee(GasAmmPoolSwap, false) * hops +
            getComputeFee(GasPayoutFromAnyVault, false);

        // Maybe the vault of the other side is not a JettonVault, but forward from any other Vault is cheaper
        let payoutGasFee = priceOfJettonForward(fwdFee, 1);

        require(
            parseStdAddress(sender().asSlice()).workchain != Basechain ||
            parseStdAddress(receiver.asSlice()).workchain != Basechain ||
            amountForFees <
            protocolGasFee +
            payoutGasFee,
            "TonVault: Not enough value to pay for swap fees",
        );

        nativeReserve(msg.amount, ReserveExact | ReserveAddOriginalBalance | ReserveBounceIfActionFail);
        message(MessageParameters {
            to: msg.action.pool,
            value: 0,
            mode: SendBounceIfActionFail | SendRemainingBalance,
            bounce: false,
            body: SwapIn {
                receiver,
                amount: msg.amount,
                params: msg.action.params,
            }.toCell(),
        });
    }

    // Someone possibly transferred us jettons by accident
    receive(msg: UnexpectedJettonNotification) {
        message(MessageParameters {
            mode: SendRemainingValue,
            value: 0,
            body: ReturnJettonsViaJettonTransfer {
                queryId: msg.queryId,
                amount: msg.amount,
                destination: msg.sender,
                responseDestination: msg.sender,
                customPayload: null,
                forwardTonAmount: 1,
                forwardPayload: sliceWithOneZeroBit(),
            }.toCell(),
            to: sender(),
            bounce: true,
        });
        commit();
        require(false, "TonVault: Jetton transfer must be performed to correct Jetton Vault");
    }

    receive(msg: AddLiquidityPartTon) {
        // TODO: exact tests for this
        let ctx = context();
        // 1 to LP Deposit contract + 1 to Amm Pool
        // + 1 to LP Jetton Wallet + 1 for LP Jetton Notify + 1 Jetton excesses (this will be cheaper)
        // + 1 to Vault (possible excesses)
        // Note, that LP Provision could fail, but in this case there will be no LP Mint - related operations, but there will be 2 Vault payouts.
        // So it is safe to use 6 here.
        let protocolGasFee =
            6 * ctx.readForwardFee() +
            // Amm Pool and Vault of excesses payout + this Vault (incoming message may be bounceable)
            getFreezeLimit() * 3 +
            getComputeFee(GasLPDepositPartTonVault, false) +
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

        require(ctx.value - msg.amountIn > protocolGasFee, "TonVault: Not enough value to pay for gas");
        nativeReserve(msg.amountIn, ReserveExact | ReserveAddOriginalBalance | ReserveBounceIfActionFail);

        if (!msg.liquidityDepositContractData.eitherBit) {
            message(MessageParameters {
                to: msg.liquidityDepositContractData.liquidityDepositContract!!,
                value: 0,
                mode: SendBounceIfActionFail | SendRemainingBalance,
                bounce: false,
                body: PartHasBeenDeposited {
                    additionalParams: msg.additionalParams,
                    amount: msg.amountIn,
                    ammPoolCode: codeOf AmmPool,
                }.toCell(),
            });
        } else {
            let initData = msg.liquidityDepositContractData.initData!!;

            let sorted = sortAddressesAndCoins(
                myAddress(),
                initData.otherVault,
                msg.amountIn,
                initData.otherAmount,
            );

            let depositorStateInit = initOf LiquidityDepositContract(
                sorted.lower,
                sorted.higher,
                sorted.lowerCoins,
                sorted.higherCoins,
                msg.lpTokensReceiver != null ? msg.lpTokensReceiver!! : sender(),
                initData.contractId,
                false,
                false,
                null,
                null,
            );

            deploy(DeployParameters {
                init: depositorStateInit,
                mode: SendBounceIfActionFail | SendRemainingBalance,
                value: 0,
                body: PartHasBeenDeposited {
                    amount: msg.amountIn,
                    additionalParams: msg.additionalParams,
                    ammPoolCode: codeOf AmmPool,
                }.toCell(),
            });
        }
    }

    receive() {
        cashback(sender());
    }
}
