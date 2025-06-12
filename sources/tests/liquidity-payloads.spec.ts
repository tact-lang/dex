//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import {beginCell, toNano} from "@ton/core"
import {Blockchain} from "@ton/sandbox"
import {findTransactionRequired, flattenTransaction} from "@ton/test-utils"
import {AmmPool, loadMintViaJettonTransferInternal, loadPayoutFromPool} from "../output/DEX_AmmPool"
import {createJettonAmmPool} from "../utils/environment"
// eslint-disable-next-line
import {SendDumpToDevWallet} from "@tondevwallet/traces"

describe("Liquidity payloads", () => {
    test("should send both successful payloads via LP minting, and send no excesses on first deposit", async () => {
        const blockchain = await Blockchain.create()
        const {
            ammPool,
            vaultA: swappedVaultA,
            vaultB: swappedVaultB,
            liquidityDepositSetup,
            isSwapped,
        } = await createJettonAmmPool(blockchain)

        const {vaultA, vaultB} = isSwapped
            ? {vaultA: swappedVaultB, vaultB: swappedVaultA}
            : {vaultA: swappedVaultA, vaultB: swappedVaultB}

        const poolState = (await blockchain.getContract(ammPool.address)).accountState?.type
        expect(poolState === "uninit" || poolState === undefined).toBe(true)

        const leftPayloadOnSuccess = beginCell().storeStringTail("SuccessLeft").endCell()
        const leftPayloadOnFailure = beginCell().storeStringTail("FailureLeft").endCell()

        const rightPayloadOnSuccess = beginCell().storeStringTail("SuccessRight").endCell()
        const rightPayloadOnFailure = beginCell().storeStringTail("FailureRight").endCell()

        // deploy liquidity deposit contract
        const amountA = toNano(1)
        const amountB = toNano(2) // 1 a == 2 b ratio
        const depositor = vaultA.treasury.walletOwner
        const liqSetup = await liquidityDepositSetup(depositor, amountA, amountB)
        await liqSetup.deploy()
        await vaultA.deploy()

        const _ = await vaultA.addLiquidity(
            liqSetup.liquidityDeposit.address,
            amountA,
            leftPayloadOnSuccess,
            leftPayloadOnFailure,
        )
        await vaultB.deploy()

        const addSecondPartAndMintLP = await vaultB.addLiquidity(
            liqSetup.liquidityDeposit.address,
            amountB,
            rightPayloadOnSuccess,
            rightPayloadOnFailure,
        )

        expect(addSecondPartAndMintLP.transactions).not.toHaveTransaction({
            from: ammPool.address,
            to: vaultA.vault.address,
        })
        expect(addSecondPartAndMintLP.transactions).not.toHaveTransaction({
            from: ammPool.address,
            to: vaultB.vault.address,
        })

        // check LP token mint
        const mintLP = findTransactionRequired(addSecondPartAndMintLP.transactions, {
            from: ammPool.address,
            to: liqSetup.depositorLpWallet.address,
            op: AmmPool.opcodes.MintViaJettonTransferInternal,
            success: true,
        })
        const transferBody = flattenTransaction(mintLP).body?.beginParse()
        const parsedBody = loadMintViaJettonTransferInternal(transferBody!!)
        expect(parsedBody.forwardPayload.asCell()).toEqualCell(
            beginCell()
                .storeUint(0, 1) // Either bit equals 0
                .storeMaybeRef(leftPayloadOnSuccess)
                .storeMaybeRef(rightPayloadOnSuccess)
                .endCell(),
        )
    })

    test("Not-first liquidity deposit should send both successful payloads via LP minting, and one excess with success payload", async () => {
        const blockchain = await Blockchain.create()

        const {
            ammPool,
            vaultA: swappedVaultA,
            vaultB: swappedVaultB,
            initWithLiquidity,
            liquidityDepositSetup,
            isSwapped,
        } = await createJettonAmmPool(blockchain)

        const {vaultA, vaultB} = isSwapped
            ? {vaultA: swappedVaultB, vaultB: swappedVaultA}
            : {vaultA: swappedVaultA, vaultB: swappedVaultB}

        const leftPayloadOnSuccess = beginCell().storeStringTail("SuccessLeft").endCell()
        const leftPayloadOnFailure = beginCell().storeStringTail("FailureLeft").endCell()

        const rightPayloadOnSuccess = beginCell().storeStringTail("SuccessRight").endCell()
        const rightPayloadOnFailure = beginCell().storeStringTail("FailureRight").endCell()
        // deploy liquidity deposit contract
        const initialRatio = 2n

        const amountA = toNano(1)
        const amountB = amountA * initialRatio // 1 a == 2 b ratio

        const depositor = vaultA.treasury.walletOwner

        const {depositorLpWallet} = await initWithLiquidity(depositor, amountA, amountB)

        const lpBalanceAfterFirstLiq = await depositorLpWallet.getJettonBalance()
        // check that the first liquidity deposit was successful
        expect(lpBalanceAfterFirstLiq).toBeGreaterThan(0n)

        // now we want to try to add more liquidity
        const additionalAmountA = toNano(1)
        // Not exactly the same ratio. There are too much right tokens in out liquidity provision
        const additionalAmountB = (additionalAmountA * initialRatio * 11n) / 10n

        const liqSetup = await liquidityDepositSetup(
            depositor,
            additionalAmountA,
            additionalAmountB,
        )
        await liqSetup.deploy()

        const _ = await vaultA.addLiquidity(
            liqSetup.liquidityDeposit.address,
            additionalAmountA,
            leftPayloadOnSuccess,
            leftPayloadOnFailure,
        )
        await vaultB.deploy()

        const addSecondPartAndMintLP = await vaultB.addLiquidity(
            liqSetup.liquidityDeposit.address,
            additionalAmountB,
            rightPayloadOnSuccess,
            rightPayloadOnFailure,
        )

        const mintLPTx = findTransactionRequired(addSecondPartAndMintLP.transactions, {
            from: ammPool.address,
            to: depositorLpWallet.address,
            op: AmmPool.opcodes.MintViaJettonTransferInternal,
            success: true,
        })
        const mintBody = flattenTransaction(mintLPTx).body?.beginParse()
        const parsedMintBody = loadMintViaJettonTransferInternal(mintBody!!)
        expect(parsedMintBody.forwardPayload.asCell()).toEqualCell(
            beginCell()
                .storeUint(0, 1) // Either bit equals 0
                .storeMaybeRef(leftPayloadOnSuccess)
                .storeMaybeRef(rightPayloadOnSuccess)
                .endCell(),
        )

        const payExcessTx = findTransactionRequired(addSecondPartAndMintLP.transactions, {
            to: vaultB.vault.address,
            op: AmmPool.opcodes.PayoutFromPool,
            success: true,
        })
        const payoutFromPoolBody = flattenTransaction(payExcessTx).body?.beginParse()
        const parsedPayoutFromPoolBody = loadPayoutFromPool(payoutFromPoolBody!!)
        expect(parsedPayoutFromPoolBody.payloadToForward).toBeDefined()
        expect(parsedPayoutFromPoolBody.payloadToForward!!).toEqualCell(rightPayloadOnSuccess)
    })

    test("should fail when slippage exceeded and return left payload via left vault and right via right", async () => {
        const blockchain = await Blockchain.create()

        const {
            ammPool,
            vaultA: swappedVaultA,
            vaultB: swappedVaultB,
            initWithLiquidity,
            liquidityDepositSetup,
            isSwapped,
        } = await createJettonAmmPool(blockchain)

        const {vaultA, vaultB} = isSwapped
            ? {vaultA: swappedVaultB, vaultB: swappedVaultA}
            : {vaultA: swappedVaultA, vaultB: swappedVaultB}

        const leftPayloadOnSuccess = beginCell().storeStringTail("SuccessLeft").endCell()
        const leftPayloadOnFailure = beginCell().storeStringTail("FailureLeft").endCell()

        const rightPayloadOnSuccess = beginCell().storeStringTail("SuccessRight").endCell()
        const rightPayloadOnFailure = beginCell().storeStringTail("FailureRight").endCell()

        // deploy liquidity deposit contract with initial liquidity
        const initialRatio = 2n

        const amountA = toNano(1)
        const amountB = amountA * initialRatio // 1 a == 2 b ratio

        const depositor = vaultA.treasury.walletOwner

        // Initialize the pool with initial liquidity
        const {depositorLpWallet} = await initWithLiquidity(depositor, amountA, amountB)

        const lpBalanceAfterFirstLiq = await depositorLpWallet.getJettonBalance()
        // check that the first liquidity deposit was successful
        expect(lpBalanceAfterFirstLiq).toBeGreaterThan(0n)

        // Get current reserves from the pool
        const leftReserve = await ammPool.getLeftSide()
        const rightReserve = await ammPool.getRightSide()

        // For the next deposit, calculate the minimum necessary amount using the formula from AMM Pool
        const amountASecond = toNano(2) // Add more of token A

        // Calculate the expected amount of token B using the formula: expectedRightAmount = muldiv(amountA, rightReserve, leftReserve)
        // This is the correct amount that would be accepted based on the current ratio
        const expectedAmountB = (amountASecond * rightReserve) / leftReserve

        // Test case 1: Provide EXACTLY the expected amount - should succeed
        const liqSetupExact = await liquidityDepositSetup(depositor, amountASecond, expectedAmountB)
        await liqSetupExact.deploy()

        // Add liquidity to vault A
        await vaultA.addLiquidity(
            liqSetupExact.liquidityDeposit.address,
            amountASecond,
            leftPayloadOnSuccess,
            leftPayloadOnFailure,
            amountASecond,
        )

        // Add liquidity to vault B
        const exactLiquidityResult = await vaultB.addLiquidity(
            liqSetupExact.liquidityDeposit.address,
            expectedAmountB,
            rightPayloadOnSuccess,
            rightPayloadOnFailure,
            // Set expectedAmountB as minimal acceptable for provision amount
            expectedAmountB,
        )

        // Verify that the liquidity was successfully added
        expect(exactLiquidityResult.transactions).toHaveTransaction({
            from: liqSetupExact.liquidityDeposit.address,
            to: ammPool.address,
            op: AmmPool.opcodes.LiquidityDeposit,
            success: true,
        })

        // LP tokens should be minted
        expect(exactLiquidityResult.transactions).toHaveTransaction({
            from: ammPool.address,
            op: AmmPool.opcodes.MintViaJettonTransferInternal,
            success: true,
        })

        const lpBalanceAfterExactLiq = await depositorLpWallet.getJettonBalance()
        expect(lpBalanceAfterExactLiq).toBeGreaterThan(lpBalanceAfterFirstLiq)

        // Test case 2: Provide 1 nano TON LESS than expected - should fail

        const lessBThanExpected = expectedAmountB - 1n // 1 nano less than expected

        const liqSetupInsufficient = await liquidityDepositSetup(
            depositor,
            amountASecond,
            lessBThanExpected,
        )
        await liqSetupInsufficient.deploy()

        // Add liquidity to vault A
        await vaultA.addLiquidity(
            liqSetupInsufficient.liquidityDeposit.address,
            amountASecond,
            leftPayloadOnSuccess,
            leftPayloadOnFailure,
            amountASecond,
        )

        // Add liquidity to vault B with an insufficient amount (1 nano less)
        const insufficientLiquidityResult = await vaultB.addLiquidity(
            liqSetupInsufficient.liquidityDeposit.address,
            lessBThanExpected,
            rightPayloadOnSuccess,
            rightPayloadOnFailure,
            lessBThanExpected,
        )

        // Should fail on the left side, as the amount on B is less than expected, so A should be less too,
        // but minimal acceptable amount A is equal to actual amount A
        expect(insufficientLiquidityResult.transactions).toHaveTransaction({
            on: ammPool.address,
            exitCode:
                AmmPool.errors["Pool: Liquidity provision failed due to slippage on left side"],
            success: true,
        })

        // Verify that appropriate transactions occurred
        // First: liquidity deposit contract notified pool
        expect(insufficientLiquidityResult.transactions).toHaveTransaction({
            from: liqSetupInsufficient.liquidityDeposit.address,
            to: ammPool.address,
            op: AmmPool.opcodes.LiquidityDeposit,
            success: true,
        })

        // Then: pool should return funds due to slippage with payloadOnFailure attached
        const payoutFromPoolA = findTransactionRequired(insufficientLiquidityResult.transactions, {
            from: ammPool.address,
            to: vaultA.vault.address,
            op: AmmPool.opcodes.PayoutFromPool,
            success: true,
        })
        const payoutFromPoolABody = flattenTransaction(payoutFromPoolA).body?.beginParse()
        const parsedPayoutFromPoolABody = loadPayoutFromPool(payoutFromPoolABody!!)
        expect(parsedPayoutFromPoolABody.payloadToForward).not.toBe(null)
        expect(parsedPayoutFromPoolABody.payloadToForward!!).toEqualCell(leftPayloadOnFailure)

        const payoutFromPoolB = findTransactionRequired(insufficientLiquidityResult.transactions, {
            from: ammPool.address,
            to: vaultB.vault.address,
            op: AmmPool.opcodes.PayoutFromPool,
            success: true,
        })
        const payoutFromPoolBBody = flattenTransaction(payoutFromPoolB).body?.beginParse()
        const parsedPayoutFromPoolBBody = loadPayoutFromPool(payoutFromPoolBBody!!)
        expect(parsedPayoutFromPoolBBody.payloadToForward).not.toBe(null)
        expect(parsedPayoutFromPoolBBody.payloadToForward!!).toEqualCell(rightPayloadOnFailure)
        expect(insufficientLiquidityResult.transactions).toHaveTransaction({
            from: ammPool.address,
            to: vaultB.vault.address,
            op: AmmPool.opcodes.PayoutFromPool,
            success: true,
        })

        // LP balance should remain unchanged from the previous successful addition
        const lpBalanceAfterFailedLiq = await depositorLpWallet.getJettonBalance()
        expect(lpBalanceAfterFailedLiq).toEqual(lpBalanceAfterExactLiq)
    })

    test("should return withdrawal payload on both jettons", async () => {
        const blockchain = await Blockchain.create()

        const {ammPool, vaultA, vaultB, initWithLiquidity} = await createJettonAmmPool(blockchain)

        const successfulPayloadOnWithdraw = beginCell()
            .storeStringTail("SuccessWithdrawPayload")
            .endCell()

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
        // check that the first liquidity deposit was successful
        expect(lpBalanceAfterFirstLiq).toBeGreaterThan(0n)

        const withdrawResultWithPayloads = await withdrawLiquidity(
            lpBalanceAfterFirstLiq,
            0n,
            0n,
            0n,
            successfulPayloadOnWithdraw,
        )

        // we have separate unit test that burn works as withdrawal at amm-pool.spec
        const payoutFromPoolA = findTransactionRequired(withdrawResultWithPayloads.transactions, {
            from: ammPool.address,
            to: vaultA.vault.address,
            op: AmmPool.opcodes.PayoutFromPool,
            success: true,
        })
        const payoutFromPoolABody = flattenTransaction(payoutFromPoolA).body?.beginParse()
        const parsedPayoutFromPoolABody = loadPayoutFromPool(payoutFromPoolABody!!)
        expect(parsedPayoutFromPoolABody.payloadToForward).not.toBe(null)
        expect(parsedPayoutFromPoolABody.payloadToForward!!).toEqualCell(
            successfulPayloadOnWithdraw,
        )

        const payoutFromPoolB = findTransactionRequired(withdrawResultWithPayloads.transactions, {
            from: ammPool.address,
            to: vaultB.vault.address,
            op: AmmPool.opcodes.PayoutFromPool,
            success: true,
        })
        const payoutFromPoolBBody = flattenTransaction(payoutFromPoolB).body?.beginParse()
        const parsedPayoutFromPoolBBody = loadPayoutFromPool(payoutFromPoolBBody!!)
        expect(parsedPayoutFromPoolBBody.payloadToForward).not.toBe(null)
        expect(parsedPayoutFromPoolBBody.payloadToForward!!).toEqualCell(
            successfulPayloadOnWithdraw,
        )
    })
})
