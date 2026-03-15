# LazyLotto - Complete Implementation Guide

**Version:** 3.0 - Community Pools  
**Last Updated:** December 10, 2025  
**Contract Versions:** LazyLotto 23.816 KB | LazyLottoPoolManager 9.327 KB | LazyLottoStorage 11.137 KB  
**Status:** Production Ready

---

## Executive Summary

LazyLotto is a decentralized lottery platform on Hedera featuring provably fair VRF-based randomness, flexible prize structures, and community-created pools. The system uses a three-contract architecture to enable rich functionality within Hedera's 24 KB contract size limit.

### Key Features

- **Community Pool Creation**: Users can create and manage custom lottery pools for a fee
- **Dual Pool System**: Global (team-created) pools and community (user-created) pools
- **Flexible Prize Structures**: Support for HBAR, fungible tokens, and NFT prizes
- **Dynamic Bonus System**: Time windows, NFT holdings, and LAZY balance bonuses
- **Transparent Proceeds**: 95/5 split between pool owners and platform
- **NFT Ticket System**: Tickets can be minted as tradeable NFTs
- **Provably Fair**: Hedera VRF for transparent randomness

---

## Architecture Overview

### Three-Contract System

```
┌──────────────────────────────────────────────────────────────┐
│                      USER INTERACTIONS                        │
└────────────────────┬─────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────┐
│                        LazyLotto                              │
│  • Pool creation & gameplay                                   │
│  • Prize management & distribution                            │
│  • Entry purchases & rolling                                  │
│  • Financial guardian (all token operations)                  │
│  • Proceeds withdrawal execution                              │
│  Size: 23.816 KB (under 24 KB limit ✅)                      │
└────────────┬────────────────────────┬───────────────────────┘
             │                        │
             ▼                        ▼
┌────────────────────────┐  ┌────────────────────────────────┐
│  LazyLottoPoolManager  │  │     LazyLottoStorage           │
│  • Pool ownership      │  │  • HTS token operations        │
│  • Authorization       │  │  • Token custody               │
│  • Creation fees       │  │  • Transfers & mints           │
│  • Proceeds tracking   │  │  Size: 11.137 KB               │
│  • Bonus calculations  │  └────────────────────────────────┘
│  • Prize managers      │
│  • Pool enumeration    │
│  Size: 9.327 KB ✅     │
└────────────────────────┘
```

### Contract Responsibilities

#### **LazyLotto** (Primary Interface)
- **Core Gameplay**: Entry purchases, rolling, prize claims
- **Pool Management**: Creation, pause/unpause, closure
- **Prize Operations**: Adding/removing prizes, NFT management
- **Financial Guardian**: All token withdrawals, validation of obligations
- **User Interface**: All user-facing operations happen here

#### **LazyLottoPoolManager** (Authorization Layer)
- **Ownership Tracking**: Pool owners, prize managers
- **Fee Management**: Creation fees (HBAR + LAZY), proceeds tracking
- **Proceeds Split**: 95% owner, 5% platform (locked at pool creation)
- **Authorization**: canManagePool(), canAddPrizes() validation
- **Bonus System**: calculateBoost(), time/NFT/LAZY bonuses
- **Pool Enumeration**: Separate tracking of global vs community pools

#### **LazyLottoStorage** (HTS Operations)
- **Token Operations**: Mints, burns, transfers, associations
- **Token Custody**: Holds all tokens (prizes, proceeds, entries)
- **Access Control**: Only accepts calls from LazyLotto
- **Unchanged**: Pre-existing contract, no modifications

---

## Contract Interactions

### Critical Approval Pattern

```javascript
// ❌ WRONG - Approving to LazyLotto won't work
await tokenContract.approve(lazyLottoAddress, amount);

// ✅ CORRECT - Approve to storage contract
const storageAddress = await lazyLottoContract.storageContract();
await tokenContract.approve(storageAddress, amount);

// LAZY tokens use LazyGasStation pattern
const gasStationAddress = await lazyLottoContract.lazyGasStation();
await lazyTokenContract.approve(gasStationAddress, amount);
```

### Pool Creation Flow

```javascript
// 1. Get creation fees
const [hbarFee, lazyFee] = await poolManager.getCreationFees();

// 2. Check user balances
const userHbar = await checkHbarBalance(userAddress);
const userLazy = await lazyToken.balanceOf(userAddress);

// 3. If LAZY fee required, ensure allowance to LazyGasStation
if (lazyFee > 0) {
  await lazyToken.approve(gasStationAddress, lazyFee);
}

// 4. Create pool (send HBAR fee as msg.value)
const tx = await lazyLotto.createPool(
  name,
  symbol,
  memo,
  royalties,
  ticketCID,
  winCID,
  winRate,
  entryFee,
  feeToken,
  { value: hbarFee } // HBAR creation fee
);

// 5. Get pool ID from event
const receipt = await tx.wait();
const poolId = receipt.events.find(e => e.event === 'PoolCreated').args.poolId;

// 6. Pool ownership tracked automatically in PoolManager
const owner = await poolManager.getPoolOwner(poolId);
console.log('Pool owner:', owner); // Your address
```

### Entry Purchase Flow

```javascript
// 1. Get pool info
const pool = await lazyLotto.getPoolBasicInfo(poolId);

// 2. Calculate total cost
const totalCost = pool.entryFee * ticketCount;

// 3. Check if burning applies
const burnPercentage = await lazyLotto.burnPercentage();
const willBurn = (pool.feeToken === lazyTokenAddress && burnPercentage > 0);

// 4. Approve tokens ($LAZY → GasStation, other tokens → Storage, NOT LazyLotto)
const storageAddress = await lazyLotto.storageContract();
if (pool.feeToken === address(0)) {
  // HBAR - send as msg.value
} else if (pool.feeToken === lazyTokenAddress) {
  // LAZY via gas station
  const gasStationAddress = await lazyLotto.lazyGasStation();
  await lazyToken.approve(gasStationAddress, totalCost);
} else {
  // Other fungible - approve to storage
  await tokenContract.approve(storageAddress, totalCost);
}

// 5. Buy entries
const tx = await lazyLotto.buyEntry(poolId, ticketCount, {
  value: pool.feeToken === address(0) ? totalCost : 0
});

// 6. Proceeds automatically recorded in PoolManager
```

### Proceeds Withdrawal Flow

```javascript
// 1. Check if caller is pool owner or admin
const owner = await poolManager.getPoolOwner(poolId);
const isAdmin = await lazyLotto.isAdmin(callerAddress);
const canWithdraw = (owner === callerAddress || isAdmin);

// 2. Get proceeds info
const [totalProceeds, withdrawn] = await poolManager.getPoolProceeds(poolId, token);
const available = totalProceeds - withdrawn;

// 3. Get platform fee percentage (locked at pool creation)
const platformFee = await poolManager.getPoolPlatformFeePercentage(poolId);
const ownerShare = available * (100 - platformFee) / 100;
const platformCut = available - ownerShare;

// 4. Withdraw (only owner or admin can call)
const tx = await lazyLotto.withdrawPoolProceeds(poolId, token);

// 5. Funds sent to owner, platform cut held in PoolManager
// Owner receives: ownerShare
// Platform accumulates: platformCut (withdrawn later by admin)
```

---

## Authorization Model

### Roles and Permissions

#### **Global Admin**
- Created pool = global pool (address(0) owner)
- Can manage any pool (pause, close, remove prizes)
- Can add prizes to any pool
- No creation fees
- Can withdraw platform fees

#### **Pool Owner** (Community Creator)
- Paid HBAR + LAZY creation fees
- Can manage their own pool
- Can add prizes to their own pool
- Can set pool prize manager
- Can transfer ownership
- Can withdraw proceeds (95% share)

#### **Global Prize Manager**
- Can add prizes to any pool
- Cannot manage pools
- Set by admin via `addGlobalPrizeManager()`

#### **Pool Prize Manager**
- Can add prizes to specific pool only
- Set by pool owner via PoolManager.setPoolPrizeManager()

### Authorization Checks

```javascript
// Check if user can manage a pool
const canManage = await poolManager.canManagePool(poolId, userAddress);
// Returns true if: global admin OR pool owner

// Check if user can add prizes
const canAddPrizes = await poolManager.canAddPrizes(poolId, userAddress);
// Returns true if: global admin OR global prize manager OR pool owner OR pool prize manager

// Check if pool is global (team-created)
const isGlobal = await poolManager.isGlobalPool(poolId);
// Returns true if poolOwner === address(0)
```

---

## Bonus System

### Bonus Calculation

All bonuses managed by PoolManager, accessed via LazyLotto facade:

```javascript
// Calculate user's total boost
const boost = await lazyLotto.calculateBoost(userAddress);
// Returns: boost in basis points scaled by 10,000
// Example: 105_000 = 10.5% bonus (105% of baseline)

// Breakdown:
// - Time bonuses: Active windows (start <= now <= end)
// - NFT bonuses: Tokens user holds or has delegated
// - LAZY balance bonus: If balance >= threshold
// All bonuses are ADDITIVE (sum of bps * 10,000)
```

### Bonus Configuration (Admin Only)

```javascript
// Time-based bonus (e.g., holiday event)
await poolManager.setTimeBonus(
  startTimestamp,
  endTimestamp,
  110 // 110 bps = 1.1% bonus (110% of 100 baseline)
);

// NFT holding bonus
await poolManager.setNFTBonus(
  nftTokenAddress,
  500 // 500 bps = 5% bonus
);

// LAZY balance bonus
await poolManager.setLazyBalanceBonus(
  10000 * (10 ** decimals), // Threshold: 10,000 LAZY
  200 // 200 bps = 2% bonus
);

// Remove bonuses by index
await poolManager.removeTimeBonus(index);
await poolManager.removeNFTBonus(index);
```

### Bonus Application

Bonuses apply during rolling (internal, automatic):
```solidity
// In LazyLotto._roll():
uint32 boostBps = poolManager.calculateBoost(msg.sender);
// Applied to win rate calculation
```

---

## Pool Enumeration

### Global vs Community Pools

```javascript
// Get total counts
const totalGlobal = await poolManager.totalGlobalPools();
const totalCommunity = await poolManager.totalCommunityPools();

// Get paginated lists (for UX: show global first, then community)
const globalPools = await poolManager.getGlobalPools(0, 20); // First 20 global pools
const communityPools = await poolManager.getCommunityPools(0, 20); // First 20 community pools

// Check if specific pool is global
const isGlobal = await poolManager.isGlobalPool(poolId);

// Get pool owner (address(0) for global pools)
const owner = await poolManager.getPoolOwner(poolId);

// Get user's owned pools
const userPools = await poolManager.getUserPools(userAddress);
```

### Display Pattern

```javascript
// Recommended UX: Display global pools first, then community
async function fetchPoolsForDisplay(offset, limit) {
  const allPools = [];
  
  // 1. Fetch global pools first
  const globalPools = await poolManager.getGlobalPools(0, 100);
  for (const poolId of globalPools) {
    const info = await lazyLotto.getPoolBasicInfo(poolId);
    allPools.push({
      poolId,
      type: 'global',
      ...info
    });
  }
  
  // 2. Fetch community pools
  const communityPools = await poolManager.getCommunityPools(0, 100);
  for (const poolId of communityPools) {
    const info = await lazyLotto.getPoolBasicInfo(poolId);
    const owner = await poolManager.getPoolOwner(poolId);
    allPools.push({
      poolId,
      type: 'community',
      owner,
      ...info
    });
  }
  
  // 3. Apply pagination
  return allPools.slice(offset, offset + limit);
}
```

---

## Fee Management

### Creation Fees

```javascript
// Get current fees
const [hbarFee, lazyFee] = await poolManager.getCreationFees();

// Set fees (admin only)
await poolManager.setCreationFees(
  100_000_000, // 1 HBAR in tinybars
  1000 * (10 ** lazyDecimals) // 1000 LAZY
);

// Check total fees collected
const totalHbar = await poolManager.totalHbarCollected();
const totalLazy = await poolManager.totalLazyCollected();
```

### Platform Proceeds Percentage

```javascript
// Current global setting (applies to NEW pools only)
const currentPercentage = await poolManager.platformProceedsPercentage();

// Set new percentage (admin only, affects future pools)
await poolManager.setPlatformProceedsPercentage(5); // 5%

// Each pool locks in the percentage at creation time
const poolFeePercentage = await poolManager.getPoolPlatformFeePercentage(poolId);
// This is what will be used for THIS pool's withdrawals (prevents "bait and switch")
```

### Platform Fee Withdrawal

```javascript
// Check accumulated platform fees
const platformHbar = await poolManager.getPlatformBalance(address(0));
const platformLazy = await poolManager.getPlatformBalance(lazyTokenAddress);

// Withdraw platform fees (admin only)
await lazyLotto.withdrawPlatformFees(tokenAddress);
// Funds sent to admin (msg.sender)
// PoolManager balance reset to zero
```

---

## Prize Management

### Adding Prizes

```javascript
// Check authorization
const canAdd = await poolManager.canAddPrizes(poolId, userAddress);

// Add single prize package (mixed FT + NFT)
await lazyLotto.addPrizePackage(
  poolId,
  tokenAddress, // address(0) for HBAR
  fungibleAmount,
  [nftToken1, nftToken2], // NFT addresses
  [[serial1, serial2], [serial3]], // Serials per token
  { value: hbarAmount } // If adding HBAR prize
);

// Add multiple fungible prizes in batch
await lazyLotto.addMultipleFungiblePrizes(
  poolId,
  tokenAddress,
  [amount1, amount2, amount3], // Creates 3 separate prize packages
  { value: totalHbar } // If token is address(0)
);

// Prizes automatically tracked in pool.prizes[]
```

### Removing Prizes

```javascript
// Only allowed if pool is closed
await lazyLotto.closePool(poolId);

// Then remove prizes
await lazyLotto.removePrizes(poolId, prizeIndex);
// Returns tokens to caller (admin or pool owner)
```

---

## Best Practices

### Size Limit Awareness

- **LazyLotto**: 23.816 KB (332 bytes under 24 KB limit)
- **PoolManager**: 9.327 KB (ample room for future enhancements)
- Use paginated queries for large datasets
- Avoid adding new state variables to LazyLotto

### Financial Safety

1. **Never hold user funds in PoolManager** - it only tracks obligations
2. **All transfers execute through LazyLotto** - single point of control
3. **Proceeds split locked at creation** - prevents retroactive fee changes
4. **Platform fees only available after owner withdrawal** - ensures owner paid first

### Gas Optimization

```javascript
// Use batch operations when possible
await lazyLotto.buyAndRollEntry(poolId, ticketCount); // Single transaction

// Estimate gas for rolling (PRNG has variability)
const gasEstimate = await lazyLotto.estimateGas.rollAll(poolId);
const gasWithBuffer = gasEstimate * 150 / 100; // 50% buffer for PRNG

// Roll in batches for large entries
for (let i = 0; i < totalEntries; i += 50) {
  await lazyLotto.rollBatch(poolId, Math.min(50, totalEntries - i));
}
```

### Error Handling

```javascript
try {
  await lazyLotto.createPool(...);
} catch (error) {
  if (error.message.includes('InsufficientHbarFee')) {
    // User didn't send enough HBAR
  } else if (error.message.includes('NotEnoughHbar')) {
    // User's wallet balance too low
  } else if (error.message.includes('BadParameters')) {
    // Invalid pool configuration
  }
}
```

### Backward Compatibility

The `calculateBoost()` facade in LazyLotto ensures existing integrations continue working:

```javascript
// Works with both old and new deployments
const boost = await lazyLotto.calculateBoost(userAddress);
// Old: Calculated internally in LazyLotto
// New: Facade to poolManager.calculateBoost()
```

For admin operations (pool ownership, enumeration), use PoolManager directly:

```javascript
// Pool enumeration (new functionality)
const globalPools = await poolManager.getGlobalPools(0, 20);
const communityPools = await poolManager.getCommunityPools(0, 20);

// Ownership queries
const owner = await poolManager.getPoolOwner(poolId);
const userPools = await poolManager.getUserPools(userAddress);
```

---

## Testing Checklist

### Unit Tests
- [ ] Pool creation (admin free, user paid)
- [ ] Fee collection and tracking
- [ ] Proceeds recording and withdrawal
- [ ] Platform fee accumulation
- [ ] Authorization (canManagePool, canAddPrizes)
- [ ] Bonus calculations (time, NFT, LAZY)
- [ ] Pool enumeration (global, community, pagination)
- [ ] Ownership transfer
- [ ] Prize manager permissions

### Integration Tests
- [ ] Full gameplay flow (create → buy → roll → claim)
- [ ] Community pool creation with fee payment
- [ ] Proceeds withdrawal with 95/5 split
- [ ] Platform fee withdrawal by admin
- [ ] Bonus application during rolling
- [ ] NFT ticket redemption
- [ ] Pool ownership transfer
- [ ] Global vs community pool distinction

### Edge Cases
- [ ] Pool with zero prizes (should fail)
- [ ] Withdrawal with no proceeds
- [ ] Transfer global pool (should fail)
- [ ] Withdraw from global pool (should fail)
- [ ] Duplicate NFT bonus tokens
- [ ] Platform fee percentage changes (old pools unaffected)
- [ ] Pool creation with insufficient fees

---

## Deployment Sequence

```javascript
// 1. Deploy LazyLottoPoolManager
const PoolManager = await ethers.getContractFactory('LazyLottoPoolManager');
const poolManager = await PoolManager.deploy(
  lazyTokenAddress,
  lazyGasStationAddress,
  lazyDelegateRegistryAddress
);

// 2. Link PoolManager to LazyLotto (one-time, admin only)
await poolManager.setLazyLotto(lazyLottoAddress);

// 3. Link LazyLotto to PoolManager (one-time, admin only)
await lazyLotto.setPoolManager(poolManager.address);

// 4. Set initial creation fees
await poolManager.setCreationFees(hbarFee, lazyFee);

// 5. Set platform proceeds percentage
await poolManager.setPlatformProceedsPercentage(5); // 5%

// 6. Configure initial bonuses (optional)
await poolManager.setTimeBonus(startTime, endTime, bonusBps);
await poolManager.setNFTBonus(nftAddress, bonusBps);
await poolManager.setLazyBalanceBonus(threshold, bonusBps);

// 7. System ready for community pool creation
```

---

## Contract Addresses

**Mainnet** (Production):
```
LazyLotto: [To be deployed]
LazyLottoPoolManager: [To be deployed]
LazyLottoStorage: [Existing deployment]
```

**Testnet** (Hedera Testnet):
```
LazyLotto: [To be deployed]
LazyLottoPoolManager: [To be deployed]
LazyLottoStorage: [Existing deployment]
```

---

## API Reference

### LazyLotto Core Methods

```solidity
// Pool Creation
createPool(
  string name,
  string symbol,
  string memo,
  NFTFeeObject[] royalties,
  string ticketCID,
  string winCID,
  uint256 winRate,
  uint256 entryFee,
  address feeToken
) payable returns (uint256 poolId)

// Entry Purchase
buyEntry(uint256 poolId, uint256 ticketCount) payable
buyAndRollEntry(uint256 poolId, uint256 ticketCount) payable returns (uint256 wins, uint256 offset)
buyAndRedeemEntry(uint256 poolId, uint256 ticketCount) payable returns (int64[] serials)

// Rolling
rollAll(uint256 poolId) returns (uint256 wins, uint256 offset)
rollBatch(uint256 poolId, uint256 numberToRoll) returns (uint256 wins, uint256 offset)
rollWithNFT(uint256 poolId, int64[] serialNumbers) returns (uint256 wins, uint256 offset)

// Prize Management
addPrizePackage(uint256 poolId, address token, uint256 amount, address[] nftTokens, uint256[][] nftSerials) payable
addMultipleFungiblePrizes(uint256 poolId, address token, uint256[] amounts) payable
removePrizes(uint256 poolId, uint256 prizeIndex)

// Claims
claimPrize(uint256 pkgIdx)
claimAllPrizes()
redeemPrizeToNFT(uint256[] indices) returns (int64[] serials)
claimPrizeFromNFT(address tokenId, int64[] serialNumbers)

// Pool Management
pausePool(uint256 poolId)
unpausePool(uint256 poolId)
closePool(uint256 poolId)

// Proceeds
withdrawPoolProceeds(uint256 poolId, address token)
withdrawPlatformFees(address token)

// Views
totalPools() returns (uint256)
getPoolBasicInfo(uint256 poolId) returns (tuple)
getPrizePackage(uint256 poolId, uint256 prizeIndex) returns (PrizePackage)
getUsersEntries(uint256 poolId, address user) returns (uint256)
getPendingPrizesCount(address user) returns (uint256)
getPendingPrizesPage(address user, uint256 start, uint256 count) returns (PendingPrize[])

// Bonus (facade to PoolManager)
calculateBoost(address user) returns (uint32)
```

### LazyLottoPoolManager Methods

```solidity
// Setup (one-time)
setLazyLotto(address) // Called once after deployment

// Authorization
canManagePool(uint256 poolId, address user) returns (bool)
canAddPrizes(uint256 poolId, address user) returns (bool)

// Pool Registration (called by LazyLotto)
recordPoolCreation(uint256 poolId, address creator, bool isGlobalAdmin) payable

// Creation Fees
getCreationFees() returns (uint256 hbar, uint256 lazy)
setCreationFees(uint256 hbarFee, uint256 lazyFee)

// Proceeds Management (called by LazyLotto)
recordProceeds(uint256 poolId, address token, uint256 amount)
requestWithdrawal(uint256 poolId, address token, address caller) returns (uint256 ownerShare)
getPoolProceeds(uint256 poolId, address token) returns (uint256 total, uint256 withdrawn)
getPlatformBalance(address token) returns (uint256)
withdrawPlatformFees(address token)
setPlatformProceedsPercentage(uint256 percentage)
getPoolPlatformFeePercentage(uint256 poolId) returns (uint256)

// Ownership
getPoolOwner(uint256 poolId) returns (address)
getUserPools(address user) returns (uint256[])
transferPoolOwnership(uint256 poolId, address newOwner)
setPoolPrizeManager(uint256 poolId, address manager)
getPoolPrizeManager(uint256 poolId) returns (address)

// Prize Managers
addGlobalPrizeManager(address)
removeGlobalPrizeManager(address)
isGlobalPrizeManager(address) returns (bool)

// Pool Enumeration
isGlobalPool(uint256 poolId) returns (bool)
totalGlobalPools() returns (uint256)
totalCommunityPools() returns (uint256)
getGlobalPools(uint256 offset, uint256 limit) returns (uint256[])
getCommunityPools(uint256 offset, uint256 limit) returns (uint256[])

// Bonus System
calculateBoost(address user) returns (uint32)
setTimeBonus(uint256 start, uint256 end, uint16 bonusBps)
removeTimeBonus(uint256 index)
setNFTBonus(address token, uint16 bonusBps)
removeNFTBonus(uint256 index)
setLazyBalanceBonus(uint256 threshold, uint16 bonusBps)
totalTimeBonuses() returns (uint256)
totalNFTBonusTokens() returns (uint256)
```

---

## Support

For technical questions, integration support, or bug reports:
- **Documentation**: This guide and associated architecture docs
- **Contract Source**: `contracts/LazyLotto.sol`, `contracts/LazyLottoPoolManager.sol`
- **Test Examples**: `test/LazyLotto.test.js`, `test/LazyLottoPoolManager.test.js`
- **Website**: https://lazysuperheroes.com/
- **DApp**: https://dapp.lazysuperheroes.com/

---

**End of Implementation Guide**
