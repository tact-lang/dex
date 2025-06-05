struct ParsedExotic {
    data: Slice;
    is_exotic: Bool;
}

asm extends fun beginParseExotic(self: Cell): ParsedExotic {
    XCTOS
}

asm extends fun preloadIthRef(self: Slice, idx: Int): Cell {
    PLDREFVAR
}

const MerkleProofTag: Int = 3;
struct MerkleProof {
    tag: Int as uint8;
    hash: Int as uint256;
    content: Cell;
}

const MerkleUpdateTag: Int = 4;
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
struct BlockHeader {
    _info: Cell;
    _valueFlow: Cell;
    stateUpdate: Cell;
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

struct TreeNode {
    leftChild: Cell;
    rightChild: Cell;
}

inline fun findShardInBinTree(cur: Cell): ShardDescr? {
    let curParsed = cur.beginParseExotic();
    if (curParsed.is_exotic) {
        return null;
    }
    // 1 = we are not in leaf yet
    if (curParsed.data.loadBool()) {
        let node = TreeNode.fromSlice(curParsed.data);
        let left = findShardInBinTree(node.leftChild);
        if (left != null) {
            return left;
        }
        return findShardInBinTree(node.rightChild);
    }
    // 0 = we are in leaf
    else {
        return ShardDescr.fromSlice(curParsed.data);
    }
}

// This function returns proof content if proof matches expected hash
// and returns null otherwise
inline fun validateMerkleProof(proofCell: Cell, expectedHash: Int): Cell {
    let parsedExotic = proofCell.beginParseExotic();
    require(parsedExotic.is_exotic, "Block Proof: Merkle proof is not exotic");
    let merkleProof = MerkleProof.fromSlice(parsedExotic.data);
    require(merkleProof.tag == MerkleProofTag, "Block Proof: Invalid Merkle proof tag");
    require(merkleProof.hash == expectedHash, "Block Proof: Invalid Merkle proof hash");
    return merkleProof.content;
}

inline fun getShardRootHash(mcBlockRootHash: Int, blockHeaderProofRaw: Cell): Int {
    let blockHeaderCell = validateMerkleProof(blockHeaderProofRaw, mcBlockRootHash);
    let blockHeader = BlockHeader.fromCell(blockHeaderCell);
    let mcStateExtra = McStateExtra.fromCell(blockHeader.extra);
    // shardHashes is a hashmap (workchain -> ShardDescr)
    // so we just need to get ShardDescr for workchain 0, as we are working in basechain.
    // We can use non-null assertation as we already proved that is is a valid block and
    // valid mc block must have ShardDescr for workchain 0
    let binTreeWithShardDescr: Cell = mcStateExtra.shardHashes.get(0)!!;
    let shardDescr = findShardInBinTree(binTreeWithShardDescr);
    require(shardDescr != null, "Block Proof: Shard description not found in BinTree");
    return shardDescr!!.rootHash;
}

asm fun castToMapFromUint256ToAddr(c: Cell): map<Int as uint256, Cell> { NOP}

inline fun getShardAccounts(shardBlockRootHash: Int, shardHeaderProofRaw: Cell, shardStateProof: Cell): map<Int as uint256, Cell> {
    let shardBlockHeaderCell = validateMerkleProof(shardHeaderProofRaw, shardBlockRootHash);
    if (shardBlockHeaderCell == null) {
        return null;
    }
    let shardHeader = BlockHeader.fromCell(shardBlockHeaderCell!!);
    let shardStateUpdate = shardHeader.stateUpdate.beginParseExotic();
    if (!shardStateUpdate.is_exotic) {
        return null;
    }
    let shardUpdate = MerkleUpdate.fromSlice(shardStateUpdate.data);
    if (shardUpdate.tag != MerkleUpdateTag) {
        return null;
    }
    let shardStateHash = shardUpdate.newHash;
    let shardState = validateMerkleProof(shardStateProof, shardStateHash);
    if (shardState == null) {
        return null;
    }
    // We will assume, that ShardState is ShardStateUnsplit
    // Probably we need to handle this behaviour on the backend to not provide splitted shard
    // Tlb Schemes for Shard State: https://github.com/ton-blockchain/ton/blob/26761a1d139402ef343081810677d2582c3eff51/crypto/block/block.tlb#L416-L433
    // Link above is explaining why do we need to skip 1 ref and load the 2nd one to get ShardAccounts
    let shardAccounts = shardState!!.beginParse().preloadIthRef(2);
    return castToMapFromUint256ToAddr(shardAccounts);
}

/*
storage_extra_none$000 = StorageExtraInfo;
storage_extra_info$001 dict_hash:uint256 = StorageExtraInfo;

storage_used$_ cells:(VarUInteger 7) bits:(VarUInteger 7) = StorageUsed;

storage_info$_ used:StorageUsed storage_extra:StorageExtraInfo last_paid:uint32
              due_payment:(Maybe Grams) = StorageInfo;

account_none$0 = Account;
account$1 addr:MsgAddressInt storage_stat:StorageInfo
          storage:AccountStorage = Account;

account_storage$_ last_trans_lt:uint64
    balance:CurrencyCollection state:AccountState
  = AccountStorage;

account_uninit$00 = AccountState;
account_active$1 _:StateInit = AccountState;
account_frozen$01 state_hash:bits256 = AccountState;

acc_state_uninit$00 = AccountStatus;
acc_state_frozen$01 = AccountStatus;
acc_state_active$10 = AccountStatus;
acc_state_nonexist$11 = AccountStatus;

account_descr$_ account:^Account last_trans_hash:bits256
  last_trans_lt:uint64 = ShardAccount;

_ fixed_prefix_length:(Maybe (## 5)) special:(Maybe TickTock)
  code:(Maybe ^Cell) data:(Maybe ^Cell)
  library:(Maybe ^Cell) = StateInit;
 */

struct TwoCells {
    first: Cell;
    second: Cell;
}

asm fun getTwoLastRefs(c: Slice): TwoCells {
    0 PUSHINT
    2 PUSHINT
    SCUTLAST
    LDREF
    LDREF
}

inline fun parseStateInitFromShardAccount(c: Cell): StateInit {
    let account = c.beginParse().loadRef();
    // This account must me AccountActive, so we can parse StateInit from the last 2 refs
    // That is why we don't support accounts that host some libs in State.
    let lastTwoRefs = getTwoLastRefs(account.beginParse());
    return StateInit {
        code: lastTwoRefs.first,
        data: lastTwoRefs.second,
    };
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
    shardBlockHeaderProof: Cell; // This is a Merkle Proof Cell
    shardStateProof: Cell; // This is a Merkle Proof Cell
}

asm fun getLastMcBlock(): BlockId {
    PREVMCBLOCKS
    16 PUSHINT
    // We use UNTUPLEVAR because UNTUPLE supports only the 0 <= n <= 15
    UNTUPLEVAR
}

asm fun getMcBlockBySeqno(seqno: Int): BlockId {
    PREVMCBLOCKS
    TPOP
    2 INDEX //  [ wc:Integer shard:Integer seqno:Integer root_hash:Integer file_hash:Integer ] = BlockId;
    ROT
    SUB NEGATE 16 ADDCONST
    INDEXVAR
    5 UNTUPLE
}

// NOTE: This function works only in workchain 0
fun getJettonMasterState(proof: StateProof, jettonMaster: Address): StateInit {
    let last = getLastMcBlock();
    // There is only 16 last mc blocks available, it is described in TVM upgrade changelog:
    // https://docs.ton.org/v3/documentation/tvm/changelog/tvm-upgrade-2023-07
    require(last.seqno - proof.mcBlockSeqno <= 16, "Block Proof: mcBlockSeqno is stale");
    let block = getMcBlockBySeqno(proof.mcBlockSeqno);
    // Here we got BlockID. However, shard information is contained in block header, so first we need to proof mc block header
    let shardRootHash = getShardRootHash(block.root_hash, proof.mcBlockHeaderProof);
    let shardAccounts = getShardAccounts(shardRootHash, proof.shardBlockHeaderProof, proof.shardStateProof);
    let jettonMasterId = parseStdAddress(jettonMaster.asSlice()).address;
    let shardAccountRaw = shardAccounts.get(jettonMasterId);
    require(shardAccountRaw != null, "Block Proof: Shard account for jetton master not found in shard accounts");
    return parseStateInitFromShardAccount(shardAccountRaw);
}
