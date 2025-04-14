import {toNano} from "@ton/core"
import {Blockchain} from "@ton/sandbox"
import {randomAddress} from "@ton/test-utils"
import {AmmPool} from "../output/DEX_AmmPool"
import {LiquidityDepositContract} from "../output/DEX_LiquidityDepositContract"
import {createAmmPool, createJettonVault} from "../utils/environment"

describe("contract", () => {
    test("Jetton vault should deploy correctly", async () => {
        // deploy vault -> send jetton trasnfer -> notify vault -> notify liq dep contract
        const blockchain = await Blockchain.create()
        const vault = await createJettonVault(blockchain)

        const vaultDeployResult = await vault.deploy()
        expect(vaultDeployResult.transactions).toHaveTransaction({
            success: true,
            deploy: true,
        })

        const mockDepositLiquidityContract = randomAddress(0)

        const jettonTransferToVault = await vault.addLiquidity(
            mockDepositLiquidityContract,
            toNano(1),
        )

        expect(jettonTransferToVault.transactions).toHaveTransaction({
            success: true,
        })

        expect(jettonTransferToVault.transactions).toHaveTransaction({
            to: mockDepositLiquidityContract,
        })

        const inited = await vault.vault.getInited()
        expect(inited).toBe(true)
    })

    test("should correctly depost liquidity", async () => {
        // create and deploy 2 vaults
        // deploy liquidity deposit contract
        // send jetton transfer to both vaults and check notifications
        // on the 2nd notify on the liquidity deposit contract check ammDeploy
        // check lp token mint
        // check liquidity deposit contract destroy

        const blockchain = await Blockchain.create()

        const {ammPool, vaultA, vaultB, liquidityDepositSetup} = await createAmmPool(blockchain)

        const poolState = (await blockchain.getContract(ammPool.address)).accountState?.type
        expect(poolState === "uninit" || poolState === undefined).toBe(true)

        // deploy liquidity deposit contract
        const amountA = toNano(1)
        const amountB = toNano(2) // 1 a == 2 b ratio

        // this is bad way of doing it, we need to create new depositor, transfer
        // jettons to it, and use it as a parameter in all vaults methods too
        //
        // depositor should be the same for both vaults jettons transfers
        const depositor = vaultA.jetton.walletOwner

        const liqSetup = await liquidityDepositSetup(depositor.address, amountA, amountB)

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
            amountA,
        )

        expect(vaultALiquidityAddResult.transactions).toHaveTransaction({
            from: vaultA.vault.address,
            to: liqSetup.liquidityDeposit.address,
            op: LiquidityDepositContract.opcodes.PartHasBeenDeposited,
            success: true,
        })
        expect(await liqSetup.liquidityDeposit.getStatus()).toBeGreaterThan(0n) // It could be 1 = 0b01 or 2 = 0b10

        // deploy vaultB
        const vaultBDeployResult = await vaultB.deploy()
        expect(vaultBDeployResult.transactions).toHaveTransaction({
            success: true,
            deploy: true,
        })

        // add liquidity to vaultB
        const vaultBLiquidityAddResult = await vaultB.addLiquidity(
            liqSetup.liquidityDeposit.address,
            amountB,
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

        const leftSide = await ammPool.getGetLeftSide()
        const rightSide = await ammPool.getGetRightSide()

        // correct liquidity amount was added
        expect(leftSide).toBe(amountA)
        expect(rightSide).toBe(amountB)

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

    // test("Liquidity deposit should work correctly", async () => {
    //     const vaultA = await jettonVault(tokenA.address)
    //     const vaultB = await jettonVault(tokenB.address)

    //     // No need to deploy ammPool, it will be deployed in the LiquidityDepositContract
    //     const ammPoolForAB = await ammPool(vaultA.address, vaultB.address)
    //     const poolState = (await blockchain.getContract(ammPoolForAB.address)).accountState?.type
    //     expect(poolState === "uninit" || poolState === undefined).toBe(true)

    //     const amountA = 10000000n
    //     const amountB = 15000000n
    //     const LPDepositContract = await liquidityDepositContract(
    //         deployer.address,
    //         vaultA.address,
    //         vaultB.address,
    //         amountA,
    //         amountB,
    //     )
    //     const LPDepositRes = await LPDepositContract.send(
    //         deployer.getSender(),
    //         {value: toNano(0.1), bounce: false},
    //         null,
    //     )
    //     expect(LPDepositRes.transactions).toHaveTransaction({
    //         success: true,
    //         deploy: true,
    //     })

    //     const walletA = await userWalletA(deployer.address)
    //     const walletB = await userWalletB(deployer.address)

    //     const realDeployVaultA = await vaultForA.send(
    //         deployer.getSender(),
    //         {value: toNano(0.1), bounce: false},
    //         null,
    //     )
    //     expect(realDeployVaultA.transactions).toHaveTransaction({
    //         success: true,
    //         deploy: true,
    //     })

    //     const transferAndNotifyLPDeposit = await walletA.sendTransfer(
    //         deployer.getSender(),
    //         toNano(1),
    //         amountA,
    //         vaultForA.address,
    //         deployer.address,
    //         null,
    //         toNano(0.5),
    //         createJettonVaultLiquidityDeposit(
    //             LPDepositContract.address,
    //             tokenACodeData.code!!,
    //             tokenACodeData.data!!,
    //         ),
    //     )
    //     expect(transferAndNotifyLPDeposit.transactions).toHaveTransaction({
    //         from: vaultForA.address,
    //         to: LPDepositContract.address,
    //         op: LiquidityDepositContract.opcodes.PartHasBeenDeposited,
    //         success: true,
    //     })
    //     expect(await LPDepositContract.getStatus()).toBeGreaterThan(0n) // It could be 1 = 0b01 or 2 = 0b10

    //     const realDeployVaultB = await vaultForB.send(
    //         deployer.getSender(),
    //         {value: toNano(0.1), bounce: false},
    //         null,
    //     )
    //     expect(realDeployVaultB.transactions).toHaveTransaction({
    //         success: true,
    //         deploy: true,
    //     })
    //     const addLiquidityAndMintLP = await walletB.sendTransfer(
    //         deployer.getSender(),
    //         toNano(1),
    //         amountB,
    //         vaultForB.address,
    //         deployer.address,
    //         null,
    //         toNano(0.5),
    //         createJettonVaultLiquidityDeposit(
    //             LPDepositContract.address,
    //             tokenBCodeData.code!!,
    //             tokenBCodeData.data!!,
    //         ),
    //     )
    //     expect(addLiquidityAndMintLP.transactions).toHaveTransaction({
    //         from: vaultForB.address,
    //         to: LPDepositContract.address,
    //         op: LiquidityDepositContract.opcodes.PartHasBeenDeposited,
    //         success: true,
    //     })

    //     const contractState = (await blockchain.getContract(LPDepositContract.address)).accountState
    //         ?.type
    //     expect(contractState === "uninit" || contractState === undefined).toBe(true)
    //     // Contract has been destroyed after depositing both parts of liquidity

    //     expect(addLiquidityAndMintLP.transactions).toHaveTransaction({
    //         from: LPDepositContract.address,
    //         to: ammPoolForAB.address,
    //         op: AmmPool.opcodes.LiquidityDeposit,
    //         success: true,
    //     })
    //     const sortedAddresses = sortAddresses(vaultA.address, vaultB.address, amountA, amountB)
    //     const leftSide = await ammPoolForAB.getGetLeftSide()
    //     const rightSide = await ammPoolForAB.getGetRightSide()

    //     expect(leftSide).toBe(sortedAddresses.leftAmount)
    //     expect(rightSide).toBe(sortedAddresses.rightAmount)

    //     const LPWallet = await userLPWallet(deployer.address, ammPoolForAB.address)

    //     // LP tokens minted successfully
    //     expect(addLiquidityAndMintLP.transactions).toHaveTransaction({
    //         from: ammPoolForAB.address,
    //         to: LPWallet.address,
    //         op: AmmPool.opcodes.MintViaJettonTransferInternal,
    //         success: true,
    //     })

    //     const LPBalance = await LPWallet.getJettonBalance()
    //     expect(LPBalance).toBeGreaterThan(0n)
    // })

    // test("Liquidity deposit should fail with wrong amount", async () => {
    //     const vaultA = vaultForA
    //     const vaultB = vaultForB

    //     const ammPoolForAB = await ammPool(vaultA.address, vaultB.address)
    //     const poolState = (await blockchain.getContract(ammPoolForAB.address)).accountState?.type
    //     expect(poolState === "uninit" || poolState === undefined).toBe(true)

    //     const initialRatio = 2n // 1 a == 2 b

    //     const amountA = toNano(1)
    //     const amountB = amountA * initialRatio

    //     const LPDepositContract = await liquidityDepositContract(
    //         deployer.address,
    //         vaultA.address,
    //         vaultB.address,
    //         amountA,
    //         amountB,
    //     )
    //     const LPDepositRes = await LPDepositContract.send(
    //         deployer.getSender(),
    //         {value: toNano(0.1), bounce: false},
    //         null,
    //     )
    //     expect(LPDepositRes.transactions).toHaveTransaction({
    //         to: LPDepositContract.address,
    //         success: true,
    //         deploy: true,
    //     })

    //     const walletA = await userWalletA(deployer.address)
    //     const walletB = await userWalletB(deployer.address)

    //     const realDeployVaultA = await vaultForA.send(
    //         deployer.getSender(),
    //         {value: toNano(0.1), bounce: false},
    //         null,
    //     )
    //     expect(realDeployVaultA.transactions).toHaveTransaction({
    //         to: vaultForA.address,
    //         success: true,
    //         deploy: true,
    //     })

    //     const transferAndNotifyLPDeposit = await walletA.sendTransfer(
    //         deployer.getSender(),
    //         toNano(1),
    //         amountA,
    //         vaultForA.address,
    //         deployer.address,
    //         null,
    //         toNano(0.5),
    //         createJettonVaultLiquidityDeposit(
    //             LPDepositContract.address,
    //             tokenACodeData.code!!,
    //             tokenACodeData.data!!,
    //         ),
    //     )
    //     expect(transferAndNotifyLPDeposit.transactions).toHaveTransaction({
    //         from: vaultForA.address,
    //         to: LPDepositContract.address,
    //         op: LiquidityDepositContract.opcodes.PartHasBeenDeposited,
    //         success: true,
    //     })
    //     expect(await LPDepositContract.getStatus()).toBeGreaterThan(0n) // It could be 1 = 0b01 or 2 = 0b10
    //     expect(await LPDepositContract.getStatus()).toBeLessThan(3n)

    //     const realDeployVaultB = await vaultForB.send(
    //         deployer.getSender(),
    //         {value: toNano(0.1), bounce: false},
    //         null,
    //     )
    //     expect(realDeployVaultB.transactions).toHaveTransaction({
    //         to: vaultForB.address,
    //         success: true,
    //         deploy: true,
    //     })
    //     const addLiquidityAndMintLP = await walletB.sendTransfer(
    //         deployer.getSender(),
    //         toNano(1),
    //         amountB,
    //         vaultForB.address,
    //         deployer.address,
    //         null,
    //         toNano(0.5),
    //         createJettonVaultLiquidityDeposit(
    //             LPDepositContract.address,
    //             tokenBCodeData.code!!,
    //             tokenBCodeData.data!!,
    //         ),
    //     )
    //     expect(addLiquidityAndMintLP.transactions).toHaveTransaction({
    //         from: vaultForB.address,
    //         to: LPDepositContract.address,
    //         op: LiquidityDepositContract.opcodes.PartHasBeenDeposited,
    //         success: true,
    //         endStatus: "non-existing", // should be destroyed
    //     })

    //     const contractState = (await blockchain.getContract(LPDepositContract.address)).accountState
    //         ?.type
    //     expect(contractState === "uninit" || contractState === undefined).toBe(true)
    //     // Contract has been destroyed after depositing both parts of liquidity

    //     expect(addLiquidityAndMintLP.transactions).toHaveTransaction({
    //         from: LPDepositContract.address,
    //         to: ammPoolForAB.address,
    //         op: AmmPool.opcodes.LiquidityDeposit,
    //         success: true,
    //     })
    //     const sortedAddresses = sortAddresses(vaultA.address, vaultB.address, amountA, amountB)
    //     const leftSide = await ammPoolForAB.getGetLeftSide()
    //     const rightSide = await ammPoolForAB.getGetRightSide()

    //     expect(leftSide).toBe(sortedAddresses.leftAmount)
    //     expect(rightSide).toBe(sortedAddresses.rightAmount)

    //     const liquidityProviderLPWallet = await userLPWallet(deployer.address, ammPoolForAB.address)

    //     // LP tokens minted successfully
    //     expect(addLiquidityAndMintLP.transactions).toHaveTransaction({
    //         from: ammPoolForAB.address,
    //         to: liquidityProviderLPWallet.address,
    //         op: AmmPool.opcodes.MintViaJettonTransferInternal,
    //         success: true,
    //     })

    //     const LPBalance = await liquidityProviderLPWallet.getJettonBalance()
    //     // TODO: add off-chain precise balance calculations tests
    //     expect(LPBalance).toBeGreaterThan(0n)

    //     // after first liquidity provisioning, we want to try to add liquidity in wrong ratio and check revert
    //     const amountAIncorrect = toNano(1)
    //     const amountBIncorrect = amountAIncorrect * initialRatio * 2n // wrong ratio

    //     const LPDepositContractBadRatio = await liquidityDepositContract(
    //         deployer.address,
    //         vaultA.address,
    //         vaultB.address,
    //         amountAIncorrect,
    //         amountBIncorrect,
    //     )

    //     const LPDepositRes2 = await LPDepositContractBadRatio.send(
    //         deployer.getSender(),
    //         {value: toNano(0.1), bounce: false},
    //         null,
    //     )
    //     expect(LPDepositRes2.transactions).toHaveTransaction({
    //         to: LPDepositContractBadRatio.address,
    //         success: true,
    //         deploy: true,
    //     })

    //     const transferAndNotifyLPDepositWrong = await walletA.sendTransfer(
    //         deployer.getSender(),
    //         toNano(1),
    //         amountAIncorrect,
    //         vaultForA.address,
    //         deployer.address,
    //         null,
    //         toNano(0.5),
    //         createJettonVaultLiquidityDeposit(
    //             LPDepositContractBadRatio.address,
    //             tokenACodeData.code!!,
    //             tokenACodeData.data!!,
    //         ),
    //     )
    //     expect(transferAndNotifyLPDepositWrong.transactions).toHaveTransaction({
    //         from: vaultForA.address,
    //         to: LPDepositContractBadRatio.address,
    //         op: LiquidityDepositContract.opcodes.PartHasBeenDeposited,
    //         success: true,
    //     })
    //     expect(await LPDepositContractBadRatio.getStatus()).toBeGreaterThan(0n) // It could be 1 = 0b01 or 2 = 0b10
    //     expect(await LPDepositContractBadRatio.getStatus()).toBeLessThan(3n)

    //     // a lot of stuff happens here
    //     // 1. jetton transfer to vaultB
    //     // 2. vaultB sends notification to LPDepositContractBadRatio
    //     // 3. LPDepositContractBadRatio sends notification to ammPool
    //     // 4. ammPool receives notification and tries to add liquidity, but since we broke the ratio, it
    //     //    can add only a part of the liquidity, and the rest of the liquidity is sent back to deployer jetton wallet
    //     // (4.1 and 4.2 are pool-payout and jetton stuff)
    //     // 5. More LP jettons are minted
    //     const addWrongRatioLiquidityAndMintLPAndRevertJettons = await walletB.sendTransfer(
    //         deployer.getSender(),
    //         toNano(3),
    //         amountBIncorrect,
    //         vaultForB.address,
    //         deployer.address,
    //         null,
    //         toNano(2),
    //         createJettonVaultLiquidityDeposit(
    //             LPDepositContractBadRatio.address,
    //             tokenBCodeData.code!!,
    //             tokenBCodeData.data!!,
    //         ),
    //     )
    //     // it is tx #2
    //     expect(addWrongRatioLiquidityAndMintLPAndRevertJettons.transactions).toHaveTransaction({
    //         from: vaultForB.address,
    //         to: LPDepositContractBadRatio.address,
    //         op: LiquidityDepositContract.opcodes.PartHasBeenDeposited,
    //         success: true,
    //     })

    //     // it is tx #3
    //     expect(addWrongRatioLiquidityAndMintLPAndRevertJettons.transactions).toHaveTransaction({
    //         from: LPDepositContractBadRatio.address,
    //         to: ammPoolForAB.address,
    //         op: AmmPool.opcodes.LiquidityDeposit,
    //         success: true,
    //     })

    //     // it is tx #4
    //     expect(addWrongRatioLiquidityAndMintLPAndRevertJettons.transactions).toHaveTransaction({
    //         from: ammPoolForAB.address,
    //         to: vaultB.address,
    //         op: AmmPool.opcodes.PayoutFromPool,
    //         success: true,
    //     })

    //     // TODO: add tests for precise amounts of jettons sent back to deployer wallet
    //     // it is tx #5
    // })
})
