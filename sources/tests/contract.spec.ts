import { Address, beginCell, Cell, StateInit, toNano } from "@ton/core";
import { Blockchain, SandboxContract, TreasuryContract } from "@ton/sandbox";
import "@ton/test-utils";
import { ExtendedJettonMinter as JettonMinter } from "../wrappers/ExtendedJettonMinter";
import { randomAddress } from "@ton/test-utils";
import { ExtendedJettonWallet as JettonWallet } from "../wrappers/ExtendedJettonWallet";
import { JettonVault, VaultDepositOpcode } from "../output/DEX_JettonVault";


function createJettonVaultMessage(opcode: bigint, payload: Cell, proofCode: Cell | undefined, proofData: Cell | undefined) {
    return beginCell()
        .storeUint(0, 1) // Either bit
        .storeMaybeRef(proofCode)
        .storeMaybeRef(proofData)
        .storeUint(opcode, 32)
        .storeRef(payload)
        .endCell();
}

describe("contract", () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let notDeployer: SandboxContract<TreasuryContract>;

    let userWalletA: (address: Address) => Promise<SandboxContract<JettonWallet>>;
    let userWalletB: (address: Address) => Promise<SandboxContract<JettonWallet>>;

    let tokenA: SandboxContract<JettonMinter>;
    let tokenB: SandboxContract<JettonMinter>;

    let vaultForA: SandboxContract<JettonVault>;
    let vaultForB: SandboxContract<JettonVault>;
    
    beforeAll(async () => {
        blockchain = await Blockchain.create();
        //blockchain.verbosity.vmLogs = "vm_logs_full";
        deployer = await blockchain.treasury("deployer");
        notDeployer = await blockchain.treasury("notDeployer");

        // Two different jettonMaster addresses, as jettonContent is different
        tokenA = blockchain.openContract(await JettonMinter.fromInit(0n, deployer.address, beginCell().storeInt(0x01, 6).endCell()));
        tokenB = blockchain.openContract(await JettonMinter.fromInit(0n, deployer.address, beginCell().storeInt(0x02, 6).endCell()));
        
        userWalletA = async (address: Address) => {
            return blockchain.openContract(
                new JettonWallet(await tokenA.getGetWalletAddress(address)),
            )
        }

        userWalletB = async (address: Address) => {
            return blockchain.openContract(
                new JettonWallet(await tokenB.getGetWalletAddress(address)),
            )
        }

        vaultForA = blockchain.openContract(await JettonVault.fromInit(tokenA.address, false, null));
        vaultForB = blockchain.openContract(await JettonVault.fromInit(tokenB.address, false, null));

        const mintRes = await tokenA.sendMint(deployer.getSender(), deployer.address, 1000000000n, 0n, toNano(1));
        expect(mintRes.transactions).toHaveTransaction({
            deploy: true,
            success: true,
        });

        const mintRes2 = await tokenB.sendMint(deployer.getSender(), deployer.address, 1000000000n, 0n, toNano(1));
        expect(mintRes2.transactions).toHaveTransaction({
            deploy: true,
            success: true,
        });
    });

    test("Jetton vault should deploy correctly", async () => {
        const mockDepositLiquidityContract = randomAddress(0);
        
        const realDeployment = await vaultForA.send(deployer.getSender(),
            {value: toNano(0.1), bounce: false},
            null
        );

        expect(realDeployment.transactions).toHaveTransaction({
            success: true,
            deploy: true,
        });

        const tokenAState = (await blockchain.getContract(tokenA.address)).accountState;
        if(tokenAState?.type !== "active") {
            throw new Error("Token A is not active");
        }

        const deployerWallet = await userWalletA(deployer.address);
        console.log(tokenA.address.toString({urlSafe: true, bounceable: true, testOnly: false}));
        const transferRes = await deployerWallet.sendTransfer(
            deployer.getSender(),
            toNano(1),
            100n,
            vaultForA.address,
            deployer.address,
            null,
            toNano(0.5),
            createJettonVaultMessage(
                VaultDepositOpcode, 
                beginCell().storeAddress(mockDepositLiquidityContract).endCell(), 
                tokenAState.state.code!!,
                tokenAState.state.data!!
            )
        )

        for(const tx of transferRes.transactions) {
            console.log(tx.debugLogs);
        }

        expect(transferRes.transactions).toHaveTransaction({
            success: true,
        });

        expect(transferRes.transactions).toHaveTransaction({
            to: mockDepositLiquidityContract,
        });

        const inited = await vaultForA.getInited();
        expect(inited).toBe(true);
    });
});
