# Changelog

All notable changes to the LazyLotto smart contract project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [npm 1.5.0] - 2026-10-16

Package release of `@lazysuperheroes/lazy-lotto` (ABIs, CLI and utils); no contract changes.

### Changed

- **Runtime dependencies trimmed to what the published files use:** `@hashgraph/sdk`, `@lazysuperheroes/hedera-multisig`, `axios`, `dotenv` and `ethers`. Hardhat toolbox, `solhint`, `chai`, `hardhat-docgen`, `hardhat-contract-sizer`, OpenZeppelin contracts and the script-only packages (`@directus/sdk`, `abi-decoder`, `chalk`, `readline-sync`) moved to `devDependencies`. A fresh install drops from about 1,080 packages to about 370, and most of the audit advisories go with them.
- Minimum versions raised: `@lazysuperheroes/hedera-multisig` ^2.3.0 (no longer installs `localtunnel` and its `axios` 0.21.4), `axios` ^1.20.0, `ethers` ^6.17.0.
- ABIs: `LazyLotto` no longer lists `setPrng` and `LazyLottoPoolManager` no longer lists `CannotTransferGlobalPools`; neither exists on the deployed contracts.

### Fixed

- `utils/hederaMirrorHelpers.js` (used by the CLI) required `hardhat` for `ethers`, so the CLI only ran when npm happened to install Hardhat as a peer. It now requires `ethers` directly.

## [2.1.0] - 2025-12-02

### 🔴 BREAKING CHANGES

Contract size optimization required removing three view functions and replacing them with paginated alternatives. **All frontend code and scripts must be updated.**

See [API Breaking Changes Guide](./LazyLotto-API_BREAKING_CHANGES.md) for complete migration instructions.

### Removed

- **`getPoolDetails(uint256 id)`** - Returned full pool struct with unbounded prizes array
  - Issue: Pools with 30+ prizes caused 400 errors from mirror node
  - Replaced by: `getPoolBasicInfo()`
  
- **`getPendingPrizes(address user)`** - Returned all pending prizes for a user
  - Issue: Users with 50+ prizes caused response size failures
  - Replaced by: `getPendingPrizesPage()` + `getPendingPrizesCount()`
  
- **`getUserEntries(address user)`** - Returned entries across all pools
  - Issue: Could fail with 100+ pools in workspace
  - Replaced by: `getUserEntriesPage()`

### Added

- **`getPoolBasicInfo(uint256 id)`** - Returns pool data without prizes array
  - Returns: Tuple of 10 values (ticketCID, winCID, winRate, entryFee, **prizeCount**, outstandingEntries, poolTokenId, paused, closed, feeToken)
  - Key difference: Returns prize **count** (uint256) instead of prizes **array**
  - Never fails regardless of prize count
  - ~40% lighter response than old `getPoolDetails()`

- **`getPendingPrizesCount(address user)`** - Returns count of pending prizes
  - Returns: uint256
  - Allows checking if user has prizes before fetching details
  - Enables smart pagination logic

- **`getPendingPrizesPage(address user, uint256 startIndex, uint256 count)`** - Paginated prizes
  - Returns: PendingPrize[] (slice of user's prizes)
  - Parameters: user address, start index (0-based), max count to return
  - Returns empty array if startIndex >= total prizes
  - Supports efficient fetching of large prize collections

- **`getUserEntriesPage(address user, uint256 startPoolId, uint256 count)`** - Paginated entries
  - Returns: uint256[] (entry counts for pool range)
  - Parameters: user address, start pool ID (0-based), max count to return
  - Returns empty array if startPoolId >= total pools
  - Supports efficient querying across many pools

### Changed

- Contract size: 23.75 KB → 23.782 KB (+32 bytes net after removals/additions)
- Contract remains under 24 KB Hedera limit (99.1% capacity)

### Fixed

- Mirror node 400 errors when querying pools with many prizes
- Response size failures for users with many pending prizes
- Query failures in workspaces with many pools

### Documentation

- Added: `LazyLotto-API_BREAKING_CHANGES.md` - Complete migration guide
- Updated: `LazyLotto-UX_IMPLEMENTATION_GUIDE.md` - v2.1 with new API patterns
- Updated: `README.md` - Breaking changes notice and new documentation links
- Updated: `LOTTO_POOL_REFACTOR_PLAN.md` - Implementation plan and rationale

### Migration Impact

**Scripts requiring updates:** 12 scripts
- Admin: `addPrizePackage.js`, `closePool.js`, `removePrizes.js`, `createPool.js`
- Queries: `masterInfo.js`, `poolInfo.js`, `userState.js`
- User: `buyEntry.js`, `rollTickets.js`, `buyAndRoll.js`, `redeemEntriesToNFT.js`, `claimPrize.js`, `claimAllPrizes.js`

**Tests requiring updates:** All tests using removed function names in `test/LazyLotto.test.js`

---

## [2.0.0] - 2025-11-12

### Added

- Prize Manager role - separate authorization for prize addition
- NFT bonus deduplication - prevents duplicate bonus calculations
- Entry redemption via `redeemEntriesToNFT()` - convert memory entries to tradeable NFT tickets
- Enhanced gas estimation patterns for PRNG operations
- Mirror node integration patterns for balance verification
- Safety checks for admin withdrawals based on prize obligations

### Documentation

- LazyLotto Business Logic guide
- UX Implementation Guide for frontend developers
- Production Readiness Summary
- Testing Plan
- Code Coverage Analysis

---

## [1.0.0] - Initial Release

### Added

- Multi-pool lottery system with customizable parameters
- Support for HBAR, HTS fungible tokens, and NFT prizes
- Dual ticket system: memory-based and NFT-based
- Boost system: time-based, NFT-based, and LAZY balance-based bonuses
- Prize management with NFT conversion capability
- Admin and Prize Manager role system
- Split-contract architecture (LazyLotto + LazyLottoStorage)
- Comprehensive event logging
- PRNG-based verifiable randomness
- 22 CLI interaction scripts
- Full test suite with ~70% coverage
