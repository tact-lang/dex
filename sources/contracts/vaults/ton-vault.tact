import "./vault-interface";
import "../math";
import "../core/messages.tact";
import "../core/liquidity-deposit";

contract TonVault(
    admin: Address,
) with VaultInterface {
    override fun handlePayout(msg: PayoutFromPool) {
        let sortedAddresses = sortAddresses(myAddress(), msg.otherVault);
        let poolInit = initOf AmmPool(sortedAddresses.lower, sortedAddresses.higher, 0, 0, 0);

        require(poolInit.hasSameBasechainAddress(sender()), "TonVault: Sender must be pool");
        // -> (fee) -> (ton vault) -> [(0.2) + amount 10 ton]
        message(MessageParameters {
            to: msg.receiver,
            value: msg.amount,
            mode: SendRemainingValue,
            bounce: false,
            body: msg.payloadToForward,
        });
    }

    receive(msg: SwapRequestTon) {
        nativeReserve(0, ReserveExact | ReserveAddOriginalBalance);

        let otherVault = msg.destinationVault;
        let sortedAddresses = sortAddresses(myAddress(), otherVault);

        let poolAddress = contractAddress(initOf AmmPool(sortedAddresses.lower, sortedAddresses.higher, 0, 0, 0));
        message(MessageParameters {
            value: msg.amountIn,
            bounce: false,
            mode: SendBounceIfActionFail,
            to: poolAddress,
            body: SwapIn {
                swapOutReceiver: msg.receiver,
                amount: msg.amountIn,
                minAmountOut: msg.minAmountOut,
                timeout: msg.timeout,
                payloadOnSuccess: msg.payloadOnSuccess,
                payloadOnFailure: msg.payloadOnFailure,
            }.toCell(),
        });
    }

    receive(msg: AddLiquidityPartTon) {
        nativeReserve(msg.amountIn, ReserveExact | ReserveAddOriginalBalance);

        message(MessageParameters {
            to: msg.liquidityDepositContract,
            value: 0,
            mode: SendBounceIfActionFail | SendRemainingBalance,
            bounce: false,
            body: PartHasBeenDeposited {
                additionalParams: msg.additionalParams,
                amount: msg.amountIn,
                depositor: sender(),
            }.toCell(),
        });
    }

    receive() {}
}
