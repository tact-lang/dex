//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import {Blockchain, SandboxContract, SendMessageResult, TreasuryContract} from "@ton/sandbox"
import {ExtendedJettonMinter as JettonMinter} from "../wrappers/ExtendedJettonMinter"
import {ExtendedJettonWallet as JettonWallet} from "../wrappers/ExtendedJettonWallet"
import {Address, beginCell, Cell, SendMode, toNano} from "@ton/core"
import {
    GasLPDepositPartJettonVault,
    GasSwapRequestJettonVault,
    JettonVault,
} from "../output/DEX_JettonVault"
import {sortAddresses} from "./deployUtils"
import {
    AmmPool,
    GasAmmPoolLiquidityDeposit,
    GasAmmPoolSwap,
    GasPayoutFromAnyVault,
    SwapStep,
} from "../output/DEX_AmmPool"
import {
    GasLPDepositContract,
    LiquidityDepositContract,
} from "../output/DEX_LiquidityDepositContract"
import {
    createJettonVaultLiquidityDepositPayload,
    createJettonVaultSwapRequest,
    createTonSwapRequest,
    createTonVaultLiquidityDepositPayload,
    createWithdrawLiquidityBody,
    getComputeGasForTx,
} from "./testUtils"
import {findTransaction, findTransactionRequired, randomAddress} from "@ton/test-utils"
import {GasLPDepositPartTonVault, GasSwapRequestTonVault, TonVault} from "../output/DEX_TonVault"
import {ExtendedLPJettonWallet} from "../wrappers/ExtendedLPJettonWallet"

// TODO: unify common prefix to structs on create setups
export const createJetton = async (blockchain: Blockchain) => {
    const minterOwner = await blockchain.treasury("jetton-owner")
    const walletOwner = await blockchain.treasury("wallet-owner")
    const mintAmount = toNano(100000)

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

export type JettonTreasury = Awaited<ReturnType<typeof createJetton>>
export type TonTreasury = SandboxContract<TreasuryContract>

export type Create<T> = (blockchain: Blockchain) => Promise<T>

type SandboxSendResult = SendMessageResult & {
    result: void
}

export type VaultInterface<T> = {
    vault: {
        address: Address
    }
    treasury: T
    deploy: () => Promise<SandboxSendResult>
    // TON Vault is always inited, no need to init explicitly
    isInited: () => Promise<boolean>
    addLiquidity: (
        liquidityDepositContractAddress: Address,
        amount: bigint,
        payloadOnSuccess?: Cell | null,
        payloadOnFailure?: Cell | null,
        minAmountToDeposit?: bigint,
        lpTimeout?: bigint,
        liquidityDepositContractData?: {
            otherVaultAddress: Address
            otherAmount: bigint
            id: bigint
        },
    ) => Promise<SandboxSendResult>
    sendSwapRequest: (
        amountToSwap: bigint,
        destinationPool: Address,
        isExactOutType: boolean,
        desiredAmount: bigint,
        timeout: bigint,
        // This value is needed only for exactOut swaps, for exactIn it is ignored
        cashbackAddress: Address | null,
        payloadOnSuccess: Cell | null,
        payloadOnFailure: Cell | null,
        nextStep: SwapStep | null,
        receiver: Address | null,
    ) => Promise<SandboxSendResult>
}

export const createJettonVault: Create<VaultInterface<JettonTreasury>> = async (
    blockchain: Blockchain,
) => {
    const jetton = await createJetton(blockchain)

    const vault = blockchain.openContract(await JettonVault.fromInit(jetton.minter.address, null))

    const deploy = async () => {
        const deployRes = await vault.send(
            (await blockchain.treasury("any-user")).getSender(),
            {value: toNano(0.1), bounce: false},
            null,
        )
        if ((await blockchain.getContract(vault.address)).balance > 0n) {
            throw new Error("Vault balance should be 0 after deploy")
        }
        return deployRes
    }

    const isInited = async () => {
        return await vault.getInited()
    }

    const addLiquidity = async (
        liquidityDepositContractAddress: Address,
        amount: bigint,
        payloadOnSuccess: Cell | null = null,
        payloadOnFailure: Cell | null = null,
        minAmountToDeposit: bigint = 0n,
        lpTimeout: bigint = BigInt(Math.ceil(Date.now() / 1000) + 5 * 60), // 5 minutes
        liquidityDepositContractData?: {
            otherVaultAddress: Address
            otherAmount: bigint
            id: bigint
        },
    ) => {
        const vaultWasInited = await isInited()
        const res = await jetton.transfer(
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
                liquidityDepositContractData,
            ),
        )
        // if the vault was not initialized, it will spend more gas on proof.
        if (vaultWasInited) {
            const txOnVault = findTransactionRequired(res.transactions, {
                on: vault.address,
                op: JettonVault.opcodes.JettonNotifyWithActionRequest,
            })
            expect(getComputeGasForTx(txOnVault)).toBeLessThanOrEqual(GasLPDepositPartJettonVault)
        }
        if (liquidityDepositContractData === undefined) {
            const txOnLpDepositContract = findTransactionRequired(res.transactions, {
                on: liquidityDepositContractAddress,
            })
            // We should check that tx wasn't skipped
            if (
                txOnLpDepositContract.description.type === "generic" &&
                txOnLpDepositContract.description.computePhase.type === "vm"
            ) {
                expect(getComputeGasForTx(txOnLpDepositContract)).toBeLessThanOrEqual(
                    GasLPDepositContract,
                )
            }
        }
        const txOnPool = findTransaction(res.transactions, {
            from: liquidityDepositContractAddress,
            op: AmmPool.opcodes.LiquidityDeposit,
        })
        if (txOnPool !== undefined) {
            expect(getComputeGasForTx(txOnPool)).toBeLessThanOrEqual(GasAmmPoolLiquidityDeposit)
        }
        return res
    }

    const sendSwapRequest = async (
        amountToSwap: bigint,
        destinationPool: Address,
        isExactOutType: boolean,
        desiredAmount: bigint,
        timeout: bigint,
        cashbackAddress: Address | null,
        payloadOnSuccess: Cell | null,
        payloadOnFailure: Cell | null,
        nextStep?: SwapStep | null,
        receiver: Address | null = null,
    ) => {
        const vaultWasInited = await isInited()
        const swapRequest = createJettonVaultSwapRequest(
            destinationPool,
            isExactOutType,
            desiredAmount,
            timeout,
            cashbackAddress,
            payloadOnSuccess,
            payloadOnFailure,
            nextStep,
            receiver,
        )
        const res = await jetton.transfer(vault.address, amountToSwap, swapRequest)
        // If vault was not initialized it will spend more gas on proof.
        if (vaultWasInited) {
            const txOnVault = findTransactionRequired(res.transactions, {
                on: vault.address,
                op: JettonVault.opcodes.JettonNotifyWithActionRequest,
            })
            expect(getComputeGasForTx(txOnVault)).toBeLessThanOrEqual(GasSwapRequestJettonVault)
        }
        const txOnPool = findTransaction(res.transactions, {
            on: destinationPool,
            op: AmmPool.opcodes.SwapIn,
        })
        if (txOnPool !== undefined) {
            expect(getComputeGasForTx(txOnPool)).toBeLessThanOrEqual(GasAmmPoolSwap)
        }
        const payoutTx = findTransaction(res.transactions, {
            op: AmmPool.opcodes.PayoutFromPool,
        })
        if (payoutTx !== undefined) {
            expect(getComputeGasForTx(payoutTx)).toBeLessThanOrEqual(GasPayoutFromAnyVault)
        }
        return res
    }

    return {
        vault,
        treasury: jetton,
        isInited,
        deploy,
        addLiquidity,
        sendSwapRequest,
    }
}

export const createTonVault: Create<VaultInterface<TonTreasury>> = async (
    blockchain: Blockchain,
) => {
    const vault = blockchain.openContract(await TonVault.fromInit())

    const wallet = await blockchain.treasury("wallet-owner")

    const deploy = async () => {
        const contractWasInited =
            (await blockchain.getContract(vault.address)).accountState?.type == "active"
        const deployRes = await vault.send(
            (await blockchain.treasury("any-user-3")).getSender(),
            {value: toNano(0.1), bounce: false},
            null,
        )
        const balance = (await blockchain.getContract(vault.address)).balance
        if (!contractWasInited && balance > 0n) {
            throw new Error("Vault balance should be 0 after deploy, got " + balance)
        }
        return deployRes
    }

    const addLiquidity = async (
        liquidityDepositContractAddress: Address,
        amount: bigint,
        payloadOnSuccess: Cell | null = null,
        payloadOnFailure: Cell | null = null,
        minAmountToDeposit: bigint = 0n,
        lpTimeout: bigint = BigInt(Math.ceil(Date.now() / 1000) + 5 * 60), // 5 minutes
        liquidityDepositContractData?: {
            otherVaultAddress: Address
            otherAmount: bigint
            id: bigint
        },
    ) => {
        const res = await wallet.send({
            to: vault.address,
            value: amount + toNano(0.5), // fee
            bounce: true,
            body: createTonVaultLiquidityDepositPayload(
                liquidityDepositContractAddress,
                amount,
                payloadOnSuccess,
                payloadOnFailure,
                minAmountToDeposit,
                lpTimeout,
                liquidityDepositContractData,
            ),
        })
        const txOnVault = findTransactionRequired(res.transactions, {
            on: vault.address,
            op: TonVault.opcodes.AddLiquidityPartTon,
        })
        expect(getComputeGasForTx(txOnVault)).toBeLessThanOrEqual(GasLPDepositPartTonVault)
        if (liquidityDepositContractData === undefined) {
            const txOnLpDepositContract = findTransactionRequired(res.transactions, {
                on: liquidityDepositContractAddress,
            })
            if (
                txOnLpDepositContract.description.type === "generic" &&
                txOnLpDepositContract.description.computePhase.type === "vm"
            ) {
                expect(getComputeGasForTx(txOnLpDepositContract)).toBeLessThanOrEqual(
                    GasLPDepositContract,
                )
            }
        }
        const txOnPool = findTransaction(res.transactions, {
            from: liquidityDepositContractAddress,
            op: AmmPool.opcodes.LiquidityDeposit,
        })
        if (txOnPool !== undefined) {
            expect(getComputeGasForTx(txOnPool)).toBeLessThanOrEqual(GasAmmPoolLiquidityDeposit)
        }
        return res
    }

    const sendSwapRequest = async (
        amountToSwap: bigint,
        destinationPool: Address,
        isExactOutType: boolean,
        desiredAmount: bigint,
        timeout: bigint,
        cashbackAddress: Address | null,
        payloadOnSuccess: Cell | null,
        payloadOnFailure: Cell | null,
        nextStep: SwapStep | null,
        receiver: Address | null = null,
    ) => {
        const swapRequest = createTonSwapRequest(
            destinationPool,
            receiver,
            amountToSwap,
            isExactOutType,
            desiredAmount,
            timeout,
            cashbackAddress,
            payloadOnSuccess,
            payloadOnFailure,
            nextStep,
        )

        const res = await wallet.send({
            to: vault.address,
            value: amountToSwap + toNano(0.2), // fee
            bounce: true,
            body: swapRequest,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
        })
        const txOnVault = findTransactionRequired(res.transactions, {
            on: vault.address,
            op: TonVault.opcodes.SwapRequestTon,
        })
        expect(getComputeGasForTx(txOnVault)).toBeLessThanOrEqual(GasSwapRequestTonVault)
        const txOnPool = findTransaction(res.transactions, {
            on: destinationPool,
            op: AmmPool.opcodes.SwapIn,
        })
        if (txOnPool !== undefined) {
            expect(getComputeGasForTx(txOnPool)).toBeLessThanOrEqual(GasAmmPoolSwap)
        }
        const payoutTx = findTransaction(res.transactions, {
            op: AmmPool.opcodes.PayoutFromPool,
        })
        if (payoutTx !== undefined) {
            expect(getComputeGasForTx(payoutTx)).toBeLessThanOrEqual(GasPayoutFromAnyVault)
        }
        return res
    }

    return {
        deploy,
        vault,
        isInited: async () => {
            return true
        },
        treasury: wallet,
        addLiquidity,
        sendSwapRequest,
    }
}

const createLiquidityDepositSetup = (
    blockchain: Blockchain,
    vaultLeft: Address,
    vaultRight: Address,
) => {
    const depositorIds: Map<string, bigint> = new Map()

    return async (
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
                false,
                false,
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
            if ((await blockchain.getContract(liquidityDeposit.address)).balance > 0n) {
                throw new Error("Liquidity deposit balance should be 0 after deploy")
            }

            return deployResult
        }

        const ammPool = blockchain.openContract(
            await AmmPool.fromInit(sortedAddresses.lower, sortedAddresses.higher, 0n, 0n, 0n, null),
        )

        const depositorLpWallet = blockchain.openContract(
            await ExtendedLPJettonWallet.fromInit(0n, depositor, ammPool.address),
        )

        const withdrawLiquidity = async (
            amount: bigint,
            minAmountLeft: bigint,
            minAmountRight: bigint,
            timeout: bigint,
            successfulPayload: Cell | null,
        ) => {
            const withdrawResult = await depositorLpWallet.sendBurn(
                depositorContract.getSender(),
                toNano(2),
                amount,
                depositor,
                createWithdrawLiquidityBody(
                    minAmountLeft,
                    minAmountRight,
                    timeout,
                    depositor,
                    successfulPayload,
                ),
            )

            const balance = (await blockchain.getContract(liquidityDeposit.address)).balance

            if (balance > 0n) {
                throw new Error(
                    `AmmPool balance should be 0 after withdraw, and its: ${balance.toString()}`,
                )
            }

            return withdrawResult
        }

        return {
            deploy,
            liquidityDeposit,
            depositorLpWallet,
            withdrawLiquidity,
        }
    }
}

export const createAmmPoolFromCreators =
    <T, U>(createLeft: Create<VaultInterface<T>>, createRight: Create<VaultInterface<U>>) =>
    async (blockchain: Blockchain) => {
        const firstVault = await createLeft(blockchain)
        const secondVault = await createRight(blockchain)
        return createAmmPool(firstVault, secondVault, blockchain)
    }

export const createAmmPool = async <T, U>(
    firstVault: VaultInterface<T>,
    secondVault: VaultInterface<U>,
    blockchain: Blockchain,
) => {
    const sortedVaults = sortAddresses(firstVault.vault.address, secondVault.vault.address, 0n, 0n)

    const vaultA = sortedVaults.lower === firstVault.vault.address ? firstVault : secondVault
    const vaultB = sortedVaults.lower === firstVault.vault.address ? secondVault : firstVault

    const sortedAddresses = sortAddresses(vaultA.vault.address, vaultB.vault.address, 0n, 0n)

    const ammPool = blockchain.openContract(
        await AmmPool.fromInit(vaultA.vault.address, vaultB.vault.address, 0n, 0n, 0n, null),
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

        if ((await blockchain.getContract(ammPool.address)).balance > 0n) {
            throw new Error("Vault balance should be 0 after deploy")
        }

        return {
            depositorLpWallet: liqSetup.depositorLpWallet,
            withdrawLiquidity: liqSetup.withdrawLiquidity,
        }
    }

    const swap = async (
        amountToSwap: bigint,
        swapFrom: "vaultA" | "vaultB",
        desiredAmount: bigint = 0n,
        timeout: bigint = 0n,
        isExactOutType: boolean = false,
        cashbackAddress: Address | null = null,
        payloadOnSuccess: Cell | null = null,
        payloadOnFailure: Cell | null = null,
        nextSwapStep: SwapStep | null = null,
        receiver: Address | null = null,
    ) => {
        let swapRes
        if (swapFrom === "vaultA") {
            swapRes = await firstVault.sendSwapRequest(
                amountToSwap,
                ammPool.address,
                isExactOutType,
                desiredAmount,
                timeout,
                cashbackAddress,
                payloadOnSuccess,
                payloadOnFailure,
                nextSwapStep,
                receiver,
            )
        } else {
            swapRes = await secondVault.sendSwapRequest(
                amountToSwap,
                ammPool.address,
                isExactOutType,
                desiredAmount,
                timeout,
                cashbackAddress,
                payloadOnSuccess,
                payloadOnFailure,
                nextSwapStep,
                receiver,
            )
        }

        if ((await blockchain.getContract(ammPool.address)).balance > 0n) {
            throw new Error("AmmPool balance should be 0 after swap")
        }

        return swapRes
    }

    return {
        ammPool,
        vaultA: firstVault,
        vaultB: secondVault,
        sorted: sortedVaults,
        isSwapped: sortedVaults.lower !== firstVault.vault.address,
        liquidityDepositSetup,
        swap,
        initWithLiquidity,
    }
}

export const createJettonAmmPool = createAmmPoolFromCreators<JettonTreasury, JettonTreasury>(
    createJettonVault,
    createJettonVault,
)

export const createTonJettonAmmPool = createAmmPoolFromCreators<TonTreasury, JettonTreasury>(
    createTonVault,
    createJettonVault,
)
