//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import {Blockchain, GetMethodError, SandboxContract} from "@ton/sandbox"
import {createJettonAmmPool, createTonJettonAmmPool} from "../utils/environment"
import {Address, beginCell, toNano, TupleBuilder} from "@ton/core"
import {AmmPool, loadPayoutFromPool} from "../output/DEX_AmmPool"
// eslint-disable-next-line
import {SendDumpToDevWallet} from "@tondevwallet/traces"
import {findTransactionRequired, flattenTransaction, randomAddress} from "@ton/test-utils"
import {ExtendedLPJettonWallet} from "../wrappers/ExtendedLPJettonWallet"
import {randomInt} from "crypto"

describe("Amm pool", () => {
    test("should swap exact amount of jetton to jetton", async () => {
        const blockchain = await Blockchain.create()

        const {ammPool, vaultA, vaultB, initWithLiquidity, swap} =
            await createJettonAmmPool(blockchain)

        // deploy liquidity deposit contract
        const initialRatio = 2n

        const amountA = toNano(1)
        const amountB = amountA * initialRatio // 1 a == 2 b ratio

        const depositor = vaultA.treasury.walletOwner

        const {depositorLpWallet} = await initWithLiquidity(depositor, amountA, amountB)

        const lpBalanceAfterFirstLiq = await depositorLpWallet.getJettonBalance()
        // check that liquidity deposit was successful
        expect(lpBalanceAfterFirstLiq).toBeGreaterThan(0n)

        const amountToSwap = 10n
        const expectedOutput = await ammPool.getExpectedOut(vaultA.vault.address, amountToSwap)

        const amountBJettonBeforeSwap = await vaultB.treasury.wallet.getJettonBalance()

        const swapResult = await swap(amountToSwap, "vaultA", expectedOutput)

        expect((await blockchain.getContract(ammPool.address)).balance).toBeLessThanOrEqual(0n)

        // check that swap was successful
        expect(swapResult.transactions).toHaveTransaction({
            from: vaultA.vault.address,
            to: ammPool.address,
            op: AmmPool.opcodes.SwapIn,
            success: true,
        })

        expect(swapResult.transactions).toHaveTransaction({
            from: ammPool.address,
            to: vaultB.vault.address,
            op: AmmPool.opcodes.PayoutFromPool,
            success: true,
        })

        expect(swapResult.transactions).toHaveTransaction({
            // TODO: from: vaultB.jettonWallet
            to: vaultB.treasury.wallet.address,
            op: AmmPool.opcodes.JettonTransferInternal,
            success: true,
        })

        const amountOfJettonBAfterSwap = await vaultB.treasury.wallet.getJettonBalance()
        // TODO: calculate precise expected amount of token B off-chain
        expect(amountOfJettonBAfterSwap).toBeGreaterThan(amountBJettonBeforeSwap)
    })

    test("should revert swap with slippage", async () => {
        const blockchain = await Blockchain.create()

        const {ammPool, vaultA, vaultB, initWithLiquidity, swap} =
            await createJettonAmmPool(blockchain)

        // deploy liquidity deposit contract
        const initialRatio = 2n

        const amountA = toNano(1)
        const amountB = amountA * initialRatio // 1 a == 2 b ratio

        const depositor = vaultA.treasury.walletOwner

        const {depositorLpWallet} = await initWithLiquidity(depositor, amountA, amountB)

        const lpBalanceAfterFirstLiq = await depositorLpWallet.getJettonBalance()
        // check that liquidity deposit was successful
        expect(lpBalanceAfterFirstLiq).toBeGreaterThan(0n)

        const amountToSwap = 10n
        const expectedOutput = await ammPool.getExpectedOut(vaultA.vault.address, amountToSwap)

        const amountBJettonBeforeSwap = await vaultB.treasury.wallet.getJettonBalance()
        const amountAJettonBeforeSwap = await vaultA.treasury.wallet.getJettonBalance()

        const swapResult = await swap(amountToSwap, "vaultA", expectedOutput + 1n) // slippage
        expect((await blockchain.getContract(ammPool.address)).balance).toBeLessThanOrEqual(0n)

        expect(swapResult.transactions).toHaveTransaction({
            from: vaultA.vault.address,
            to: ammPool.address, // NOTE: Swap should fail
            exitCode: AmmPool.errors["Pool: Amount out is less than desired amount"],
            success: true, // That is what happens when throw after commit(), exit code is non-zero, success is true
        })

        const amountAJettonAfterSwap = await vaultA.treasury.wallet.getJettonBalance()
        const amountBJettonAfterSwap = await vaultB.treasury.wallet.getJettonBalance()

        // check that swap was reverted and jettons are not moved
        expect(amountAJettonBeforeSwap).toEqual(amountAJettonAfterSwap)
        expect(amountBJettonBeforeSwap).toEqual(amountBJettonAfterSwap)
    })

    test("should withdraw liquidity with lp burn", async () => {
        const blockchain = await Blockchain.create()

        const {ammPool, vaultA, vaultB, initWithLiquidity} = await createJettonAmmPool(blockchain)

        // deploy liquidity deposit contract
        const initialRatio = 2n

        const amountA = toNano(1)
        const amountB = amountA * initialRatio // 1 a == 2 b ratio

        const depositor = vaultA.treasury.walletOwner

        const {depositorLpWallet, withdrawLiquidity} = await initWithLiquidity(
            depositor,
            amountA,
            amountB,
        )

        const lpBalanceAfterFirstLiq = await depositorLpWallet.getJettonBalance()
        // check that liquidity deposit was successful
        expect(lpBalanceAfterFirstLiq).toBeGreaterThan(0n)

        const amountBJettonBefore = await vaultB.treasury.wallet.getJettonBalance()
        const amountAJettonBefore = await vaultA.treasury.wallet.getJettonBalance()

        const withdrawResult = await withdrawLiquidity(lpBalanceAfterFirstLiq, 0n, 0n, 0n, null)

        expect((await blockchain.getContract(ammPool.address)).balance).toBeLessThanOrEqual(0n)

        expect(withdrawResult.transactions).toHaveTransaction({
            from: depositorLpWallet.address,
            to: ammPool.address,
            op: AmmPool.opcodes.LiquidityWithdrawViaBurnNotification,
            success: true,
        })
        expect(withdrawResult.transactions).toHaveTransaction({
            from: ammPool.address,
            to: vaultA.vault.address,
            op: AmmPool.opcodes.PayoutFromPool,
            success: true,
        })

        expect(withdrawResult.transactions).toHaveTransaction({
            from: ammPool.address,
            to: vaultB.vault.address,
            op: AmmPool.opcodes.PayoutFromPool,
            success: true,
        })

        const amountBJettonAfter = await vaultB.treasury.wallet.getJettonBalance()
        const amountAJettonAfter = await vaultA.treasury.wallet.getJettonBalance()

        // TODO: add off-chain precise checks here
        expect(amountAJettonAfter).toBeGreaterThan(amountAJettonBefore)
        expect(amountBJettonAfter).toBeGreaterThan(amountBJettonBefore)
    })

    test("should swap exact amount of jetton to ton", async () => {
        const blockchain = await Blockchain.create()

        const {ammPool, vaultA, vaultB, initWithLiquidity, swap} =
            await createTonJettonAmmPool(blockchain)

        // deploy liquidity deposit contract
        const initialRatio = 2n

        const amountA = toNano(1)
        const amountB = amountA * initialRatio // 1 a == 2 b ratio

        const depositor = vaultB.treasury.walletOwner

        const {depositorLpWallet} = await initWithLiquidity(depositor, amountA, amountB)

        const lpBalanceAfterFirstLiq = await depositorLpWallet.getJettonBalance()
        // check that liquidity deposit was successful
        expect(lpBalanceAfterFirstLiq).toBeGreaterThan(0n)

        // swap 10 jettons for ton
        const amountToSwap = 10n
        const expectedOutputTon = await ammPool.getExpectedOut(vaultB.vault.address, amountToSwap)

        const amountBJettonBeforeSwap = await vaultB.treasury.wallet.getJettonBalance()

        const swapResult = await swap(amountToSwap, "vaultB", expectedOutputTon)
        expect((await blockchain.getContract(ammPool.address)).balance).toBeLessThanOrEqual(0n)

        // check that swap was successful
        expect(swapResult.transactions).toHaveTransaction({
            from: vaultB.vault.address,
            to: ammPool.address,
            op: AmmPool.opcodes.SwapIn,
            success: true,
        })

        expect(swapResult.transactions).toHaveTransaction({
            from: ammPool.address,
            to: vaultA.vault.address,
            op: AmmPool.opcodes.PayoutFromPool,
            success: true,
        })

        expect(swapResult.transactions).toHaveTransaction({
            to: vaultB.treasury.walletOwner.address,
            // TODO: add precise ton calculations (a lot of different fees)
            // value: expectedOutputTon,
            success: true,
        })

        const amountOfJettonBAfterSwap = await vaultB.treasury.wallet.getJettonBalance()
        expect(amountOfJettonBAfterSwap).toBe(amountBJettonBeforeSwap - amountToSwap)
    })

    test("should swap exact amount of ton to jetton", async () => {
        const blockchain = await Blockchain.create()

        const {ammPool, vaultA, vaultB, initWithLiquidity, swap} =
            await createTonJettonAmmPool(blockchain)

        // deploy liquidity deposit contract
        const initialRatio = 2n

        const amountA = toNano(1)
        const amountB = amountA * initialRatio // 1 a == 2 b ratio

        const depositor = vaultB.treasury.walletOwner

        const {depositorLpWallet} = await initWithLiquidity(depositor, amountA, amountB)

        const lpBalanceAfterFirstLiq = await depositorLpWallet.getJettonBalance()
        // check that liquidity deposit was successful
        expect(lpBalanceAfterFirstLiq).toBeGreaterThan(0n)

        // swap 5 nanoton for jetton
        const amountToSwapTon = 5n
        const expectedOutputJetton = await ammPool.getExpectedOut(
            vaultA.vault.address,
            amountToSwapTon,
        )

        const amountBJettonBeforeSwap = await vaultB.treasury.wallet.getJettonBalance()

        const swapResult = await swap(amountToSwapTon, "vaultA", expectedOutputJetton)

        expect((await blockchain.getContract(ammPool.address)).balance).toBeLessThanOrEqual(0n)

        // check that swap was successful
        expect(swapResult.transactions).toHaveTransaction({
            from: vaultA.vault.address,
            to: ammPool.address,
            op: AmmPool.opcodes.SwapIn,
            success: true,
        })

        expect(swapResult.transactions).toHaveTransaction({
            from: ammPool.address,
            to: vaultB.vault.address,
            op: AmmPool.opcodes.PayoutFromPool,
            success: true,
        })

        expect(swapResult.transactions).toHaveTransaction({
            to: vaultB.treasury.wallet.address,
            op: AmmPool.opcodes.JettonTransferInternal,
            success: true,
        })

        const amountOfJettonBAfterSwap = await vaultB.treasury.wallet.getJettonBalance()
        expect(amountOfJettonBAfterSwap).toBe(amountBJettonBeforeSwap + expectedOutputJetton)
    })

    describe("Amm pool should act as a JettonMaster", () => {
        const createUserLPWallet = (blockchain: Blockchain, ammPool: SandboxContract<AmmPool>) => {
            return async (address: Address) => {
                return blockchain.openContract(
                    new ExtendedLPJettonWallet(await ammPool.getGetWalletAddress(address)),
                )
            }
        }

        test("Amm pool is TEP-89 compatible JettonMaster that reports correct discovery address", async () => {
            const blockchain = await Blockchain.create()
            const deployer = await blockchain.treasury(randomAddress().toString()) // Just a random treasury
            const notDeployer = await blockchain.treasury(randomAddress().toString())
            const ammPool = blockchain.openContract(
                await AmmPool.fromInit(randomAddress(), randomAddress(), 0n, 0n, 0n, null),
            )
            const userWallet = createUserLPWallet(blockchain, ammPool)
            const deployAmmPoolRes = await ammPool.send(
                deployer.getSender(),
                {value: toNano(0.01)},
                null,
            )
            expect(deployAmmPoolRes.transactions).toHaveTransaction({
                from: deployer.address,
                to: ammPool.address,
                success: true,
            })

            let discoveryResult = await ammPool.send(
                deployer.getSender(),
                {
                    value: toNano(0.01),
                },
                {
                    $$type: "ProvideWalletAddress",
                    queryId: 0n,
                    ownerAddress: deployer.address,
                    includeAddress: true,
                },
            )

            expect((await blockchain.getContract(ammPool.address)).balance).toBeLessThanOrEqual(0n)

            /*
              take_wallet_address#d1735400 query_id:uint64 wallet_address:MsgAddress owner_address:(Maybe ^MsgAddress) = InternalMsgBody;
            */
            const deployerJettonWallet = await userWallet(deployer.address)
            expect(discoveryResult.transactions).toHaveTransaction({
                from: ammPool.address,
                to: deployer.address,
                body: beginCell()
                    .storeUint(AmmPool.opcodes.TakeWalletAddress, 32)
                    .storeUint(0, 64)
                    .storeAddress(deployerJettonWallet.address)
                    .storeUint(1, 1)
                    .storeRef(beginCell().storeAddress(deployer.address).endCell())
                    .endCell(),
            })

            discoveryResult = await ammPool.send(
                deployer.getSender(),
                {
                    value: toNano(0.01),
                },
                {
                    $$type: "ProvideWalletAddress",
                    queryId: 0n,
                    ownerAddress: notDeployer.address,
                    includeAddress: true,
                },
            )

            expect((await blockchain.getContract(ammPool.address)).balance).toBeLessThanOrEqual(0n)

            const notDeployerJettonWallet = await userWallet(notDeployer.address)
            expect(discoveryResult.transactions).toHaveTransaction({
                from: ammPool.address,
                to: deployer.address,
                body: beginCell()
                    .storeUint(AmmPool.opcodes.TakeWalletAddress, 32)
                    .storeUint(0, 64)
                    .storeAddress(notDeployerJettonWallet.address)
                    .storeUint(1, 1)
                    .storeRef(beginCell().storeAddress(notDeployer.address).endCell())
                    .endCell(),
            })

            // do not include the owner address
            discoveryResult = await ammPool.send(
                deployer.getSender(),
                {
                    value: toNano(0.01),
                },
                {
                    $$type: "ProvideWalletAddress",
                    queryId: 0n,
                    ownerAddress: notDeployer.address,
                    includeAddress: false,
                },
            )
            expect(discoveryResult.transactions).toHaveTransaction({
                from: ammPool.address,
                to: deployer.address,
                body: beginCell()
                    .storeUint(AmmPool.opcodes.TakeWalletAddress, 32)
                    .storeUint(0, 64)
                    .storeAddress(notDeployerJettonWallet.address)
                    .storeUint(0, 1)
                    .endCell(),
            })
        })
        test("Correctly handles not valid address in discovery", async () => {
            const blockchain = await Blockchain.create()
            const deployer = await blockchain.treasury(randomAddress().toString()) // Just a random treasury
            const ammPool = blockchain.openContract(
                await AmmPool.fromInit(randomAddress(), randomAddress(), 0n, 0n, 0n, null),
            )
            const badAddr = randomAddress(-1)
            let discoveryResult = await ammPool.send(
                deployer.getSender(),
                {
                    value: toNano(0.01),
                },
                {
                    $$type: "ProvideWalletAddress",
                    queryId: 0n,
                    ownerAddress: badAddr,
                    includeAddress: false,
                },
            )

            expect((await blockchain.getContract(ammPool.address)).balance).toBeLessThanOrEqual(0n)

            expect(discoveryResult.transactions).toHaveTransaction({
                from: ammPool.address,
                to: deployer.address,
                body: beginCell()
                    .storeUint(AmmPool.opcodes.TakeWalletAddress, 32)
                    .storeUint(0, 64)
                    .storeUint(0, 2) // addr_none
                    .storeUint(0, 1)
                    .endCell(),
            })

            // Include address should still be available

            discoveryResult = await ammPool.send(
                deployer.getSender(),
                {
                    value: toNano(0.01),
                },
                {
                    $$type: "ProvideWalletAddress",
                    queryId: 0n,
                    ownerAddress: badAddr,
                    includeAddress: true,
                },
            )

            expect(discoveryResult.transactions).toHaveTransaction({
                from: ammPool.address,
                to: deployer.address,
                body: beginCell()
                    .storeUint(AmmPool.opcodes.TakeWalletAddress, 32)
                    .storeUint(0, 64)
                    .storeUint(0, 2) // addr_none
                    .storeUint(1, 1)
                    .storeRef(beginCell().storeAddress(badAddr).endCell())
                    .endCell(),
            })
        })
    })
    describe("Exact out swaps", () => {
        test("Should correctly estimate amountIn for exact out swap", async () => {
            const blockchain = await Blockchain.create()

            const {ammPool, vaultA, vaultB, initWithLiquidity, swap} =
                await createJettonAmmPool(blockchain)

            // deploy liquidity deposit contract
            const initialRatio = 2n

            const amountA = toNano(1)
            const amountB = amountA * initialRatio // 1 a == 2 b ratio

            const depositor = vaultA.treasury.walletOwner

            const {depositorLpWallet} = await initWithLiquidity(depositor, amountA, amountB)

            const lpBalanceAfterFirstLiq = await depositorLpWallet.getJettonBalance()
            // check that liquidity deposit was successful
            expect(lpBalanceAfterFirstLiq).toBeGreaterThan(0n)

            const exactAmountOut = 100000n
            const notEnoughAmountIn =
                (await ammPool.getNeededInToGetX(vaultB.vault.address, exactAmountOut)) - 1n

            const tokenBReceiver = randomAddress()

            const payloadOnFailure = beginCell().storeStringTail("Failure payload").endCell()
            const payloadOnSuccess = beginCell().storeStringTail("Success payload").endCell()

            let swapResult = await swap(
                notEnoughAmountIn,
                "vaultA",
                exactAmountOut,
                0n,
                true,
                tokenBReceiver,
                payloadOnSuccess,
                payloadOnFailure,
            )

            expect((await blockchain.getContract(ammPool.address)).balance).toBeLessThanOrEqual(0n)

            // check that swap was not successful
            expect(swapResult.transactions).toHaveTransaction({
                from: vaultA.vault.address,
                to: ammPool.address,
                op: AmmPool.opcodes.SwapIn,
                exitCode:
                    AmmPool.errors["Pool: Amount of tokens sent is insufficient for exactOut swap"],
            })

            expect(swapResult.transactions).not.toHaveTransaction({
                from: ammPool.address,
                to: vaultB.vault.address,
            })

            const returnFundsTx = flattenTransaction(
                findTransactionRequired(swapResult.transactions, {
                    from: ammPool.address,
                    to: vaultA.vault.address,
                    op: AmmPool.opcodes.PayoutFromPool,
                }),
            )
            if (returnFundsTx.body === undefined) {
                throw new Error("Return funds transaction body is undefined")
            }
            const parsedReturnFundsTx = loadPayoutFromPool(returnFundsTx.body.asSlice())
            expect(parsedReturnFundsTx.amount).toEqual(notEnoughAmountIn)
            expect(parsedReturnFundsTx.otherVault).toEqualAddress(vaultB.vault.address)
            expect(parsedReturnFundsTx.payloadToForward).toEqualCell(payloadOnFailure)

            const enoughAmountIn = notEnoughAmountIn + 1n
            swapResult = await swap(
                enoughAmountIn,
                "vaultA",
                exactAmountOut,
                0n,
                true,
                tokenBReceiver,
                payloadOnSuccess,
                payloadOnFailure,
            )

            expect(swapResult.transactions).toHaveTransaction({
                from: vaultA.vault.address,
                to: ammPool.address,
                op: AmmPool.opcodes.SwapIn,
                exitCode: 0,
                success: true,
            })

            // Because we are sending the minimal possible amount, so there should be no excess
            expect(swapResult.transactions).not.toHaveTransaction({
                from: ammPool.address,
                to: vaultA.vault.address,
            })

            const payoutTx = flattenTransaction(
                findTransactionRequired(swapResult.transactions, {
                    from: ammPool.address,
                    to: vaultB.vault.address,
                    op: AmmPool.opcodes.PayoutFromPool,
                    exitCode: 0,
                }),
            )
            if (payoutTx.body === undefined) {
                throw new Error("Payout transaction body is undefined")
            }
            const parsedPayoutTx = loadPayoutFromPool(payoutTx.body.asSlice())
            expect(parsedPayoutTx.amount).toEqual(exactAmountOut)
            expect(parsedPayoutTx.otherVault).toEqualAddress(vaultA.vault.address)
            expect(parsedPayoutTx.payloadToForward).toEqualCell(payloadOnSuccess)
        })
        test("Exact out swap send excesses and swap out amount correctly", async () => {
            const blockchain = await Blockchain.create()

            const {ammPool, vaultA, vaultB, initWithLiquidity, swap} =
                await createJettonAmmPool(blockchain)

            // deploy liquidity deposit contract
            const initialRatio = 2n

            const amountA = toNano(1)
            const amountB = amountA * initialRatio // 1 a == 2 b ratio

            const depositor = vaultA.treasury.walletOwner

            const {depositorLpWallet} = await initWithLiquidity(depositor, amountA, amountB)

            const lpBalanceAfterFirstLiq = await depositorLpWallet.getJettonBalance()
            // check that liquidity deposit was successful
            expect(lpBalanceAfterFirstLiq).toBeGreaterThan(0n)

            const exactAmountOut = 100000n
            const amountToRefund = BigInt(randomInt(100, 1000))
            const moreThanEnoughAmountIn =
                (await ammPool.getNeededInToGetX(vaultB.vault.address, exactAmountOut)) +
                amountToRefund

            const payloadOnFailure = beginCell().storeStringTail("Failure payload").endCell()
            const payloadOnSuccess = beginCell().storeStringTail("Success payload").endCell()

            const cashbackAddress = randomAddress()

            const swapResult = await swap(
                moreThanEnoughAmountIn,
                "vaultA",
                exactAmountOut,
                0n,
                true,
                cashbackAddress,
                payloadOnSuccess,
                payloadOnFailure,
            )

            expect((await blockchain.getContract(ammPool.address)).balance).toBeLessThanOrEqual(0n)

            expect(swapResult.transactions).toHaveTransaction({
                from: vaultA.vault.address,
                to: ammPool.address,
                op: AmmPool.opcodes.SwapIn,
                exitCode: 0,
                success: true,
            })

            const refundTx = flattenTransaction(
                findTransactionRequired(swapResult.transactions, {
                    from: ammPool.address,
                    to: vaultA.vault.address,
                    op: AmmPool.opcodes.PayoutFromPool,
                    exitCode: 0,
                }),
            )
            if (refundTx.body === undefined) {
                throw new Error("Refund transaction body is undefined")
            }
            const parsedRefundTx = loadPayoutFromPool(refundTx.body.asSlice())
            expect(parsedRefundTx.amount).toEqual(amountToRefund)
            expect(parsedRefundTx.otherVault).toEqualAddress(vaultB.vault.address)
            expect(parsedRefundTx.payloadToForward).toEqualCell(payloadOnSuccess)
            expect(parsedRefundTx.receiver).toEqualAddress(cashbackAddress)

            const payoutTx = flattenTransaction(
                findTransactionRequired(swapResult.transactions, {
                    from: ammPool.address,
                    to: vaultB.vault.address,
                    op: AmmPool.opcodes.PayoutFromPool,
                    exitCode: 0,
                }),
            )
            if (payoutTx.body === undefined) {
                throw new Error("Payout transaction body is undefined")
            }
            const parsedPayoutTx = loadPayoutFromPool(payoutTx.body.asSlice())
            expect(parsedPayoutTx.receiver).toEqualAddress(vaultA.treasury.walletOwner.address)
            expect(parsedPayoutTx.amount).toEqual(exactAmountOut)
            expect(parsedPayoutTx.otherVault).toEqualAddress(vaultA.vault.address)
            expect(parsedPayoutTx.payloadToForward).toEqualCell(payloadOnSuccess)
        })

        test("Too big amountOut should revert", async () => {
            const blockchain = await Blockchain.create()

            const {ammPool, vaultA, vaultB, initWithLiquidity, swap} =
                await createJettonAmmPool(blockchain)

            const amountA = 1n
            const amountB = 2n

            const depositor = vaultA.treasury.walletOwner

            const {depositorLpWallet} = await initWithLiquidity(depositor, amountA, amountB)

            const lpBalanceAfterFirstLiq = await depositorLpWallet.getJettonBalance()
            // check that liquidity deposit was successful
            expect(lpBalanceAfterFirstLiq).toBeGreaterThan(0n)

            const builder = new TupleBuilder()
            builder.writeAddress(vaultB.vault.address)
            //builder.writeNumber(randomInt(2, 3));
            builder.writeNumber(2)
            const provider = blockchain.provider(ammPool.address)
            // IDK, how to catch the error in a better way
            // Sandbox just doesn't provide an interface for it
            try {
                await provider.get("neededInToGetX", builder.build())
            } catch (e) {
                if (!(e instanceof GetMethodError)) {
                    throw e
                }
                expect(e.exitCode).toEqual(
                    AmmPool.errors["Pool: Desired amount out is greater than pool reserves"],
                )
            }

            const tooMuchAmountOut = BigInt(randomInt(2, 4))
            const payloadOnFailure = beginCell().storeStringTail("Failure payload").endCell()
            const payloadOnSuccess = beginCell().storeStringTail("Success payload").endCell()

            const swapOutReceiver = randomAddress()

            const moreThanEnoughAmountIn = toNano(1)
            const swapResult = await swap(
                moreThanEnoughAmountIn,
                "vaultA",
                tooMuchAmountOut,
                0n,
                true,
                swapOutReceiver,
                payloadOnSuccess,
                payloadOnFailure,
            )
            expect(swapResult.transactions).toHaveTransaction({
                to: ammPool.address,
                from: vaultA.vault.address,
                exitCode: AmmPool.errors["Pool: Desired amount out is greater than pool reserves"],
            })
            const refundTx = flattenTransaction(
                findTransactionRequired(swapResult.transactions, {
                    from: ammPool.address,
                    to: vaultA.vault.address,
                    op: AmmPool.opcodes.PayoutFromPool,
                    exitCode: 0,
                }),
            )
            if (refundTx.body === undefined) {
                throw new Error("Refund transaction body is undefined")
            }
            const parsedRefundTx = loadPayoutFromPool(refundTx.body.asSlice())
            expect(parsedRefundTx.receiver).toEqualAddress(vaultA.treasury.walletOwner.address)
            expect(parsedRefundTx.amount).toEqual(moreThanEnoughAmountIn)
            expect(parsedRefundTx.otherVault).toEqualAddress(vaultB.vault.address)
            expect(parsedRefundTx.payloadToForward).toEqualCell(payloadOnFailure)
        })
    })
    test("Amm pool get-methods throw, when there are no reserves", async () => {
        const blockchain = await Blockchain.create()

        const randomDeployer = await blockchain.treasury(randomAddress().toString())
        const firstVault = randomAddress()
        const secondVault = randomAddress()
        const ammPool = blockchain.openContract(
            await AmmPool.fromInit(firstVault, secondVault, 0n, 0n, 0n, null),
        )

        await ammPool.send(randomDeployer.getSender(), {value: toNano(0.01)}, null)

        try {
            await ammPool.getExpectedOut(firstVault, BigInt(randomInt(0, 100)))
        } catch (e) {
            if (!(e instanceof GetMethodError)) {
                throw e
            }
            expect(e.exitCode).toEqual(AmmPool.errors["Pool: No liquidity in pool"])
        }

        try {
            await ammPool.getExpectedOut(secondVault, BigInt(randomInt(0, 100)))
        } catch (e) {
            if (!(e instanceof GetMethodError)) {
                throw e
            }
            expect(e.exitCode).toEqual(AmmPool.errors["Pool: No liquidity in pool"])
        }

        try {
            await ammPool.getNeededInToGetX(firstVault, BigInt(randomInt(0, 100)))
        } catch (e) {
            if (!(e instanceof GetMethodError)) {
                throw e
            }
            expect(e.exitCode).toEqual(AmmPool.errors["Pool: No liquidity in pool"])
        }

        try {
            await ammPool.getNeededInToGetX(secondVault, BigInt(randomInt(0, 100)))
        } catch (e) {
            if (!(e instanceof GetMethodError)) {
                throw e
            }
            expect(e.exitCode).toEqual(AmmPool.errors["Pool: No liquidity in pool"])
        }
    })
})
