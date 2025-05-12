import {toNano} from "@ton/core"
import {Blockchain} from "@ton/sandbox"
import {randomAddress} from "@ton/test-utils"
import {createJettonVault, createTonJettonAmmPool} from "../utils/environment"
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

    test("should follow math across multiple liquidity additions", async () => {
        const blockchain = await Blockchain.create()

        const {ammPool, vaultB, isSwapped, initWithLiquidity} =
            await createTonJettonAmmPool(blockchain)

        let lpAmount = 0n
        const depositor = vaultB.treasury.walletOwner

        const getReserves = async () => {
            try {
                return {
                    left: await ammPool.getLeftSide(),
                    right: await ammPool.getRightSide(),
                }
            } catch (error) {
                return {
                    left: 0n,
                    right: 0n,
                }
            }
        }

        const seed = Math.floor(Math.random() * 1000000)
        console.log(`Debug Seed: ${seed}`)

        const random = (min: number, max: number) =>
            Math.floor(Math.random() * (max - min + 1)) + min

        for (let index = 0; index < 10; index++) {
            const initialRatio = BigInt(random(1, 10)) // Random ratio between 1 and 10

            const amountARaw = BigInt(random(1, 1000))
            const amountBRaw = amountARaw * initialRatio

            const amountA = isSwapped ? amountARaw : amountBRaw
            const amountB = isSwapped ? amountBRaw : amountARaw

            const {left: reserveABefore, right: reserveBBefore} = await getReserves()

            const {depositorLpWallet} = await initWithLiquidity(depositor, amountA, amountB)

            const mintedTotal = await depositorLpWallet.getJettonBalance()
            const lpAmountMinted = mintedTotal === lpAmount ? lpAmount : mintedTotal - lpAmount

            const expectedLpAmount = calculateLiquidityProvisioning(
                reserveABefore,
                reserveBBefore,
                amountA,
                amountB,
                0n,
                0n,
                lpAmount,
            )

            // check that first liquidity deposit was successful
            expect(lpAmountMinted).toBeGreaterThan(expectedLpAmount.lpTokens - 1n)
            expect(lpAmountMinted).toBeLessThan(expectedLpAmount.lpTokens + 1n)
            // check that pool reserves are correct
            expect(await ammPool.getLeftSide()).toEqual(expectedLpAmount.reserveA)
            expect(await ammPool.getRightSide()).toEqual(expectedLpAmount.reserveB)

            lpAmount = mintedTotal
        }
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
})
