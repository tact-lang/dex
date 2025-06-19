//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

asm fun emptyAddress(): Address { b{00} PUSHSLICE }

asm fun sliceWithOneZeroBit(): Slice {
    b{0} PUSHSLICE
}

asm fun muldiv(x: Int, y: Int, z: Int): Int { MULDIV }

// CALLCC resets c0 and c1 to default quit-cont (extraordinary continuation),
// so after implicit RET we will call quit-cont
asm fun exit() { <{ }> PUSHCONT CALLCC }

// I fully understand that gasConsumed() in this case will be not 100% accurate, as there are more operations further
// but this is not a problem
// It's still a good way to send 2 messages with nearly equal value.
inline fun getHalfOfMsgValue(): Int {
    return (context().value - getComputeFee(gasConsumed(), false)) / 2;
}

// helper function to calculate jetton wallet address synchronously
// inside tvm with jetton minter state and data, using RUNVM opcode
asm fun calculateJettonWallet(owner: Address, jettonData: Cell, jettonCode: Cell, jettonMaster: Address): Address {
    c7 PUSHCTR
    0 INDEX // Unpack singleton from c7
    // https://docs.ton.org/v3/documentation/tvm/tvm-initialization#control-register-c7
    SWAP
    8 SETINDEX
    SWAP
    DUP
    ROTREV
    10 SETINDEX
    1 TUPLE // Make it singleton back
    // owner md mc c7
    ROTREV
    CTOS            // owner_addr c7 md mc"
    2 PUSHINT       // owner_addr c7 md mc args"
    103289 PUSHINT  // owner_addr c7 md mc args get_jwa_method_id"
    5 0 REVERSE     // owner_addr get_jwa_method_id args mc md c7"
    53 RUNVM        // address exit_code c4' c5'"
    // TODO check RUNVM exit code
    3 BLKDROP       // address";
}
