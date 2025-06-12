//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

struct SortedAddresses {
    lower: Address;
    higher: Address;
}

// Represents a pair of sorted addresses and their associated coin values.
// The addresses are sorted in ascending order, with `lower` being the smaller address
// and `higher` being the larger address. `lowerCoins` and `higherCoins` store the
// respective coin values for these addresses.
struct SortedAddressesAndCoins {
    lower: Address;
    higher: Address;
    lowerCoins: Int;
    higherCoins: Int;
}

inline fun sortAddresses(a: Address, b: Address): SortedAddresses {
    if (parseStdAddress(a.asSlice()).address < parseStdAddress(b.asSlice()).address) {
        return SortedAddresses { lower: a, higher: b };
    }
    return SortedAddresses { lower: b, higher: a };
}

inline fun sortAddressesAndCoins(
    a: Address,
    b: Address,
    aCoins: Int,
    bCoins: Int,
): SortedAddressesAndCoins {
    if (parseStdAddress(a.asSlice()).address < parseStdAddress(b.asSlice()).address) {
        return SortedAddressesAndCoins { lower: a, higher: b, lowerCoins: aCoins, higherCoins: bCoins };
    }
    return SortedAddressesAndCoins { lower: b, higher: a, lowerCoins: bCoins, higherCoins: aCoins };
}
