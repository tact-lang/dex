struct ParsedExotic {
    data: Slice;
    is_exotic: Bool;
}

asm extends fun beginParseExotic(self: Cell): ParsedExotic {
    XCTOS
}

struct MerkleProof {
    tag: Int as uint8;
    hash: Int as uint256;
    content: Cell;
}

struct MerkleUpdate {
    tag: Int as uint8;
    prevHash: Int as uint256;
    newHash: Int as uint256;
    prevState: Cell;
    newState: Cell;
}


// https://docs.ton.org/v3/documentation/data-formats/tlb/block-layout#block
/*
block#11ef55aa global_id:int32
    info:^BlockInfo value_flow:^ValueFlow
    state_update:^(MERKLE_UPDATE ShardState)
    extra:^BlockExtra = Block;
*/

// In case of MC block, shard hashes are placed in extra:^BlockExtra field.
// And as we are not interested in anything else in case of StateProofing, we won't parse
// other fields. Unused fields are marked with _ prefix
struct FullBlock {
    _info: Cell;
    _valueFlow: Cell;
    _stateUpdate: Cell;
    extra: Cell;
}

/*
_ (HashmapE 32 ^(BinTree ShardDescr)) = ShardHashes;
_ (HashmapAugE 96 ShardFeeCreated ShardFeeCreated) = ShardFees;
_ config_addr:bits256 config:^(Hashmap 32 ^Cell) = ConfigParams;

masterchain_state_extra#cc1f
    shard_hashes:ShardHashes
    shard_fees:ShardFees
    config:ConfigParams
= McStateExtra;
 */
struct McStateExtra {
    _tag: Int as uint16; // Will be equal to 0xcc1f
    // shardHashes is a hashmap (workchain -> ShardDescr)
    shardHashes: map<Int as int32, Cell>;
    // We use optional here as Hashmap is Maybe ^Cell
    _shardFees: Cell?;
    _configAddr: Int as uint256;
    _config: Cell?;
}

/*
shard_descr_new#a seq_no:uint32 reg_mc_seqno:uint32
  start_lt:uint64 end_lt:uint64
  root_hash:bits256 file_hash:bits256
  before_split:Bool before_merge:Bool
  want_split:Bool want_merge:Bool
  nx_cc_updated:Bool flags:(## 3) { flags = 0 }
  next_catchain_seqno:uint32 next_validator_shard:uint64
  min_ref_mc_seqno:uint32 gen_utime:uint32
  split_merge_at:FutureSplitMerge
  ^[ fees_collected:CurrencyCollection
     funds_created:CurrencyCollection ] = ShardDescr;
 */

struct ShardDescr {
    // seq_no:uint32 reg_mc_seqno:uint32
    // start_lt:uint64 end_lt:uint64
    _unusedBits: Int as uint192;
    rootHash: Int as uint256;
    // Won't parse remaining here to save gas
    // Moreover there can be different ShardDescr and we can't express that without unions
    _remaining: Slice as remaining;
}

inline fun findShardInBinTree(root: Cell): {

}

inline fun validateBlockHeaderProof(rawProof: Cell, blockRootHash: Int): Bool {
    let parsedExotic = rawProof.beginParseExotic();
    if(!parsedExotic.is_exotic) {
        return false;
    }
    let proof = MerkleProof.fromCell(parsedExotic.data);
    // Merkle proof tag always equals 3
    if (proof.tag != 3 || proof.hash != blockRootHash) {
        return false;
    }
    // Above we checked, that the block that was provided to us have known, trusted hash
    let fullBlock = FullBlock.fromCell(proof.content);
    let mcStateExtra = McStateExtra.fromCell(fullBlock.extra);
    // shardHashes is a hashmap (workchain -> ShardDescr)
    // so we just need to get ShardDescr for workchain 0, as we are working in basechain.
    // We can use non-null assertation as we already proved that is is a valid block and
    // valid mc block must have ShardDescr for workchain 0
    let shardDescr: Cell = mcStateExtra.shardHashes.get(0)!!;

}

struct BlockId {
    workchain: Int;
    shard: Int;
    seqno: Int;
    root_hash: Int;
    file_hash: Int;
}

struct StateProof {
    // https://github.com/ton-blockchain/ton/blob/26761a1d139402ef343081810677d2582c3eff51/crypto/block/block.tlb#L411
    // Using this value we will get BlockID (using PREVMCBLOCKS instruction)
    mcBlockSeqno: Int as uint32;
    mcBlockHeaderProof: Cell; // This is a Merkle Proof Cell
}

asm fun getLastMcBlock(): BlockId {
    PREVMCBLOCKS
    UNTUPLE
}

asm fun getMcBlockBySeqno(seqno: Int): BlockId {
    PREVMCBLOCKS
    TPOP
    2 INDEX //  [ wc:Integer shard:Integer seqno:Integer root_hash:Integer file_hash:Integer ] = BlockId;
    ROT
    SUB NEGATE 16 ADDCONST
    INDEXVAR
    UNTUPLE
}

// NOTE: This function works only in workchain 0
fun checkBlockProof(proof: StateProof): Bool {
    let last = getLastMcBlock();
    // There is only 16 last mc blocks available
    if (last.seqno - proof.mcBlockSeqno > 16) {
        return false;
    }
    let block = getMcBlockBySeqno(proof.mcBlockSeqno);
    // Here we got BlockID. However, shard information is contained in block header, so first we need to proof mc block header
    if (!validateBlockHeaderProof(proof.mcBlockHeaderProof, block.root_hash)) {
        return false;
    }
}
