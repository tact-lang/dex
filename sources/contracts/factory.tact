import "./math";
import "./core/amm-pool";
import "./vaults/jetton-vault";

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

// Request should be something like Either Cell ^Cell in the future
// Or (perfect) it could be a union that supports such layout
struct Request {
    requestId: Int as uint32;
    request: Cell;
}

// Address request may contain up to 3 subrequests, it is convenient, as you can provide lp or perform swap with only one address-get request
// For LP you need 3 addresses: left vault, right vault and depositor
// For swap you need 2 addresses: left vault and AmmPool
message AddressesRequest {
    responseAddress: Address?;
    first: Request;
    second: Request?;
    third: Request?;
    forwardPayload: Cell?;
}

message AddressResponse {
    first: Address;
    second: Address?;
    third: Address?;
    forwardPayload: Cell?;
}

contract Factory() {
    receive(msg: AddressesRequest) {
        let second: Address? = null;
        if(msg.second != null) {
            second = performAddrRequest(msg.second!!.requestId, msg.second!!.request);
        }
        let third: Address? = null;
        if(msg.third != null) {
            third = performAddrRequest(msg.third!!.requestId, msg.third!!.request);
        }
        let destination = msg.responseAddress != null ? msg.responseAddress : sender();
        message(MessageParameters {
            mode: SendRemainingValue,
            body: AddressResponse {
                first: performAddrRequest(msg.first.requestId, msg.first.request),
                second: second,
                third: third,
                forwardPayload: msg.forwardPayload,
            },
            value: 0,
            to: destination,
            bounce: false,
        })
    }
}

fun performAddrRequest(requestId: Int, request: Cell): Address {
    if(requestId == AmmPoolAddrRequestId) {
        let params = AmmPoolParams.fromCell(request);
        let sortedAddresses = sortAddresses(params.firstVault, params.secondVault);
        return contractAddress(initOf AmmPool(sortedAddresses.lower, sortedAddresses.higher, 0, 0, 0, null));
    }
    if(requestId == LPDepositRequestId) {
        let params = LPDepositParams.fromCell(request);
        let sortedAddresses = sortAddresses(params.firstVault, params.secondVault);
        return contractAddress(initOf AmmPool(sortedAddresses.lower, sortedAddresses.higher, 0, 0, 0, null));

    }
    if(requestId == JettonVaultRequestId) {
        let params = JettonVaultParams.fromCell(request);
        return contractAddress(initOf JettonVault(params.jettonMaster, null));
    }
    require(false, "Factory: Unknown requestId");
}