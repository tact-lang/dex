//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import "dotenv/config"
import {beginCell, toNano, TonClient, WalletContractV4, internal} from "@ton/ton"
import {getHttpEndpoint} from "@orbs-network/ton-access"
import {mnemonicToPrivateKey} from "@ton/crypto"
import {ExtendedJettonMinter} from "../wrappers/ExtendedJettonMinter"
import {buildOnchainMetadata, sortAddresses} from "../utils/deployUtils"
import {
    JettonNotifyWithActionRequest,
    JettonVault,
    PROOF_TEP89,
    storeLPDepositPart,
} from "../output/DEX_JettonVault"
import {LiquidityDepositContract, LPDepositPartOpcode} from "../output/DEX_LiquidityDepositContract"
import {ExtendedJettonWallet} from "../wrappers/ExtendedJettonWallet"
import {storeJettonTransfer} from "../output/Jetton_JettonMinter"
import {createJettonVaultLiquidityDepositPayload} from "../utils/testUtils"
import {AmmPool} from "../output/DEX_AmmPool"
import {Factory} from "../output/DEX_Factory"
import {TonVault} from "../output/DEX_TonVault"
import {randomAddress} from "@ton/test-utils"
import {Cell} from "@ton/core"

const main = async () => {
    const mnemonics = process.env.MNEMONICS
    if (mnemonics === undefined) {
        throw new Error("MNEMONICS is not set")
    }
    const network = "testnet"
    const endpoint = await getHttpEndpoint({network})
    const client = new TonClient({
        endpoint: endpoint,
    })
    const keyPair = await mnemonicToPrivateKey(mnemonics.split(" "))
    const secretKey = keyPair.secretKey
    const workchain = 0 //we are working in basechain.
    const deployerWalletContract = WalletContractV4.create({
        workchain: workchain,
        publicKey: keyPair.publicKey,
    })
    const deployerWallet = client.open(deployerWalletContract)

    const factoryContract = await Factory.fromInit()
    console.log("Factory deployed at", factoryContract.address)
    const factory = client.open(factoryContract)
    await factory.send(deployerWallet.sender(keyPair.secretKey), {value: toNano(0.05)}, null)

    const jettonParamsA = {
        name: "TactTokenA",
        description: "This is description of Jetton, written in Tact-lang",
        symbol: "A",
        image: "https://raw.githubusercontent.com/tact-lang/tact/refs/heads/main/docs/public/logomark-light.svg",
    }
    //Mint Token A
    const jettonMinterAContract = await ExtendedJettonMinter.fromInit(
        0n,
        deployerWallet.address,
        buildOnchainMetadata(jettonParamsA),
    )
    const jettonMinterACode = jettonMinterAContract.init?.code
    const jettonMinterAData = jettonMinterAContract.init?.data
    const jettonMinterA = client.open(jettonMinterAContract)

    // await jettonMinterA.sendMint(
    //     deployerWallet.sender(keyPair.secretKey),
    //     deployerWallet.address,
    //     toNano(2000000000),
    //     0n,
    //     toNano(0.05)
    // )
    console.log("Minted Token A", jettonMinterA.address.toString())

    const tonVaultContract = await TonVault.fromInit()
    const _tonVault = client.open(tonVaultContract)
    // const deployResult = await tonVault.send(
    //     deployerWallet.sender(keyPair.secretKey),
    //     {value: toNano(0.05)},
    //     null,
    // )
    // console.log("Ton Vault deployed at", tonVault.address)

    const jettonParamsB = {
        name: "TactTokenB",
        description: "This is description of Jetton, written in Tact-lang",
        symbol: "B",
        image: "https://raw.githubusercontent.com/tact-lang/tact/refs/heads/main/docs/public/logomark-light.svg",
    }

    //Mint Token B
    const jettonMinterBContract = await ExtendedJettonMinter.fromInit(
        0n,
        deployerWallet.address,
        buildOnchainMetadata(jettonParamsB),
    )
    const jettonMinterBCode = jettonMinterBContract.init?.code
    const jettonMinterBData = jettonMinterBContract.init?.data
    const jettonMinterB = client.open(jettonMinterBContract)

    // await jettonMinterB.sendMint(
    //     deployerWallet.sender(keyPair.secretKey),
    //     deployerWallet.address,
    //     toNano(2000000000),
    //     0n,
    //     toNano(0.05)
    // )
    console.log("Minted Token B")

    const jettonVaultAContract = await JettonVault.fromInit(jettonMinterA.address, null)
    const jettonVaultA = client.open(jettonVaultAContract)
    console.log("Jetton Vault A deployed at", jettonVaultA.address)

    const mockPayload = beginCell()
        .store(
            storeLPDepositPart({
                $$type: "LPDepositPart",
                liquidityDepositContractData: {
                    $$type: "LiquidityDepositEitherAddress",
                    eitherBit: false,
                    liquidityDepositContract: randomAddress(0), // Mock LP contract address
                    initData: null,
                },
                lpTokensReceiver: null,
                additionalParams: {
                    $$type: "AdditionalParams",
                    minAmountToDeposit: 0n,
                    lpTimeout: 0n,
                    payloadOnSuccess: null,
                    payloadOnFailure: null,
                },
            }),
        )
        .endCell()

    const msg: JettonNotifyWithActionRequest = {
        $$type: "JettonNotifyWithActionRequest",
        queryId: 0n,
        amount: 0n,
        sender: randomAddress(0),
        eitherBit: false,
        actionOpcode: LPDepositPartOpcode,
        actionPayload: mockPayload,
        proofType: PROOF_TEP89,
        proof: new Cell().asSlice(),
    }
    await jettonVaultA.send(deployerWallet.sender(keyPair.secretKey), {value: toNano(0.05)}, msg)

    process.exit(0)

    const jettonVaultBContract = await JettonVault.fromInit(jettonMinterB.address, null)
    const jettonVaultB = client.open(jettonVaultBContract)
    console.log("Jetton Vault B deployed at", jettonVaultB.address)
    // await jettonVaultB.send(
    //     deployerWallet.sender(keyPair.secretKey),
    //     {value: toNano(0.05)},
    //     null
    // )

    const sortedAddresses = sortAddresses(jettonVaultA.address, jettonVaultB.address, 0n, 0n)

    const poolContract = await AmmPool.fromInit(
        sortedAddresses.lower,
        sortedAddresses.higher,
        0n,
        0n,
        0n,
        null,
    )
    const pool = client.open(poolContract)

    // await pool.send(
    //     deployerWallet.sender(keyPair.secretKey),
    //     {value: toNano(0.05)},
    //     null
    // )
    // process.exit(0)
    console.log("Amm Pool deployed at", pool.address)

    const amountLeft = 1n
    const amountRight = 1n
    const LPproviderContract = await LiquidityDepositContract.fromInit(
        sortedAddresses.lower,
        sortedAddresses.higher,
        amountLeft,
        amountRight,
        deployerWallet.address,
        0n,
        false,
        false,
        null,
        null,
    )
    const LPprovider = client.open(LPproviderContract)

    // await LPprovider.send(
    //     deployerWallet.sender(keyPair.secretKey),
    //     {value: toNano(0.05)},
    //     null
    // )
    // process.exit(0)

    console.log("Liquidity Provider deployed at", LPprovider.address)

    const walletA = client.open(
        await ExtendedJettonWallet.fromInit(0n, deployerWallet.address, jettonMinterA.address),
    )
    const walletB = client.open(
        await ExtendedJettonWallet.fromInit(0n, deployerWallet.address, jettonMinterB.address),
    )

    const transferA = beginCell()
        .store(
            storeJettonTransfer({
                $$type: "JettonTransfer",
                queryId: 0n,
                amount: amountLeft,
                destination: jettonVaultA.address,
                responseDestination: deployerWallet.address,
                customPayload: null,
                forwardTonAmount: toNano(0.5),
                forwardPayload: createJettonVaultLiquidityDepositPayload(
                    LPprovider.address,
                    jettonMinterACode!!,
                    jettonMinterAData!!,
                ).beginParse(),
            }),
        )
        .endCell()

    const transferB = beginCell()
        .store(
            storeJettonTransfer({
                $$type: "JettonTransfer",
                queryId: 0n,
                amount: amountRight,
                destination: jettonVaultB.address,
                responseDestination: deployerWallet.address,
                customPayload: null,
                forwardTonAmount: toNano(0.5),
                forwardPayload: createJettonVaultLiquidityDepositPayload(
                    LPprovider.address,
                    jettonMinterBCode!!,
                    jettonMinterBData!!,
                ).beginParse(),
            }),
        )
        .endCell()

    const seqno = await deployerWallet.getSeqno()
    await deployerWallet.sendTransfer({
        seqno,
        secretKey,
        messages: [
            internal({
                to: walletA.address,
                value: toNano(0.6),
                init: {
                    code: walletA.init?.code,
                    data: walletA.init?.data,
                },
                body: transferA,
            }),
            internal({
                to: walletB.address,
                value: toNano(0.6),
                init: {
                    code: walletB.init?.code,
                    data: walletB.init?.data,
                },
                body: transferB,
            }),
        ],
    })
}
void main()
