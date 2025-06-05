import {toNano, beginCell} from "@ton/core"
import {Blockchain, BlockId} from "@ton/sandbox"
import {findTransactionRequired, flattenTransaction, randomAddress} from "@ton/test-utils"
import {createJettonVault, createJetton} from "../utils/environment"
// eslint-disable-next-line
import {SendDumpToDevWallet} from "@tondevwallet/traces"
import {createJettonVaultMessage} from "../utils/testUtils"
import {JettonVault, PROOF_STATE_TO_THE_BLOCK, storeLPDepositPart} from "../output/DEX_JettonVault"
import {LPDepositPartOpcode} from "../output/DEX_LiquidityDepositContract"
import {PROOF_TEP89, TEP89DiscoveryProxy} from "../output/DEX_TEP89DiscoveryProxy"
import {TonClient4} from "@ton/ton"
import {randomInt} from "crypto"
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
    const toSkipStateProofTest = process.env.TESTNET_TONCENTER_KEY === undefined;
    (toSkipStateProofTest ? test.skip : test)("State proof should work correctly", async () => {
        const TESTNET_TONCENTER_KEY = process.env.TESTNET_TONCENTER_KEY;
        if (TESTNET_TONCENTER_KEY === undefined) {
            // This will never happen because we skip the test if the key is not set
            throw new Error("Test failure");
        }
        const blockchain = await Blockchain.create()
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

        const client = new TonClient4({
            endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
        });
        const lastTestnetBlocksId = await client.getLastBlock();
        const lastSeqno = lastTestnetBlocksId.last.seqno;

        const convertBlockId = (from: Awaited<ReturnType<typeof client.getBlock>>): BlockId => {
            const mcBlock = from.shards.find(shard => shard.workchain === -1);
            if (mcBlock === undefined) {
                throw new Error("Masterchain block not found in the response");
            }
            return {
                workchain: mcBlock.workchain,
                shard: BigInt("0x" + mcBlock.shard),
                seqno: mcBlock.seqno,
                rootHash: Buffer.from(mcBlock.rootHash, "hex"),
                fileHash: Buffer.from(mcBlock.fileHash, "hex"),
            }
        }
        // We need to fetch the last 16 blocks and pass them to the emulation
        const lastMcBlocks: BlockId[] = []
        for (let i = 0; i < 16; i++) {
            const block = await client.getBlock(lastSeqno - i);
            lastMcBlocks.push(convertBlockId(block));
        }
        if (blockchain.prevBlocks === undefined) {
            throw new Error("Blockchain prevBlocks is undefined");
        }
        blockchain.prevBlocks.lastMcBlocks = lastMcBlocks;
        const seqnoOfBlockToProofTo = randomInt(lastSeqno - 16, lastSeqno + 1);

        const mcBlockHeaderProof = await client.

        const sendNotifyWithStateProof = await vaultSetup.treasury.transfer(
            vaultSetup.vault.address,
            toNano(0.5),
            createJettonVaultMessage(
                // We can use any Jetton Vault opcode here because we don't need an actual operation here
                LPDepositPartOpcode,
                mockPayload,
                {
                    proofType: PROOF_STATE_TO_THE_BLOCK,
                },
            ),
        )
        expect(sendNotifyWithStateProof.transactions).toHaveTransaction({
            to: vaultSetup.treasury.minter.address,
            op: JettonVault.opcodes.ProvideWalletAddress,
            success: true,
        })
        const replyWithWallet = findTransactionRequired(sendNotifyWithStateProof.transactions, {
            from: vaultSetup.treasury.minter.address,
            op: JettonVault.opcodes.TakeWalletAddress,
            success: true,
        })
        const tep89proxyAddress = flattenTransaction(replyWithWallet).to
        expect(sendNotifyWithStateProof.transactions).toHaveTransaction({
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
})
