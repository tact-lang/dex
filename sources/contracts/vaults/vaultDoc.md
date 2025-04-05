# Vaults

## Common Interface

Любой Vault должен реализовывать следующий интерфейс, для взаимодействия с остальными компонентами системы:

### Получение запроса на выплату
```tact
message(0x74f7a60) PayoutFromPool {
    inVault: Address; // For proofing purposes
    amount: Int as uint256;
    receiver: Address;
}
```

### Получение запроса на сохранение средств, для последующего залива ликвидности
(Оно само зависит от конкретного пула)

(Сообщение, которое должно быть отправлено на LiquidityDeposit контракт)
```tact
message(0xe7a3475f) PartHasBeenDeposited {
    depositor: Address;
    amount: Int as uint256;
}
```
