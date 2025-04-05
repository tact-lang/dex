message initVanityContract {
    code: Cell;
    data: Cell;
}

contract VanityContract(
    codeDatahash: Int as uint256; 
) {
    receive(msg: initVanityContract) {
        require(msg.code.hash() ^ msg.data.hash() == self.codeDatahash, "Code or data not matched");
        setCode(msg.code);
        setData(msg.data);
    }
}
