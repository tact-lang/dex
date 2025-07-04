//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import {toNano} from "@ton/core"
import {Blockchain} from "@ton/sandbox"
import {findTransactionRequired, flattenTransaction, randomAddress} from "@ton/test-utils"
import {AmmPool} from "../output/DEX_AmmPool"
import {LiquidityDepositContract} from "../output/DEX_LiquidityDepositContract"
import {
    createJettonAmmPool,
    createJettonVault,
    createTonJettonAmmPool,
    createTonVault,
} from "../utils/environment"
import {sortAddresses} from "../utils/deployUtils"
// eslint-disable-next-line
import {SendDumpToDevWallet} from "@tondevwallet/traces"
import {ExtendedLPJettonWallet} from "../wrappers/ExtendedLPJettonWallet"

describe("Liquidity deposit", () => {
    test("Jetton vault should deploy correctly", async () => {
        // deploy vault -> send jetton transfer -> notify vault -> notify liq dep contract
        const blockchain = await Blockchain.create()
        const vaultSetup = await createJettonVault(blockchain)

        const vaultDeployResult = await vaultSetup.deploy()
        expect(vaultDeployResult.transactions).toHaveTransaction({
            success: true,
            deploy: true,
        })

        const mockDepositLiquidityContract = randomAddress(0)

        const jettonTransferToVault = await vaultSetup.addLiquidity(
            mockDepositLiquidityContract,
            toNano(1),
        )

        expect(jettonTransferToVault.transactions).toHaveTransaction({
            success: true,
        })

        expect(jettonTransferToVault.transactions).toHaveTransaction({
            to: mockDepositLiquidityContract,
        })
    })

    test("should correctly deposit liquidity from both jetton vaults", async () => {
        // create and deploy 2 vaults
        // deploy liquidity deposit contract
        // send jetton transfer to both vaults and check notifications
        // on the 2nd notify on the liquidity deposit contract check ammDeploy
        // check lp token mint
        // check liquidity deposit contract destroy

        const blockchain = await Blockchain.create()

        const {ammPool, vaultA, vaultB, liquidityDepositSetup, isSwapped} =
            await createJettonAmmPool(blockchain)

        const poolState = (await blockchain.getContract(ammPool.address)).accountState?.type
        expect(poolState === "uninit" || poolState === undefined).toBe(true)

        // deploy liquidity deposit contract
        const amountA = toNano(1)
        const amountB = toNano(2) // 1 a == 2 b ratio

        // this is a bad way of doing it, we need to create new depositor, transfer
        // jettons to it, and use it as a parameter in all vaults methods too
        //
        // depositor should be the same for both vaults jettons transfers
        const depositor = vaultA.treasury.walletOwner

        const liqSetup = await liquidityDepositSetup(depositor, amountA, amountB)

        const liqDepositDeployResult = await liqSetup.deploy()

        expect(liqDepositDeployResult.transactions).toHaveTransaction({
            success: true,
            deploy: true,
        })

        // deploy vaultA
        const vaultADeployResult = await vaultA.deploy()
        // under the hood ?
        expect(vaultADeployResult.transactions).toHaveTransaction({
            success: true,
            deploy: true,
        })

        // add liquidity to vaultA
        const vaultALiquidityAddResult = await vaultA.addLiquidity(
            liqSetup.liquidityDeposit.address,
            isSwapped ? amountB : amountA,
        )

        expect(vaultALiquidityAddResult.transactions).toHaveTransaction({
            from: vaultA.vault.address,
            to: liqSetup.liquidityDeposit.address,
            op: LiquidityDepositContract.opcodes.PartHasBeenDeposited,
            success: true,
        })
        const status = await liqSetup.liquidityDeposit.getStatus()
        expect(status.leftSideFilled || status.rightSideFilled).toBeTruthy()

        // deploy vaultB
        const vaultBDeployResult = await vaultB.deploy()
        expect(vaultBDeployResult.transactions).toHaveTransaction({
            success: true,
            deploy: true,
        })

        // add liquidity to vaultB
        const vaultBLiquidityAddResult = await vaultB.addLiquidity(
            liqSetup.liquidityDeposit.address,
            isSwapped ? amountA : amountB,
        )

        expect(vaultBLiquidityAddResult.transactions).toHaveTransaction({
            from: vaultB.vault.address,
            to: liqSetup.liquidityDeposit.address,
            op: LiquidityDepositContract.opcodes.PartHasBeenDeposited,
            success: true,
        })

        // liq deposit contract should be destroyed after depositing both parts of liquidity
        const contractState = (await blockchain.getContract(liqSetup.liquidityDeposit.address))
            .accountState?.type
        expect(contractState === "uninit" || contractState === undefined).toBe(true)

        // check amm pool deploy and notification
        expect(vaultBLiquidityAddResult.transactions).toHaveTransaction({
            from: liqSetup.liquidityDeposit.address,
            to: ammPool.address,
            op: AmmPool.opcodes.LiquidityDeposit,
            success: true,
            deploy: true,
        })

        const leftSide = await ammPool.getLeftSide()
        const rightSide = await ammPool.getRightSide()

        // the correct liquidity amount was added
        const sortedWithAmounts = sortAddresses(
            vaultA.vault.address,
            vaultB.vault.address,
            isSwapped ? amountB : amountA,
            isSwapped ? amountA : amountB,
        )
        expect(leftSide).toBe(sortedWithAmounts.leftAmount)
        expect(rightSide).toBe(sortedWithAmounts.rightAmount)

        // check LP token mint
        expect(vaultBLiquidityAddResult.transactions).toHaveTransaction({
            from: ammPool.address,
            to: liqSetup.depositorLpWallet.address,
            op: AmmPool.opcodes.MintViaJettonTransferInternal,
            success: true,
        })

        const lpBalance = await liqSetup.depositorLpWallet.getJettonBalance()
        // TODO: add off-chain precise balance calculations tests (with sqrt and separate cases)
        expect(lpBalance).toBeGreaterThan(0n)
    })

    test("should revert liquidity deposit with wrong ratio with both jetton vaults", async () => {
        const blockchain = await Blockchain.create()

        const {
            ammPool,
            vaultA,
            vaultB,
            isSwapped,
            sorted,
            liquidityDepositSetup,
            initWithLiquidity,
        } = await createJettonAmmPool(blockchain)

        // deploy liquidity deposit contract
        const initialRatio = 2n

        const amountA = toNano(1)
        const amountB = amountA * initialRatio // 1 a == 2 b ratio

        const depositor = vaultA.treasury.walletOwner

        const {depositorLpWallet} = await initWithLiquidity(depositor, amountA, amountB)

        const lpBalanceAfterFirstLiq = await depositorLpWallet.getJettonBalance()
        // check that first liquidity deposit was successful
        expect(lpBalanceAfterFirstLiq).toBeGreaterThan(0n)

        // now we want to try to add liquidity in wrong ratio and check revert
        const amountABadRatio = toNano(1)
        const amountBBadRatio = amountABadRatio * initialRatio * 5n // wrong ratio

        const liqSetupBadRatio = await liquidityDepositSetup(
            depositor,
            amountABadRatio,
            amountBBadRatio,
        )
        const liqDepositDeployResultBadRatio = await liqSetupBadRatio.deploy()
        expect(liqDepositDeployResultBadRatio.transactions).toHaveTransaction({
            success: true,
            deploy: true,
        })

        // both vaults are already deployed so we can just add next liquidity
        const vaultALiquidityAddResultBadRatio = await vaultA.addLiquidity(
            liqSetupBadRatio.liquidityDeposit.address,
            isSwapped ? amountBBadRatio : amountABadRatio,
        )

        expect(vaultALiquidityAddResultBadRatio.transactions).toHaveTransaction({
            from: vaultA.vault.address,
            to: liqSetupBadRatio.liquidityDeposit.address,
            op: LiquidityDepositContract.opcodes.PartHasBeenDeposited,
            success: true,
        })
        const statusBadRatio = await liqSetupBadRatio.liquidityDeposit.getStatus()
        expect(statusBadRatio.leftSideFilled || statusBadRatio.rightSideFilled).toBeTruthy()

        // a lot of stuff happens here
        // 1. jetton transfer to vaultB
        // 2. vaultB sends notification to LPDepositContractBadRatio
        // 3. LPDepositContractBadRatio sends notification to ammPool
        // 4. ammPool receives notification and tries to add liquidity, but since we broke the ratio, it
        //    can add only a part of the liquidity, and the rest of the liquidity is sent back to deployer jetton wallet
        // (4.1 and 4.2 are pool-payout and jetton stuff)
        // 5. More LP jettons are minted
        const vaultBLiquidityAddResultBadRatio = await vaultB.addLiquidity(
            liqSetupBadRatio.liquidityDeposit.address,
            isSwapped ? amountABadRatio : amountBBadRatio,
        )

        // it is tx #2
        expect(vaultBLiquidityAddResultBadRatio.transactions).toHaveTransaction({
            from: vaultB.vault.address,
            to: liqSetupBadRatio.liquidityDeposit.address,
            op: LiquidityDepositContract.opcodes.PartHasBeenDeposited,
            success: true,
        })

        // it is tx #3
        expect(vaultBLiquidityAddResultBadRatio.transactions).toHaveTransaction({
            from: liqSetupBadRatio.liquidityDeposit.address,
            to: ammPool.address,
            op: AmmPool.opcodes.LiquidityDeposit,
            success: true,
        })

        // it is tx #4
        expect(vaultBLiquidityAddResultBadRatio.transactions).toHaveTransaction({
            from: ammPool.address,
            to: sorted.higher, // TODO: add dynamic test why we revert B here
            op: AmmPool.opcodes.PayoutFromPool,
            success: true,
        })

        // TODO: add tests for precise amounts of jettons sent back to deployer wallet
        // for tx #5

        const lpBalanceAfterSecond = await depositorLpWallet.getJettonBalance()
        // check that the second liquidity deposit was successful
        // and we got more LP tokens
        expect(lpBalanceAfterSecond).toBeGreaterThan(lpBalanceAfterFirstLiq)
    })

    test("should deploy ton vault", async () => {
        const blockchain = await Blockchain.create()

        const vaultSetup = await createTonVault(blockchain)

        const vaultDeployResult = await vaultSetup.deploy()
        expect(vaultDeployResult.transactions).toHaveTransaction({
            success: true,
            deploy: true,
        })

        const mockDepositLiquidityContract = randomAddress(0)

        const tonTransferToVault = await vaultSetup.addLiquidity(
            mockDepositLiquidityContract,
            toNano(1),
        )

        expect(tonTransferToVault.transactions).toHaveTransaction({
            success: true,
        })

        expect(tonTransferToVault.transactions).toHaveTransaction({
            to: mockDepositLiquidityContract,
        })
    })

    test("should correctly deposit liquidity from jetton vault and ton vault", async () => {
        const blockchain = await Blockchain.create()

        const {ammPool, vaultA, vaultB, liquidityDepositSetup, isSwapped} =
            await createTonJettonAmmPool(blockchain)

        const poolState = (await blockchain.getContract(ammPool.address)).accountState?.type
        expect(poolState === "uninit" || poolState === undefined).toBe(true)

        // deploy liquidity deposit contract
        const amountA = toNano(1)
        const amountB = toNano(2) // 1 a == 2 b ratio

        const depositor = vaultB.treasury.walletOwner

        const liqSetup = await liquidityDepositSetup(depositor, amountA, amountB)

        const liqDepositDeployResult = await liqSetup.deploy()

        expect(liqDepositDeployResult.transactions).toHaveTransaction({
            success: true,
            deploy: true,
        })

        // deploy vaultA
        const vaultADeployResult = await vaultA.deploy()
        // under the hood ?
        expect(vaultADeployResult.transactions).toHaveTransaction({
            success: true,
            deploy: true,
        })

        // add liquidity to vaultA
        const vaultALiquidityAddResult = await vaultA.addLiquidity(
            liqSetup.liquidityDeposit.address,
            isSwapped ? amountB : amountA,
        )

        expect(vaultALiquidityAddResult.transactions).toHaveTransaction({
            from: vaultA.vault.address,
            to: liqSetup.liquidityDeposit.address,
            op: LiquidityDepositContract.opcodes.PartHasBeenDeposited,
            success: true,
        })
        const status = await liqSetup.liquidityDeposit.getStatus()
        expect(status.leftSideFilled || status.rightSideFilled).toBeTruthy()

        // deploy vaultB
        const vaultBDeployResult = await vaultB.deploy()
        expect(vaultBDeployResult.transactions).toHaveTransaction({
            success: true,
            deploy: true,
        })

        // add liquidity to vaultB
        const vaultBLiquidityAddResult = await vaultB.addLiquidity(
            liqSetup.liquidityDeposit.address,
            isSwapped ? amountA : amountB,
        )

        expect(vaultBLiquidityAddResult.transactions).toHaveTransaction({
            from: vaultB.vault.address,
            to: liqSetup.liquidityDeposit.address,
            op: LiquidityDepositContract.opcodes.PartHasBeenDeposited,
            success: true,
        })

        const contractState = (await blockchain.getContract(liqSetup.liquidityDeposit.address))
            .accountState?.type
        expect(contractState === "uninit" || contractState === undefined).toBe(true)

        // check amm pool deploy and notification
        expect(vaultBLiquidityAddResult.transactions).toHaveTransaction({
            from: liqSetup.liquidityDeposit.address,
            to: ammPool.address,
            op: AmmPool.opcodes.LiquidityDeposit,
            success: true,
            deploy: true,
        })

        const leftSide = await ammPool.getLeftSide()
        const rightSide = await ammPool.getRightSide()

        // the correct liquidity amount was added
        const sortedWithAmounts = sortAddresses(
            vaultA.vault.address,
            vaultB.vault.address,
            isSwapped ? amountB : amountA,
            isSwapped ? amountA : amountB,
        )
        expect(leftSide).toBe(sortedWithAmounts.leftAmount)
        expect(rightSide).toBe(sortedWithAmounts.rightAmount)

        // check LP token mint
        expect(vaultBLiquidityAddResult.transactions).toHaveTransaction({
            from: ammPool.address,
            to: liqSetup.depositorLpWallet.address,
            op: AmmPool.opcodes.MintViaJettonTransferInternal,
            success: true,
        })

        const lpBalance = await liqSetup.depositorLpWallet.getJettonBalance()
        // TODO: add off-chain precise balance calculations tests (with sqrt and separate cases)
        expect(lpBalance).toBeGreaterThan(0n)
    })

    test("should revert liquidity deposit with wrong ratio with jetton vault and ton vault", async () => {
        const blockchain = await Blockchain.create()

        const {ammPool, vaultA, vaultB, isSwapped, liquidityDepositSetup, initWithLiquidity} =
            await createTonJettonAmmPool(blockchain)

        // deploy liquidity deposit contract
        const initialRatio = 2n

        const amountA = toNano(1)
        const amountB = amountA * initialRatio // 1 a == 2 b ratio

        const depositor = vaultB.treasury.walletOwner

        const {depositorLpWallet} = await initWithLiquidity(depositor, amountA, amountB)

        const lpBalanceAfterFirstLiq = await depositorLpWallet.getJettonBalance()
        // check that first liquidity deposit was successful
        expect(lpBalanceAfterFirstLiq).toBeGreaterThan(0n)

        // now we want to try to add liquidity in wrong ratio and check revert
        const amountABadRatio = toNano(1)
        const amountBBadRatio = amountABadRatio * initialRatio * 5n // wrong ratio

        const liqSetupBadRatio = await liquidityDepositSetup(
            depositor,
            amountABadRatio,
            amountBBadRatio,
        )
        const liqDepositDeployResultBadRatio = await liqSetupBadRatio.deploy()
        expect(liqDepositDeployResultBadRatio.transactions).toHaveTransaction({
            success: true,
            deploy: true,
        })

        // both vaults are already deployed so we can just add next liquidity
        const vaultALiquidityAddResultBadRatio = await vaultA.addLiquidity(
            liqSetupBadRatio.liquidityDeposit.address,
            isSwapped ? amountBBadRatio : amountABadRatio,
        )

        expect(vaultALiquidityAddResultBadRatio.transactions).toHaveTransaction({
            from: vaultA.vault.address,
            to: liqSetupBadRatio.liquidityDeposit.address,
            op: LiquidityDepositContract.opcodes.PartHasBeenDeposited,
            success: true,
        })
        const statusBadRatio = await liqSetupBadRatio.liquidityDeposit.getStatus()
        expect(statusBadRatio.leftSideFilled || statusBadRatio.rightSideFilled).toBeTruthy()

        // a lot of stuff happens here
        // 1. ton vault transfer to vaultB
        // 2. vaultB sends notification to LPDepositContractBadRatio
        // 3. LPDepositContractBadRatio sends notification to ammPool
        // 4. ammPool receives notification and tries to add liquidity, but since we broke the ratio, it
        //    can add only a part of the liquidity, and the rest of the liquidity is sent back to deployer jetton wallet
        // (4.1 and 4.2 are pool-payout and jetton stuff)
        // 5. More LP jettons are minted
        const vaultBLiquidityAddResultBadRatio = await vaultB.addLiquidity(
            liqSetupBadRatio.liquidityDeposit.address,
            isSwapped ? amountABadRatio : amountBBadRatio,
        )

        // it is tx #2
        expect(vaultBLiquidityAddResultBadRatio.transactions).toHaveTransaction({
            from: vaultB.vault.address,
            to: liqSetupBadRatio.liquidityDeposit.address,
            op: LiquidityDepositContract.opcodes.PartHasBeenDeposited,
            success: true,
        })

        // it is tx #3
        expect(vaultBLiquidityAddResultBadRatio.transactions).toHaveTransaction({
            from: liqSetupBadRatio.liquidityDeposit.address,
            to: ammPool.address,
            op: AmmPool.opcodes.LiquidityDeposit,
            success: true,
        })

        // it is tx #4
        expect(vaultBLiquidityAddResultBadRatio.transactions).toHaveTransaction({
            from: ammPool.address,
            to: isSwapped ? vaultA.vault.address : vaultB.vault.address, // TODO: add dynamic test why we revert B here
            op: AmmPool.opcodes.PayoutFromPool,
            success: true,
        })

        // TODO: add tests for precise amounts of jettons sent back to deployer wallet
        // for tx #5

        const lpBalanceAfterSecond = await depositorLpWallet.getJettonBalance()
        // check that the second liquidity deposit was successful
        // and we got more LP tokens
        expect(lpBalanceAfterSecond).toBeGreaterThan(lpBalanceAfterFirstLiq)
    })

    test.each([
        {
            name: "Jetton->Jetton",
            createPool: createJettonAmmPool,
        },
        {
            name: "TON->Jetton",
            createPool: createTonJettonAmmPool,
        },
    ])(
        "should correctly deploy liquidity deposit contract from $name vault",
        async ({createPool}) => {
            const blockchain = await Blockchain.create()

            const {vaultB, vaultA, ammPool} = await createPool(blockchain)

            await vaultA.deploy()
            await vaultB.deploy()

            const amountA = toNano(1)
            const amountB = toNano(2)

            const addLiquidityWithDeploy = await vaultA.addLiquidity(
                randomAddress(0),
                amountA,
                null,
                null,
                0n,
                0n,
                {
                    id: 1n,
                    otherVaultAddress: vaultB.vault.address,
                    otherAmount: amountB,
                },
            )

            expect(addLiquidityWithDeploy.transactions).toHaveTransaction({
                from: vaultA.vault.address,
                // to: liquidity deposit contract address,
                op: LiquidityDepositContract.opcodes.PartHasBeenDeposited,
                success: true,
                deploy: true,
            })

            const returnFundsTx = flattenTransaction(
                findTransactionRequired(addLiquidityWithDeploy.transactions, {
                    from: vaultA.vault.address,
                    op: LiquidityDepositContract.opcodes.PartHasBeenDeposited,
                    success: true,
                    deploy: true,
                }),
            )

            const liquidityDepositContractAddress = returnFundsTx.to!

            await vaultB.addLiquidity(liquidityDepositContractAddress, amountB)

            const depositor = vaultB.treasury.walletOwner

            const depositorLpWallet = blockchain.openContract(
                await ExtendedLPJettonWallet.fromInit(0n, depositor.address, ammPool.address),
            )

            // check that after the second lp deposit, the liquidity was added
            const lpBalance = await depositorLpWallet.getJettonBalance()
            expect(lpBalance).toBeGreaterThan(0n)
        },
    )
})
