import {Blockchain} from "@ton/sandbox"
import {ExtendedJettonMinter as JettonMinter} from "../wrappers/ExtendedJettonMinter"
import {ExtendedJettonWallet as JettonWallet} from "../wrappers/ExtendedJettonWallet"
import {Address, beginCell, Cell, toNano} from "@ton/core"
import {JettonVault} from "../output/DEX_JettonVault"
import {sortAddresses} from "./deployUtils"
import {AmmPool} from "../output/DEX_AmmPool"
import {LiquidityDepositContract} from "../output/DEX_LiquidityDepositContract"
import {createJettonVaultLiquidityDeposit} from "./testUtils"
import {randomAddress} from "@ton/test-utils"

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

    const addLiquidity = async (liquidityDepositContractAddress: Address, amount: bigint) => {
        const addLiquidityResult = await jetton.transfer(
            vault.address,
            amount,
            createJettonVaultLiquidityDeposit(
                liquidityDepositContractAddress,
                jetton.minter.init?.code,
                jetton.minter.init?.data,
            ),
        )

        return addLiquidityResult
    }

    return {
        vault,
        jetton,
        deploy,
        addLiquidity,
    }
}

export const createLiquidityDepositSetup = (
    blockchain: Blockchain,
    vaultLeft: Address,
    vaultRight: Address,
) => {
    const depositorIds: Map<string, bigint> = new Map()

    const setup = async (depositor: Address, amountLeft: bigint, amountRight: bigint) => {
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

        return {
            deploy,
            liquidityDeposit,
            depositorLpWallet,
        }
    }

    return setup
}

export const createAmmPool = async (blockchain: Blockchain) => {
    const vaultA = await createJettonVault(blockchain)
    const vaultB = await createJettonVault(blockchain)

    const sortedAddresses = sortAddresses(vaultA.vault.address, vaultB.vault.address, 0n, 0n)

    const ammPool = blockchain.openContract(
        await AmmPool.fromInit(sortedAddresses.lower, sortedAddresses.higher, 0n, 0n, 0n),
    )

    const liquidityDepositSetup = createLiquidityDepositSetup(
        blockchain,
        vaultA.vault.address,
        vaultB.vault.address,
    )

    // for later stage setup do everything by obtaining the address of the liq deposit here
    //
    // - deploy vaults
    // - deploy liq deposit
    // - add liq to vaults
    const initWithLiquidity = async (
        depositor: Address,
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
        }
    }

    return {
        ammPool,
        vaultA,
        vaultB,
        liquidityDepositSetup,
        initWithLiquidity,
    }
}

// const createDexEnvironment = async (blockchain: Blockchain) => {
//     const tokenA = createJetton(blockchain)
//     const tokenB = createJetton(blockchain)

//     return {
//         tokenA,
//         tokenB,
//     }
// }

// const fabrik = blockchain => {
//     return {}
// }
