# OpenDeFi Library: Decentralized Exchange in Tact, T-Dex

<div align="center">

<img src="./assets/t-dex.png" alt="Tyrannosaurus rex holding TON logo" width="400" height="400" />

**T-Dex**: A decentralized exchange (DEX) on the TON blockchain providing<br>efficient exchange of various token types with a high degree of asset abstraction.

</div>

Check out T-Dex wip dApp frontend to perform swaps with web UI:

Link: https://tact-lang.github.io/dex-frontend/
Repo: https://github.com/tact-lang/dex-frontend

You can use this example to see how to integrate with T-Dex contracts from the frontend or execute swap transactions.

## Project Goals

- Creating a state-of-the-art fully open-source decentralized exchange (DEX)
- Minimizing commission costs through optimized architecture
- Providing a real-world example of a complex system of smart contracts, written in Tact
- Providing an example of safe and complex Jettons interaction

## Project Scope

- Smart contracts for Vaults of various asset types
- Automated Market Maker (AMM) Pool contracts
- Contracts for secure liquidity addition

## How-to and dev docs

Check these docs to learn about how T-Dex works, its semantics and how to integrate with it.

- [How to swap on T-Dex](./dev-docs/swap.md)
- [How to manage liquidity](./dev-docs/liquidity.md)
- How to work with Factory, TODO
- How to create new pool and vaults, TODO

## Examples and usage

### Contracts

T-Dex contracts are deployed in testnet and are ready for usage and testing purposes.

- [Jetton A](https://testnet.tonviewer.com/kQBCzXhQNxS727KxwsHld8aVNoFpSka0Xzr3GUBOxC_l2gQM)
- [Jetton A Vault](https://testnet.tonviewer.com/kQBBWii_pqdQWcWQ9pWPC7lt1qoNngdZ9TuUMgT81TFgQiM_)

- [Jetton B](https://testnet.tonviewer.com/kQDO8Rt30nYL8RbXOWWMCqY3E4o-mN-tum0MTlABiFTDtz2p)
- [Jetton B Vault](https://testnet.tonviewer.com/kQBtrwWIuAD_KJIoI14S3jxcANwnL4TrTvsj88cGXVCfG6y2)

- [A-B Jettons pool](https://testnet.tonviewer.com/kQDRJqnVNdRdCH8u9cVclk-iZKpI4bVMBvgyTWfNyI6rTtQH)
- [Proxy liquidity deposit](https://testnet.tonviewer.com/0QBa3_cmTS4lg_pGBt_k5t1NEfHFnsDm8Y2UkD_t3MCQHAG7) (Non-existent because was destroyed after tx)

- [T-Dex factory](https://testnet.tonviewer.com/kQDR9j1SuiGtbSi7NZNgNwlDPIWZFEN5BLMz6AOd-IpGunLG) (No tx on it, used for get-methods)
- [Ton Vault](https://testnet.tonviewer.com/kQDTsG5OoAbrtTRpYMHlmqDXwI9mj3Iv-wj-NNrNf0BDG1dJ) (Inited, but no pools with it yet)

### Transactions

- [A-B Jettons liquidity provisioning](https://testnet.tonviewer.com/transaction/21825ccd231a2aae8dbb95307f9a3b46cff61f2f863a4b9a1a35ec6c6e18f4f3) (Lp jettons minting in the end)
- [A->B Jettons exact-out swap with slippage](https://testnet.tonviewer.com/transaction/91c4004bda0941ee16a611689bacdd4105b6ef230d3b6b9419ec20d40b784cfa) (Notice partial A jetton refund because of slippage)
- [A->B Jettons exact-in swap](https://testnet.tonviewer.com/transaction/8645178e74ab066e86d5bf1912bf05298c1ecf68887a8d38463a8a9aa2c57fda)
- [B->A Jettons swap with low decimals](https://testnet.tonviewer.com/transaction/fdabd6abb38adf2a705417a809f86b8421638479439466a99bb977ebca496cd9)
- [B Vault initialization](https://testnet.tonviewer.com/transaction/c6f4a9758ab80fd2172af8f82e40d55a98cec4e79df32734761a03a90450cb81)

## DEX Architecture

DEX is built on a modular architecture with clear component separation:

### Core System Components

```mermaid
graph LR
    subgraph "Vault Interface"
        PayoutRequest(["PayoutFromPool<br>(msg 0x74f7a60)<br>- amount: uint256<br>- receiver: Address"])
        DepositRequest(["PartHasBeenDeposited<br>(msg 0xe7a3475f)<br>- depositor: Address<br>- amount: uint256"])
        SwapRequestMsg(["SwapRequest<br>(msg 0x123456)<br>- ammPool: Address<br>- minAmountOut: uint256"])
    end

    Vault["Vault<br>(Asset Container)"]

    subgraph "Different Asset Implementations"
        JettonVault["Jetton Vault<br>(Different Implementation)"]
        TONVault["TON Vault<br>(Different Implementation)"]
        ExtraCurrencyVault["Extra-Currency Vault<br>(Different Implementation)"]
    end

    subgraph "DEX Component"
        AMMPool["AMM Pool"]
    end

    subgraph "User"
        Trader["Trader"]
    end

    JettonVault -->|implements| Vault
    TONVault -->|implements| Vault
    ExtraCurrencyVault -->|implements| Vault

    Vault --> PayoutRequest
    Vault --> DepositRequest
    Vault --> SwapRequestMsg


    Trader -->|"sends SwapRequest"| Vault
    Vault -->|"forwards to"| AMMPool

    VaultAbstraction["Asset Abstraction Layer"]
    Vault --- VaultAbstraction

    VaultNote["Any contract that implements<br>the Vault interface can serve<br>as a Vault regardless of asset type.<br>Each asset has its own implementation."]
    VaultAbstraction --- VaultNote

    AMMPoolNote["AMM Pool only knows Vault addresses,<br>not the actual asset details,<br>enabling uniform asset handling"]
    AMMPool --- AMMPoolNote

    TraderNote["Trader interacts with assets<br>only through their Vaults"]
    Trader --- TraderNote

    style Vault fill:#f9f,stroke:#333,stroke-width:2px
    style VaultAbstraction fill:#eef,stroke:#888,stroke-dasharray: 5 5
    style VaultNote fill:#fff,stroke:#888,stroke-dasharray: 5 5
    style AMMPoolNote fill:#fff,stroke:#888,stroke-dasharray: 5 5
    style TraderNote fill:#fff,stroke:#888,stroke-dasharray: 5 5
    style JettonVault fill:#dfd,stroke:#333
    style TONVault fill:#dfd,stroke:#333
    style ExtraCurrencyVault fill:#dfd,stroke:#333
    style AMMPool fill:#ddf,stroke:#333
    style Trader fill:#ffe,stroke:#333
```

### Swap Process

```mermaid
graph LR
    %% Horizontal flow from left to right
    subgraph Step1["Step 1: Trader Sends Swap Request to Vault"]
        Trader1["Trader"]
        VaultA1["Vault A<br>(e.g. TON Vault)"]

        Trader1 -->|"Swap Request<br>(msg 0x123456)<br>ammPool: Address<br>minAmountOut: uint256"| VaultA1
    end

    subgraph Step2["Step 2: Vault A Forwards to AMM Pool"]
        VaultA2["Vault A<br>(e.g. TON Vault)"]
        AMMPool1["AMM Pool Contract"]

        VaultA2 -->|"Swap In<br>Send tokens to pool"| AMMPool1
    end

    subgraph Step3["Step 3: AMM Pool Calculates and Requests Output"]
        AMMPool2["AMM Pool Contract"]
        VaultB1["Vault B<br>(e.g. Jetton Vault)"]

        AMMPool2 -->|"Swap Out<br>Request token transfer"| VaultB1
    end

    subgraph Step4["Step 4: Vault B Pays Out to Trader"]
        VaultB2["Vault B<br>(e.g. Jetton Vault)"]
        Trader2["Trader"]

        VaultB2 -->|"PayoutFromPool<br>(msg 0x74f7a60)<br>amount: uint256<br>receiver: Address"| Trader2
    end

    %% Connect the steps in sequence
    Step1 --> Step2
    Step2 --> Step3
    Step3 --> Step4

    %% Notes
    AMM_FormulaNotes["Constant Product Formula<br>x * y = k<br>Where x and y are token balances"]
    AMMPool1 --- AMM_FormulaNotes

    VaultAbstractionNote["Asset Abstraction Layer:<br>AMM Pool doesn't know asset implementation details"]
    AMMPool2 --- VaultAbstractionNote

    TraderNote["Swap request exact format<br>depends on exact Vault type"]
    Trader1 --- TraderNote

    style Trader1 fill:#ffe,stroke:#333,stroke-width:2px
    style Trader2 fill:#ffe,stroke:#333,stroke-width:2px
    style VaultA1 fill:#dfd,stroke:#333,stroke-width:2px
    style VaultA2 fill:#dfd,stroke:#333,stroke-width:2px
    style VaultB1 fill:#dfd,stroke:#333,stroke-width:2px
    style VaultB2 fill:#dfd,stroke:#333,stroke-width:2px
    style AMMPool1 fill:#f9f,stroke:#333,stroke-width:2px
    style AMMPool2 fill:#f9f,stroke:#333,stroke-width:2px

    style AMM_FormulaNotes fill:#fff,stroke:#888,stroke-dasharray: 5 5
    style VaultAbstractionNote fill:#fff,stroke:#888,stroke-dasharray: 5 5
    style TraderNote fill:#fff,stroke:#888,stroke-dasharray: 5 5

    style Step1 fill:none,stroke:#333,stroke-width:1px
    style Step2 fill:none,stroke:#333,stroke-width:1px
    style Step3 fill:none,stroke:#333,stroke-width:1px
    style Step4 fill:none,stroke:#333,stroke-width:1px
```

### Liquidity Provision Process

```mermaid
graph LR
    %% Horizontal flow from left to right
    subgraph StepA["Step 1: Deposit Assets"]
        Depositor1["Depositor (Wallet)"]
        VaultA1["Vault A<br>(TON Vault)"]
        VaultB1["Vault B<br>(Jetton Vault)"]

        Depositor1 -->|"Asset A Deposit"| VaultA1
        Depositor1 -->|"Asset B Deposit"| VaultB1
    end

    subgraph StepB["Step 2: Vaults Notify LP Deposit Contract"]
        VaultA2["Vault A<br>(TON Vault)"]
        VaultB2["Vault B<br>(Jetton Vault)"]
        LPDeposit1["LP Deposit Contract"]

        VaultA2 -->|"PartHasBeenDeposited<br>(msg 0xe7a3475f)<br>depositor: Address<br>amount: uint256"| LPDeposit1
        VaultB2 -->|"PartHasBeenDeposited<br>(msg 0xe7a3475f)<br>depositor: Address<br>amount: uint256"| LPDeposit1
    end

    subgraph StepC["Step 3: LP Deposit Confirms to AMM Pool"]
        LPDeposit2["LP Deposit Contract"]
        AMMPool1["AMM Pool Contract"]

        LPDeposit2 -->|"BothPartHasBeenDeposited<br>(msg 0x333333)<br>depositor: Address<br>amountA: uint256<br>amountB: uint256"| AMMPool1
    end

    subgraph StepD["Step 4: AMM Pool Returns Extra Coins"]
        AMMPool2["AMM Pool Contract"]
        VaultB3["Vault<br>(Some vault, depending on how price changed)"]
        Depositor2["Depositor (Wallet)"]

        AMMPool2 -->|"PayoutFromPool<br>(due to slippage)"| VaultB3

        VaultB3 -->|"Return extra coins"| Depositor2
    end

    subgraph StepE["Step 5: AMM Pool Mints LP Tokens"]
        AMMPool3["AMM Pool Contract"]
        Depositor3["Depositor (Wallet)"]

        AMMPool3 -->|"Mint LP Tokens"| Depositor3
    end

    %% Connect the steps in sequence
    StepA --> StepB
    StepB --> StepC
    StepC --> StepD
    StepD --> StepE

    %% Notes
    VaultANote["Different implementation<br>for TON assets"]
    VaultA1 --- VaultANote

    VaultBNote["Different implementation<br>for Jetton assets"]
    VaultB1 --- VaultBNote

    LPDepositNote["Coordinates deposits<br>Ensures atomicity<br>Destroys itself after deposit<br>Acts like a point of synchronization"]
    LPDeposit1 --- LPDepositNote

    AMMPoolNote["Never interacts directly<br>with underlying assets"]
    AMMPool1 --- AMMPoolNote

    style Depositor1 fill:#ffe,stroke:#333,stroke-width:2px
    style Depositor2 fill:#ffe,stroke:#333,stroke-width:2px
    style Depositor3 fill:#ffe,stroke:#333,stroke-width:2px
    style VaultA1 fill:#dfd,stroke:#333,stroke-width:2px
    style VaultA2 fill:#dfd,stroke:#333,stroke-width:2px
    style VaultB1 fill:#dfd,stroke:#333,stroke-width:2px
    style VaultB2 fill:#dfd,stroke:#333,stroke-width:2px
    style VaultB3 fill:#dfd,stroke:#333,stroke-width:2px
    style LPDeposit1 fill:#fdd,stroke:#333,stroke-width:2px
    style LPDeposit2 fill:#fdd,stroke:#333,stroke-width:2px
    style AMMPool1 fill:#f9f,stroke:#333,stroke-width:2px
    style AMMPool2 fill:#f9f,stroke:#333,stroke-width:2px
    style AMMPool3 fill:#f9f,stroke:#333,stroke-width:2px

    style VaultANote fill:#fff,stroke:#888,stroke-dasharray: 5 5
    style VaultBNote fill:#fff,stroke:#888,stroke-dasharray: 5 5
    style LPDepositNote fill:#fff,stroke:#888,stroke-dasharray: 5 5
    style AMMPoolNote fill:#fff,stroke:#888,stroke-dasharray: 5 5

    style StepA fill:none,stroke:#333,stroke-width:1px
    style StepB fill:none,stroke:#333,stroke-width:1px
    style StepC fill:none,stroke:#333,stroke-width:1px
    style StepD fill:none,stroke:#333,stroke-width:1px
    style StepE fill:none,stroke:#333,stroke-width:1px
```

## Key Features

- **Tact based**: Easy to read and understand code, with a focus on safety and security
- **Asset Abstraction**: Vault is a contract, that stores any kind of an Asset (TON, Jetton, Extra Currency, etc.). All other contracts stores Vaults addresses.
- **Cheap Cross-pool swaps**: This architecture allows to easily perform cross-pool swaps with very low network fees.
- **AMM (Automated Market Maker)**: Using constant product formula for exchange rate determination
- **Atomic Liquidity Addition**: Synchronized asset addition through the LP Deposit contract
- **Exchange Fee**: 0.3% fee on token exchanges (configurable)
- **Constrained Swap Requests**: Ability to specify minimum output token amount and timeout

## Project Setup and Development

To start working with T-Dex, install all dependencies:

```shell
yarn install
```

Build the contracts:

```shell
yarn build
```

Other useful commands:

Run tests:

```shell
yarn test
```

Lint the code:

```shell
yarn lint
```

Format the code:

```shell
yarn fmt
```

## Testing

The project uses Jest for testing. Tests are located in the `sources/tests` directory and cover various aspects of the T-Dex functionality:

- `amm-pool.spec.ts` - Tests for the AMM Pool functionality
- `liquidity-deposit.spec.ts` - Tests for liquidity deposit process
- `liquidity-payloads.spec.ts` - Tests for payload handling in liquidity operations
- `swap-payloads.spec.ts` - Tests for payload handling in swap operations

To run all tests:

```shell
yarn test
```

## Contract Configuration

If you need to modify the contract configuration, update the [`tact.config.json`](./tact.config.json) file. For a description of `tact.config.json`, see the [Configuration page in the Tact documentation](https://docs.tact-lang.org/book/config).

## License

[MIT](./LICENSE)
