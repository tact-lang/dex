import {Address, beginCell, Cell, CellType, convertToMerkleProof, toNano} from "@ton/core"
import {Blockchain, BlockId, internal} from "@ton/sandbox"
import {findTransactionRequired, flattenTransaction, randomAddress} from "@ton/test-utils"
import {createJetton, createJettonVault} from "../utils/environment"
// eslint-disable-next-line
import {createJettonVaultMessage} from "../utils/testUtils"
import {JettonVault, PROOF_STATE_TO_THE_BLOCK, storeLPDepositPart} from "../output/DEX_JettonVault"
import {LPDepositPartOpcode} from "../output/DEX_LiquidityDepositContract"
import {PROOF_TEP89, TEP89DiscoveryProxy} from "../output/DEX_TEP89DiscoveryProxy"
import {TonApiClient} from "@ton-api/client"
import {randomInt} from "crypto"

function walk(cell: Cell, depth = 0, path: number[] = [], best: any) {
    if (cell.isExotic && cell.type === CellType.PrunedBranch) {
        if (!best || depth > best.depth) best = {path, depth}
    }
    cell.refs.forEach((c, i) => {
        best = walk(c, depth + 1, [...path, i], best)
    })
    return best
}

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
                    liquidityDepositContract: randomAddress(0), // Mock LP contract address
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
                    liquidityDepositContract: randomAddress(0), // Mock LP contract address
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
            exitCode: JettonVault.errors["JettonVault: Expected and Actual wallets are not equal"],
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
                exitCode: JettonVault.errors["JettonVault: Proof is invalid"],
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
                    liquidityDepositContract: randomAddress(0), // Mock LP contract address
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
                success: true, // Because commit was called
                exitCode: JettonVault.errors["JettonVault: Sender must be jetton wallet"],
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
    test("Simple", async () => {
        const cell = beginCell().storeRef(beginCell().storeStringTail("Hi").endCell()).endCell()
        const hashBefore = cell.hash(0).toString("hex")
        const x = cell.refs[0].hash(0).toString("hex")
        cell.refs[0] = beginCell()
            .storeUint(1, 8)
            .storeUint(1, 8)
            .storeBuffer(cell.refs[0].hash(), 32)
            .storeUint(0, 16)
            .endCell({exotic: true})
        cell.update()
        const middleHash = cell.hash(0).toString("hex")
        console.log(x)
        console.log(cell.refs[0].hash(0).toString("hex"))
        expect(hashBefore).toEqual(middleHash)
    })
    //const toSkipStateProofTest = process.env.TONAPI_KEY === undefined
    //;(toSkipStateProofTest ? test.skip : test)("State proof should work correctly", async () => {
    test("State proof should work correctly", async () => {
        const TONAPI_KEY = process.env.TONAPI_KEY
        if (TONAPI_KEY === undefined) {
            // This will never happen because we skip the test if the key is not set
            throw new Error("TONAPI_KEY is not set. Please set it to run this test.")
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
                    liquidityDepositContract: randomAddress(0), // Mock LP contract address
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
                "(-1,8000000000000000," + (lastSeqno - i) + ")",
            )
            lastMcBlocks.push(convertToBlockId(block))
        }

        blockchain.prevBlocks = {
            lastMcBlocks: lastMcBlocks,
            // Not real prevKeyBlock, but we won't use that so does not matter
            prevKeyBlock: lastMcBlocks[0],
        }

        const blockToProofTo = lastMcBlocks[randomInt(0, 16)]
        const blockToProofToStrId =
            "(-1,8000000000000000," +
            blockToProofTo.seqno +
            "," +
            blockToProofTo.rootHash.toString("hex") +
            "," +
            blockToProofTo.fileHash.toString("hex") +
            ")"

        const accountStateAndProof = await client.liteServer.getRawAccountState(
            jettonMinterToProofStateFor,
            {
                target_block: blockToProofToStrId,
            },
        )

        // We need to merge the account state and proof into a single cell
        const shardBlock = Cell.fromBoc(Buffer.from(accountStateAndProof.proof, "hex"))
        const shardBlockHeaderMerkleProof = shardBlock[0]
        const shardBlockHeader = shardBlockHeaderMerkleProof.refs[0]

        const shardStateMerkleProof = shardBlock[1]

        const hashBefore = shardBlockHeader.hash(0).toString("hex")
        const shardState = shardStateMerkleProof.refs[0]
        expect(shardState.type).toBe(CellType.Ordinary)
        expect(shardState.hash(0)).toEqual(shardBlockHeader.refs[2].refs[1].hash(0))
        console.warn(shardState)
        shardBlockHeader.refs[2].refs[1] = shardState
        shardBlockHeader.refs[2].refs[1].type = CellType.Ordinary
        shardBlockHeader.update(true)
        const hashAfter = shardBlockHeader.hash(0).toString("hex")
        expect(hashBefore).toEqual(hashAfter)

        const newShardBlockHeaderMerkleProof = convertToMerkleProof(shardBlockHeader)

        //const hashAfter = shardBlockHeader.hash(0).toString("hex")
        //expect(hashBefore).toEqual(hashAfter)

        const augHashmapShardAccounts = shardBlockHeader.refs[2].refs[1].refs[1].refs[0]
        const augHashmapShardAccountsHashBefore = augHashmapShardAccounts.hash(0).toString("hex")

        const findDeepestNonPrunedCell = (cell: Cell): Cell => {
            for (const ref of cell.refs) {
                if (!ref.isExotic) {
                    return findDeepestNonPrunedCell(ref)
                }
            }
            if (cell.depth() !== 1) {
                throw Error("Deepest cell is not at depth 1")
            }
            return cell
        }

        const deepestNonPrunedCell = findDeepestNonPrunedCell(augHashmapShardAccounts)
        deepestNonPrunedCell.refs[0] = Cell.fromHex(accountStateAndProof.state).refs[0]
        augHashmapShardAccounts.update()

        const augHashmapShardAccountsHashAfter = augHashmapShardAccounts.hash(0).toString("hex")
        // Our modified augHashmapShardAccounts should have the same hash as before as we only replaced the pruned cell with the actual account state
        expect(augHashmapShardAccountsHashAfter).toEqual(augHashmapShardAccountsHashBefore)

        const shardBlockStrId =
            "(" +
            accountStateAndProof.shardblk.workchain +
            "," +
            accountStateAndProof.shardblk.shard +
            "," +
            accountStateAndProof.shardblk.seqno +
            "," +
            accountStateAndProof.shardblk.rootHash +
            "," +
            accountStateAndProof.shardblk.fileHash +
            ")"
        console.log(shardBlockStrId)
        const mcBlockHeaderProof = await client.liteServer.getRawShardBlockProof(shardBlockStrId)
        console.log(mcBlockHeaderProof)

        const vaultContract = await blockchain.getContract(vault.address)
        const tester = await blockchain.treasury("Proofs equals pain")
        const getMethodResult = await client.blockchain.execGetMethodForBlockchainAccount(
            jettonMinterToProofStateFor,
            "get_wallet_address",
            {
                args: [beginCell().storeAddress(tester.address).endCell().toBoc().toString("hex")],
            },
        )
        if (getMethodResult.stack[0].type !== "cell") {
            throw new Error("Unexpected get-method result type: " + getMethodResult.stack[0].type)
        }
        const jettonWalletAddress = getMethodResult.stack[0].cell.beginParse().loadAddress()

        const test = shardBlockHeaderMerkleProof.toBoc()
        console.log(test.toString("hex"))
        const test2 = Cell.fromBoc(test)[0]
        console.log(test2)

        const receiveNotifyWithStateProof = await vaultContract.receiveMessage(
            internal({
                from: jettonWalletAddress,
                to: vault.address,
                value: toNano(0.5),
                body: createJettonVaultMessage(LPDepositPartOpcode, mockPayload, {
                    proofType: PROOF_STATE_TO_THE_BLOCK,
                    mcBlockSeqno: BigInt(blockToProofTo.seqno),
                    shardBitLen: BigInt(Cell.fromHex(mcBlockHeaderProof.links[0].proof).depth()),
                    mcBlockHeaderProof: Cell.fromHex(mcBlockHeaderProof.links[0].proof),
                    shardBlockHeaderProof: shardBlockHeaderMerkleProof,
                }),
            }),
        )

        // expect(sendNotifyWithStateProof.transactions).toHaveTransaction({
        //     to: vaultSetup.treasury.minter.address,
        //     op: JettonVault.opcodes.ProvideWalletAddress,
        //     success: true,
        // })
        // const replyWithWallet = findTransactionRequired(sendNotifyWithStateProof.transactions, {
        //     from: vaultSetup.treasury.minter.address,
        //     op: JettonVault.opcodes.TakeWalletAddress,
        //     success: true,
        // })
        // const tep89proxyAddress = flattenTransaction(replyWithWallet).to
        // expect(sendNotifyWithStateProof.transactions).toHaveTransaction({
        //     from: tep89proxyAddress,
        //     op: JettonVault.opcodes.TEP89DiscoveryResult,
        //     // As there was a commit() after the proof was validated
        //     success: true,
        //     // However, probably there is not-null exit code, as we attached the incorrect payload
        // })
        // const jettonVaultInstance = blockchain.openContract(
        //     JettonVault.fromAddress(vaultSetup.vault.address),
        // )
        // expect(await jettonVaultInstance.getInited()).toBe(true)
    })
})
