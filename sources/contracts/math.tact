struct SortedAddresses {
    lower: Address;
    higher: Address;
}

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
