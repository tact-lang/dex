import {Blockchain} from "@ton/sandbox"
import {createJettonAmmPool} from "../utils/environment"
import {beginCell, toNano} from "@ton/core"
import {AmmPool, loadPayoutFromPool, loadSendViaJettonTransfer} from "../output/DEX_AmmPool"
// eslint-disable-next-line
import {SendDumpToDevWallet} from "@tondevwallet/traces"
import {JettonVault} from "../output/DEX_JettonVault"
import {findTransactionRequired, flattenTransaction} from "@ton/test-utils"
import {calculateAmountOut, calculateSwapResult} from "../utils/liquidityMath"

const expectEqualTvmToJs = (expected: bigint, got: bigint) => {
    expect(expected).toBeGreaterThanOrEqual(got - 1n)
    expect(expected).toBeLessThanOrEqual(got + 1n)
}

// this test suite ensures that swaps math is compatible with uniswap v2 spec
describe("Swaps math", () => {
    test("should correctly return expected out", async () => {
        const blockchain = await Blockchain.create()

        const {ammPool, vaultA, vaultB, isSwapped, initWithLiquidity} =
            await createJettonAmmPool(blockchain)

        const initialRatio = 7n

        const amountARaw = toNano(1)
        const amountBRaw = amountARaw * initialRatio // 1 a == 2 b ratio

        const amountA = isSwapped ? amountARaw : amountBRaw
        const amountB = isSwapped ? amountBRaw : amountARaw

        const depositor = vaultB.treasury.walletOwner

        await initWithLiquidity(depositor, amountA, amountB)

        const leftReserve = await ammPool.getLeftSide()
        const rightReserve = await ammPool.getRightSide()

        const reserveA = isSwapped ? rightReserve : leftReserve
        const reserveB = isSwapped ? leftReserve : rightReserve

        const amountToSwap = toNano(1)
        const expectedOutput = await ammPool.getExpectedOut(vaultA.vault.address, amountToSwap)

        const res = calculateAmountOut(reserveA, reserveB, AmmPool.PoolFee, amountToSwap)

        // difference in tvm and js rounding
        expectEqualTvmToJs(expectedOutput, res)
    })

    test("should correctly change reserves after the swap", async () => {
        const blockchain = await Blockchain.create()

        const {ammPool, vaultA, vaultB, swap, isSwapped, initWithLiquidity} =
            await createJettonAmmPool(blockchain)

        const initialRatio = 7n

        const amountARaw = toNano(1)
        const amountBRaw = amountARaw * initialRatio // 1 a == 2 b ratio

        const amountA = isSwapped ? amountARaw : amountBRaw
        const amountB = isSwapped ? amountBRaw : amountARaw

        const depositor = vaultB.treasury.walletOwner

        await initWithLiquidity(depositor, amountA, amountB)

        const leftReserve = await ammPool.getLeftSide()
        const rightReserve = await ammPool.getRightSide()

        const reserveA = isSwapped ? rightReserve : leftReserve
        const reserveB = isSwapped ? leftReserve : rightReserve

        const amountToSwap = toNano(1)
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
})
