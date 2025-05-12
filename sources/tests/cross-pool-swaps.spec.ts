import {Blockchain} from "@ton/sandbox"
import {
    createJettonVault,
    JettonTreasury,
    TonTreasury,
    Create,
    VaultInterface,
    createTonVault,
    createAmmPool,
} from "../utils/environment"

import {toNano} from "@ton/core"
import {AmmPool} from "../output/DEX_AmmPool"
// eslint-disable-next-line
import {SendDumpToDevWallet} from "@tondevwallet/traces"
import {findTransactionRequired, flattenTransaction} from "@ton/test-utils"

describe("Cross-pool Swaps", () => {
    const createVaults = <A, B, C>(
        first: Create<VaultInterface<A>>,
        second: Create<VaultInterface<B>>,
        third: Create<VaultInterface<C>>,
    ) => {
        return async (blockchain: Blockchain) => {
            const firstPoolVaultA = await first(blockchain)
            const firstPoolVaultB = await second(blockchain)
            const secondPoolVaultA = firstPoolVaultB
            const secondPoolVaultB = await third(blockchain)
            return {
                firstPoolVaultA,
                firstPoolVaultB,
                secondPoolVaultA,
                secondPoolVaultB,
            }
        }
    }

    const createPoolCombinations: {
        name: string
        createVaults: (blockchain: Blockchain) => Promise<{
            firstPoolVaultA: VaultInterface<unknown>
            firstPoolVaultB: VaultInterface<unknown>
            secondPoolVaultA: VaultInterface<unknown>
            secondPoolVaultB: VaultInterface<unknown>
        }>
    }[] = [
        {
            name: "Jetton->Jetton->Jetton",
            createVaults: createVaults(createJettonVault, createJettonVault, createJettonVault),
        },
        {
            name: "TON->Jetton->Jetton",
            createVaults: createVaults(createTonVault, createJettonVault, createJettonVault),
        },
        {
            name: "TON->Jetton->TON",
            createVaults: createVaults(createTonVault, createJettonVault, createTonVault),
        },
    ]

    test.each(createPoolCombinations)("should perform $name swap", async ({name, createVaults}) => {
        const blockchain = await Blockchain.create()

        const {firstPoolVaultA, firstPoolVaultB, secondPoolVaultA, secondPoolVaultB} =
            await createVaults(blockchain)

        const {
            ammPool: firstAmmPool,
            swap,
            initWithLiquidity: initWithLiquidityFirst,
        } = await createAmmPool(firstPoolVaultA, firstPoolVaultB, blockchain)

        const {ammPool: secondAmmPool, initWithLiquidity: initWithLiquiditySecond} =
            await createAmmPool(secondPoolVaultA, secondPoolVaultB, blockchain)

        // deploy liquidity deposit contract
        const initialRatio = 2n
        const amountA = toNano(1)
        const amountB = amountA * initialRatio // 1 a == 2 b ratio

        // TODO: This is a temporary workaround to get treasury, we must find a better way to get it
        const castToJettonVault = firstPoolVaultA.treasury as unknown as JettonTreasury
        let depositor
        if (typeof castToJettonVault.walletOwner !== "undefined") {
            depositor = castToJettonVault.walletOwner
        } else {
            depositor = firstPoolVaultA.treasury as unknown as TonTreasury
        }

        const firstLP = await initWithLiquidityFirst(depositor, amountA, amountB)
        expect(await firstLP.depositorLpWallet.getJettonBalance()).toBeGreaterThan(0)

        // Multiply by 2 only to get different values for the second pool
        const secondLP = await initWithLiquiditySecond(depositor, amountA * 2n, amountB * 2n)
        expect(await secondLP.depositorLpWallet.getJettonBalance()).toBeGreaterThan(0)

        const amountToSwap = toNano(0.1)
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

        const inVaultOnFirst = firstPoolVaultA.vault.address
        const outVaultOnFirst = firstPoolVaultB.vault.address

        // inVaultB should be the same as outVaultA as it is cross-pool swap
        const inVaultOnSecond = outVaultOnFirst
        expect(
            secondPoolVaultA.vault.address.equals(inVaultOnSecond) ||
                secondPoolVaultB.vault.address.equals(inVaultOnSecond),
        ).toBeTruthy()
        const outVaultOnSecond = secondPoolVaultA.vault.address.equals(inVaultOnSecond)
            ? secondPoolVaultB.vault.address
            : secondPoolVaultA.vault.address

        const outAmountOnFirstBeforeSwap = await firstAmmPool.getReserveForVault(outVaultOnFirst)
        const inAmountOnSecondBeforeSwap = await secondAmmPool.getReserveForVault(inVaultOnSecond)

        const swapResult = await swap(
            amountToSwap,
            "vaultA",
            expectedOutFirst,
            0n,
            null,
            null,
            nextSwapStep,
        )

        // Successful swap in the first pool
        expect(swapResult.transactions).toHaveTransaction({
            from: firstPoolVaultA.vault.address,
            to: firstAmmPool.address,
            op: AmmPool.opcodes.SwapIn,
            success: true,
        })

        // Successful swap in the second pool
        expect(swapResult.transactions).toHaveTransaction({
            from: firstAmmPool.address,
            to: secondAmmPool.address,
            op: AmmPool.opcodes.SwapIn,
            success: true,
        })

        const outAmountOnFirstAfterSwap = await firstAmmPool.getReserveForVault(outVaultOnFirst)
        const inAmountOnSecondAfterSwap = await secondAmmPool.getReserveForVault(inVaultOnSecond)

        const payoutTx = findTransactionRequired(swapResult.transactions, {
            from: secondAmmPool.address,
            op: AmmPool.opcodes.PayoutFromPool,
        })
        expect(flattenTransaction(payoutTx).to).toEqualAddress(outVaultOnSecond)

        // Check the round swap
        if (name === "TON->Jetton->TON") {
            expect(firstAmmPool.address).toEqualAddress(secondAmmPool.address)
            expect(outVaultOnSecond).toEqualAddress(inVaultOnFirst)
        } else {
            // Using this expect statement, we check that the order
            // We don't check that in TON-Jetton-TON as both pools are actually the same
            expect(outAmountOnFirstAfterSwap).toBeLessThan(outAmountOnFirstBeforeSwap)
            expect(inAmountOnSecondAfterSwap).toBeGreaterThan(inAmountOnSecondBeforeSwap)
        }

        expect(swapResult.transactions).toHaveTransaction({
            from: secondAmmPool.address,
            op: AmmPool.opcodes.PayoutFromPool,
            success: true,
        })
    })
})
