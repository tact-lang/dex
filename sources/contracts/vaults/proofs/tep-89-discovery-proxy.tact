//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import "../../core/lp-jettons/messages";

// As TEP-89 does not support forwardPayload, we need to use a separate contract
message(0x7a1267fd) TEP89DiscoveryResult {
    discoveryId: Int as uint64;
    expectedJettonWallet: Address;
    actualJettonWallet: Address?;
    action: Cell;
}

// Proxy for TEP-89 wallet discovery process
// Handles interaction with Jetton Master and result delivery
contract TEP89DiscoveryProxy(
    jettonMaster: Address,
    discoveryRequester: Address,
    expectedJettonWallet: Address,
    action: Cell, // Actually it is JettonNotify*, but is cheaper to store it as Cell
    discoveryId: Int as uint64, // Unique discovery ID (salt)
) {
    receive() {
        require(sender() == self.discoveryRequester, "TEP89 proxy: Sender must be the discovery requester");

        // Initiate discovery with jetton master
        message(MessageParameters {
            to: self.jettonMaster,
            bounce: true, // So we can save some tons (we won't pay storage fees for JettonMaster)
            value: 0,
            mode: SendRemainingValue,
            body: ProvideWalletAddress {
                queryId: 0,
                ownerAddress: self.discoveryRequester,
                // We could ask to provide address, but it is cheaper to store it in data
                includeAddress: false,
            }.toCell(),
        });
    }

    receive(msg: TakeWalletAddress) {
        require(sender() == self.jettonMaster, "TEP89 proxy: TakeWalletAddress must be sent by the jetton master");

        // Return discovery result to requester
        message(MessageParameters {
            to: self.discoveryRequester,
            bounce: false,
            value: 0,
            mode: SendRemainingBalance | SendDestroyIfZero,
            body: TEP89DiscoveryResult {
                discoveryId: self.discoveryId,
                expectedJettonWallet: self.expectedJettonWallet,
                actualJettonWallet: msg.walletAddress,
                action: self.action,
            }.toCell(),
        });
    }

    bounced(msg: bounced<ProvideWalletAddress>) {
        // Handle failed discovery request
        message(MessageParameters {
            to: self.discoveryRequester,
            bounce: false,
            value: 0,
            mode: SendRemainingBalance | SendDestroyIfZero,
            body: TEP89DiscoveryResult {
                discoveryId: self.discoveryId,
                expectedJettonWallet: self.expectedJettonWallet,
                actualJettonWallet: null,
                action: self.action,
            }.toCell(),
        });
    }
}
