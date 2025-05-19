import "./liquidity-deposit";
import "./messages";
import "../utils/utils";
import "lp-jettons/constants";
import "lp-jettons/utils";
import "lp-jettons/LP-jetton-minter";

contract AmmPool(
    leftVault: Address,
    rightVault: Address, // To be deterministic, rightVault address must be greater than leftVault address
    // Amount of tokens are stored as coins, as all minted TONs can be stored as coins
    // And Jetton TEP-74 also uses coins for amount
    leftSideReserve: Int as coins, // Should be deployed with 0
    rightSideReserve: Int as coins, // Should be deployed with 0
    // LP tokens-related field
    totalSupply: Int as coins, // Should be deployed with 0
    jettonContent: Cell?,
) with LPJettonMinter {
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
            null,
            null,
        );

        require(liquidityDepositContractInit.hasSameBasechainAddress(sender()), "Pool: Liquidity provider should be liquidity contract");
        require(msg.leftAmount > 0, "Pool: You can't add 0 tokens on one side");

        let leftSideReceived = msg.leftAmount;
        let rightSideReceived = msg.rightAmount;
        // Both sides are 0 in this case.
        if (now() > max(msg.leftAdditionalParams.lpTimeout, msg.rightAdditionalParams.lpTimeout)) {
            self.failLiquidityProvision(msg);
            require(false, "Pool: Liquidity provision failed due to timeout");
        }

        require(
            (self.leftSideReserve == 0) ==
            (self.rightSideReserve == 0),
            "Pool: INVARIANT BROKEN",
        );
        if (self.leftSideReserve == 0) {
            self.leftSideReserve = msg.leftAmount;
            self.rightSideReserve = msg.rightAmount;
        } else {
            // Liquidity provide contract does not allow to add 0 tokens on one side.
            // Probably the rate has changed, so we must return extra tokens.

            // We can multiply without overflow, as coins are have 120 bits precision, so coins * coins < 2^256 and we will never overflow
            if (msg.rightAmount * self.leftSideReserve > self.rightSideReserve * msg.leftAmount) {
                let expectedRightAmount = muldiv(msg.leftAmount, self.rightSideReserve, self.leftSideReserve);
                rightSideReceived = expectedRightAmount;

                // Slippage is too high, we need to decline liquidity provision and return all tokens
                if (rightSideReceived < msg.rightAdditionalParams.minAmountToDeposit) {
                    // We can't reuse returnFunds function because we need to return both sides
                    self.failLiquidityProvision(msg);
                    require(false, "Pool: Liquidity provision failed due to slippage on right side");
                }

                message(MessageParameters {
                    // TODO: think about the value here and in lp minting
                    value: context().value / 2,
                    mode: SendPayFwdFeesSeparately,
                    to: self.rightVault,
                    body: PayoutFromPool {
                        otherVault: self.leftVault,
                        amount: msg.rightAmount - expectedRightAmount,
                        receiver: msg.depositor,
                        // TODO: Maybe we don't need to forward any payload here?
                        // Or we can even forward both payloads?
                        payloadToForward: msg.rightAdditionalParams.payloadOnSuccess,
                    }.toCell(),
                });
            } else {
                let expectedLeftAmount = muldiv(msg.rightAmount, self.leftSideReserve, self.rightSideReserve);
                leftSideReceived = expectedLeftAmount;

                if (leftSideReceived < msg.leftAdditionalParams.minAmountToDeposit) {
                    // We can't reuse returnFunds function because we need to return both sides
                    self.failLiquidityProvision(msg);
                    require(false, "Pool: Liquidity provision failed due to slippage on left side");
                }

                message(MessageParameters {
                    value: context().value / 2,
                    mode: SendPayFwdFeesSeparately,
                    to: self.leftVault,
                    bounce: false,
                    body: PayoutFromPool {
                        // TODO: Maybe we don't need to forward any payload here?
                        // Or we can even forward both payloads?
                        payloadToForward: msg.leftAdditionalParams.payloadOnSuccess,
                        otherVault: self.rightVault,
                        amount: msg.leftAmount - expectedLeftAmount,
                        receiver: msg.depositor,
                    }.toCell(),
                });
            }

            self.leftSideReserve += leftSideReceived;
            self.rightSideReserve += rightSideReceived;
        }

        // TODO Consider checking overflow
        let liquidityTokensToMint = sqrt(leftSideReceived * rightSideReceived);
        // not first time
        if (self.leftSideReserve != leftSideReceived) {
            /*
                lpTokens: min(
                    (amountADesired * mintedLpTokenTotalSupply) / tokenAReserveBefore,
                    (amountB * mintedLpTokenTotalSupply) / tokenBReserveBefore,
                ),
            */
            liquidityTokensToMint = min(
                muldiv(leftSideReceived, self.totalSupply, self.leftSideReserve - leftSideReceived),
                muldiv(rightSideReceived, self.totalSupply, self.rightSideReserve - rightSideReceived),
            );
        }

        let forwardPayload = beginCell()
            .storeBit(false) // Either bit equals 0
            .storeMaybeRef(msg.leftAdditionalParams.payloadOnSuccess)
            .storeMaybeRef(msg.rightAdditionalParams.payloadOnSuccess)
            .endCell()
            .beginParse();

        self.totalSupply += liquidityTokensToMint;

        // Mint LP tokens, amm pool acts as the jetton minter for lp jettons
        deploy(DeployParameters {
            value: context().value / 2 - 1,
            bounce: true,
            mode: SendPayFwdFeesSeparately,
            init: getJettonWalletInit(msg.depositor),
            body: MintViaJettonTransferInternal {
                queryId: 0,
                amount: liquidityTokensToMint,
                sender: myAddress(),
                responseDestination: msg.depositor,
                forwardTonAmount: 1, // TODO: We should maximize forwardTonAmount
                forwardPayload,
            }.toCell(),
        });
    }

    receive(msg: LiquidityWithdrawViaBurnNotification) {
        let sender = parseStdAddress(sender().asSlice());
        let wallet = getJettonBasechainWalletByOwner(msg.sender);

        // Workchain 0 is basechain
        require(sender.workchain == Basechain && sender.address == wallet.hash!!, "Pool: Invalid sender of JettonBurn notification");

        let action = msg.forwardPayload;

        require(action.timeout == 0 || now() <= action.timeout, "Pool: Expired timeout on liquidity withdrawal");

        let amountOfLeftToPay = muldiv(msg.amount, self.leftSideReserve, self.totalSupply);
        let amountOfRightToPay = muldiv(msg.amount, self.rightSideReserve, self.totalSupply);

        // it will bounce back and sender's jetton wallet will handle burn bounce
        require(amountOfLeftToPay >= action.leftAmountMin, "Pool: Couldn't pay left more than asked");
        require(amountOfRightToPay >= action.rightAmountMin, "Pool: Couldn't pay right more than asked");

        self.totalSupply -= msg.amount;
        let halfOfMsgValue = context().value / 2;

        self.leftSideReserve -= amountOfLeftToPay;
        self.rightSideReserve -= amountOfRightToPay;

        // Preserve original balance (more, if we have storage debt)
        nativeReserve(myStorageDue(), ReserveAddOriginalBalance | ReserveExact);

        message(MessageParameters {
            to: self.leftVault,
            value: halfOfMsgValue,
            mode: SendDefaultMode | SendBounceIfActionFail,
            body: PayoutFromPool {
                otherVault: self.rightVault,
                amount: amountOfLeftToPay,
                receiver: action.receiver,
                payloadToForward: action.liquidityWithdrawPayload,
            }.toCell(),
        });

        message(MessageParameters {
            to: self.rightVault,
            value: 0,
            mode: SendRemainingBalance,
            body: PayoutFromPool {
                otherVault: self.leftVault,
                amount: amountOfRightToPay,
                receiver: action.receiver,
                payloadToForward: action.liquidityWithdrawPayload,
            }.toCell(),
        });
    }

    const PoolFee: Int = 3; // 0.3%

    receive(msg: SwapIn) {
        let incomingVault = emptyAddress();
        let inVault = emptyAddress();
        let outVault = emptyAddress();
        let inBalance = 0;
        let outBalance = 0;
        let vaultOrderSwap = false;

        // Check if the sender is another pool
        if (msg.multihopInfo != null) {
            let init = initOf AmmPool(msg.multihopInfo!!.leftVault, msg.multihopInfo!!.rightVault, 0, 0, 0, null);
            // We use require if situations that should never be possible unless someone is trying to hack the contract
            require(init.hasSameBasechainAddress(sender()), "Pool: Sender must be pool if multihopInfo is specified");
            require(msg.multihopInfo!!.outVault == self.leftVault || msg.multihopInfo!!.outVault == self.rightVault, "Pool: Out vault on a previous step must be one of the pool vaults");
            // Their out vault is our in vault
            incomingVault = msg.multihopInfo!!.outVault;
        } else {
            incomingVault = sender();
            require(incomingVault == self.leftVault || incomingVault == self.rightVault, "Pool: Sender must be a vault");
        }

        // TODO: This if statement can be optimized. Just need to set default values for inVault, outVault, inBalance and outBalance as for leftVault
        if (incomingVault == self.leftVault) {
            inVault = self.leftVault;
            outVault = self.rightVault;
            inBalance = self.leftSideReserve;
            outBalance = self.rightSideReserve;
        } else {
            inVault = self.rightVault;
            outVault = self.leftVault;
            inBalance = self.rightSideReserve;
            outBalance = self.leftSideReserve;
            vaultOrderSwap = true;
        }

        // TODO: Need to add block functionality (for exact-time listings)

        if (inBalance == 0 || outBalance == 0) {
            returnFunds(incomingVault, msg.swapOutReceiver, outVault, msg.amount, msg.payloadOnFailure);
            require(false, "Pool: No liquidity in pool");
        }

        if (msg.timeout > 0 && now() > msg.timeout) {
            returnFunds(incomingVault, msg.swapOutReceiver, outVault, msg.amount, msg.payloadOnFailure);
            require(false, "Pool: Swap timeout");
        }
        let newAmountIn = -1;
        let newAmountOut = -1;
        // ExactIn swap (default one)
        if (!msg.isExactOutType) {
            // TODO: Test, that muldiv for msg.amount >= 0, 1000 - self.PoolFee >= 0 does not produce negative result
            // I couldn't check that in sources, cause there is very shitty c++ code that is impossible to read
            // So we just need to kinda fuzz it with corner cases
            let amountInWithFee = muldiv(msg.amount, 1000 - self.PoolFee, 1000);

            newAmountIn = inBalance + amountInWithFee;
            newAmountOut = muldiv(outBalance, inBalance, newAmountIn);
            let amountToPay = outBalance - newAmountOut;

            if (amountToPay < msg.limit) {
                returnFunds(incomingVault, msg.swapOutReceiver, outVault, msg.amount, msg.payloadOnFailure);
                require(false, "Pool: Amount out is less than minAmountOut");
            }

            // So we have one more swap step
            if (msg.nextStep != null) {
                message(MessageParameters {
                    mode: SendRemainingValue,
                    body: SwapIn {
                        swapOutReceiver: msg.swapOutReceiver,
                        amount: amountToPay,
                        // Swap type for multi-hop swaps is always exactIn
                        isExactOutType: false,
                        limit: msg.nextStep!!.minAmountOut,
                        timeout: msg.timeout,
                        payloadOnSuccess: msg.payloadOnSuccess,
                        payloadOnFailure: msg.payloadOnFailure,
                        nextStep: msg.nextStep!!.nextStep != null ? SwapStep.fromCell(msg.nextStep!!.nextStep) : null,

                        multihopInfo: MultihopInfo {
                            leftVault: self.leftVault,
                            rightVault: self.rightVault,
                            outVault,
                        },
                    }.toCell(),
                    value: 0,
                    to: msg.nextStep!!.pool,
                    // All internal protocol messages are sent with bounce = false
                    bounce: false,
                });
            } else {
                message(MessageParameters {
                    value: 0,
                    mode: SendRemainingValue,
                    to: outVault,
                    body: PayoutFromPool {
                        otherVault: inVault,
                        amount: amountToPay,
                        receiver: msg.swapOutReceiver,
                        payloadToForward: msg.payloadOnSuccess,
                    }.toCell(),
                });
            }
        } else {
            // TODO: Implement exactOut swap
            require(false, "Pool: ExactOut swap is not supported yet");
        }

        if (vaultOrderSwap) {
            self.leftSideReserve = newAmountOut;
            self.rightSideReserve = newAmountIn;
        } else {
            self.leftSideReserve = newAmountIn;
            self.rightSideReserve = newAmountOut;
        }
    }

    get fun leftVault(): Address {
        return self.leftVault;
    }

    get fun rightVault(): Address {
        return self.rightVault;
    }

    get fun leftSide(): Int {
        return self.leftSideReserve;
    }

    get fun rightSide(): Int {
        return self.rightSideReserve;
    }

    get fun reserveForVault(vaultAddress: Address): Int {
        if (vaultAddress == self.leftVault) {
            return self.leftSideReserve;
        } else if (vaultAddress == self.rightVault) {
            return self.rightSideReserve;
        } else {
            require(false, "Pool: argument of `reserveForVault` must be one of the vaults");
            return 0; // This line will never be reached, but we need to return something to satisfy the compiler
        }
    }

    get fun expectedOut(vaultAddress: Address, amountIn: Int): Int {
        let inVault = emptyAddress();
        let outVault = emptyAddress();
        let inBalance = 0;
        let outBalance = 0;

        if (vaultAddress == self.leftVault) {
            inVault = self.leftVault;
            outVault = self.rightVault;
            inBalance = self.leftSideReserve;
            outBalance = self.rightSideReserve;
        } else {
            inVault = self.rightVault;
            outVault = self.leftVault;
            inBalance = self.rightSideReserve;
            outBalance = self.leftSideReserve;
        }
        let amountInWithFee = muldiv(amountIn, 1000 - self.PoolFee, 1000);
        let newAmountIn = inBalance + amountInWithFee;
        let newAmountOut = muldiv(outBalance, inBalance, newAmountIn);
        return outBalance - newAmountOut;
    }

    inline fun failLiquidityProvision(msg: LiquidityDeposit) {
        let halfOfMsgValue = context().value / 2;
        // TODO: Maybe nativeReserve() here?
        // nativeReserve(myStorageDue(), ReserveAddOriginalBalance | ReserveExact);
        // Check tha sample above
        message(MessageParameters {
            to: self.leftVault,
            value: halfOfMsgValue,
            bounce: false,
            mode: SendDefaultMode | SendIgnoreErrors,
            body: PayoutFromPool {
                otherVault: self.rightVault,
                amount: msg.rightAmount,
                receiver: msg.depositor,
                payloadToForward: msg.leftAdditionalParams.payloadOnFailure,
            }.toCell(),
        });
        message(MessageParameters {
            to: self.rightVault,
            value: halfOfMsgValue,
            bounce: false,
            mode: SendDefaultMode | SendIgnoreErrors,
            body: PayoutFromPool {
                otherVault: self.leftVault,
                amount: msg.leftAmount,
                receiver: msg.depositor,
                payloadToForward: msg.rightAdditionalParams.payloadOnFailure,
            }.toCell(),
        });
        commit();
    }
}

inline fun returnFunds(viaVault: Address, receiver: Address, otherVault: Address, amount: Int, payloadOnFailure: Cell?) {
    message(MessageParameters {
        to: viaVault,
        value: 0,
        bounce: false,
        mode: SendRemainingValue,
        body: PayoutFromPool {
            otherVault,
            amount,
            receiver,
            payloadToForward: payloadOnFailure,
        }.toCell(),
    });
    commit();
}
