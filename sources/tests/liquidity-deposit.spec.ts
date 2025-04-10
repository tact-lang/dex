import {Address, beginCell, Cell, toNano} from "@ton/core"
import {Blockchain, SandboxContract, TreasuryContract, BlockchainSnapshot} from "@ton/sandbox"
import {ExtendedJettonMinter as JettonMinter} from "../wrappers/ExtendedJettonMinter"
import {randomAddress} from "@ton/test-utils"
import {ExtendedJettonWallet as JettonWallet} from "../wrappers/ExtendedJettonWallet"
import {JettonVault} from "../output/DEX_JettonVault"
import {AmmPool} from "../output/DEX_AmmPool"
import {LiquidityDepositContract} from "../output/DEX_LiquidityDepositContract"
import {createJettonVaultLiquidityDeposit} from "../utils/testUtils"
// eslint-disable-next-line
import fs from "fs"
import {sortAddresses} from "../utils/deployUtils"

type ContractCodeData = {
    code: Cell | undefined
    data: Cell | undefined
}

describe("contract", () => {
    let blockchain: Blockchain
    let deployer: SandboxContract<TreasuryContract>

    let userWalletA: (address: Address) => Promise<SandboxContract<JettonWallet>>
    let userWalletB: (address: Address) => Promise<SandboxContract<JettonWallet>>
    let userLPWallet: (owner: Address, pool: Address) => Promise<SandboxContract<JettonWallet>>
    let jettonVault: (address: Address) => Promise<SandboxContract<JettonVault>>
    let ammPool: (vaultLeft: Address, vaultRight: Address) => Promise<SandboxContract<AmmPool>>
    const depositorIds: Map<string, bigint> = new Map()
    let liquidityDepositContract: (
        depositor: Address,
        vaultLeft: Address,
        vaultRight: Address,
        amountLeft: bigint,
        amountRight: bigint,
    ) => Promise<SandboxContract<LiquidityDepositContract>>

    let tokenA: SandboxContract<JettonMinter>
    let tokenACodeData: ContractCodeData
    let tokenB: SandboxContract<JettonMinter>
    let tokenBCodeData: ContractCodeData
    let vaultForA: SandboxContract<JettonVault>
    let vaultForB: SandboxContract<JettonVault>

    let snapshot: BlockchainSnapshot

    beforeAll(async () => {
        blockchain = await Blockchain.create()
        //blockchain.verbosity.vmLogs = "vm_logs_full";
        //blockchain.verbosity.vmLogs = "vm_logs_verbose";
        deployer = await blockchain.treasury("deployer")

        // Two different jettonMaster addresses, as jettonContent is different
        tokenA = blockchain.openContract(
            await JettonMinter.fromInit(
                0n,
                deployer.address,
                beginCell().storeInt(0x01, 6).endCell(),
            ),
        )
        tokenACodeData = {
            code: tokenA.init?.code,
            data: tokenA.init?.data,
        }
        tokenB = blockchain.openContract(
            await JettonMinter.fromInit(
                0n,
                deployer.address,
                beginCell().storeInt(0x02, 6).endCell(),
            ),
        )
        tokenBCodeData = {
            code: tokenB.init?.code,
            data: tokenB.init?.data,
        }
        userWalletA = async (address: Address) => {
            return blockchain.openContract(
                new JettonWallet(await tokenA.getGetWalletAddress(address)),
            )
        }

        userWalletB = async (address: Address) => {
            return blockchain.openContract(
                new JettonWallet(await tokenB.getGetWalletAddress(address)),
            )
        }

        vaultForA = blockchain.openContract(await JettonVault.fromInit(tokenA.address, false, null))
        vaultForB = blockchain.openContract(await JettonVault.fromInit(tokenB.address, false, null))

        jettonVault = async (address: Address) => {
            return blockchain.openContract(await JettonVault.fromInit(address, false, null))
        }

        ammPool = async (vaultLeft: Address, vaultRight: Address) => {
            let sortedAddresses = sortAddresses(vaultLeft, vaultRight, 0n, 0n)
            return blockchain.openContract(
                await AmmPool.fromInit(sortedAddresses.lower, sortedAddresses.higher, 0n, 0n, 0n),
            )
        }

        userLPWallet = async (owner: Address, pool: Address) => {
            return blockchain.openContract(await JettonWallet.fromInit(0n, owner, pool))
        }

        liquidityDepositContract = async (
            depositor: Address,
            vaultLeft: Address,
            vaultRight: Address,
            amountLeft: bigint,
            amountRight: bigint,
        ): Promise<SandboxContract<LiquidityDepositContract>> => {
            const depositorKey = depositor.toRawString()
            let contractId = depositorIds.get(depositorKey) || 0n
            depositorIds.set(depositorKey, contractId + 1n)

            let sortedAddresses = sortAddresses(vaultLeft, vaultRight, amountLeft, amountRight)
            return blockchain.openContract(
                await LiquidityDepositContract.fromInit(
                    sortedAddresses.lower,
                    sortedAddresses.higher,
                    sortedAddresses.leftAmount,
                    sortedAddresses.rightAmount,
                    depositor,
                    contractId,
                    0n,
                ),
            )
        }

        const mintAmount = toNano(100)

        const mintRes = await tokenA.sendMint(
            deployer.getSender(),
            deployer.address,
            mintAmount,
            0n,
            toNano(1),
        )
        expect(mintRes.transactions).toHaveTransaction({
            deploy: true,
            success: true,
        })

        const mintRes2 = await tokenB.sendMint(
            deployer.getSender(),
            deployer.address,
            mintAmount,
            0n,
            toNano(1),
        )
        expect(mintRes2.transactions).toHaveTransaction({
            deploy: true,
            success: true,
        })

        snapshot = blockchain.snapshot()
    })

    beforeEach(async () => {
        await blockchain.loadFrom(snapshot)
    })

    test("Jetton vault should deploy correctly", async () => {
        const mockDepositLiquidityContract = randomAddress(0)

        const realDeployment = await vaultForA.send(
            deployer.getSender(),
            {value: toNano(0.1), bounce: false},
            null,
        )

        expect(realDeployment.transactions).toHaveTransaction({
            success: true,
            deploy: true,
        })

        const deployerWallet = await userWalletA(deployer.address)
        const transferRes = await deployerWallet.sendTransfer(
            deployer.getSender(),
            toNano(1),
            100n,
            vaultForA.address,
            deployer.address,
            null,
            toNano(0.5),
            createJettonVaultLiquidityDeposit(
                mockDepositLiquidityContract,
                tokenACodeData.code!!,
                tokenACodeData.data!!,
            ),
        )

        expect(transferRes.transactions).toHaveTransaction({
            success: true,
        })

        expect(transferRes.transactions).toHaveTransaction({
            to: mockDepositLiquidityContract,
        })

        const inited = await vaultForA.getInited()
        expect(inited).toBe(true)
    })

    test("Liquidity deposit should work correctly", async () => {
        const vaultA = await jettonVault(tokenA.address)
        const vaultB = await jettonVault(tokenB.address)

        // No need to deploy ammPool, it will be deployed in the LiquidityDepositContract
        const ammPoolForAB = await ammPool(vaultA.address, vaultB.address)
        const poolState = (await blockchain.getContract(ammPoolForAB.address)).accountState?.type
        expect(poolState === "uninit" || poolState === undefined).toBe(true)

        const amountA = 10000000n
        const amountB = 15000000n
        const LPDepositContract = await liquidityDepositContract(
            deployer.address,
            vaultA.address,
            vaultB.address,
            amountA,
            amountB,
        )
        const LPDepositRes = await LPDepositContract.send(
            deployer.getSender(),
            {value: toNano(0.1), bounce: false},
            null,
        )
        expect(LPDepositRes.transactions).toHaveTransaction({
            success: true,
            deploy: true,
        })

        const walletA = await userWalletA(deployer.address)
        const walletB = await userWalletB(deployer.address)

        const realDeployVaultA = await vaultForA.send(
            deployer.getSender(),
            {value: toNano(0.1), bounce: false},
            null,
        )
        expect(realDeployVaultA.transactions).toHaveTransaction({
            success: true,
            deploy: true,
        })

        const transferAndNotifyLPDeposit = await walletA.sendTransfer(
            deployer.getSender(),
            toNano(1),
            amountA,
            vaultForA.address,
            deployer.address,
            null,
            toNano(0.5),
            createJettonVaultLiquidityDeposit(
                LPDepositContract.address,
                tokenACodeData.code!!,
                tokenACodeData.data!!,
            ),
        )
        expect(transferAndNotifyLPDeposit.transactions).toHaveTransaction({
            from: vaultForA.address,
            to: LPDepositContract.address,
            op: LiquidityDepositContract.opcodes.PartHasBeenDeposited,
            success: true,
        })
        expect(await LPDepositContract.getStatus()).toBeGreaterThan(0n) // It could be 1 = 0b01 or 2 = 0b10

        const realDeployVaultB = await vaultForB.send(
            deployer.getSender(),
            {value: toNano(0.1), bounce: false},
            null,
        )
        expect(realDeployVaultB.transactions).toHaveTransaction({
            success: true,
            deploy: true,
        })
        const addLiquidityAndMintLP = await walletB.sendTransfer(
            deployer.getSender(),
            toNano(1),
            amountB,
            vaultForB.address,
            deployer.address,
            null,
            toNano(0.5),
            createJettonVaultLiquidityDeposit(
                LPDepositContract.address,
                tokenBCodeData.code!!,
                tokenBCodeData.data!!,
            ),
        )
        expect(addLiquidityAndMintLP.transactions).toHaveTransaction({
            from: vaultForB.address,
            to: LPDepositContract.address,
            op: LiquidityDepositContract.opcodes.PartHasBeenDeposited,
            success: true,
        })

        const contractState = (await blockchain.getContract(LPDepositContract.address)).accountState
            ?.type
        expect(contractState === "uninit" || contractState === undefined).toBe(true)
        // Contract has been destroyed after depositing both parts of liquidity

        expect(addLiquidityAndMintLP.transactions).toHaveTransaction({
            from: LPDepositContract.address,
            to: ammPoolForAB.address,
            op: AmmPool.opcodes.LiquidityDeposit,
            success: true,
        })
        const sortedAddresses = sortAddresses(vaultA.address, vaultB.address, amountA, amountB)
        const leftSide = await ammPoolForAB.getGetLeftSide()
        const rightSide = await ammPoolForAB.getGetRightSide()

        expect(leftSide).toBe(sortedAddresses.leftAmount)
        expect(rightSide).toBe(sortedAddresses.rightAmount)

        const LPWallet = await userLPWallet(deployer.address, ammPoolForAB.address)

        // LP tokens minted successfully
        expect(addLiquidityAndMintLP.transactions).toHaveTransaction({
            from: ammPoolForAB.address,
            to: LPWallet.address,
            op: AmmPool.opcodes.MintViaJettonTransferInternal,
            success: true,
        })

        const LPBalance = await LPWallet.getJettonBalance()
        expect(LPBalance).toBeGreaterThan(0n)
    })

    test("Liquidity deposit should fail with wrong amount", async () => {
        const vaultA = vaultForA
        const vaultB = vaultForB

        const ammPoolForAB = await ammPool(vaultA.address, vaultB.address)
        const poolState = (await blockchain.getContract(ammPoolForAB.address)).accountState?.type
        expect(poolState === "uninit" || poolState === undefined).toBe(true)

        const initialRatio = 2n // 1 a == 2 b

        const amountA = toNano(1)
        const amountB = amountA * initialRatio

        const LPDepositContract = await liquidityDepositContract(
            deployer.address,
            vaultA.address,
            vaultB.address,
            amountA,
            amountB,
        )
        const LPDepositRes = await LPDepositContract.send(
            deployer.getSender(),
            {value: toNano(0.1), bounce: false},
            null,
        )
        expect(LPDepositRes.transactions).toHaveTransaction({
            to: LPDepositContract.address,
            success: true,
            deploy: true,
        })

        const walletA = await userWalletA(deployer.address)
        const walletB = await userWalletB(deployer.address)

        const realDeployVaultA = await vaultForA.send(
            deployer.getSender(),
            {value: toNano(0.1), bounce: false},
            null,
        )
        expect(realDeployVaultA.transactions).toHaveTransaction({
            to: vaultForA.address,
            success: true,
            deploy: true,
        })

        const transferAndNotifyLPDeposit = await walletA.sendTransfer(
            deployer.getSender(),
            toNano(1),
            amountA,
            vaultForA.address,
            deployer.address,
            null,
            toNano(0.5),
            createJettonVaultLiquidityDeposit(
                LPDepositContract.address,
                tokenACodeData.code!!,
                tokenACodeData.data!!,
            ),
        )
        expect(transferAndNotifyLPDeposit.transactions).toHaveTransaction({
            from: vaultForA.address,
            to: LPDepositContract.address,
            op: LiquidityDepositContract.opcodes.PartHasBeenDeposited,
            success: true,
        })
        expect(await LPDepositContract.getStatus()).toBeGreaterThan(0n) // It could be 1 = 0b01 or 2 = 0b10
        expect(await LPDepositContract.getStatus()).toBeLessThan(3n)

        const realDeployVaultB = await vaultForB.send(
            deployer.getSender(),
            {value: toNano(0.1), bounce: false},
            null,
        )
        expect(realDeployVaultB.transactions).toHaveTransaction({
            to: vaultForB.address,
            success: true,
            deploy: true,
        })
        const addLiquidityAndMintLP = await walletB.sendTransfer(
            deployer.getSender(),
            toNano(1),
            amountB,
            vaultForB.address,
            deployer.address,
            null,
            toNano(0.5),
            createJettonVaultLiquidityDeposit(
                LPDepositContract.address,
                tokenBCodeData.code!!,
                tokenBCodeData.data!!,
            ),
        )
        expect(addLiquidityAndMintLP.transactions).toHaveTransaction({
            from: vaultForB.address,
            to: LPDepositContract.address,
            op: LiquidityDepositContract.opcodes.PartHasBeenDeposited,
            success: true,
            endStatus: "non-existing", // should be destroyed
        })

        const contractState = (await blockchain.getContract(LPDepositContract.address)).accountState
            ?.type
        expect(contractState === "uninit" || contractState === undefined).toBe(true)
        // Contract has been destroyed after depositing both parts of liquidity

        expect(addLiquidityAndMintLP.transactions).toHaveTransaction({
            from: LPDepositContract.address,
            to: ammPoolForAB.address,
            op: AmmPool.opcodes.LiquidityDeposit,
            success: true,
        })
        const sortedAddresses = sortAddresses(vaultA.address, vaultB.address, amountA, amountB)
        const leftSide = await ammPoolForAB.getGetLeftSide()
        const rightSide = await ammPoolForAB.getGetRightSide()

        expect(leftSide).toBe(sortedAddresses.leftAmount)
        expect(rightSide).toBe(sortedAddresses.rightAmount)

        const liquidityProviderLPWallet = await userLPWallet(deployer.address, ammPoolForAB.address)

        // LP tokens minted successfully
        expect(addLiquidityAndMintLP.transactions).toHaveTransaction({
            from: ammPoolForAB.address,
            to: liquidityProviderLPWallet.address,
            op: AmmPool.opcodes.MintViaJettonTransferInternal,
            success: true,
        })

        const LPBalance = await liquidityProviderLPWallet.getJettonBalance()
        // TODO: add off-chain precise balance calculations tests
        expect(LPBalance).toBeGreaterThan(0n)

        // after first liquidity provisioning, we want to try to add liquidity in wrong ratio and check revert
        const amountAIncorrect = toNano(1)
        const amountBIncorrect = amountAIncorrect * initialRatio * 2n // wrong ratio

        const LPDepositContractBadRatio = await liquidityDepositContract(
            deployer.address,
            vaultA.address,
            vaultB.address,
            amountAIncorrect,
            amountBIncorrect,
        )

        const LPDepositRes2 = await LPDepositContractBadRatio.send(
            deployer.getSender(),
            {value: toNano(0.1), bounce: false},
            null,
        )
        expect(LPDepositRes2.transactions).toHaveTransaction({
            to: LPDepositContractBadRatio.address,
            success: true,
            deploy: true,
        })

        const transferAndNotifyLPDepositWrong = await walletA.sendTransfer(
            deployer.getSender(),
            toNano(1),
            amountAIncorrect,
            vaultForA.address,
            deployer.address,
            null,
            toNano(0.5),
            createJettonVaultLiquidityDeposit(
                LPDepositContractBadRatio.address,
                tokenACodeData.code!!,
                tokenACodeData.data!!,
            ),
        )
        expect(transferAndNotifyLPDepositWrong.transactions).toHaveTransaction({
            from: vaultForA.address,
            to: LPDepositContractBadRatio.address,
            op: LiquidityDepositContract.opcodes.PartHasBeenDeposited,
            success: true,
        })
        expect(await LPDepositContractBadRatio.getStatus()).toBeGreaterThan(0n) // It could be 1 = 0b01 or 2 = 0b10
        expect(await LPDepositContractBadRatio.getStatus()).toBeLessThan(3n)

        // a lot of stuff happens here
        // 1. jetton transfer to vaultB
        // 2. vaultB sends notification to LPDepositContractBadRatio
        // 3. LPDepositContractBadRatio sends notification to ammPool
        // 4. ammPool receives notification and tries to add liquidity, but since we broke the ratio, it
        //    can add only a part of the liquidity, and the rest of the liquidity is sent back to deployer jetton wallet
        // (4.1 and 4.2 are pool-payout and jetton stuff)
        // 5. More LP jettons are minted
        const addWrongRatioLiquidityAndMintLPAndRevertJettons = await walletB.sendTransfer(
            deployer.getSender(),
            toNano(3),
            amountBIncorrect,
            vaultForB.address,
            deployer.address,
            null,
            toNano(2),
            createJettonVaultLiquidityDeposit(
                LPDepositContractBadRatio.address,
                tokenBCodeData.code!!,
                tokenBCodeData.data!!,
            ),
        )
        // it is tx #2
        expect(addWrongRatioLiquidityAndMintLPAndRevertJettons.transactions).toHaveTransaction({
            from: vaultForB.address,
            to: LPDepositContractBadRatio.address,
            op: LiquidityDepositContract.opcodes.PartHasBeenDeposited,
            success: true,
        })

        // it is tx #3
        expect(addWrongRatioLiquidityAndMintLPAndRevertJettons.transactions).toHaveTransaction({
            from: LPDepositContractBadRatio.address,
            to: ammPoolForAB.address,
            op: AmmPool.opcodes.LiquidityDeposit,
            success: true,
        })

        // it is tx #4
        expect(addWrongRatioLiquidityAndMintLPAndRevertJettons.transactions).toHaveTransaction({
            from: ammPoolForAB.address,
            to: vaultB.address,
            op: AmmPool.opcodes.PayoutFromPool,
            success: true,
        })

        // TODO: add tests for precise amounts of jettons sent back to deployer wallet
        // it is tx #5
    })
})
