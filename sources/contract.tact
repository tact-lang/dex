import "@stdlib/ownable";

contract TON_Vault(
    owner: Address,
    counter: Int as uint32,
) with Ownable {

    // empty receiver for deployment
    receive() {
        cashback(sender());
    }

    receive(_: Increment) {
        self.add(1);
    }

    receive(msg: Add) {
        self.add(msg.amount);
    }

    fun add(v: Int) {
        self.requireOwner();
        self.counter += v;
    }

    get fun counter(): Int {
        return self.counter;
    }
}
