import {Address, beginCell, Builder, Cell} from "@ton/core"
import {
    SwapRequest,
    storeSwapRequest,
    SwapRequestOpcode,
    storeLPDepositPart,
    LPDepositPartOpcode,
    SwapStep,
} from "../output/DEX_AmmPool"
import {
    PROOF_NO_PROOF_ATTACHED,
    PROOF_TEP89,
    PROOF_STATE_INIT,
    storeLiquidityWithdrawParameters,
} from "../output/DEX_JettonVault"
import {storeAddLiquidityPartTon, storeSwapRequestTon} from "../output/DEX_TonVault"

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

export type Proof = NoProof | TEP89Proof | StateInitProof

function storeProof(proof: Proof) {
    return (b: Builder) => {
        b.storeUint(proof.proofType, 8)
        switch (proof.proofType) {
            case PROOF_NO_PROOF_ATTACHED:
                break
            case PROOF_TEP89:
                break
            case PROOF_STATE_INIT:
                b.storeMaybeRef(proof.code)
                b.storeMaybeRef(proof.data)
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
    limit: bigint = 0n,
    timeout: bigint = 0n,
    payloadOnSuccess: Cell | null = null,
    payloadOnFailure: Cell | null = null,
    nextStep: SwapStep | null = null,
) {
    const swapRequest: SwapRequest = {
        $$type: "SwapRequest",
        pool: destinationPool,
        receiver: null,
        isExactOutType: isExactOutType,
        limit: limit,
        timeout: timeout,
        payloadOnSuccess: payloadOnSuccess,
        payloadOnFailure: payloadOnFailure,
        // Field for specifying the next step in the swap (for cross-pool swaps)
        nextStep: nextStep,
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

export function createJettonVaultLiquidityDepositPayload(
    LPContract: Address,
    proofCode: Cell | undefined,
    proofData: Cell | undefined,
    minAmountToDeposit: bigint = 0n,
    lpTimeout: bigint = BigInt(Math.ceil(Date.now() / 1000) + 5 * 60), // 5 minutes
    payloadOnSuccess: Cell | null = null,
    payloadOnFailure: Cell | null = null,
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
    return createJettonVaultMessage(
        LPDepositPartOpcode,
        beginCell()
            .store(
                storeLPDepositPart({
                    $$type: "LPDepositPart",
                    liquidityDepositContract: LPContract,
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
) {
    return beginCell()
        .store(
            storeAddLiquidityPartTon({
                $$type: "AddLiquidityPartTon",
                amountIn: amount,
                liquidityDepositContract: liquidityDepositContractAddress,
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
    receiver: Address,
    amountIn: bigint,
    minAmountOut: bigint = 0n,
    timeout: bigint = 0n,
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
                    isExactOutType: false,
                    limit: minAmountOut,
                    payloadOnFailure: payloadOnFailure,
                    payloadOnSuccess: payloadOnSuccess,
                    timeout: timeout,
                    receiver: receiver,
                    // Field for specifying the next step in the swap (for cross-pool swaps)
                    nextStep: nextStep,
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
