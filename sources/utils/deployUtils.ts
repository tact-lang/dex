//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import {Dictionary, beginCell, Cell, Address} from "@ton/core"
import {Sha256} from "@aws-crypto/sha256-js"

const ONCHAIN_CONTENT_PREFIX = 0x00
const SNAKE_PREFIX = 0x00
const CELL_MAX_SIZE_BYTES = Math.floor((1023 - 8) / 8)

const sha256 = (str: string) => {
    const sha = new Sha256()
    sha.update(str)
    return Buffer.from(sha.digestSync())
}

const toKey = (key: string) => {
    return BigInt(`0x${sha256(key).toString("hex")}`)
}

export function buildOnchainMetadata(data: {
    name: string
    description: string
    image: string
}): Cell {
    const dict = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell())

    // Store the on-chain metadata in the dictionary
    Object.entries(data).forEach(([key, value]) => {
        dict.set(toKey(key), makeSnakeCell(Buffer.from(value, "utf8")))
    })

    return beginCell().storeInt(ONCHAIN_CONTENT_PREFIX, 8).storeDict(dict).endCell()
}

export function makeSnakeCell(data: Buffer) {
    // Create a cell that package the data
    const chunks = bufferToChunks(data, CELL_MAX_SIZE_BYTES)

    const b = chunks.reduceRight((curCell, chunk, index) => {
        if (index === 0) {
            curCell.storeInt(SNAKE_PREFIX, 8)
        }
        curCell.storeBuffer(chunk)
        if (index > 0) {
            const cell = curCell.endCell()
            return beginCell().storeRef(cell)
        } else {
            return curCell
        }
    }, beginCell())
    return b.endCell()
}
function bufferToChunks(buff: Buffer, chunkSize: number) {
    const chunks: Buffer[] = []
    while (buff.byteLength > 0) {
        chunks.push(buff.slice(0, chunkSize))
        buff = buff.slice(chunkSize)
    }
    return chunks
}

export function sortAddresses(
    address1: Address,
    address2: Address,
    leftAmount: bigint,
    rightAmount: bigint,
) {
    const address1Hash = BigInt("0x" + address1.hash.toString("hex"))
    const address2Hash = BigInt("0x" + address2.hash.toString("hex"))
    if (address1Hash < address2Hash) {
        return {lower: address1, higher: address2, leftAmount: leftAmount, rightAmount: rightAmount}
    } else {
        return {lower: address2, higher: address1, leftAmount: rightAmount, rightAmount: leftAmount}
    }
}
