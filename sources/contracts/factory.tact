import "./math";
import "./core/amm-pool";

const AmmPoolAddrRequestId: Int = 0x46389573;
struct AmmPoolParams {
    // Here vault may be not sorted, we will sort them for user
    firstVault: Address;
    secondVault: Address;
}

const LPDepositRequestId: Int = 0x7bd2db38;
struct LPDepositParams {
    // Here, unlike in real state init, vaults can be not sorted, we will sort them for user
    firstVault: Address;
    secondVault: Address;
    leftSideAmount: Int as coins;
    rightSideAmount: Int as coins;
    depositor: Address; // This and the next field are kind of salt; so several similar contracts can exist
    // This contractId should be unique for each liquidity deposit action, one can use LT of a contact
    contractId: Int as uint64;
}

const JettonVaultRequestId: Int = 0x7af4c10b;
struct JettonVaultParams {
    jettonMaster: Address;
}

// Address request may contain up to 3 subrequests, it is convenient, as you can provide lp or perform swap with only one address-get request
// For LP you need 3 addresses: left vault, right vault and depositor
// For swap you need 2 addresses: left vault and AmmPool
message AddressesRequest {
    firstRequestId: Int? as uint32;
    firstRequest: Cell?;
    secondRequestId: Int? as uint32;
    secondRequest: Cell?;
    thirdRequestId: Int? as uint32;
    thirdRequest: Cell?;
    forwardPayload: Cell?;
}

message AddressResponse {
    firstRequestId: Int? as uint32;
    firstResult: Address?;
    secondRequestId: Int? as uint32;
    secondResult: Address?;
    thirdRequestId: Int? as uint32;
    thirdResult: Address?;
    forwardPayload: Cell?;
}

contract Factory() {
    receive(msg: AddressesRequest) {

    }

}

fun performAddrRequest(requestId: Int, request: Cell): Address {
    if(requestId == AmmPoolAddrRequestId) {
        let params = AmmPoolParams.fromCell(request);
        let sortedAddresses = sortAddresses(params.firstVault, params.secondVault);
        return contractAddress(initOf AmmPool(sortedAddresses.lower, sortedAddresses.upper, 0, 0, 0, null));
    }
    if(requestId == LPDepositRequestId) {
        let params = LPDepositParams.fromCell(request);

    }
    if(requestId == JettonVaultRequestId) {
        let params = JettonVaultParams.fromCell(request);

    }
}