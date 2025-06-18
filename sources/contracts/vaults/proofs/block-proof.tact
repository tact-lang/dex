//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import "../../utils/aug-hashmap";

struct ParsedExotic {
    data: Slice;
    isExotic: Bool;
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
    depth: Int as uint16;
    content: Cell;
}

const MerkleUpdateTag: Int = 4;
struct MerkleUpdate {
    tag: Int as uint8;
    _prevHash: Int as uint256;
    newHash: Int as uint256;
    _oldDepth: Int as uint16;
    _newDepth: Int as uint16;
    _prevState: Cell;
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
    // The reason for this is a bug in Tact serialization of 4-refs struct
    extra: Slice as remaining; // This is a Cell, but we will parse it later
}

/*
_ (HashmapE 32 ^(BinTree ShardDescr)) = ShardHashes;
_ (HashmapAugE 96 ShardFeeCreated ShardFeeCreated) = ShardFees;
_ config_addr:bits256 config:^(Hashmap 32 ^Cell) = ConfigParams;

masterchain_block_extra#cca5
  key_block:(## 1)
  shard_hashes:ShardHashes
  shard_fees:ShardFees
  ^[ prev_blk_signatures:(HashmapE 16 CryptoSignaturePair)
     recover_create_msg:(Maybe ^InMsg)
     mint_msg:(Maybe ^InMsg) ]
  config:key_block?ConfigParams
= McBlockExtra;
 */

struct McBlockExtra {
    _unusedBits: Int as uint17; // Tag and 1 bit for key_block
    // shardHashes is a hashmap (workchain -> ShardDescr)
    shardHashes: map<Int as int32, Cell>;
    _unusedRemaining: Slice as remaining;
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
    // #a or #b is a tag for ShardDescr (4 bits)
    // seq_no:uint32 reg_mc_seqno:uint32
    // start_lt:uint64 end_lt:uint64
    _unusedBits: Int as uint196;
    rootHash: Int as uint256;
    // Won't parse remaining here to save gas
    // Moreover there can be different ShardDescr and we can't express that without unions
    _remaining: Slice as remaining;
}

struct TreeNode {
    leftChild: Cell;
    rightChild: Cell;
}

asm fun myParseVarAddress(slice: Slice): VarAddress { REWRITEVARADDR }

inline fun findShardInBinTree(root: Cell, address: Address, shardBitLen: Int): ShardDescr {
    let curCs = root.beginParse();
    // It's std address, but we parse it as VarAddress to get hash part as Slice, not as Int
    let accountId = myParseVarAddress(address.asSlice()).address;
    repeat (shardBitLen) {
        if (accountId.loadBool()) {
            // If the bit is 1, we go to the right child
            curCs = curCs.preloadIthRef(1).beginParse();
        } else {
            // If the bit is 0, we go to the left child
            curCs = curCs.preloadIthRef(0).beginParse();
        }
    }
    curCs.skipBits(1); // We need to skip 1 bit - leaf tag of the tree node
    return ShardDescr.fromSlice(curCs);
}

// This function returns proof content if proof matches expected hash
// and returns null otherwise
inline fun validateMerkleProof(proofCell: Cell, expectedHash: Int): Cell {
    let parsedExotic = proofCell.beginParseExotic();
    require(parsedExotic.isExotic, "Block Proof: Merkle proof is not exotic");
    let merkleProof = MerkleProof.fromSlice(parsedExotic.data);
    require(merkleProof.tag == MerkleProofTag, "Block Proof: Invalid Merkle proof tag");
    require(merkleProof.hash == expectedHash, "Block Proof: Invalid Merkle proof hash");
    return merkleProof.content;
}

// We provide jettonMaster address and shardBit length as an argument to easily find shard in the bin tree
inline fun getShardRootHash(mcBlockRootHash: Int, blockHeaderProofRaw: Cell, jettonMaster: Address, shardBitLen: Int): Int {
    let blockHeaderCell = validateMerkleProof(blockHeaderProofRaw, mcBlockRootHash);
    let blockHeader = BlockHeader.fromCell(blockHeaderCell);

    //block_extra in_msg_descr:^InMsgDescr
    //out_msg_descr:^OutMsgDescr
    //account_blocks:^ShardAccountBlocks
    //rand_seed:bits256
    //created_by:bits256
    //custom:(Maybe ^McBlockExtra) = BlockExtra;

    // Here we load McBlockExtra from BlockExtra, that is why we load 3rd ref
    let mcBlockExtra = McBlockExtra.fromCell(blockHeader.extra.loadRef().beginParse().preloadIthRef(3));
    // shardHashes is a hashmap (workchain -> ShardDescr)
    // so we just need to get ShardDescr for workchain 0, as we are working in basechain.
    // We can use non-null assertion as we already proved that is is a valid block and
    // valid mc block must have ShardDescr for workchain 0
    let binTreeWithShardDescr: Cell = mcBlockExtra.shardHashes.get(0)!!;
    let shardDescr = findShardInBinTree(binTreeWithShardDescr, jettonMaster, shardBitLen);
    return shardDescr.rootHash;
}

inline fun getShardAccounts(shardBlockRootHash: Int, shardHeaderProofRaw: Cell, shardChainStateProof: Cell): Cell {
    let shardBlockHeaderCell = validateMerkleProof(shardHeaderProofRaw, shardBlockRootHash);
    let shardHeader = BlockHeader.fromCell(shardBlockHeaderCell);
    let shardStateUpdate = shardHeader.stateUpdate.beginParseExotic();
    require(shardStateUpdate.isExotic, "Block Proof: Shard state update is not exotic");

    let shardUpdate = MerkleUpdate.fromSlice(shardStateUpdate.data);
    require(shardUpdate.tag == MerkleUpdateTag, "Block Proof: Invalid Merkle update tag");

    // We compose proof in quite unusual way. To not proof ShardState separately, we embed the ShardState into
    // the MerkleUpdate directly.
    // So, needed ShardState is in the second ref of the MerkleUpdate.
    let shardState = validateMerkleProof(shardChainStateProof, shardUpdate.newHash);
    // We will assume, that ShardState is ShardStateUnsplit
    // Probably we need to handle this behavior on the backend to not provide split shard
    // Tlb Schemes for Shard State: https://github.com/ton-blockchain/ton/blob/26761a1d139402ef343081810677d2582c3eff51/crypto/block/block.tlb#L416-L433
    // Link above is explaining why do we need to skip 1 ref and load the 2nd one to get ShardAccounts
    return shardState.beginParse().preloadIthRef(1);
}

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
DROP
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
inline fun parseStateFromShardAccount(c: Slice): StateInit {
    let account = c.loadRef();
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
    rootHash: Int;
    fileHash: Int;
}

struct StateProof {
    // https://github.com/ton-blockchain/ton/blob/26761a1d139402ef343081810677d2582c3eff51/crypto/block/block.tlb#L411
    // Using this value we will get BlockID (using PREVMCBLOCKS instruction)
    mcBlockSeqno: Int as uint32;
    shardBitLen: Int as uint8; // This is the length of Jetton Master's shard prefix in bits
    mcBlockHeaderProof: Cell; // This is a Merkle Proof Cell
    shardBlockHeaderProof: Cell; // This is a Merkle Proof Cell
    shardChainStateProof: Cell; // This is a Merkle Proof Cell
}

asm fun getLastMcBlock(): BlockId {
    PREVMCBLOCKS
    // Get the latest block
    0 INDEX
    // Unpack a tuple
    // [ wc:Integer shard:Integer seqno:Integer root_hash:Integer file_hash:Integer ]
    5 UNTUPLE
}

// PREVMCBLOCKS has 16 last mc block as tuple
asm fun getMcBlockBySeqno(seqno: Int): BlockId {
    PREVMCBLOCKS
    DUP
    0 INDEX
    2 INDEX //  [ wc:Integer shard:Integer seqno:Integer root_hash:Integer file_hash:Integer ] = BlockId;
    ROT
    SUB
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
    let shardRootHash = getShardRootHash(block.rootHash, proof.mcBlockHeaderProof, jettonMaster, proof.shardBitLen);
    let shardAccounts = getShardAccounts(shardRootHash, proof.shardBlockHeaderProof, proof.shardChainStateProof);
    let jettonMasterId = myParseVarAddress(jettonMaster.asSlice()).address;
    let augHashmap = shardAccounts.beginParse().loadRef();
    let shardAccountLookupResult = augHashmapLookup(
        augHashmap,
        jettonMasterId,
        256, // We use 256 bits for address
    );
    require(shardAccountLookupResult.found, "Block Proof: Shard account for jetton master not found in shard accounts");
    return parseStateFromShardAccount(shardAccountLookupResult.valueWithExtra!!);
}
