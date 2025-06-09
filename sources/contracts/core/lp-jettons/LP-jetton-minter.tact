//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import "./utils";
import "./messages";
import "./LP-jetton-wallet";
import "./constants";
import "../messages";

trait LPJettonMinter {
    totalSupply: Int as coins;
    jettonContent: Cell?;

    receive(msg: ProvideWalletAddress) {
        let ownerWorkchain: Int = parseStdAddress(msg.ownerAddress.asSlice()).workchain;

        // If owner is basechain address, we can calculate LPJettonWallet
        let targetJettonWallet: BasechainAddress = (ownerWorkchain == Basechain)
            ? contractBasechainAddress(initOf LPJettonWallet(0, msg.ownerAddress, myAddress()))
            : emptyBasechainAddress();

        message(MessageParameters {
            body: makeTakeWalletAddressMsg(targetJettonWallet, msg),
            to: sender(),
            value: 0,
            mode: SendRemainingValue,
        });
    }

    // This bounce should never happen, but it's still better to handle it
    // TODO: Add a proper constraint, that guarantees that this message will never be bounced
    bounced(msg: bounced<MintViaJettonTransferInternal>) {
        self.totalSupply -= msg.amount;
    }

    get fun get_wallet_address(ownerAddress: Address): Address {
        return getJettonWalletByOwner(ownerAddress);
    }

    get fun get_jetton_data(): JettonMinterState {
        return JettonMinterState {
            totalSupply: self.totalSupply,
            mintable: true,
            adminAddress: zeroBasechainAddress(),
            // TODO: Fix after solving https://github.com/tact-lang/dex/issues/54
            jettonContent: emptyCell(),
            jettonWalletCode: codeOf LPJettonWallet,
        };
    }
}
