//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import "./LP-jetton-wallet.tact";
import "./messages";

// VENDOR LOCK: These jetton wallet base implementation were copied from the tact-lang/jetton repository.
// https://github.com/tact-lang/jetton/tree/0e2b51dcd7f91c2db194027ae867c44fb0e0c11b

inline fun checkEitherForwardPayload(forwardPayload: Slice) {
    if (forwardPayload.preloadUint(1) == 1) {
        let bitsAndRefs = calculateSliceBitsAndRefs(forwardPayload);
        require(bitsAndRefs.refs == 1 && bitsAndRefs.bits == 1, "Invalid forward payload in message");
    }
}

struct SliceBitsAndRefs {
    bits: Int;
    refs: Int;
}

asm fun calculateSliceBitsAndRefs(slice: Slice): SliceBitsAndRefs {
    SBITREFS
}

inline fun getJettonWalletInit(address: Address): StateInit {
    return initOf LPJettonWallet(0, address, myAddress());
}

inline fun getJettonWalletByOwner(jettonWalletOwner: Address): Address {
    return contractAddress(getJettonWalletInit(jettonWalletOwner));
}

inline fun getJettonBasechainWalletByOwner(jettonWalletOwner: Address): BasechainAddress {
    return contractBasechainAddress(getJettonWalletInit(jettonWalletOwner));
}

inline fun makeTakeWalletAddressMsg(targetJettonWallet: BasechainAddress, msg: ProvideWalletAddress): Cell {
    return beginCell()
        .storeUint(TakeWalletAddress.opcode(), 32)
        .storeUint(msg.queryId, 64)
        .storeBasechainAddress(targetJettonWallet)
        .storeMaybeRef(msg.includeAddress ? beginCell().storeAddress(msg.ownerAddress).endCell() : null)
        .endCell();
}

// Very inefficient implementation but we don't care because this function is only called in getter, where the gas is free
inline fun zeroBasechainAddress(): Address {
    return beginCell().storeUint(1, 1).storeUint(0, 266).asSlice().asAddressUnsafe();
}
