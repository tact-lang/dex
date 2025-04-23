import {beginCell, toNano} from "@ton/core"
import {Blockchain} from "@ton/sandbox"
import {findTransactionRequired, flattenTransaction} from "@ton/test-utils"
import {AmmPool, loadMintViaJettonTransferInternal} from "../output/DEX_AmmPool"
import {createAmmPool} from "../utils/environment"
// eslint-disable-next-line
import {SendDumpToDevWallet} from "@tondevwallet/traces"

describe("Liquidity payloads", () => {
    test("should send both payloads via LP minting, and send no excesses on first deposit", async () => {
        const blockchain = await Blockchain.create()
        const {ammPool, vaultA, vaultB, liquidityDepositSetup} = await createAmmPool(blockchain)
        const poolState = (await blockchain.getContract(ammPool.address)).accountState?.type
        expect(poolState === "uninit" || poolState === undefined).toBe(true)

        const leftPayloadOnSuccess = beginCell().storeStringTail("SuccessLeft").endCell()
        const leftPayloadOnFailure = beginCell().storeStringTail("FailureLeft").endCell()

        const rightPayloadOnSuccess = beginCell().storeStringTail("SuccessRight").endCell()
        const rightPayloadOnFailure = beginCell().storeStringTail("FailureRight").endCell()

        // deploy liquidity deposit contract
        const amountA = toNano(1)
        const amountB = toNano(2) // 1 a == 2 b ratio
        const depositor = vaultA.jetton.walletOwner
        const liqSetup = await liquidityDepositSetup(depositor, amountA, amountB)
        await liqSetup.deploy()
        await vaultA.deploy()

        const _ = await vaultA.addLiquidity(
            liqSetup.liquidityDeposit.address,
            amountA,
            leftPayloadOnSuccess,
            leftPayloadOnFailure,
        )
        await vaultB.deploy()

        const addSecondPartAndMintLP = await vaultB.addLiquidity(
            liqSetup.liquidityDeposit.address,
            amountB,
            rightPayloadOnSuccess,
            rightPayloadOnFailure,
        )

        expect(addSecondPartAndMintLP.transactions).not.toHaveTransaction({
            from: ammPool.address,
            to: vaultA.vault.address,
        })
        expect(addSecondPartAndMintLP.transactions).not.toHaveTransaction({
            from: ammPool.address,
            to: vaultB.vault.address,
        })

        // check LP token mint
        const mintLP = findTransactionRequired(addSecondPartAndMintLP.transactions, {
            from: ammPool.address,
            to: liqSetup.depositorLpWallet.address,
            op: AmmPool.opcodes.MintViaJettonTransferInternal,
            success: true,
        })
        const transferBody = flattenTransaction(mintLP).body?.beginParse()
        const parsedBody = loadMintViaJettonTransferInternal(transferBody!!)
        expect(parsedBody.forwardPayload.asCell()).toEqualCell(
            beginCell()
                .storeUint(0, 1) // Either bit equals 0
                .storeMaybeRef(leftPayloadOnSuccess)
                .storeMaybeRef(rightPayloadOnSuccess)
                .endCell(),
        )

        const lpBalance = await liqSetup.depositorLpWallet.getJettonBalance()
        // TODO: add off-chain precise balance calculations tests (with sqrt and separate cases)
        expect(lpBalance).toBeGreaterThan(0n)
    })
})
