import {Blockchain} from "@ton/sandbox"
import {createJettonAmmPool} from "../utils/environment"
import {toNano} from "@ton/core"
import {AmmPool} from "../output/DEX_AmmPool"
// eslint-disable-next-line
import {SendDumpToDevWallet} from "@tondevwallet/traces"

describe("Amm pool", () => {
    test("should swap exact amount of tokens", async () => {
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

        expect(swapResult.transactions).toHaveTransaction({
            from: vaultA.vault.address,
            to: ammPool.address, // NOTE: Swap should fail
            exitCode: AmmPool.errors["Pool: Amount out is less than minAmountOut"],
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

        const withdrawResult = await withdrawLiquidity(lpBalanceAfterFirstLiq, null)

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
})
