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

describe("Fees", () => {
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
})
