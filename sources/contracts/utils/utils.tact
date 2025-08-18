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

asm fun getFreezeLimit(): Int {
    // Retrieve basechain gas prices from c7
    c7 PUSHCTR
    FIRST // Unpack singleton from c7
    // https://docs.ton.org/v3/documentation/tvm/changelog/tvm-upgrade-2024-04
    // 14: a tuple containing various config parameters as cell slices. If a parameter is absent from the config, its value is null.
    14 INDEX
    // get basechain gas prices
    3 INDEX
    // Now we have a slice with gas prices
    // Check param 21 on https://explorer.toncoin.org/config to understand parsing here
    464 PUSHINT
    SDSKIPFIRST
    64 LDU
    DROP
}

inline fun priceOfJettonForward(fwdFee: Int, fwdTonAmount: Int): Int {
    // We know nothing about the jetton, so let's just assume that it fits in some gas limits
    return
        fwdTonAmount +
    // Let's assume that we will always have a Jetton Notify
        2 * fwdFee +
    // I've never seen jetton that occupies more than that.
    // However it is easy to create one :)
        getForwardFee(40, 30000, false) +
    // I don't think there is a jetton that requires more than 30k gas to transfer
        (2 * getComputeFee(30000, false) +
    // I've seen that some jettons reserve 0.02 TON for storage so let's assume that
         ton("0.02"));
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
    ONE 2 -ROLL // Moves the top stack value (ONE) to the third position: [A, B, C] -> [B, C, A]. We expect only 1 return value. Flag +256 for runvm enables this argument
    // Here is the full list of modes of RUNVM
    // +1 = same_c3 (set c3 to code)
    // +2 = push_0 (push an implicit 0 before running the code); only works with +1 enabled
    // +4 = load c4 (persistent data) from stack and return its final value
    // +8 = load gas limit from stack and return consumed gas
    // +16 = load c7 (smart-contract context)
    // +32 = return c5 (actions)
    // +64 = pop hard gas limit (enabled by ACCEPT) from stack as well
    // +128 = isolated gas consumption (separate set of visited cells, reset CHKSIGNU counter)
    // +256 = pop number N, return exactly N values from stack (only if res=0 or 1; if not enough then res=stk_und)
    //
    // We use only +1 +4 +16 +256 = 277
    // Mode 256 is crucial, because it ignores all stack values except the first one, and protects us from stack poisoning
    277 RUNVM        // address exit_code c4'"
    2 BLKDROP       // address";
}
