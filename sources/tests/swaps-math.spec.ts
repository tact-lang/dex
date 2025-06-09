import {Blockchain} from "@ton/sandbox"
import {createJettonAmmPool, createTonJettonAmmPool} from "../utils/environment"
import {toNano} from "@ton/core"
import {AmmPool} from "../output/DEX_AmmPool"
// eslint-disable-next-line
import {SendDumpToDevWallet} from "@tondevwallet/traces"
import {calculateAmountIn, calculateAmountOut, calculateSwapResult} from "../utils/liquidityMath"

const expectEqualTvmToJs = (expected: bigint, got: bigint) => {
    expect(expected).toBeGreaterThanOrEqual(got - 1n)
    expect(expected).toBeLessThanOrEqual(got + 1n)
}
const random = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min

// this test suite ensures that swaps math is compatible with uniswap v2 spec
describe.each([
    {
        name: "Jetton->Jetton",
        createPool: createJettonAmmPool,
    },
    {
        name: "TON->Jetton",
        createPool: createTonJettonAmmPool,
    },
])("Swaps math for $name", ({createPool}) => {
    test("should correctly return expected out", async () => {
        const blockchain = await Blockchain.create()

        const {ammPool, vaultA, vaultB, isSwapped, initWithLiquidity} = await createPool(blockchain)

        const initialRatio = BigInt(random(1, 100))

        const amountARaw = toNano(random(1, 50))
        const amountBRaw = amountARaw * initialRatio // 1 a == 2 b ratio

        const amountA = isSwapped ? amountARaw : amountBRaw
        const amountB = isSwapped ? amountBRaw : amountARaw

        const depositor = vaultB.treasury.walletOwner

        await initWithLiquidity(depositor, amountA, amountB)

        const leftReserve = await ammPool.getLeftSide()
        const rightReserve = await ammPool.getRightSide()

        const reserveA = isSwapped ? rightReserve : leftReserve
        const reserveB = isSwapped ? leftReserve : rightReserve

        const amountToSwap = BigInt(random(1, 50))
        const expectedOutput = await ammPool.getExpectedOut(vaultA.vault.address, amountToSwap)

        const res = calculateAmountOut(reserveA, reserveB, AmmPool.PoolFee, amountToSwap)

        // difference in tvm and js rounding
        expectEqualTvmToJs(expectedOutput, res)
    })

    test("should correctly change reserves after the swap", async () => {
        const blockchain = await Blockchain.create()

        const {ammPool, vaultA, vaultB, swap, isSwapped, initWithLiquidity} =
            await createPool(blockchain)

        const initialRatio = BigInt(random(1, 100))

        const amountARaw = toNano(random(1, 50))
        const amountBRaw = amountARaw * initialRatio // 1 a == 2 b ratio

        const amountA = isSwapped ? amountARaw : amountBRaw
        const amountB = isSwapped ? amountBRaw : amountARaw

        const depositor = vaultB.treasury.walletOwner

        await initWithLiquidity(depositor, amountA, amountB)

        const leftReserve = await ammPool.getLeftSide()
        const rightReserve = await ammPool.getRightSide()

        const reserveA = isSwapped ? rightReserve : leftReserve
        const reserveB = isSwapped ? leftReserve : rightReserve

        const amountToSwap = BigInt(random(1, 50))
        const expectedOutput = await ammPool.getExpectedOut(vaultA.vault.address, amountToSwap)

        const res = calculateSwapResult(reserveA, reserveB, AmmPool.PoolFee, amountToSwap, 0n)

        const swapResult = await swap(amountToSwap, "vaultA", expectedOutput, 0n, false, null, null)

        // check that swap was successful
        expect(swapResult.transactions).toHaveTransaction({
            from: vaultA.vault.address,
            to: ammPool.address,
            op: AmmPool.opcodes.SwapIn,
            success: true,
        })

        const leftReserveAfter = await ammPool.getLeftSide()
        const rightReserveAfter = await ammPool.getRightSide()

        const aReserveAfter = isSwapped ? rightReserveAfter : leftReserveAfter
        const bReserveAfter = isSwapped ? leftReserveAfter : rightReserveAfter

        // check reserves change
        expectEqualTvmToJs(aReserveAfter, res.reserveA)
        expectEqualTvmToJs(bReserveAfter, res.reserveB)
    })

    test("should correctly change reserves after series of swaps", async () => {
        const blockchain = await Blockchain.create()

        const {ammPool, vaultA, vaultB, swap, isSwapped, initWithLiquidity} =
            await createPool(blockchain)

        const initialRatio = BigInt(random(1, 100))

        const amountARaw = toNano(random(1, 50))
        const amountBRaw = amountARaw * initialRatio // 1 a == 2 b ratio

        const amountA = isSwapped ? amountARaw : amountBRaw
        const amountB = isSwapped ? amountBRaw : amountARaw

        const depositor = vaultB.treasury.walletOwner

        await initWithLiquidity(depositor, amountA, amountB)

        // check that reserves correctly change after series of swaps
        // this is different from the previous test since there could be
        // an error with payouts that will appear only in the long term
        for (let index = 0; index < 20; index++) {
            const leftReserve = await ammPool.getLeftSide()
            const rightReserve = await ammPool.getRightSide()

            const reserveA = isSwapped ? rightReserve : leftReserve
            const reserveB = isSwapped ? leftReserve : rightReserve

            const amountToSwap = BigInt(random(1, 50))
            const expectedOutput = await ammPool.getExpectedOut(vaultA.vault.address, amountToSwap)

            const res = calculateSwapResult(reserveA, reserveB, AmmPool.PoolFee, amountToSwap, 0n)

            const swapResult = await swap(
                amountToSwap,
                "vaultA",
                expectedOutput,
                0n,
                false,
                null,
                null,
            )

            // check that swap was successful
            expect(swapResult.transactions).toHaveTransaction({
                from: vaultA.vault.address,
                to: ammPool.address,
                op: AmmPool.opcodes.SwapIn,
                success: true,
            })

            const leftReserveAfter = await ammPool.getLeftSide()
            const rightReserveAfter = await ammPool.getRightSide()

            const aReserveAfter = isSwapped ? rightReserveAfter : leftReserveAfter
            const bReserveAfter = isSwapped ? leftReserveAfter : rightReserveAfter

            // check reserves change
            expectEqualTvmToJs(aReserveAfter, res.reserveA)
            expectEqualTvmToJs(bReserveAfter, res.reserveB)
        }
    })

    test("should correctly return expected in for exact out", async () => {
        const blockchain = await Blockchain.create()

        const {ammPool, vaultB, isSwapped, initWithLiquidity} = await createPool(blockchain)

        const initialRatio = BigInt(random(1, 100))

        const amountARaw = toNano(random(1, 50))
        const amountBRaw = amountARaw * initialRatio // 1 a == 2 b ratio

        const amountA = isSwapped ? amountARaw : amountBRaw
        const amountB = isSwapped ? amountBRaw : amountARaw

        const depositor = vaultB.treasury.walletOwner

        await initWithLiquidity(depositor, amountA, amountB)

        const leftReserve = await ammPool.getLeftSide()
        const rightReserve = await ammPool.getRightSide()

        const reserveA = isSwapped ? rightReserve : leftReserve
        const reserveB = isSwapped ? leftReserve : rightReserve

        const amountToGetAfterSwap = BigInt(random(1, 50))
        const expectedInput = await ammPool.getNeededInToGetX(
            vaultB.vault.address,
            amountToGetAfterSwap,
        )

        const res = calculateAmountIn(reserveA, reserveB, AmmPool.PoolFee, amountToGetAfterSwap)

        // difference in tvm and js rounding
        expectEqualTvmToJs(expectedInput, res)
    })
})
