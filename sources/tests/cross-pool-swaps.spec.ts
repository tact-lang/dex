import {Blockchain} from "@ton/sandbox"
import {
    Create,
    createAmmPool,
    createJettonVault,
    createTonVault,
    JettonTreasury,
    TonTreasury,
    VaultInterface,
} from "../utils/environment"

import {beginCell, toNano} from "@ton/core"
import {AmmPool, loadPayoutFromPool} from "../output/DEX_AmmPool"
// eslint-disable-next-line
import {SendDumpToDevWallet} from "@tondevwallet/traces"
import {findTransactionRequired, flattenTransaction, randomAddress} from "@ton/test-utils"

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
        // https://github.com/tact-lang/dex/issues/42
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

        const payloadOnSuccess = beginCell().storeStringTail("Success").endCell()
        const payloadOnFailure = beginCell().storeStringTail("Failure").endCell()

        const randomReceiver = randomAddress()
        const swapResult = await swap(
            amountToSwap,
            "vaultA",
            expectedOutFirst,
            0n,
            payloadOnSuccess,
            payloadOnFailure,
            nextSwapStep,
            randomReceiver,
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

        const payoutTx = flattenTransaction(
            findTransactionRequired(swapResult.transactions, {
                from: secondAmmPool.address,
                op: AmmPool.opcodes.PayoutFromPool,
                success: true,
            }),
        )
        expect(payoutTx.to).toEqualAddress(outVaultOnSecond)
        if (payoutTx.body === undefined) {
            throw new Error("Payout transaction body is undefined")
        }
        const parsedPayoutBody = loadPayoutFromPool(payoutTx.body.asSlice())

        if (name !== "TON->Jetton->TON") {
            // Because in this case our `getExpectedOut is incorrect
            expect(parsedPayoutBody.amount).toEqual(expectedOutSecond)
        }

        expect(parsedPayoutBody.receiver).toEqualAddress(randomReceiver)
        expect(parsedPayoutBody.payloadToForward).toEqualCell(payloadOnSuccess)

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
    })

    test.each(createPoolCombinations)(
        "Testing $name layout. Failure of A->B->C swap on B->C should return tokens B to receiver with payloadOnFailure provided",
        async ({name, createVaults}) => {
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
            // https://github.com/tact-lang/dex/issues/42
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
            let expectedOutSecond = await secondAmmPool.getExpectedOut(
                firstPoolVaultB.vault.address,
                expectedOutFirst,
            )
            if (name === "TON->Jetton->TON") {
                // Because in this case our `getExpectedOut is incorrect, as we swap in the same pool but in two different directions
                // Amount + 1 will fail because we can't get more coins we put in
                expectedOutSecond = amountToSwap + 1n
            }
            const nextSwapStep = {
                $$type: "SwapStep",
                pool: secondAmmPool.address,
                minAmountOut: expectedOutSecond + 1n, // +1 to make the next step fail
                nextStep: null,
            } as const

            // inVaultB should be the same as outVaultA as it is cross-pool swap
            const inVaultOnSecond = firstPoolVaultB.vault.address
            const outVaultOnSecond = secondPoolVaultA.vault.address.equals(inVaultOnSecond)
                ? secondPoolVaultB.vault.address
                : secondPoolVaultA.vault.address

            const payloadOnSuccess = beginCell().storeStringTail("Success").endCell()
            const payloadOnFailure = beginCell().storeStringTail("Failure").endCell()

            const randomReceiver = randomAddress()
            const swapResult = await swap(
                amountToSwap,
                "vaultA",
                expectedOutFirst, // We will receive exactly this amount in the first pool
                0n,
                payloadOnSuccess,
                payloadOnFailure,
                nextSwapStep,
                randomReceiver,
            )

            expect(swapResult.transactions).toHaveTransaction({
                from: firstAmmPool.address,
                to: secondAmmPool.address,
                exitCode: AmmPool.errors["Pool: Amount out is less than minAmountOut"],
            })

            const payoutTx = flattenTransaction(
                findTransactionRequired(swapResult.transactions, {
                    from: secondAmmPool.address,
                    to: inVaultOnSecond,
                    op: AmmPool.opcodes.PayoutFromPool,
                }),
            )
            if (payoutTx.body === undefined) {
                throw new Error("Payout transaction body is undefined")
            }
            const parsedPayoutBody = loadPayoutFromPool(payoutTx.body.asSlice())

            // So we pay exactly the amount we got in the first pool
            expect(parsedPayoutBody.amount).toEqual(expectedOutFirst)
            expect(parsedPayoutBody.otherVault).toEqualAddress(outVaultOnSecond)
            expect(parsedPayoutBody.receiver).toEqualAddress(randomReceiver)
            expect(parsedPayoutBody.payloadToForward).toEqualCell(payloadOnFailure)
        },
    )
})
