//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

// VENDOR LOCK: These jetton wallet base implementation were copied from the tact-lang/jetton repository.
// https://github.com/tact-lang/jetton/tree/0e2b51dcd7f91c2db194027ae867c44fb0e0c11b

const gasForBurn: Int = 6700;
const gasForTransfer: Int = 10500;
const minTonsForStorage: Int = ton("0.01"); // This should use https://github.com/tact-lang/tact/issues/2336 in the future
const Basechain: Int = 0;

const walletStateInitCells: Int = 30;
const walletStateInitBits: Int = 20000;
