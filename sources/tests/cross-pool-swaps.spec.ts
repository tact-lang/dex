import {Blockchain} from "@ton/sandbox"
import {createJettonAmmPool, createTonJettonAmmPool} from "../utils/environment"
import {toNano} from "@ton/core"
import {AmmPool} from "../output/DEX_AmmPool"
// eslint-disable-next-line
import {SendDumpToDevWallet} from "@tondevwallet/traces"

describe("Cross-pool Swaps", () => {
    test("should perform Jetton->Jetton->Jetton swap", async () => {
        const blockchain = await Blockchain.create()

        const {
            ammPool: firstAmmPool,
            vaultA: firstPoolVaultA,
            vaultB: firstPoolVaultB,
            initWithLiquidity: initWithLiquidityFirst,
            swap,
        } = await createJettonAmmPool(blockchain)

        const {ammPool: secondAmmPool, initWithLiquidity: initWithLiquiditySecond} =
            await createJettonAmmPool(blockchain)

        // deploy liquidity deposit contract
        const initialRatio = 2n
        const amountA = toNano(1)
        const amountB = amountA * initialRatio // 1 a == 2 b ratio
        const depositor = firstPoolVaultA.treasury.walletOwner
        const _ = await initWithLiquidityFirst(depositor, amountA, amountB)
        const __ = await initWithLiquiditySecond(depositor, amountA, amountB)

        const amountToSwap = 10n
        const expectedOutFirst = await firstAmmPool.getExpectedOut(
            firstPoolVaultA.vault.address,
            amountToSwap,
        )
        const expectedOutSecond = await secondAmmPool.getExpectedOut(
            firstPoolVaultB.vault.address,
            expectedOutFirst,
        )
        const nextSwapStep = {
            $$type: "SwapStep",
            pool: secondAmmPool.address,
            minAmountOut: expectedOutSecond,
            nextStep: null,
        } as const
        const swapResult = await swap(
            amountToSwap,
            "vaultA",
            expectedOutFirst,
            0n,
            null,
            null,
            nextSwapStep,
        )

        // Successful swap in first pool
        expect(swapResult.transactions).toHaveTransaction({
            from: firstPoolVaultA.vault.address,
            to: firstAmmPool.address,
            op: AmmPool.opcodes.SwapIn,
            success: true,
        })

        // Successful swap in second pool
        expect(swapResult.transactions).toHaveTransaction({
            from: firstAmmPool.address,
            to: secondAmmPool.address,
            op: AmmPool.opcodes.SwapIn,
            success: true,
        })

        expect(swapResult.transactions).toHaveTransaction({
            from: secondAmmPool.address,
            op: AmmPool.opcodes.PayoutFromPool,
            success: true,
        })
    })

    const createPoolCombinations = [
        {
            name: "Jetton->Jetton->Jetton",
            firstPool: createJettonAmmPool,
            secondPool: createJettonAmmPool,
        },
        {
            name: "TON->Jetton->Jetton",
            firstPool: createTonJettonAmmPool,
            secondPool: createJettonAmmPool,
        },
        {
            name: "TON->Jetton->TON",
            firstPool: createTonJettonAmmPool,
            secondPool: createTonJettonAmmPool,
        },
    ]

    test.each(createPoolCombinations)(
        "should perform $name swap",
        async ({firstPool, secondPool}) => {
            const blockchain = await Blockchain.create()

            const {
                ammPool: firstAmmPool,
                vaultA: firstPoolVaultA,
                vaultB: firstPoolVaultB,
                initWithLiquidity: initWithLiquidityFirst,
                swap,
            } = await firstPool(blockchain)

            const {ammPool: secondAmmPool, initWithLiquidity: initWithLiquiditySecond} =
                await secondPool(blockchain)

            // deploy liquidity deposit contract
            const initialRatio = 2n
            const amountA = toNano(1)
            const amountB = amountA * initialRatio // 1 a == 2 b ratio
            const depositor = firstPoolVaultA.treasury.walletOwner

            const _ = await initWithLiquidityFirst(depositor, amountA, amountB)
            const __ = await initWithLiquiditySecond(depositor, amountA, amountB)

            const amountToSwap = 10n
            const expectedOutFirst = await firstAmmPool.getExpectedOut(
                firstPoolVaultA.vault.address,
                amountToSwap,
            )
            const expectedOutSecond = await secondAmmPool.getExpectedOut(
                firstPoolVaultB.vault.address,
                expectedOutFirst,
            )
            const nextSwapStep = {
                $$type: "SwapStep",
                pool: secondAmmPool.address,
                minAmountOut: expectedOutSecond,
                nextStep: null,
            } as const
            const swapResult = await swap(
                amountToSwap,
                "vaultA",
                expectedOutFirst,
                0n,
                null,
                null,
                nextSwapStep,
            )

            // Successful swap in first pool
            expect(swapResult.transactions).toHaveTransaction({
                from: firstPoolVaultA.vault.address,
                to: firstAmmPool.address,
                op: AmmPool.opcodes.SwapIn,
                success: true,
            })

            // Successful swap in second pool
            expect(swapResult.transactions).toHaveTransaction({
                from: firstAmmPool.address,
                to: secondAmmPool.address,
                op: AmmPool.opcodes.SwapIn,
                success: true,
            })

            expect(swapResult.transactions).toHaveTransaction({
                from: secondAmmPool.address,
                op: AmmPool.opcodes.PayoutFromPool,
                success: true,
            })
        },
    )
})
