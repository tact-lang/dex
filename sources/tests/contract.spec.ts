import { Address, beginCell, Cell, StateInit, toNano } from "@ton/core";
import { Blockchain, SandboxContract, TreasuryContract } from "@ton/sandbox";
import "@ton/test-utils";
import { ExtendedJettonMinter as JettonMinter } from "../wrappers/ExtendedJettonMinter";
import { randomAddress } from "@ton/test-utils";
import { ExtendedJettonWallet as JettonWallet } from "../wrappers/ExtendedJettonWallet";
import { JettonVault, VaultDepositOpcode } from "../output/DEX_JettonVault";
import { AmmPool } from "../output/DEX_AmmPool";
import { LiquidityDepositContract } from "../output/DEX_LiquidityDepositContract";


function createJettonVaultMessage(opcode: bigint, payload: Cell, proofCode: Cell | undefined, proofData: Cell | undefined) {
    return beginCell()
        .storeUint(0, 1) // Either bit
        .storeMaybeRef(proofCode)
        .storeMaybeRef(proofData)
        .storeUint(opcode, 32)
        .storeRef(payload)
        .endCell();
}

type ContractCodeData = {
    code: Cell | undefined;
    data: Cell | undefined;
}


describe("contract", () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let notDeployer: SandboxContract<TreasuryContract>;

    let userWalletA: (address: Address) => Promise<SandboxContract<JettonWallet>>;
    let userWalletB: (address: Address) => Promise<SandboxContract<JettonWallet>>;
    let jettonVault: (address: Address) => Promise<SandboxContract<JettonVault>>;
    let ammPool: (vaultLeft: Address, vaultRight: Address) => Promise<SandboxContract<AmmPool>>;
    const depositorIds = new Map<string, bigint>();
    let liquidityDepositContract: (
        depositor: Address,
        vaultLeft: Address,
        vaultRight: Address,
        amountLeft: bigint,
        amountRight: bigint
    ) => Promise<SandboxContract<LiquidityDepositContract>>;

    let tokenA: SandboxContract<JettonMinter>;
    let tokenACodeData: ContractCodeData;
    let tokenB: SandboxContract<JettonMinter>;
    let tokenBCodeData: ContractCodeData;
    let vaultForA: SandboxContract<JettonVault>;
    let vaultForB: SandboxContract<JettonVault>;
    
    beforeAll(async () => {
        blockchain = await Blockchain.create();
        //blockchain.verbosity.vmLogs = "vm_logs_full";
        deployer = await blockchain.treasury("deployer");
        notDeployer = await blockchain.treasury("notDeployer");

        // Two different jettonMaster addresses, as jettonContent is different
        tokenA = blockchain.openContract(await JettonMinter.fromInit(0n, deployer.address, beginCell().storeInt(0x01, 6).endCell()));
        tokenACodeData = {
            code: await tokenA.init?.code,
            data: await tokenA.init?.data,
        }
        tokenB = blockchain.openContract(await JettonMinter.fromInit(0n, deployer.address, beginCell().storeInt(0x02, 6).endCell()));
        tokenBCodeData = {
            code: await tokenB.init?.code,
            data: await tokenB.init?.data,
        }
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

        jettonVault = async (address: Address) => {
            return blockchain.openContract(await JettonVault.fromInit(address, false, null));
        }

        ammPool = async (vaultLeft: Address, vaultRight: Address) => {
            let leftHash = BigInt('0x' + vaultLeft.hash.toString('hex'));
            let rightHash = BigInt('0x' + vaultRight.hash.toString('hex'));
            if(leftHash < rightHash) {
                return blockchain.openContract(await AmmPool.fromInit(vaultLeft, vaultRight, 0n, 0n));
            } else {
                return blockchain.openContract(await AmmPool.fromInit(vaultRight, vaultLeft, 0n, 0n));
            }
        }

        liquidityDepositContract = (async (
            depositor: Address,
            vaultLeft: Address,
            vaultRight: Address,
            amountLeft: bigint,
                amountRight: bigint
        ): Promise<SandboxContract<LiquidityDepositContract>> => {
            const depositorKey = depositor.toRawString();
            let contractId = depositorIds.get(depositorKey) || 0n;
            depositorIds.set(depositorKey, contractId + 1n);
            return blockchain.openContract(
                await LiquidityDepositContract.fromInit(
                    vaultLeft,
                    vaultRight,
                    amountLeft,
                    amountRight,
                    depositor,
                    contractId,
                    0n
                )
            );
        });

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

        const deployerWallet = await userWalletA(deployer.address);
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
                tokenACodeData.code!!,
                tokenACodeData.data!!
            )
        )

        expect(transferRes.transactions).toHaveTransaction({
            success: true,
        });

        expect(transferRes.transactions).toHaveTransaction({
            to: mockDepositLiquidityContract,
        });

        const inited = await vaultForA.getInited();
        expect(inited).toBe(true);
    });

    test("Liquidity deposit should work correctly", async () => {
        const vaultA = await jettonVault(tokenA.address);
        const vaultB = await jettonVault(tokenB.address);
        const ammPoolForAandB = await ammPool(vaultA.address, vaultB.address);

        const deployAmmPool = await ammPoolForAandB.send(deployer.getSender(),
            {value: toNano(0.1), bounce: false},
            null
        );
        expect(deployAmmPool.transactions).toHaveTransaction({
            success: true,
            deploy: true,
        });
        
        const LPDepositContract = await liquidityDepositContract(deployer.address, vaultA.address, vaultB.address, 1000000000n, 1000000000n);
        const LPDepositRes = await LPDepositContract.send(deployer.getSender(),
            {value: toNano(0.1), bounce: false},
            null
        );
        expect(LPDepositRes.transactions).toHaveTransaction({
            success: true,
            deploy: true,
        });

        const walletA = await userWalletA(deployer.address);
        const walletB = await userWalletB(deployer.address);

        const transferTokenAToA = await walletA.sendTransfer(
            deployer.getSender(),
            toNano(1),
            100n,
            vaultForA.address,
            deployer.address,
            null,
            toNano(0.5),
            createJettonVaultMessage(
                VaultDepositOpcode, 
                beginCell().storeAddress(LPDepositContract.address).endCell(), 
                tokenACodeData.code!!,
                tokenACodeData.data!!
            )
        )
        expect(transferTokenAToA.transactions).toHaveTransaction({
            from: vaultForA.address,
            to: LPDepositContract.address,
            success: true,
        });
    });
});
