//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import {toNano, beginCell} from "@ton/core"
import {Blockchain, SandboxContract, TreasuryContract} from "@ton/sandbox"
import {findTransactionRequired, flattenTransaction, randomAddress} from "@ton/test-utils"
import {
    Factory,
    AmmPoolParams,
    JettonVaultParams,
    storeAmmPoolParams,
    storeJettonVaultParams,
    AmmPoolAddrRequestId,
    LPDepositAddrRequestId,
    loadAddressResponse,
    JettonVaultAddrRequestId,
    LPDepositParams,
    storeLPDepositParams,
    AddressesRequest,
} from "../output/DEX_Factory"
import {AmmPool} from "../output/DEX_AmmPool"
import {LiquidityDepositContract} from "../output/DEX_LiquidityDepositContract"
import {sortAddresses} from "../utils/deployUtils"
import {JettonVault} from "../output/DEX_JettonVault"
import {randomInt} from "crypto"
// eslint-disable-next-line
import {SendDumpToDevWallet} from "@tondevwallet/traces"
import {randomCoins} from "../utils/testUtils"

describe("Factory", () => {
    let factory: SandboxContract<Factory>
    let deployer: SandboxContract<TreasuryContract>

    beforeAll(async () => {
        const blockchain = await Blockchain.create()
        deployer = await blockchain.treasury("deployer")
        factory = blockchain.openContract(await Factory.fromInit())
        const deployResult = await factory.send(deployer.getSender(), {value: toNano("0.05")}, null)
        expect(deployResult.transactions).toHaveTransaction({
            success: true,
            deploy: true,
        })
    })

    test("should calculate correct addresses", async () => {
        // Mock vaults
        const vaultA = randomAddress()
        const vaultB = randomAddress()
        const randomLeftSideAmount = randomCoins()
        const randomRightSideAmount = randomCoins()
        const sortedAddresses = sortAddresses(
            vaultA,
            vaultB,
            BigInt(randomLeftSideAmount),
            BigInt(randomRightSideAmount),
        )

        // Calculate pool address using factory
        const ammPoolParams: AmmPoolParams = {
            $$type: "AmmPoolParams",
            firstVault: vaultA,
            secondVault: vaultB,
        }
        const ammPoolParamsCell = beginCell().store(storeAmmPoolParams(ammPoolParams)).endCell()

        const expectedPoolAddress = (
            await AmmPool.fromInit(sortedAddresses.lower, sortedAddresses.higher, 0n, 0n, 0n, null)
        ).address

        const randomJettonMaster = randomAddress()
        const jettonVaultParams: JettonVaultParams = {
            $$type: "JettonVaultParams",
            jettonMaster: randomJettonMaster,
        }
        const jettonVaultParamsCell = beginCell()
            .store(storeJettonVaultParams(jettonVaultParams))
            .endCell()

        const expectedJettonVaultAddress = (await JettonVault.fromInit(randomJettonMaster, null))
            .address

        const randomLPDepositor = randomAddress()
        const randomContractId = randomInt(0, 281474976710655)
        const lpDepositParams: LPDepositParams = {
            $$type: "LPDepositParams",
            firstVault: vaultA,
            secondVault: vaultB,
            firstAmount: BigInt(randomLeftSideAmount),
            secondAmount: BigInt(randomRightSideAmount),
            lpTokensReceiver: randomLPDepositor,
            contractId: BigInt(randomContractId),
        }

        const expectedLPDepositAddress = (
            await LiquidityDepositContract.fromInit(
                sortedAddresses.lower,
                sortedAddresses.higher,
                sortedAddresses.leftAmount,
                sortedAddresses.rightAmount,
                randomLPDepositor,
                BigInt(randomContractId),
                false,
                false,
                null,
                null,
            )
        ).address

        const lpDepositParamsCell = beginCell()
            .store(storeLPDepositParams(lpDepositParams))
            .endCell()

        const forwardPayload = beginCell().storeStringTail("test").endCell()
        const requestMsg: AddressesRequest = {
            $$type: "AddressesRequest",
            responseAddress: null,
            first: {
                $$type: "Request",
                requestId: AmmPoolAddrRequestId,
                request: ammPoolParamsCell,
            },
            second: {
                $$type: "Request",
                requestId: JettonVaultAddrRequestId,
                request: jettonVaultParamsCell,
            },
            third: {
                $$type: "Request",
                requestId: LPDepositAddrRequestId,
                request: lpDepositParamsCell,
            },
            forwardPayload: forwardPayload,
        }

        const result = await factory.send(deployer.getSender(), {value: toNano("0.05")}, requestMsg)
        // Check that the response contains the correct pool address
        const replyTx = flattenTransaction(
            findTransactionRequired(result.transactions, {
                from: factory.address,
                to: deployer.address,
                op: Factory.opcodes.AddressResponse,
                success: true,
            }),
        )
        if (replyTx.body === undefined) {
            throw new Error("No body in reply transaction")
        }
        const reply = loadAddressResponse(replyTx.body.beginParse())

        expect(reply.first).toEqualAddress(expectedPoolAddress)
        expect(reply.second).toEqualAddress(expectedJettonVaultAddress)
        expect(expectedJettonVaultAddress).toEqualAddress(
            await factory.getJettonVaultAddr(randomJettonMaster),
        )
        expect(reply.third).toEqualAddress(expectedLPDepositAddress)
    })
})
