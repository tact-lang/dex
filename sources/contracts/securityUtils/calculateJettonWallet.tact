asm fun calculateJettonWallet(owner: Address, jettonData: Cell?, jettonCode: Cell?, jettonMaster: Address): Address {
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
    3 BLKDROP       // address";
}
