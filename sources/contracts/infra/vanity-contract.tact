//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

message(0xedafb633) InitVanityContract {
    code: Cell;
    data: Cell;
}

contract VanityContract(
    codeDataHash: Int as uint256,
) {
    receive(msg: InitVanityContract) {
        require(msg.code.hash() ^ msg.data.hash() == self.codeDataHash, "Code or data not matched");
        setCode(msg.code);
        setData(msg.data);
    }
}
