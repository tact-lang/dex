import {beginCell, storeTransaction, Transaction} from "@ton/core"

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
