//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import {
    Address,
    beginCell,
    Cell,
    CellType,
    convertToMerkleProof,
    loadAccount,
    toNano,
    TupleBuilder,
} from "@ton/core"
import {Blockchain, BlockId, internal} from "@ton/sandbox"
import {findTransactionRequired, flattenTransaction, randomAddress} from "@ton/test-utils"
import {createJetton, createJettonVault} from "../utils/environment"
// eslint-disable-next-line
import {SendDumpToDevWallet} from "@tondevwallet/traces"
import {createJettonVaultMessage} from "../utils/testUtils"
import {
    JettonVault,
    PROOF_STATE_TO_THE_BLOCK,
    storeJettonNotifyWithActionRequest,
    storeLPDepositPart,
    storeStateProof,
} from "../output/DEX_JettonVault"
import {LPDepositPartOpcode} from "../output/DEX_LiquidityDepositContract"
import {PROOF_TEP89, TEP89DiscoveryProxy} from "../output/DEX_TEP89DiscoveryProxy"
import {TonApiClient} from "@ton-api/client"
import allAccountStateAndProof from "./offline-data/16_last_proofs.json"
import shardBlockProofs from "./offline-data/shardProofs.json"
import {lastMcBlocks} from "./offline-data/last-mc-blocks"
import {randomInt} from "crypto"

// This function finds the path deepest pruned Cell
function walk(cell: Cell, depth = 0, path: number[] = [], best: any) {
    if (cell.isExotic && cell.type === CellType.PrunedBranch) {
        if (!best || depth > best.depth) best = {path, depth}
    }
    cell.refs.forEach((c, i) => {
        best = walk(c, depth + 1, [...path, i], best)
    })
    return best
}

// This function takes the path from the function above and replaces the deepest cell (in the path)
// With the needed cell
function rebuild(cell: Cell, path: number[], replacement: Cell): Cell {
    if (path.length === 0) {
        return replacement
    }

    const idx = path[0]
    const builder = beginCell()
    const slice = cell.beginParse()
    builder.storeBits(slice.loadBits(slice.remainingBits))

    cell.refs.forEach((r, i) => {
        builder.storeRef(i === idx ? rebuild(r, path.slice(1), replacement) : r)
    })
    return builder.endCell({exotic: cell.isExotic})
}

describe("Proofs", () => {
    test("TEP89 proof should correctly work for discoverable jettons", async () => {
        const blockchain = await Blockchain.create()
        // Our Jettons, used when creating the vault support TEP-89
        const vaultSetup = await createJettonVault(blockchain)

        const _ = await vaultSetup.deploy()
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

        const sendNotifyWithTep89Proof = await vaultSetup.treasury.transfer(
            vaultSetup.vault.address,
            toNano(0.5),
            createJettonVaultMessage(
                // We can use any Jetton Vault opcode here because we don't need an actual operation here
                LPDepositPartOpcode,
                mockPayload,
                {
                    proofType: PROOF_TEP89,
                },
            ),
        )
        expect(sendNotifyWithTep89Proof.transactions).toHaveTransaction({
            to: vaultSetup.treasury.minter.address,
            op: JettonVault.opcodes.ProvideWalletAddress,
            success: true,
        })
        const replyWithWallet = findTransactionRequired(sendNotifyWithTep89Proof.transactions, {
            from: vaultSetup.treasury.minter.address,
            op: JettonVault.opcodes.TakeWalletAddress,
            success: true,
        })
        const tep89proxyAddress = flattenTransaction(replyWithWallet).to
        expect(sendNotifyWithTep89Proof.transactions).toHaveTransaction({
            from: tep89proxyAddress,
            op: JettonVault.opcodes.TEP89DiscoveryResult,
            // As there was a commit() after the proof was validated
            success: true,
            // However, probably there is not-null exit code, as we attached the incorrect payload
        })
        const jettonVaultInstance = blockchain.openContract(
            JettonVault.fromAddress(vaultSetup.vault.address),
        )
        expect(await jettonVaultInstance.getInited()).toBe(true)
    })

    test("Jettons are returned if TEP89 proof fails if wrong jetton sent", async () => {
        const blockchain = await Blockchain.create()
        // Our Jettons, used when creating the vault support TEP-89
        const vaultSetup = await createJettonVault(blockchain)

        const _ = await vaultSetup.deploy()
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

        // Create different Jetton and send it to the vault
        const differentJetton = await createJetton(blockchain)

        const initialJettonBalance = await differentJetton.wallet.getJettonBalance()

        const sendNotifyFromIncorrectWallet = await differentJetton.transfer(
            vaultSetup.vault.address,
            toNano(0.5),
            createJettonVaultMessage(
                // We can use any Jetton Vault opcode here because we don't need an actual operation here
                LPDepositPartOpcode,
                mockPayload,
                {
                    proofType: PROOF_TEP89,
                },
            ),
        )

        // Vault deployed proxy that asked JettonMaster for the wallet address
        expect(sendNotifyFromIncorrectWallet.transactions).toHaveTransaction({
            to: vaultSetup.treasury.minter.address,
            op: TEP89DiscoveryProxy.opcodes.ProvideWalletAddress,
            success: true,
        })
        // Jetton Master replied with the correct wallet address
        const replyWithWallet = findTransactionRequired(
            sendNotifyFromIncorrectWallet.transactions,
            {
                from: vaultSetup.treasury.minter.address,
                op: JettonVault.opcodes.TakeWalletAddress,
                success: true,
            },
        )
        const tep89proxyAddress = flattenTransaction(replyWithWallet).to

        expect(sendNotifyFromIncorrectWallet.transactions).toHaveTransaction({
            from: tep89proxyAddress,
            op: JettonVault.opcodes.TEP89DiscoveryResult,
            success: true, // Because commit was called
            exitCode:
                JettonVault.errors[
                    "JettonVault: Expected and Actual wallets are not equal or gas for action is not enough"
                ],
        })

        expect(await vaultSetup.isInited()).toBe(false)
        const finalJettonBalance = await differentJetton.wallet.getJettonBalance()
        expect(finalJettonBalance).toEqual(initialJettonBalance)
    })
    test("Jettons are returned if proof type is incorrect", async () => {
        const blockchain = await Blockchain.create()
        const vaultSetup = await createJettonVault(blockchain)

        const _ = await vaultSetup.deploy()
        const mockActionPayload = beginCell()
            .storeStringTail("Random action that does not mean anything")
            .endCell()

        const initialJettonBalance = await vaultSetup.treasury.wallet.getJettonBalance()

        const sendNotifyWithNoProof = await vaultSetup.treasury.transfer(
            vaultSetup.vault.address,
            toNano(0.5),
            createJettonVaultMessage(
                // We can use any Jetton Vault opcode here because we don't need an actual operation here
                LPDepositPartOpcode,
                mockActionPayload,
                {
                    proofType: 0n, // No proof attached
                },
            ),
        )

        const toVaultTx = flattenTransaction(
            findTransactionRequired(sendNotifyWithNoProof.transactions, {
                to: vaultSetup.vault.address,
                op: JettonVault.opcodes.JettonNotifyWithActionRequest,
                success: true, // Because commit was called
                exitCode: JettonVault.errors["JettonVault: Unsupported proof type"],
            }),
        )

        expect(sendNotifyWithNoProof.transactions).toHaveTransaction({
            from: vaultSetup.vault.address,
            to: toVaultTx.from,
            op: JettonVault.opcodes.JettonTransfer,
            success: true,
        })

        expect(await vaultSetup.isInited()).toBe(false)
        const finalJettonBalance = await vaultSetup.treasury.wallet.getJettonBalance()
        expect(finalJettonBalance).toEqual(initialJettonBalance)
    })

    test("Jettons are returned if sent to wrong vault", async () => {
        const blockchain = await Blockchain.create()
        // Create and set up a correct jetton vault
        const vaultSetup = await createJettonVault(blockchain)
        const _ = await vaultSetup.deploy()

        // Create a different jetton (wrong one) for testing
        const wrongJetton = await createJetton(blockchain)

        // Get the initial balance of the wrong jetton wallet
        const initialWrongJettonBalance = await wrongJetton.wallet.getJettonBalance()

        // Create a mock payload to use with the transfer
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

        // Number of jettons to send to the wrong vault
        const amountToSend = toNano(0.5)

        // First, we need to initialize the vault with the correct jettons
        const _initVault = await vaultSetup.treasury.transfer(
            vaultSetup.vault.address,
            amountToSend,
            createJettonVaultMessage(
                // We can use any Jetton Vault opcode here because we don't need an actual operation here
                LPDepositPartOpcode,
                mockPayload,
                {
                    proofType: PROOF_TEP89,
                },
            ),
        )
        expect(await vaultSetup.isInited()).toBeTruthy()

        // Send wrong Jetton to the vault
        const sendJettonsToWrongVault = await wrongJetton.transfer(
            vaultSetup.vault.address,
            amountToSend,
            createJettonVaultMessage(LPDepositPartOpcode, mockPayload, {
                proofType: PROOF_TEP89,
            }),
        )

        // Verify that the transaction to the vault has occurred but failed due to the wrong jetton
        const toVaultTx = flattenTransaction(
            findTransactionRequired(sendJettonsToWrongVault.transactions, {
                to: vaultSetup.vault.address,
                op: JettonVault.opcodes.JettonNotifyWithActionRequest,
                success: true, // Because commit() was called
                exitCode:
                    JettonVault.errors[
                        "JettonVault: Sender must be jetton wallet or too low gas for action"
                    ],
            }),
        )

        // Check that the jettons were sent back to the original wallet
        expect(sendJettonsToWrongVault.transactions).toHaveTransaction({
            from: vaultSetup.vault.address,
            to: toVaultTx.from,
            op: JettonVault.opcodes.JettonTransfer,
            success: true,
        })

        expect(await vaultSetup.isInited()).toBeTruthy()

        // Verify that the balance of the wrong jetton wallet is unchanged (jettons returned)
        const finalWrongJettonBalance = await wrongJetton.wallet.getJettonBalance()
        expect(finalWrongJettonBalance).toEqual(initialWrongJettonBalance)
    })

    test("State proof should work correctly", async () => {
        const blockchain = await Blockchain.create()

        const jettonMinterToProofStateFor = Address.parse(
            "EQBlqsm144Dq6SjbPI4jjZvA1hqTIP3CvHovbIfW_t-SCALE",
        )
        const cs = Cell.fromHex(
            "b5ee9c7201021e0100057a000271c0065aac9b5e380eae928db3c8e238d9bc0d61a9320fdc2bc7a2f6c87d6fedf920823c89d70341ec66380000d27a68e9dd09404e9342a6d34001020114ff00f4a413f4bcf2c80b03025173b4555c113bad1801910d90954876876fd726d613ca31157ce1b1460c00f71e4c535b99d001cba6b10b0c02016204050202cc060702037a60090a01ddd9910e38048adf068698180b8d848adf07d201800e98fe99ff6a2687d007d206a6a18400aa9385d471a1a9a80e00079702428a26382f97024fd207d006a18106840306b90fd001812081a282178042a906428027d012c678b666664f6aa7041083deecbef0bdd71812f83c207f9784080093dfc142201b82a1009aa0a01e428027d012c678b00e78b666491646580897a007a00658064907c80383a6465816503e5ffe4e83bc00c646582ac678b28027d0109e5b589666664b8fd80400fc03fa00fa40f82854120870542013541403c85004fa0258cf1601cf16ccc922c8cb0112f400f400cb00c9f9007074c8cb02ca07cbffc9d05008c705f2e04a12a1035024c85004fa0258cf16ccccc9ed5401fa403020d70b01c3008e1f8210d53276db708010c8cb055003cf1622fa0212cb6acb1fcb3fc98042fb00915be2007dadbcf6a2687d007d206a6a183618fc1400b82a1009aa0a01e428027d012c678b00e78b666491646580897a007a00658064fc80383a6465816503e5ffe4e8400023af16f6a2687d007d206a6a1811e0002a9040006c01697066733a2f2f516d6565625a6d3473436d5847644d39696944385474594479517779466133446d323768786f6e565179465434500114ff00f4a413f4bcf2c80b0d0201620e0f0202cc1011001ba0f605da89a1f401f481f481a8610201d41213020148141500bb0831c02497c138007434c0c05c6c2544d7c0fc02f83e903e900c7e800c5c75c87e800c7e800c00b4c7e08403e29fa954882ea54c4d167c0238208405e3514654882ea58c511100fc02780d60841657c1ef2ea4d67c02b817c12103fcbc2000113e910c1c2ebcb8536002012016170201201c1d01f500f4cffe803e90087c007b51343e803e903e90350c144da8548ab1c17cb8b04a30bffcb8b0950d109c150804d50500f214013e809633c58073c5b33248b232c044bd003d0032c032483e401c1d3232c0b281f2fff274013e903d010c7e801de0063232c1540233c59c3e8085f2dac4f3208405e351467232c7c6601803f73b51343e803e903e90350c0234cffe80145468017e903e9014d6f1c1551cdb5c150804d50500f214013e809633c58073c5b33248b232c044bd003d0032c0327e401c1d3232c0b281f2fff274140371c1472c7cb8b0c2be80146a2860822625a020822625a004ad822860822625a028062849f8c3c975c2c070c008e0191a1b009acb3f5007fa0222cf165006cf1625fa025003cf16c95005cc2391729171e25008a813a08208989680aa008208989680a0a014bcf2e2c504c98040fb001023c85004fa0258cf1601cf16ccc9ed5400705279a018a182107362d09cc8cb1f5230cb3f58fa025007cf165007cf16c9718018c8cb0524cf165006fa0215cb6a14ccc971fb0010241023000e10491038375f040076c200b08e218210d53276db708010c8cb055008cf165004fa0216cb6a12cb1f12cb3fc972fb0093356c21e203c85004fa0258cf1601cf16ccc9ed5400db3b51343e803e903e90350c01f4cffe803e900c145468549271c17cb8b049f0bffcb8b0a0822625a02a8005a805af3cb8b0e0841ef765f7b232c7c572cfd400fe8088b3c58073c5b25c60063232c14933c59c3e80b2dab33260103ec01004f214013e809633c58073c5b3327b55200083200835c87b51343e803e903e90350c0134c7e08405e3514654882ea0841ef765f784ee84ac7cb8b174cfcc7e800c04e81408f214013e809633c58073c5b3327b5520",
        ).beginParse()
        cs.skip(1)
        await blockchain.setShardAccount(jettonMinterToProofStateFor, {
            account: loadAccount(cs),
            lastTransactionLt: 57855797000001n,
            lastTransactionHash:
                0xb859ff3a641d8d1ecf778facdeeb1676c36c189ede0d3532eefe966d328f6002n,
        })

        const vault = blockchain.openContract(
            await JettonVault.fromInit(jettonMinterToProofStateFor, null),
        )

        const deployRes = await vault.send(
            (await blockchain.treasury("Proofs equals pain")).getSender(),
            {value: toNano(0.1), bounce: false},
            null,
        )
        expect(deployRes.transactions).toHaveTransaction({
            on: vault.address,
            deploy: true,
        })

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

        blockchain.prevBlocks = {
            lastMcBlocks: lastMcBlocks,
            // Not real prevKeyBlock, but we won't use that so does not matter
            prevKeyBlock: lastMcBlocks[0],
        }

        for (let blockNum = 0; blockNum < 16; ++blockNum) {
            const blockToProofTo = lastMcBlocks[blockNum]
            const accountStateAndProof = allAccountStateAndProof[blockNum]

            const proofs = Cell.fromBoc(Buffer.from(accountStateAndProof.proof, "hex"))

            const scBlockProof = proofs[0]
            const newShardStateProof = proofs[1]
            const newShardState = newShardStateProof.refs[0]
            const accountState = Cell.fromHex(accountStateAndProof.state)

            const {path} = walk(newShardState, 0, [], null) // Find the deepest pruned branch cell
            const patchedShardState = rebuild(newShardState, path, accountState) // And replace it with the actual account state

            expect(newShardState.hash(0).toString("hex")).toEqual(
                patchedShardState.hash(0).toString("hex"),
            )

            const shardBlockProof = shardBlockProofs[blockNum]
            const tester = await blockchain.treasury("Proofs equals pain")
            const jettonMasterProvider = blockchain.provider(jettonMinterToProofStateFor)

            const builder = new TupleBuilder()
            builder.writeAddress(vault.address)
            const getMethodResult = await jettonMasterProvider.get(
                "get_wallet_address",
                builder.build(),
            )
            const jettonWalletAddress = getMethodResult.stack.readAddress()

            const vaultContract = await blockchain.getContract(vault.address)

            const _res = await vaultContract.receiveMessage(
                internal({
                    from: jettonWalletAddress,
                    to: vault.address,
                    value: toNano(0.5),
                    body: beginCell()
                        .store(
                            storeJettonNotifyWithActionRequest({
                                $$type: "JettonNotifyWithActionRequest",
                                queryId: 0n,
                                sender: tester.address,
                                // Amount doesn't matter
                                amount: 100n,
                                eitherBit: false,
                                actionOpcode: LPDepositPartOpcode,
                                actionPayload: mockPayload,
                                proofType: PROOF_STATE_TO_THE_BLOCK,
                                proof: beginCell()
                                    .store(
                                        storeStateProof({
                                            $$type: "StateProof",
                                            mcBlockSeqno: BigInt(blockToProofTo.seqno),
                                            shardBitLen: BigInt(
                                                Cell.fromHex(
                                                    shardBlockProof.links[0].proof,
                                                ).depth() - 6,
                                                // Subtracting 6 be unobvious, but actually what we need here is the depth of BinTree here
                                                // _ (HashmapE 32 ^(BinTree ShardDescr)) = ShardHashes;
                                                // But shardBlockProof.links[0].proof is Merkle proof made of a masterchain block
                                            ),
                                            mcBlockHeaderProof: Cell.fromHex(
                                                shardBlockProof.links[0].proof,
                                            ),
                                            shardBlockHeaderProof: scBlockProof,
                                            shardChainStateProof:
                                                convertToMerkleProof(patchedShardState),
                                        }),
                                    )
                                    .asSlice(),
                            }),
                        )
                        .endCell(),
                }),
            )
            // We only need to test that the vault has been successfully initialized.
            // Moreover, it is a sufficient check because we do not trust any data from the message and validate everything via hashes
            expect(await vault.getInited()).toBe(true)
        }
    })

    // This test checks exactly the same as the previous one, but it uses real fresh data from the blockchain
    // It is skipped as it needs TONAPI_KEY to work
    // And it is much slower than the previous one
    test.skip("State proof should work correctly if constructed in real time", async () => {
        const TONAPI_KEY = process.env.TONAPI_KEY
        if (TONAPI_KEY === undefined) {
            throw Error("TONAPI_KEY is not set. Please set it to run this test.")
        }
        const blockchain = await Blockchain.create()
        const jettonMinterToProofStateFor = Address.parse(
            "EQBlqsm144Dq6SjbPI4jjZvA1hqTIP3CvHovbIfW_t-SCALE",
        )

        const vault = blockchain.openContract(
            await JettonVault.fromInit(jettonMinterToProofStateFor, null),
        )

        const deployRes = await vault.send(
            (await blockchain.treasury("Proofs equals pain")).getSender(),
            {value: toNano(0.1), bounce: false},
            null,
        )
        expect(deployRes.transactions).toHaveTransaction({
            on: vault.address,
            deploy: true,
        })

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

        const client = new TonApiClient({
            apiKey: TONAPI_KEY,
        })
        const lastTestnetBlocksId = await client.blockchain.getBlockchainMasterchainHead()
        const lastSeqno = lastTestnetBlocksId.seqno

        const convertToBlockId = (
            from: Awaited<ReturnType<typeof client.blockchain.getBlockchainBlock>>,
        ): BlockId => {
            return {
                workchain: from.workchainId,
                shard: BigInt("0x" + from.shard),
                seqno: from.seqno,
                rootHash: Buffer.from(from.rootHash, "hex"),
                fileHash: Buffer.from(from.fileHash, "hex"),
            }
        }
        // We need to fetch the last 16 blocks and pass them to the emulation
        const lastMcBlocks: BlockId[] = []
        for (let i = 0; i < 16; i++) {
            const block = await client.blockchain.getBlockchainBlock(
                `(-1,8000000000000000,${lastSeqno - i})`,
            )
            lastMcBlocks.push(convertToBlockId(block))
        }

        blockchain.prevBlocks = {
            lastMcBlocks: lastMcBlocks,
            // Not real prevKeyBlock, but we won't use that so does not matter
            prevKeyBlock: lastMcBlocks[0],
        }

        const blockToProofTo = lastMcBlocks[randomInt(0, 16)]
        const blockToProofToStrId = `(-1,8000000000000000,${blockToProofTo.seqno},${blockToProofTo.rootHash.toString("hex")},${blockToProofTo.fileHash.toString("hex")})`

        const accountStateAndProof = await client.liteServer.getRawAccountState(
            jettonMinterToProofStateFor,
            {
                target_block: blockToProofToStrId,
            },
        )

        const proofs = Cell.fromBoc(Buffer.from(accountStateAndProof.proof, "hex"))

        const scBlockProof = proofs[0]
        const newShardStateProof = proofs[1]
        const newShardState = newShardStateProof.refs[0]
        const accountState = Cell.fromHex(accountStateAndProof.state)

        const {path} = walk(newShardState, 0, [], null) // Find the deepest pruned branch cell
        const patchedShardState = rebuild(newShardState, path, accountState) // And replace it with the actual account state

        expect(newShardState.hash(0).toString("hex")).toEqual(
            patchedShardState.hash(0).toString("hex"),
        )

        const shardBlockStrId = `(${accountStateAndProof.shardblk.workchain},${accountStateAndProof.shardblk.shard},${accountStateAndProof.shardblk.seqno},${accountStateAndProof.shardblk.rootHash},${accountStateAndProof.shardblk.fileHash})`
        const shardBlockProof = await client.liteServer.getRawShardBlockProof(shardBlockStrId)

        const tester = await blockchain.treasury("Proofs equals pain")
        const getMethodResult = await client.blockchain.execGetMethodForBlockchainAccount(
            jettonMinterToProofStateFor,
            "get_wallet_address",
            {
                args: [beginCell().storeAddress(vault.address).endCell().toBoc().toString("hex")],
            },
        )
        if (getMethodResult.stack[0].type !== "cell") {
            throw new Error("Unexpected get-method result type: " + getMethodResult.stack[0].type)
        }
        const jettonWalletAddress = getMethodResult.stack[0].cell.beginParse().loadAddress()

        const vaultContract = await blockchain.getContract(vault.address)
        //blockchain.verbosity.vmLogs = "vm_logs_verbose"
        const _res = await vaultContract.receiveMessage(
            internal({
                from: jettonWalletAddress,
                to: vault.address,
                value: toNano(0.5),
                body: beginCell()
                    .store(
                        storeJettonNotifyWithActionRequest({
                            $$type: "JettonNotifyWithActionRequest",
                            queryId: 0n,
                            sender: tester.address,
                            // Amount doesn't matter
                            amount: 100n,
                            eitherBit: false,
                            actionOpcode: LPDepositPartOpcode,
                            actionPayload: mockPayload,
                            proofType: PROOF_STATE_TO_THE_BLOCK,
                            proof: beginCell()
                                .store(
                                    storeStateProof({
                                        $$type: "StateProof",
                                        mcBlockSeqno: BigInt(blockToProofTo.seqno),
                                        shardBitLen: BigInt(
                                            Cell.fromHex(shardBlockProof.links[0].proof).depth() -
                                                6,
                                            // Subtracting 6 be unobvious, but actually what we need here is the depth of BinTree here
                                            // _ (HashmapE 32 ^(BinTree ShardDescr)) = ShardHashes;
                                            // But shardBlockProof.links[0].proof is Merkle proof made of a masterchain block
                                        ),
                                        mcBlockHeaderProof: Cell.fromHex(
                                            shardBlockProof.links[0].proof,
                                        ),
                                        shardBlockHeaderProof: scBlockProof,
                                        shardChainStateProof:
                                            convertToMerkleProof(patchedShardState),
                                    }),
                                )
                                .asSlice(),
                        }),
                    )
                    .endCell(),
            }),
        )

        // We only need to test that the vault has been successfully initialized.
        // Moreover, it is a sufficient check because we do not trust any data from the message and validate everything via hashes
        expect(await vault.getInited()).toBe(true)
    })
})
