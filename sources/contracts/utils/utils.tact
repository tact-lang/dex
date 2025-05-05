asm fun emptyAddress(): Address { b{00} PUSHSLICE }

asm fun muldiv(x: Int, y: Int, z: Int): Int { MULDIV }

// CALLCC resets c0 and c1 to default quit-cont (extraordinary continuation),
// so after implicit RET we will call quit-cont
asm fun exit() { <{ }> PUSHCONT CALLCC }

inline fun returnFunds(receiver: Address, otherVault: Address, amount: Int, payloadOnFailure: Cell?) {
    message(MessageParameters {
        to: sender(),
        value: 0,
        bounce: false,
        mode: SendRemainingValue,
        body: PayoutFromPool {
            otherVault: otherVault,
            amount: amount,
            receiver: receiver,
            payloadToForward: payloadOnFailure,
        }.toCell(),
    });
    commit();
}
