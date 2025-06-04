import {Blockchain} from "@ton/sandbox"
import {createJettonAmmPool} from "../utils/environment"
import {beginCell, toNano} from "@ton/core"
import {AmmPool, loadPayoutFromPool, loadSendViaJettonTransfer} from "../output/DEX_AmmPool"
// eslint-disable-next-line
import {SendDumpToDevWallet} from "@tondevwallet/traces"
import {JettonVault} from "../output/DEX_JettonVault"
import {findTransactionRequired, flattenTransaction} from "@ton/test-utils"
import {calculateAmountOut} from "../utils/liquidityMath"

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

        expect(expectedOutput).toBeGreaterThanOrEqual(res - 1n)
        expect(expectedOutput).toBeLessThanOrEqual(res + 1n)
    })
})
