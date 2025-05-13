import {Blockchain, SandboxContract} from "@ton/sandbox"
import {createJettonAmmPool, createTonJettonAmmPool} from "../utils/environment"
import {Address, beginCell, toNano} from "@ton/core"
import {AmmPool} from "../output/DEX_AmmPool"
// eslint-disable-next-line
import {SendDumpToDevWallet} from "@tondevwallet/traces"
import {randomAddress} from "@ton/test-utils"
import {ExtendedLPJettonWallet} from "../wrappers/ExtendedLPJettonWallet"

describe("Amm pool", () => {
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

    test("should revert swap with slippage", async () => {
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
        const amountAJettonBeforeSwap = await vaultA.treasury.wallet.getJettonBalance()

        const swapResult = await swap(amountToSwap, "vaultA", expectedOutput + 1n) // slippage

        expect(swapResult.transactions).toHaveTransaction({
            from: vaultA.vault.address,
            to: ammPool.address, // NOTE: Swap should fail
            exitCode: AmmPool.errors["Pool: Amount out is less than minAmountOut"],
            success: true, // That is what happens when throw after commit(), exit code is non-zero, success is true
        })

        const amountAJettonAfterSwap = await vaultA.treasury.wallet.getJettonBalance()
        const amountBJettonAfterSwap = await vaultB.treasury.wallet.getJettonBalance()

        // check that swap was reverted and jettons are not moved
        expect(amountAJettonBeforeSwap).toEqual(amountAJettonAfterSwap)
        expect(amountBJettonBeforeSwap).toEqual(amountBJettonAfterSwap)
    })

    test("should withdraw liquidity with lp burn", async () => {
        const blockchain = await Blockchain.create()

        const {ammPool, vaultA, vaultB, initWithLiquidity} = await createJettonAmmPool(blockchain)

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
        // check that liquidity deposit was successful
        expect(lpBalanceAfterFirstLiq).toBeGreaterThan(0n)

        const amountBJettonBefore = await vaultB.treasury.wallet.getJettonBalance()
        const amountAJettonBefore = await vaultA.treasury.wallet.getJettonBalance()

        const withdrawResult = await withdrawLiquidity(lpBalanceAfterFirstLiq, null)

        expect(withdrawResult.transactions).toHaveTransaction({
            from: depositorLpWallet.address,
            to: ammPool.address,
            op: AmmPool.opcodes.LiquidityWithdrawViaBurnNotification,
            success: true,
        })
        expect(withdrawResult.transactions).toHaveTransaction({
            from: ammPool.address,
            to: vaultA.vault.address,
            op: AmmPool.opcodes.PayoutFromPool,
            success: true,
        })
        expect(withdrawResult.transactions).toHaveTransaction({
            from: ammPool.address,
            to: vaultB.vault.address,
            op: AmmPool.opcodes.PayoutFromPool,
            success: true,
        })

        const amountBJettonAfter = await vaultB.treasury.wallet.getJettonBalance()
        const amountAJettonAfter = await vaultA.treasury.wallet.getJettonBalance()

        // TODO: add off-chain precise checks here
        expect(amountAJettonAfter).toBeGreaterThan(amountAJettonBefore)
        expect(amountBJettonAfter).toBeGreaterThan(amountBJettonBefore)
    })

    test("should swap exact amount of jetton to ton", async () => {
        const blockchain = await Blockchain.create()

        const {ammPool, vaultA, vaultB, initWithLiquidity, swap} =
            await createTonJettonAmmPool(blockchain)

        // deploy liquidity deposit contract
        const initialRatio = 2n

        const amountA = toNano(1)
        const amountB = amountA * initialRatio // 1 a == 2 b ratio

        const depositor = vaultB.treasury.walletOwner

        const {depositorLpWallet} = await initWithLiquidity(depositor, amountA, amountB)

        const lpBalanceAfterFirstLiq = await depositorLpWallet.getJettonBalance()
        // check that liquidity deposit was successful
        expect(lpBalanceAfterFirstLiq).toBeGreaterThan(0n)

        // swap 10 jettons for ton
        const amountToSwap = 10n
        const expectedOutputTon = await ammPool.getExpectedOut(vaultB.vault.address, amountToSwap)

        const amountBJettonBeforeSwap = await vaultB.treasury.wallet.getJettonBalance()

        const swapResult = await swap(amountToSwap, "vaultB", expectedOutputTon)

        // check that swap was successful
        expect(swapResult.transactions).toHaveTransaction({
            from: vaultB.vault.address,
            to: ammPool.address,
            op: AmmPool.opcodes.SwapIn,
            success: true,
        })

        expect(swapResult.transactions).toHaveTransaction({
            from: ammPool.address,
            to: vaultA.vault.address,
            op: AmmPool.opcodes.PayoutFromPool,
            success: true,
        })

        expect(swapResult.transactions).toHaveTransaction({
            to: vaultB.treasury.walletOwner.address,
            // TODO: add precise ton calculations (a lot of different fees)
            // value: expectedOutputTon,
            success: true,
        })

        const amountOfJettonBAfterSwap = await vaultB.treasury.wallet.getJettonBalance()
        expect(amountOfJettonBAfterSwap).toBe(amountBJettonBeforeSwap - amountToSwap)
    })

    test("should swap exact amount of ton to jetton", async () => {
        const blockchain = await Blockchain.create()

        const {ammPool, vaultA, vaultB, initWithLiquidity, swap} =
            await createTonJettonAmmPool(blockchain)

        // deploy liquidity deposit contract
        const initialRatio = 2n

        const amountA = toNano(1)
        const amountB = amountA * initialRatio // 1 a == 2 b ratio

        const depositor = vaultB.treasury.walletOwner

        const {depositorLpWallet} = await initWithLiquidity(depositor, amountA, amountB)

        const lpBalanceAfterFirstLiq = await depositorLpWallet.getJettonBalance()
        // check that liquidity deposit was successful
        expect(lpBalanceAfterFirstLiq).toBeGreaterThan(0n)

        // swap 5 nanoton for jetton
        const amountToSwapTon = 5n
        const expectedOutputJetton = await ammPool.getExpectedOut(
            vaultA.vault.address,
            amountToSwapTon,
        )

        const amountBJettonBeforeSwap = await vaultB.treasury.wallet.getJettonBalance()

        const swapResult = await swap(amountToSwapTon, "vaultA", expectedOutputJetton)

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
            to: vaultB.treasury.wallet.address,
            op: AmmPool.opcodes.JettonTransferInternal,
            success: true,
        })

        const amountOfJettonBAfterSwap = await vaultB.treasury.wallet.getJettonBalance()
        expect(amountOfJettonBAfterSwap).toBe(amountBJettonBeforeSwap + expectedOutputJetton)
    })

    describe("Amm pool should act as a JettonMaster", () => {
        const createUserLPWallet = (blockchain: Blockchain, ammPool: SandboxContract<AmmPool>) => {
            return async (address: Address) => {
                return blockchain.openContract(
                    new ExtendedLPJettonWallet(await ammPool.getGetWalletAddress(address)),
                )
            }
        }

        test("Amm pool is TEP-89 compatible JettonMaster that reports correct discovery address", async () => {
            const blockchain = await Blockchain.create()
            const deployer = await blockchain.treasury(randomAddress().toString()) // Just a random treasury
            const notDeployer = await blockchain.treasury(randomAddress().toString())
            const ammPool = blockchain.openContract(
                await AmmPool.fromInit(randomAddress(), randomAddress(), 0n, 0n, 0n, null),
            )
            const userWallet = createUserLPWallet(blockchain, ammPool)
            const deployAmmPoolRes = await ammPool.send(
                deployer.getSender(),
                {value: toNano(0.01)},
                null,
            )
            expect(deployAmmPoolRes.transactions).toHaveTransaction({
                from: deployer.address,
                to: ammPool.address,
                success: true,
            })

            let discoveryResult = await ammPool.send(
                deployer.getSender(),
                {
                    value: toNano(0.01),
                },
                {
                    $$type: "ProvideWalletAddress",
                    queryId: 0n,
                    ownerAddress: deployer.address,
                    includeAddress: true,
                },
            )
            /*
              take_wallet_address#d1735400 query_id:uint64 wallet_address:MsgAddress owner_address:(Maybe ^MsgAddress) = InternalMsgBody;
            */
            const deployerJettonWallet = await userWallet(deployer.address)
            expect(discoveryResult.transactions).toHaveTransaction({
                from: ammPool.address,
                to: deployer.address,
                body: beginCell()
                    .storeUint(AmmPool.opcodes.TakeWalletAddress, 32)
                    .storeUint(0, 64)
                    .storeAddress(deployerJettonWallet.address)
                    .storeUint(1, 1)
                    .storeRef(beginCell().storeAddress(deployer.address).endCell())
                    .endCell(),
            })

            discoveryResult = await ammPool.send(
                deployer.getSender(),
                {
                    value: toNano(0.01),
                },
                {
                    $$type: "ProvideWalletAddress",
                    queryId: 0n,
                    ownerAddress: notDeployer.address,
                    includeAddress: true,
                },
            )
            const notDeployerJettonWallet = await userWallet(notDeployer.address)
            expect(discoveryResult.transactions).toHaveTransaction({
                from: ammPool.address,
                to: deployer.address,
                body: beginCell()
                    .storeUint(AmmPool.opcodes.TakeWalletAddress, 32)
                    .storeUint(0, 64)
                    .storeAddress(notDeployerJettonWallet.address)
                    .storeUint(1, 1)
                    .storeRef(beginCell().storeAddress(notDeployer.address).endCell())
                    .endCell(),
            })

            // do not include the owner address
            discoveryResult = await ammPool.send(
                deployer.getSender(),
                {
                    value: toNano(0.01),
                },
                {
                    $$type: "ProvideWalletAddress",
                    queryId: 0n,
                    ownerAddress: notDeployer.address,
                    includeAddress: false,
                },
            )
            expect(discoveryResult.transactions).toHaveTransaction({
                from: ammPool.address,
                to: deployer.address,
                body: beginCell()
                    .storeUint(AmmPool.opcodes.TakeWalletAddress, 32)
                    .storeUint(0, 64)
                    .storeAddress(notDeployerJettonWallet.address)
                    .storeUint(0, 1)
                    .endCell(),
            })
        })
        test("Correctly handles not valid address in discovery", async () => {
            const blockchain = await Blockchain.create()
            const deployer = await blockchain.treasury(randomAddress().toString()) // Just a random treasury
            const ammPool = blockchain.openContract(
                await AmmPool.fromInit(randomAddress(), randomAddress(), 0n, 0n, 0n, null),
            )
            const badAddr = randomAddress(-1)
            let discoveryResult = await ammPool.send(
                deployer.getSender(),
                {
                    value: toNano(0.01),
                },
                {
                    $$type: "ProvideWalletAddress",
                    queryId: 0n,
                    ownerAddress: badAddr,
                    includeAddress: false,
                },
            )

            expect(discoveryResult.transactions).toHaveTransaction({
                from: ammPool.address,
                to: deployer.address,
                body: beginCell()
                    .storeUint(AmmPool.opcodes.TakeWalletAddress, 32)
                    .storeUint(0, 64)
                    .storeUint(0, 2) // addr_none
                    .storeUint(0, 1)
                    .endCell(),
            })

            // Include address should still be available

            discoveryResult = await ammPool.send(
                deployer.getSender(),
                {
                    value: toNano(0.01),
                },
                {
                    $$type: "ProvideWalletAddress",
                    queryId: 0n,
                    ownerAddress: badAddr,
                    includeAddress: true,
                },
            )

            expect(discoveryResult.transactions).toHaveTransaction({
                from: ammPool.address,
                to: deployer.address,
                body: beginCell()
                    .storeUint(AmmPool.opcodes.TakeWalletAddress, 32)
                    .storeUint(0, 64)
                    .storeUint(0, 2) // addr_none
                    .storeUint(1, 1)
                    .storeRef(beginCell().storeAddress(badAddr).endCell())
                    .endCell(),
            })
        })
    })
})
