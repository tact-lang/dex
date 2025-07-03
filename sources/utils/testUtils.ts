//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import {Address, beginCell, Builder, Cell} from "@ton/core"
import {
    SwapRequest,
    storeSwapRequest,
    SwapRequestOpcode,
    storeLPDepositPart,
    LPDepositPartOpcode,
    SwapStep,
    LiquidityDepositEitherAddress,
} from "../output/DEX_AmmPool"
import {
    PROOF_NO_PROOF_ATTACHED,
    PROOF_TEP89,
    PROOF_STATE_INIT,
    storeLiquidityWithdrawParameters,
    PROOF_STATE_TO_THE_BLOCK,
    storeStateProof,
} from "../output/DEX_JettonVault"
import {storeAddLiquidityPartTon, storeSwapRequestTon} from "../output/DEX_TonVault"
import {randomBytes} from "node:crypto"
import {BlockchainTransaction} from "@ton/sandbox"

export type NoProof = {
    proofType: 0n
}

export type TEP89Proof = {
    proofType: 1n
}

export type StateInitProof = {
    proofType: 2n
    code: Cell
    data: Cell
}

export type StateProof = {
    proofType: 3n
    mcBlockSeqno: bigint
    shardBitLen: bigint
    mcBlockHeaderProof: Cell
    shardBlockHeaderProof: Cell
    shardChainStateProof: Cell
}

export type Proof = NoProof | TEP89Proof | StateInitProof | StateProof

function storeProof(proof: Proof) {
    return (b: Builder) => {
        b.storeUint(proof.proofType, 8)
        switch (proof.proofType) {
            case PROOF_NO_PROOF_ATTACHED:
                break
            case PROOF_TEP89:
                break
            case PROOF_STATE_INIT:
                b.storeRef(proof.code)
                b.storeRef(proof.data)
                break
            case PROOF_STATE_TO_THE_BLOCK:
                b.store(
                    storeStateProof({
                        $$type: "StateProof",
                        mcBlockSeqno: proof.mcBlockSeqno,
                        shardBitLen: proof.shardBitLen,
                        mcBlockHeaderProof: proof.mcBlockHeaderProof,
                        shardBlockHeaderProof: proof.shardBlockHeaderProof,
                        shardChainStateProof: proof.shardChainStateProof,
                    }),
                )
                break
            default:
                throw new Error("Unknown proof type")
        }
    }
}

export function createJettonVaultMessage(opcode: bigint, payload: Cell, proof: Proof) {
    return beginCell()
        .storeUint(0, 1) // Either bit
        .storeUint(opcode, 32)
        .storeRef(payload)
        .store(storeProof(proof))
        .endCell()
}

export function createJettonVaultSwapRequest(
    destinationPool: Address,
    isExactOutType: boolean = false,
    // Default is exactIn
    desiredAmount: bigint = 0n,
    timeout: bigint = 0n,
    cashbackAddress: Address | null = null,
    payloadOnSuccess: Cell | null = null,
    payloadOnFailure: Cell | null = null,
    nextStep: SwapStep | null = null,
    receiver: Address | null = null,
) {
    const swapRequest: SwapRequest = {
        $$type: "SwapRequest",
        pool: destinationPool,
        receiver: receiver,
        params: {
            $$type: "SwapParameters",
            isExactOutType,
            cashbackAddress,
            desiredAmount,
            payloadOnSuccess,
            payloadOnFailure,
            timeout,
            nextStep,
        },
    }

    return createJettonVaultMessage(
        SwapRequestOpcode,
        beginCell().store(storeSwapRequest(swapRequest)).endCell(),
        // This function does not specify proof code and data as there is no sense to swap anything without ever providing a liquidity.
        {
            proofType: PROOF_NO_PROOF_ATTACHED,
        },
    )
}

const createLiquidityDepositEitherAddress = (
    LPContract: Address,
    liquidityDepositContractData?: {
        otherVaultAddress: Address
        otherAmount: bigint
        id: bigint
    },
) => {
    const eitherData: LiquidityDepositEitherAddress = {
        $$type: "LiquidityDepositEitherAddress",
        eitherBit: false,
        liquidityDepositContract: LPContract,
        initData: null,
    }

    if (typeof liquidityDepositContractData !== "undefined") {
        eitherData.eitherBit = true
        eitherData.liquidityDepositContract = null
        eitherData.initData = {
            $$type: "LiquidityDepositInitData",
            otherVault: liquidityDepositContractData.otherVaultAddress,
            otherAmount: liquidityDepositContractData.otherAmount,
            contractId: liquidityDepositContractData.id,
        }
    }

    return eitherData
}

export function createJettonVaultLiquidityDepositPayload(
    LPContract: Address,
    proofCode: Cell | undefined,
    proofData: Cell | undefined,
    minAmountToDeposit: bigint = 0n,
    lpTimeout: bigint = BigInt(Math.ceil(Date.now() / 1000) + 5 * 60), // 5 minutes
    payloadOnSuccess: Cell | null = null,
    payloadOnFailure: Cell | null = null,
    liquidityDepositContractData?: {
        otherVaultAddress: Address
        otherAmount: bigint
        id: bigint
    },
) {
    let proof: Proof
    if (proofCode !== undefined && proofData !== undefined) {
        proof = {
            proofType: PROOF_STATE_INIT,
            code: proofCode,
            data: proofData,
        }
    } else {
        proof = {
            proofType: PROOF_NO_PROOF_ATTACHED,
        }
    }

    const eitherData: LiquidityDepositEitherAddress = createLiquidityDepositEitherAddress(
        LPContract,
        liquidityDepositContractData,
    )

    return createJettonVaultMessage(
        LPDepositPartOpcode,
        beginCell()
            .store(
                storeLPDepositPart({
                    $$type: "LPDepositPart",
                    liquidityDepositContractData: eitherData,
                    lpTokensReceiver: null,
                    additionalParams: {
                        $$type: "AdditionalParams",
                        minAmountToDeposit: minAmountToDeposit,
                        lpTimeout: lpTimeout,
                        payloadOnSuccess: payloadOnSuccess,
                        payloadOnFailure: payloadOnFailure,
                    },
                }),
            )
            .endCell(),
        proof,
    )
}

export function createTonVaultLiquidityDepositPayload(
    liquidityDepositContractAddress: Address,
    amount: bigint,
    payloadOnSuccess: Cell | null = null,
    payloadOnFailure: Cell | null = null,
    minAmountToDeposit: bigint = 0n,
    lpTimeout: bigint = BigInt(Math.ceil(Date.now() / 1000) + 5 * 60),
    liquidityDepositContractData?: {
        otherVaultAddress: Address
        otherAmount: bigint
        id: bigint
    },
) {
    const eitherData = createLiquidityDepositEitherAddress(
        liquidityDepositContractAddress,
        liquidityDepositContractData,
    )

    return beginCell()
        .store(
            storeAddLiquidityPartTon({
                $$type: "AddLiquidityPartTon",
                amountIn: amount,
                liquidityDepositContractData: eitherData,
                lpTokensReceiver: null,
                additionalParams: {
                    $$type: "AdditionalParams",
                    minAmountToDeposit: minAmountToDeposit,
                    lpTimeout: lpTimeout,
                    payloadOnSuccess: payloadOnSuccess,
                    payloadOnFailure: payloadOnFailure,
                },
            }),
        )
        .endCell()
}

export function createTonSwapRequest(
    pool: Address,
    receiver: Address | null,
    amountIn: bigint,
    isExactOutType: boolean,
    desiredAmount: bigint,
    timeout: bigint = 0n,
    cashbackAddress: Address | null = null,
    payloadOnSuccess: Cell | null = null,
    payloadOnFailure: Cell | null = null,
    nextStep: SwapStep | null = null,
) {
    return beginCell()
        .store(
            storeSwapRequestTon({
                $$type: "SwapRequestTon",
                amount: amountIn,
                action: {
                    $$type: "SwapRequest",
                    pool: pool,
                    receiver: receiver,
                    params: {
                        $$type: "SwapParameters",
                        isExactOutType,
                        cashbackAddress,
                        desiredAmount,
                        payloadOnSuccess,
                        payloadOnFailure,
                        timeout,
                        // Field for specifying the next step in the swap (for cross-pool swaps)
                        nextStep,
                    },
                },
            }),
        )
        .endCell()
}

export function createWithdrawLiquidityBody(
    minAmountLeft: bigint,
    minAmountRight: bigint,
    timeout: bigint,
    receiver: Address,
    successfulPayload: Cell | null,
) {
    return beginCell()
        .store(
            storeLiquidityWithdrawParameters({
                $$type: "LiquidityWithdrawParameters",
                leftAmountMin: minAmountLeft,
                rightAmountMin: minAmountRight,
                receiver,
                timeout,
                liquidityWithdrawPayload: successfulPayload,
            }),
        )
        .endCell()
}

// Coins is a value from 0 to 2^120-1 inclusive.
// https://github.com/ton-blockchain/ton/blob/6f745c04daf8861bb1791cffce6edb1beec62204/crypto/block/block.tlb#L116
export function randomCoins() {
    // 120 bits = 15 bytes
    return BigInt("0x" + randomBytes(15).toString("hex"))
}

export function getComputeGasForTx(tx: BlockchainTransaction) {
    if (tx.description.type !== "generic") {
        throw new Error("Transaction description is not generic, got: " + tx.description.type)
    }
    if (tx.description.computePhase.type !== "vm") {
        throw new Error(
            "Transaction compute phase is not VM, got: " + tx.description.computePhase.type,
        )
    }
    return tx.description.computePhase.gasUsed
}
