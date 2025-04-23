import {Blockchain, SandboxContract, TreasuryContract} from "@ton/sandbox"
import {ExtendedJettonMinter as JettonMinter} from "../wrappers/ExtendedJettonMinter"
import {ExtendedJettonWallet as JettonWallet} from "../wrappers/ExtendedJettonWallet"
import {Address, beginCell, Cell, toNano} from "@ton/core"
import {JettonVault} from "../output/DEX_JettonVault"
import {sortAddresses} from "./deployUtils"
import {AmmPool} from "../output/DEX_AmmPool"
import {LiquidityDepositContract} from "../output/DEX_LiquidityDepositContract"
import {createJettonVaultLiquidityDepositPayload, createJettonVaultSwapRequest} from "./testUtils"
import {randomAddress} from "@ton/test-utils"

// TODO: unify common prefix to structs on create setups
const createJetton = async (blockchain: Blockchain) => {
    const minterOwner = await blockchain.treasury("jetton-owner")
    const walletOwner = await blockchain.treasury("wallet-owner")
    const mintAmount = toNano(100)

    const minter = blockchain.openContract(
        await JettonMinter.fromInit(
            0n,
            minterOwner.address,
            beginCell().storeAddress(randomAddress(0)).endCell(), // salt
        ),
    )
    // external -> minter (from owner) -> wallet (to wallet owner)
    await minter.sendMint(minterOwner.getSender(), walletOwner.address, mintAmount, 0n, toNano(1))

    const wallet = blockchain.openContract(
        new JettonWallet(await minter.getGetWalletAddress(walletOwner.address)),
    )

    const transfer = async (to: Address, jettonAmount: bigint, forwardPayload: Cell | null) => {
        const transferResult = await wallet.sendTransfer(
            walletOwner.getSender(),
            toNano(2),
            jettonAmount,
            to,
            walletOwner.address,
            null,
            toNano(1),
            forwardPayload,
        )

        return transferResult
    }

    return {
        minter,
        wallet,
        walletOwner,
        transfer,
    }
}

export const createJettonVault = async (blockchain: Blockchain) => {
    const jetton = await createJetton(blockchain)

    const vault = blockchain.openContract(
        await JettonVault.fromInit(jetton.minter.address, false, null),
    )

    const deploy = async () => {
        const vaultDeployResult = await vault.send(
            (await blockchain.treasury("any-user")).getSender(),
            {value: toNano(0.1), bounce: false},
            null,
        )

        return vaultDeployResult
    }

    const addLiquidity = async (
        liquidityDepositContractAddress: Address,
        amount: bigint,
        payloadOnSuccess: Cell | null = null,
        payloadOnFailure: Cell | null = null,
        minAmountToDeposit: bigint = 0n,
        lpTimeout: bigint = BigInt(Math.ceil(Date.now() / 1000) + 5 * 60), // 5 minutes
    ) => {
        return await jetton.transfer(
            vault.address,
            amount,
            createJettonVaultLiquidityDepositPayload(
                liquidityDepositContractAddress,
                jetton.minter.init?.code,
                jetton.minter.init?.data,
                minAmountToDeposit,
                lpTimeout,
                payloadOnSuccess,
                payloadOnFailure,
            ),
        )
    }

    return {
        vault,
        jetton,
        deploy,
        addLiquidity,
    }
}

const createLiquidityDepositSetup = (
    blockchain: Blockchain,
    vaultLeft: Address,
    vaultRight: Address,
) => {
    const depositorIds: Map<string, bigint> = new Map()

    const setup = async (
        depositorContract: SandboxContract<TreasuryContract>,
        amountLeft: bigint,
        amountRight: bigint,
    ) => {
        const depositor = depositorContract.address

        const depositorKey = depositor.toRawString()
        const contractId = depositorIds.get(depositorKey) || 0n
        depositorIds.set(depositorKey, contractId + 1n)

        const sortedAddresses = sortAddresses(vaultLeft, vaultRight, amountLeft, amountRight)

        const liquidityDeposit = blockchain.openContract(
            await LiquidityDepositContract.fromInit(
                sortedAddresses.lower,
                sortedAddresses.higher,
                sortedAddresses.leftAmount,
                sortedAddresses.rightAmount,
                depositor,
                contractId,
                0n,
                null,
                null,
            ),
        )

        const deploy = async () => {
            const deployResult = await liquidityDeposit.send(
                (await blockchain.treasury("any-user-2")).getSender(),
                {value: toNano(0.1), bounce: false},
                null,
            )

            return deployResult
        }

        const ammPool = blockchain.openContract(
            await AmmPool.fromInit(sortedAddresses.lower, sortedAddresses.higher, 0n, 0n, 0n),
        )

        const depositorLpWallet = blockchain.openContract(
            await JettonWallet.fromInit(0n, depositor, ammPool.address),
        )

        const withdrawLiquidity = async (amount: bigint) => {
            const withdrawResult = await depositorLpWallet.sendBurn(
                depositorContract.getSender(),
                toNano(2),
                amount,
                depositor,
                null,
            )

            return withdrawResult
        }

        return {
            deploy,
            liquidityDeposit,
            depositorLpWallet,
            withdrawLiquidity,
        }
    }

    return setup
}

export const createAmmPool = async (blockchain: Blockchain) => {
    const firstVault = await createJettonVault(blockchain)
    const secondVault = await createJettonVault(blockchain)

    const sortedVaults = sortAddresses(firstVault.vault.address, secondVault.vault.address, 0n, 0n)

    const vaultA = sortedVaults.lower === firstVault.vault.address ? firstVault : secondVault
    const vaultB = sortedVaults.lower === firstVault.vault.address ? secondVault : firstVault

    const sortedAddresses = sortAddresses(vaultA.vault.address, vaultB.vault.address, 0n, 0n)

    const ammPool = blockchain.openContract(
        await AmmPool.fromInit(vaultA.vault.address, vaultB.vault.address, 0n, 0n, 0n),
    )

    const liquidityDepositSetup = createLiquidityDepositSetup(
        blockchain,
        sortedAddresses.lower,
        sortedAddresses.higher,
    )

    // for later stage setup do everything by obtaining the address of the liq deposit here
    //
    // - deploy vaults
    // - deploy liq deposit
    // - add liq to vaults
    const initWithLiquidity = async (
        depositor: SandboxContract<TreasuryContract>,
        amountLeft: bigint,
        amountRight: bigint,
    ) => {
        await vaultA.deploy()
        await vaultB.deploy()
        const liqSetup = await liquidityDepositSetup(depositor, amountLeft, amountRight)

        await liqSetup.deploy()
        await vaultA.addLiquidity(liqSetup.liquidityDeposit.address, amountLeft)
        await vaultB.addLiquidity(liqSetup.liquidityDeposit.address, amountRight)

        return {
            depositorLpWallet: liqSetup.depositorLpWallet,
            withdrawLiquidity: liqSetup.withdrawLiquidity,
        }
    }

    const swap = async (
        amountToSwap: bigint,
        swapFrom: "vaultA" | "vaultB",
        expectedOutput: bigint = 0n,
        timeout: bigint = 0n,
        payloadOnSuccess: Cell | null = null,
        payloadOnFailure: Cell | null = null,
    ) => {
        if (swapFrom === "vaultA") {
            return await vaultA.jetton.transfer(
                vaultA.vault.address,
                amountToSwap,
                createJettonVaultSwapRequest(
                    vaultB.vault.address,
                    expectedOutput,
                    timeout,
                    payloadOnSuccess,
                    payloadOnFailure,
                ),
            )
        }

        return await vaultB.jetton.transfer(
            vaultB.vault.address,
            amountToSwap,
            createJettonVaultSwapRequest(
                vaultA.vault.address,
                expectedOutput,
                timeout,
                payloadOnSuccess,
                payloadOnFailure,
            ),
        )
    }

    return {
        ammPool,
        vaultA,
        vaultB,
        liquidityDepositSetup,
        swap,
        initWithLiquidity,
    }
}
