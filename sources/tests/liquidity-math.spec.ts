import {toNano} from "@ton/core"
import {Blockchain} from "@ton/sandbox"
import {randomAddress} from "@ton/test-utils"
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
import {calculateLiquidityProvisioning} from "../utils/liquidityMath"

describe("Liquidity math", () => {
    // TODO: add tests for all combinations of pools (with it.each, it should be the same)
    test("should increase pool reserves by correct amount", async () => {
        const blockchain = await Blockchain.create()

        const {ammPool, vaultB, isSwapped, initWithLiquidity} =
            await createTonJettonAmmPool(blockchain)

        const initialRatio = 7n

        const amountARaw = toNano(1)
        const amountBRaw = amountARaw * initialRatio // 1 a == 2 b ratio

        const amountA = isSwapped ? amountARaw : amountBRaw
        const amountB = isSwapped ? amountBRaw : amountARaw

        const depositor = vaultB.treasury.walletOwner

        const {depositorLpWallet} = await initWithLiquidity(depositor, amountA, amountB)

        const lpBalanceAfterFirstLiq = await depositorLpWallet.getJettonBalance()

        const expectedLpAmount = calculateLiquidityProvisioning(
            0n,
            0n,
            amountA,
            amountB,
            0n,
            0n,
            0n,
        )

        // check that first liquidity deposit was successful
        expect(lpBalanceAfterFirstLiq).toEqual(expectedLpAmount.lpTokens)
        // check that pool reserves are correct
        expect(await ammPool.getLeftSide()).toEqual(expectedLpAmount.reserveA)
        expect(await ammPool.getRightSide()).toEqual(expectedLpAmount.reserveB)
    })

    test("should increase pool reserves by correct amount with revert", async () => {
        const blockchain = await Blockchain.create()

        const {ammPool, vaultB, isSwapped, initWithLiquidity} =
            await createTonJettonAmmPool(blockchain)

        const initialRatio = 7n

        const amountARaw = toNano(1)
        const amountBRaw = amountARaw * initialRatio // 1 a == 2 b ratio

        const amountA = isSwapped ? amountARaw : amountBRaw
        const amountB = isSwapped ? amountBRaw : amountARaw

        const depositor = vaultB.treasury.walletOwner

        const {depositorLpWallet} = await initWithLiquidity(depositor, amountA, amountB)

        const lpBalanceAfterFirstLiq = await depositorLpWallet.getJettonBalance()
        // check that first liquidity deposit was successful
        expect(lpBalanceAfterFirstLiq).toBeGreaterThan(0n)

        const reserveABefore = await ammPool.getLeftSide()
        const reserveBBefore = await ammPool.getRightSide()

        // change value a little so it won't be equal to reserveA
        const amountABadRatioRaw = toNano(1.1)
        const amountBBadRatioRaw = amountABadRatioRaw * initialRatio * 5n // wrong ratio

        const amountABadRatio = isSwapped ? amountABadRatioRaw : amountBBadRatioRaw
        const amountBBadRatio = isSwapped ? amountBBadRatioRaw : amountABadRatioRaw

        // second add
        await initWithLiquidity(depositor, amountABadRatio, amountBBadRatio)

        const lpBalanceAfterSecondLiq = await depositorLpWallet.getJettonBalance()

        const expectedLpAmountSecondTime = calculateLiquidityProvisioning(
            reserveABefore,
            reserveBBefore,
            amountABadRatio,
            amountBBadRatio,
            0n,
            0n,
            lpBalanceAfterFirstLiq,
        )

        // since we have same depositor
        const lpAmountMinted = lpBalanceAfterSecondLiq - lpBalanceAfterFirstLiq

        // smthing was minted
        expect(lpAmountMinted).toBeGreaterThan(0n)
        expect(lpAmountMinted).toEqual(expectedLpAmountSecondTime.lpTokens)

        // check that pool reserves are correct
        expect(await ammPool.getLeftSide()).toEqual(expectedLpAmountSecondTime.reserveA)
        expect(await ammPool.getRightSide()).toEqual(expectedLpAmountSecondTime.reserveB)
    })

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

        expect(await liqSetupBadRatio.liquidityDeposit.getStatus()).toBeGreaterThan(0n)

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
})
