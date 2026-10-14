# Changelog

All notable changes to the LazyLotto smart contract project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - LazyTradeLotto v2

### 🔴 BREAKING CHANGES

LazyTradeLotto v2 is a fresh deployment; v1 signatures and the v1 `rollLotto` call do not work against it. Signer and client changes are in [LazyTradeLotto-V2_SIGNER_GUIDE.md](./LazyTradeLotto-V2_SIGNER_GUIDE.md).

### Changed

- **`rollLotto`** takes two new arguments before `teamSignature`: `bool burnExempt` and `uint256 deadline`; rolls after the deadline revert `SignatureExpired()`.
- **Signed roll message** now binds `address(this)` and `block.chainid` and includes `burnExempt` and the deadline, so a signature is valid for one contract on one network for a limited time (audit TL-02).
- **Burn exemption is signed, not looked up**: the signer decides whether the roller is an LSH holder or valid delegate. The contract no longer reads LSH balances or LazyDelegateRegistry on wins, so a broken dependency can't block payouts (TL-04) and stale delegations no longer grant 0% burn (TL-05).
- **`boostJackpot`** clamps the pool to `maxJackpotPool` and emits `JackpotUpdate` with the new total instead of the boost amount (TL-06).
- **Zero-amount payouts are skipped instead of reverting**: a regular win that draws 0 (possible when `minWinAmt` is 0) or a jackpot hit on an empty pool (possible with `lottoLossIncrement` 0) now completes without paying. Previously LazyGasStation rejected the zero payout, which reverted the roll and let the ticket be rolled again.
- **Constructor** is now `(prng, lazyGasStation, systemWallet, initialJackpot, lossIncrement, burnPercentage, maxWinAmtCap, payoutWindowCap)`. The LSH collections and delegate registry are gone. `deployLazyTradeLotto.js` / `lazyLottoDeployAll.js` read `LOTTO_MAX_WIN_CAP` and `LOTTO_PAYOUT_WINDOW_CAP` (whole $LAZY).

### Removed

- `getBurnForUser`, `LSH_GEN1`, `LSH_GEN2`, `LSH_GEN1_MUTANT`, `lazyDelegateRegistry`.

### Added

- **`maxWinAmtCap` / `updateMaxWinAmtCap`**: owner-settable upper bound on the signed `maxWinAmt` (TL-03).
- **24h payout cap**: `payoutWindowCap` / `updatePayoutWindowCap` / `getPayoutWindow()`. Regular wins plus jackpots per 24h window; a win that would exceed it reverts `PayoutCapReached()`. Bounds total loss from a leaked signer across many rolls (TL-03).
- **EOA-only rolls**: `rollLotto` reverts `OnlyEOA()` unless `tx.origin == msg.sender`, an on-chain backstop for the signer's EOA-only rule (TL-01). `setRequireCodelessCaller(true)` also requires `msg.sender.code.length == 0`, rejecting HIP-1340 / EIP-7702 delegated EOAs. It is off by default, to be enabled once validated on testnet, with no redeploy.
- **`getRollMessageHash(...)`**: the exact digest the contract verifies, for signer parity checks.
- Scripts: `admin/updateMaxWinCap.js`, `admin/updatePayoutWindowCap.js`, `admin/setRequireCodelessCaller.js`; `queries/getUserBurn.js` is now the reference off-chain burn-exemption resolver; `getLottoInfo.js` shows the caps, payout window and caller policy; the `testing/` scripts sign the v2 format (`--contract`, `--ttl`, `--burnExempt`) and `rollLottoTest.js` pre-flights digest parity, the win cap, the payout window and the resolved exemption. Test mocks `contracts/mocks/CallForwarder.sol`, `contracts/mocks/MockLazyGasStation.sol`.

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
