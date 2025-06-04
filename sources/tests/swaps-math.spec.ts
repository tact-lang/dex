import {Blockchain} from "@ton/sandbox"
import {createJettonAmmPool} from "../utils/environment"
import {beginCell, toNano} from "@ton/core"
import {AmmPool, loadPayoutFromPool, loadSendViaJettonTransfer} from "../output/DEX_AmmPool"
// eslint-disable-next-line
import {SendDumpToDevWallet} from "@tondevwallet/traces"
import {JettonVault} from "../output/DEX_JettonVault"
import {findTransactionRequired, flattenTransaction} from "@ton/test-utils"

// this test suite ensures that swaps math is compatible with uniswap v2 spec
describe("Swaps math", () => {
    test("should correctly return expected out", async () => {
        const blockchain = await Blockchain.create()

        const {ammPool, vaultA, vaultB, initWithLiquidity, swap} =
            await createJettonAmmPool(blockchain)

        // deploy liquidity deposit contract
        const initialRatio = 10n
        const amountA = toNano(5)
        const amountB = amountA * initialRatio // 1 a == 2 b ratio
        const depositor = vaultA.treasury.walletOwner
        const {depositorLpWallet} = await initWithLiquidity(depositor, amountA, amountB)
        const lpBalanceAfterFirstLiq = await depositorLpWallet.getJettonBalance()
        // check that liquidity deposit was successful
        expect(lpBalanceAfterFirstLiq).toBeGreaterThan(0n)

        const payloadOnSuccess = beginCell().storeStringTail("Success").endCell()

        const amountToSwap = toNano(0.05)
        const expectedOutput = await ammPool.getExpectedOut(vaultA.vault.address, amountToSwap)
        const amountBJettonBeforeSwap = await vaultB.treasury.wallet.getJettonBalance()

        const swapResult = await swap(
            amountToSwap,
            "vaultA",
            expectedOutput,
            0n,
            false,
            null,
            payloadOnSuccess,
        )

        // check that swap was successful
        expect(swapResult.transactions).toHaveTransaction({
            from: vaultA.vault.address,
            to: ammPool.address,
            op: AmmPool.opcodes.SwapIn,
            success: true,
        })

        const payoutTx = findTransactionRequired(swapResult.transactions, {
            from: ammPool.address,
            to: vaultB.vault.address,
            op: AmmPool.opcodes.PayoutFromPool,
            success: true,
        })
        const payoutBody = flattenTransaction(payoutTx).body?.beginParse()
        const parsedPayout = loadPayoutFromPool(payoutBody!!)
        expect(parsedPayout.otherVault).toEqualAddress(vaultA.vault.address)
        expect(parsedPayout.amount).toEqual(expectedOutput)
        expect(parsedPayout.receiver).toEqualAddress(depositor.address)
        expect(parsedPayout.payloadToForward!!).toEqualCell(payloadOnSuccess)

        const tx = findTransactionRequired(swapResult.transactions, {
            from: vaultB.vault.address,
            // TODO: to: vaultB.jettonWallet
            op: JettonVault.opcodes.SendViaJettonTransfer,
            success: true,
        })

        const body = flattenTransaction(tx).body?.beginParse()
        const parsedBody = loadSendViaJettonTransfer(body!!)
        expect(parsedBody.destination).toEqualAddress(depositor.address)
        expect(parsedBody.responseDestination).toEqualAddress(depositor.address)
        expect(parsedBody.forwardPayload.asCell()).toEqualCell(
            beginCell().storeMaybeRef(payloadOnSuccess).endCell(),
        )

        const amountOfJettonBAfterSwap = await vaultB.treasury.wallet.getJettonBalance()
        expect(amountOfJettonBAfterSwap).toBeGreaterThan(amountBJettonBeforeSwap)
    })
})
