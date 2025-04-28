import {Address, beginCell, Cell, storeTransaction, Transaction} from "@ton/core"
import {
    SwapRequest,
    storeSwapRequest,
    SwapRequestOpcode,
    storeLPDepositPart,
    LPDepositPartOpcode,
} from "../output/DEX_AmmPool"

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

function createJettonVaultMessage(
    opcode: bigint,
    payload: Cell,
    proofCode: Cell | undefined,
    proofData: Cell | undefined,
) {
    return beginCell()
        .storeUint(0, 1) // Either bit
        .storeMaybeRef(proofCode)
        .storeMaybeRef(proofData)
        .storeUint(opcode, 32)
        .storeRef(payload)
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
        undefined,
        undefined,
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
        proofCode,
        proofData,
    )
}
