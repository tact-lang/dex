//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import {Blockchain, internal} from "@ton/sandbox"
import {createJetton, createTonVault} from "../utils/environment"
import {beginCell, toNano} from "@ton/core"
import {findTransactionRequired, flattenTransaction, randomAddress} from "@ton/test-utils"
import {randomInt} from "node:crypto"
import {loadPayoutFromTonVault, storePayoutFromPool, TonVault} from "../output/DEX_TonVault"
import {AmmPool} from "../output/DEX_AmmPool"
import {sortAddresses} from "../utils/deployUtils"

describe("TON Vault", () => {
    test("Jettons are returned if sent to TON Vault", async () => {
        const blockchain = await Blockchain.create()
        const vaultSetup = await createTonVault(blockchain)

        const _ = await vaultSetup.deploy()
        const mockActionPayload = beginCell().storeStringTail("Random payload").endCell()

        const jetton = await createJetton(blockchain)
        const initialBalance = await jetton.wallet.getJettonBalance()
        const numberOfJettons = BigInt(randomInt(0, 100000000000))
        const sendResult = await jetton.transfer(
            vaultSetup.vault.address,
            numberOfJettons,
            mockActionPayload,
        )

        const toVaultTx = flattenTransaction(
            findTransactionRequired(sendResult.transactions, {
                to: vaultSetup.vault.address,
                op: TonVault.opcodes.UnexpectedJettonNotification,
                success: true, // Because commit was called
                exitCode:
                    TonVault.errors[
                        "TonVault: Jetton transfer must be performed to correct Jetton Vault"
                    ],
            }),
        )

        expect(sendResult.transactions).toHaveTransaction({
            from: vaultSetup.vault.address,
            to: toVaultTx.from,
            op: TonVault.opcodes.ReturnJettonsViaJettonTransfer,
            success: true,
        })
        const finalJettonBalance = await jetton.wallet.getJettonBalance()
        expect(finalJettonBalance).toEqual(initialBalance)
    })
    test("TON Vault successfully transfers swap payload", async () => {
        const blockchain = await Blockchain.create()

        const tonVaultContract = await TonVault.fromInit()
        const openedTonVault = blockchain.openContract(tonVaultContract)
        const deployer = await blockchain.treasury("deployer")
        // Deploy contract
        const deployRes = await openedTonVault.send(
            deployer.getSender(),
            {value: toNano(0.1)},
            null,
        )
        expect(deployRes.transactions).toHaveTransaction({
            on: tonVaultContract.address,
            deploy: true,
        })

        const otherVaultAddress = randomAddress(0)
        const sortedAddresses = sortAddresses(tonVaultContract.address, otherVaultAddress, 0n, 0n)
        const randomAmmPool = await AmmPool.fromInit(
            sortedAddresses.lower,
            sortedAddresses.higher,
            0n,
            0n,
            0n,
            null,
        )
        const tonVaultObject = await blockchain.getContract(tonVaultContract.address)

        const randomReceiver = randomAddress(0)
        const payloadToForward = beginCell()
            .storeStringTail("Random quite big payload. User can encode anything here")
            .endCell()
        const res = await tonVaultObject.receiveMessage(
            internal({
                from: randomAmmPool.address,
                to: tonVaultContract.address,
                value: toNano(0.1),
                body: beginCell()
                    .store(
                        storePayoutFromPool({
                            $$type: "PayoutFromPool",
                            amount: 0n,
                            otherVault: otherVaultAddress,
                            receiver: randomReceiver,
                            payloadToForward: payloadToForward,
                        }),
                    )
                    .endCell(),
            }),
        )
        const flatTx = flattenTransaction(res)
        expect(flatTx.exitCode).toEqual(0)
        expect(flatTx.actionResultCode).toEqual(0)
        expect(res.outMessagesCount).toEqual(1)
        const payoutBody = res.outMessages.get(0)?.body
        expect(payoutBody).toBeDefined()
        const parsedPayout = loadPayoutFromTonVault(payoutBody!.beginParse())
        expect(parsedPayout.$$type).toEqual("PayoutFromTonVault")
        expect(parsedPayout.body).toEqualCell(payloadToForward)
    })
})
