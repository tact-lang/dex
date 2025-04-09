import {Address, beginCell, Cell, storeTransaction, Transaction} from "@ton/core"
import {
    SwapRequest,
    VaultDepositOpcode,
    storeSwapRequest,
    SwapRequestOpcode,
} from "../output/DEX_AmmPool"

const fieldsToSave = ["blockchainLogs", "vmLogs", "debugLogs", "shard", "delay", "totalDelay"]

export function SerializeTransactionsList(transactions: any[]): string {
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
) {
    const swapRequest: SwapRequest = {
        $$type: "SwapRequest",
        destinationVault: destinationVault,
        minAmountOut: minAmountOut,
        timeout: timeout,
    }

    return createJettonVaultMessage(
        SwapRequestOpcode,
        beginCell().store(storeSwapRequest(swapRequest)).endCell(),
        undefined,
        undefined,
    )
}

export function createJettonVaultLiquidityDeposit(
    LPContract: Address,
    proofCode: Cell | undefined,
    proofData: Cell | undefined,
) {
    return createJettonVaultMessage(
        VaultDepositOpcode,
        beginCell().storeAddress(LPContract).endCell(),
        proofCode,
        proofData,
    )
}
