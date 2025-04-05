struct SortedAddresses{
    lower: Address;
    higher: Address;
}

inline fun sortAddresses(a: Address, b: Address): SortedAddresses {
    if(parseStdAddress(a.asSlice()).address < parseStdAddress(b.asSlice()).address) {
        return SortedAddresses{lower: a, higher: b};
    }
    return SortedAddresses{lower: b, higher: a};
}
