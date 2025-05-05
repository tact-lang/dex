import {Address, beginCell, Builder, Cell, storeTransaction, Transaction} from "@ton/core"
import {
    SwapRequest,
    storeSwapRequest,
    SwapRequestOpcode,
    storeLPDepositPart,
    LPDepositPartOpcode,
} from "../output/DEX_AmmPool"
import {PROOF_NO_PROOF_ATTACHED, PROOF_TEP89, PROOF_STATE_INIT} from "../output/DEX_JettonVault"

const fieldsToSave = ["blockchainLogs", "vmLogs", "debugLogs", "shard", "delay", "totalDelay"]

export function serializeTransactionsList(transactions: any[]): string {
    const dump = {
        transactions: transactions.map(t => {
            const tx = beginCell()
                .store(storeTransaction(t as Transaction))
                .endCell()
                .toBoc()
                .toString("base64")

            return {
                transaction: tx,
                fields: fieldsToSave.reduce((acc: any, f) => {
                    acc[f] = t[f]
                    return acc
                }, {}),
                parentId: t.parent?.lt.toString(),
                childrenIds: t.children?.map((c: any) => c?.lt?.toString()),
            }
        }),
    }
    return JSON.stringify(dump, null, 2)
}

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
    destinationVault: Address,
    minAmountOut: bigint = 0n,
    timeout: bigint = 0n,
    payloadOnSuccess: Cell | null = null,
    payloadOnFailure: Cell | null = null,
) {
    const swapRequest: SwapRequest = {
        $$type: "SwapRequest",
        destinationVault: destinationVault,
        minAmountOut: minAmountOut,
        timeout: timeout,
        payloadOnSuccess: payloadOnSuccess,
        payloadOnFailure: payloadOnFailure,
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
