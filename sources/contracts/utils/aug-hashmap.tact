//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

/**
 * Augmented Hashmap Implementation for TON Blockchain
 *
 * This module implements operations for working with augmented hashmaps (HashmapAugE)
 * according to TON TL-B specifications. Augmented hashmaps extend regular hashmaps
 * by storing an additional "extra" value in each node alongside the main data.
 *
 * TL-B Schema:
 * ```
 * ahme_empty$0 {n:#} {X:Type} {Y:Type} extra:Y = HashmapAugE n X Y;
 * ahme_root$1 {n:#} {X:Type} {Y:Type} root:^(HashmapAug n X Y) extra:Y = HashmapAugE n X Y;
 *
 * ahm_edge#_ {n:#} {X:Type} {Y:Type} {l:#} {m:#}
 *   label:(HmLabel ~l n) {n = (~m) + l}
 *   node:(HashmapAugNode m X Y) = HashmapAug n X Y;
 *
 * ahmn_leaf#_ {X:Type} {Y:Type} extra:Y value:X = HashmapAugNode 0 X Y;
 * ahmn_fork#_ {n:#} {X:Type} {Y:Type} left:^(HashmapAug n X Y)
 *   right:^(HashmapAug n X Y) extra:Y = HashmapAugNode (n + 1) X Y;
 * ```
 */

/**
 * Result structure for augmented hashmap lookup operations.
 * Contains the lookup result and success status.
 */
struct AugHashmapLookupResult {
    valueWithExtra: Slice?;
    found: Bool;
}

/**
 * Internal structure for hashmap label parsing results.
 * Used during traversal of hashmap edges to extract key path information.
 */
struct ParseHashmapLabelResult {
    self: Slice;
    label: Int;
    labelLength: Int;
}

// Assembly function imports for low-level bit operations
asm extends fun getBitSize(self: Int): Int { UBITSIZE }
asm(-> 1 0) extends mutates fun loadOnes(self: Slice): Int { LDONES }
asm fun intIf(condition: Bool, thenValue: Int, elseValue: Int): Int { CONDSEL }
asm fun cellIf(condition: Bool, thenValue: Cell, elseValue: Cell): Cell { CONDSEL }

/**
 * Parse hashmap label according to TL-B HmLabel specification.
 *
 * Handles three label types:
 * - hml_short$0: Unary length encoding followed by label bits
 * - hml_long$10: Direct length encoding followed by label bits
 * - hml_same$11: Repeated bit pattern encoding
 *
 * TL-B Schema:
 * ```
 * hml_short$0 {m:#} {n:#} len:(Unary ~n) {n <= m} s:(n * Bit) = HmLabel ~n m;
 * hml_long$10 {m:#} n:(#<= m) s:(n * Bit) = HmLabel ~n m;
 * hml_same$11 {m:#} v:Bit n:(#<= m) = HmLabel ~n m;
 * ```
 */
inline extends fun parseHashmapLabel(self: Slice, m: Int): ParseHashmapLabelResult {
    // Check first bit to determine label type
    if (!self.loadBit()) {
        // hml_short$0: Unary length encoding
        let n = self.loadOnes();
        self.skipBits(1); // skip trailing zero of unary encoding
        require(n <= m, "Label length exceeds maximum");

        let s = self.loadUint(n);
        return ParseHashmapLabelResult {
            self,
            label: s,
            labelLength: n,
        };
    }

    // Check second bit
    if (!self.loadBit()) {
        // hml_long$10: Direct length encoding
        let bitSize = m.getBitSize();
        let n = self.loadUint(bitSize);
        let s = self.loadUint(n);
        return ParseHashmapLabelResult {
            self,
            label: s,
            labelLength: n,
        };
    }

    // hml_same$11: Repeated bit pattern
    let v = self.loadBit();
    let bitSize = m.getBitSize();
    let n = self.loadUint(bitSize);
    let s = intIf(v, (1 << n) - 1, 0);
    return ParseHashmapLabelResult {
        self,
        label: s,
        labelLength: n,
    };
}

/**
 * Lookup value in augmented hashmap by key.
 *
 * Traverses the hashmap tree structure following the key path through edges
 * and nodes until reaching a leaf node or determining the key doesn't exist.
 *
 * Algorithm:
 * 1. Validate key length and handle empty hashmap
 * 2. Traverse tree by parsing edge labels and following branches
 * 3. Compare key prefixes with edge labels
 * 4. Return value when key is fully consumed or not found
 */
inline fun augHashmapLookup(dict: Cell?, key: Slice, keyLen: Int): AugHashmapLookupResult {
    // Handle empty hashmap or invalid key length
    if (keyLen != key.bits() || dict == null) {
        return AugHashmapLookupResult {
            valueWithExtra: null,
            found: false,
        };
    }

    let n = keyLen;
    let currentCell = dict!!;
    let currentKey = key;

    // Traverse hashmap tree structure
    while (true) {
        let edge = currentCell.beginParse();
        let labelResult = edge.parseHashmapLabel(n);

        // Check if key matches edge label
        if (currentKey.preloadUint(labelResult.labelLength) != labelResult.label) {
            return AugHashmapLookupResult {
                valueWithExtra: null,
                found: false,
            };
        }

        n -= labelResult.labelLength;

        // Key fully consumed - found the value
        if (n <= 0) {
            return AugHashmapLookupResult {
                valueWithExtra: edge,
                found: true,
            };
        }

        // Continue traversal to next level
        currentKey.skipBits(labelResult.labelLength);
        let isRight = currentKey.loadBit();
        let leftRef = edge.loadRef();
        let rightRef = edge.preloadRef();

        currentCell = cellIf(isRight, rightRef, leftRef);
        n -= 1;
    }

    return AugHashmapLookupResult {
        valueWithExtra: null,
        found: false,
    };
}
