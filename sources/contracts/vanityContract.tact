message initVanityContract {
    code: Cell;
    data: Cell;
}

contract VanityContract(
    codeDataHash: Int as uint256; 
) {
    receive(msg: initVanityContract) {
        require(msg.code.hash() ^ msg.data.hash() == self.codeDataHash, "Code or data not matched");
        setCode(msg.code);
        setData(msg.data);
    }
}
