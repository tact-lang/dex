import {Cell, toNano} from "@ton/core"
import {Blockchain} from "@ton/sandbox"
import {findTransactionRequired, flattenTransaction} from "@ton/test-utils"
import {createJettonVault} from "../utils/environment"
// eslint-disable-next-line
import {SendDumpToDevWallet} from "@tondevwallet/traces"
import {createJettonVaultMessage} from "../utils/testUtils"
import {JettonVault} from "../output/DEX_JettonVault"
import {LPDepositPartOpcode} from "../output/DEX_LiquidityDepositContract"
describe("Proofs", () => {
    test("TEP89 proof should correctly work for discoverable jettons", async () => {
        const blockchain = await Blockchain.create()
        //blockchain.verbosity.vmLogs = "vm_logs_verbose"
        // Our Jettons, used when creating the vault, that supports TEP-89
        const vaultSetup = await createJettonVault(blockchain)

        const _ = await vaultSetup.deploy()
        const mockPayload = new Cell()

        const sendNotifyWithTep89Proof = await vaultSetup.jetton.transfer(
            vaultSetup.vault.address,
            toNano(1),
            createJettonVaultMessage(
                // We can use any Jetton Vault opcode here because we don't need an actual operation here
                LPDepositPartOpcode,
                mockPayload,
                {
                    $$type: "TEP89Proof",
                    proofType: 1n,
                },
            ),
        )
        await SendDumpToDevWallet({
            transactions: sendNotifyWithTep89Proof.transactions as any,
        })

        expect(sendNotifyWithTep89Proof.transactions).toHaveTransaction({
            to: vaultSetup.jetton.minter.address,
            op: JettonVault.opcodes.ProvideWalletAddress,
            success: true,
        })
        const replyWithWallet = findTransactionRequired(sendNotifyWithTep89Proof.transactions, {
            from: vaultSetup.jetton.minter.address,
            op: JettonVault.opcodes.TakeWalletAddress,
            success: true,
        })
        const prooferAddress = flattenTransaction(replyWithWallet).to
        expect(sendNotifyWithTep89Proof.transactions).toHaveTransaction({
            from: prooferAddress,
            op: JettonVault.opcodes.JettonNotifyWithActionRequest,
            // As there was a commit() after the proof was validated
            success: true,
            // However, probably there is not-null exit code, as we attached incorrect payload
        })
        expect(await vaultSetup.vault.getInited()).toBe(true)
    })
})
