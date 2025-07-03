//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import "../utils/math";
import "../core/amm-pool";
import "../core/liquidity-deposit";
import "../vaults/jetton-vault";
import "../utils/utils";

const AmmPoolAddrRequestId: Int = 0x46389573;
struct AmmPoolParams {
    // Here vault may be not sorted, we will sort them for user
    firstVault: Address;
    secondVault: Address;
}

const LPDepositAddrRequestId: Int = 0x7bd2db38;
struct LPDepositParams {
    // Here, unlike in real state init, vaults can be not sorted, we will sort them for user
    firstVault: Address;
    secondVault: Address;
    firstAmount: Int as coins;
    secondAmount: Int as coins;
    lpTokensReceiver: Address; // This and the next field are kind of salt; so several similar contracts can exist
    // This contractId should be unique for each liquidity deposit action, one can use LT of a contact
    contractId: Int as uint64;
}

const JettonVaultAddrRequestId: Int = 0x7af4c10b;
struct JettonVaultParams {
    jettonMaster: Address;
}

// Request should be something like Either Cell ^Cell in the future
// Or (perfect) it could be a union that supports such layout
struct Request {
    requestId: Int as uint32;
    request: Cell;
}

// Address request may contain up to 3 queries, it is convenient, as you can provide lp or perform swap with only one address-get request
// For LP you need 3 addresses: left vault, right vault and depositor
// For swap you need 2 addresses: left vault and AmmPool
message(0xb0534b79) AddressesRequest {
    responseAddress: Address?;
    first: Request;
    second: Request?;
    third: Request?;
    forwardPayload: Cell?;
}

message(0xbcd2d2e2) AddressResponse {
    first: Address;
    second: Address?;
    third: Address?;
    forwardPayload: Cell?;
}

contract Factory() {
    receive() {}

    receive(msg: AddressesRequest) {
        let second: Address? = null;
        if (msg.second != null) {
            second = performAddrRequest(msg.second!!.requestId, msg.second!!.request);
        }

        let third: Address? = null;
        if (msg.third != null) {
            third = performAddrRequest(msg.third!!.requestId, msg.third!!.request);
        }

        let destination = msg.responseAddress != null ? msg.responseAddress!! : sender();
        message(MessageParameters {
            mode: SendRemainingValue,
            body: AddressResponse {
                first: performAddrRequest(msg.first.requestId, msg.first.request),
                second,
                third,
                forwardPayload: msg.forwardPayload,
            }.toCell(),
            value: 0,
            to: destination,
            bounce: false,
        });
    }

    // Of course this kind of thing waste gas on extra toCell/fromCell, but we don't care about gas in get-methods
    get fun ammPoolAddr(firstVault: Address, secondVault: Address): Address {
        return performAddrRequest(AmmPoolAddrRequestId, AmmPoolParams {
            firstVault,
            secondVault,
        }.toCell());
    }

    get fun lpDepositAddr(
        firstVault: Address,
        secondVault: Address,
        firstAmount: Int,
        secondAmount: Int,
        lpTokensReceiver: Address,
        contractId: Int,
    ): Address {
        return performAddrRequest(LPDepositAddrRequestId, LPDepositParams {
            firstVault,
            secondVault,
            firstAmount,
            secondAmount,
            lpTokensReceiver,
            contractId,
        }.toCell());
    }

    get fun jettonVaultAddr(jettonMaster: Address): Address {
        return performAddrRequest(JettonVaultAddrRequestId, JettonVaultParams {
            jettonMaster,
        }.toCell());
    }
}

fun performAddrRequest(requestId: Int, request: Cell): Address {
    if (requestId == AmmPoolAddrRequestId) {
        let params = AmmPoolParams.fromCell(request);
        let sortedAddresses = sortAddresses(params.firstVault, params.secondVault);
        return contractAddress(initOf AmmPool(
            sortedAddresses.lower,
            sortedAddresses.higher,
            0,
            0,
            0,
            null,
        ));
    }
    if (requestId == LPDepositAddrRequestId) {
        let params = LPDepositParams.fromCell(request);
        let sortedAddressesAndCoins = sortAddressesAndCoins(
            params.firstVault,
            params.secondVault,
            params.firstAmount,
            params.secondAmount,
        );
        return contractAddress(initOf LiquidityDepositContract(
            sortedAddressesAndCoins.lower,
            sortedAddressesAndCoins.higher,
            sortedAddressesAndCoins.lowerCoins,
            sortedAddressesAndCoins.higherCoins,
            params.lpTokensReceiver,
            params.contractId,
            false,
            false,
            null,
            null,
        ));
    }
    if (requestId == JettonVaultAddrRequestId) {
        let params = JettonVaultParams.fromCell(request);
        return contractAddress(initOf JettonVault(params.jettonMaster, null));
    }
    require(false, "Factory: Unknown requestId");
    // unreachable
    return emptyAddress();
}
