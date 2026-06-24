# LazyLotto Interaction Scripts

Comprehensive collection of scripts for interacting with the LazyLotto contract system.

## Prerequisites

Ensure your `.env` file is configured:

```env
ACCOUNT_ID=0.0.xxxxx
PRIVATE_KEY=302...
ENVIRONMENT=test
LAZY_LOTTO_CONTRACT_ID=0.0.xxxxx
LAZY_LOTTO_STORAGE=0.0.xxxxx
```

## Script Categories

### 📊 Query Scripts (`queries/`)

Read-only scripts for retrieving contract state:

- **`masterInfo.js`** - Comprehensive contract state (all pools, all data)
- **`poolInfo.js`** - Detailed information about a specific pool
- **`userState.js`** - User's tickets, prizes, and boost information
- **`poolPrizes.js`** - All prizes in a pool with detailed breakdown
- **`contractConfig.js`** - Contract configuration and settings
- **`analysePlayPatterns.js`** - Replays on-chain events + state to analyse play patterns: who plays which pools, paid vs free vs NFT-sourced entries, bonus usage, actual-vs-expected win odds, hourly activity, top players, prize claims. Pass a contract ID and `--env`, optionally `--json <path>`.

### 👤 User Scripts (`user/`)

Scripts for regular user operations:

- **`buyEntry.js`** - Purchase lottery tickets (memory entries)
- **`buyAndRedeemToNFT.js`** - Purchase and mint tickets as NFTs
- **`buyAndRoll.js`** - Purchase and immediately roll tickets
- **`rollTickets.js`** - Roll existing tickets (memory or NFT)
- **`claimPrize.js`** - Claim a specific prize
- **`claimAllPrizes.js`** - Claim all pending prizes
- **`redeemPrizeToNFT.js`** - Convert prizes to tradeable NFTs
- **`claimFromPrizeNFT.js`** - Claim prizes from NFT voucher

### 🔧 Admin Scripts (`admin/`)

Scripts for contract administrators:

**Pool Management:**
- **`createPool.js`** - Create a new lottery pool
- **`addPrizePackage.js`** - Add prizes to a pool
- **`pausePool.js`** - Pause ticket sales for a pool
- **`unpausePool.js`** - Resume ticket sales
- **`closePool.js`** - Permanently close a pool
- **`removePrizes.js`** - Remove prizes from closed pool

**Role & Access Management:**
- **`manageRoles.js`** - Add/remove admins and prize managers

**Configuration:**
- **`setBonuses.js`** - Configure bonus system (NFT, time, LAZY balance)
- **`setBurnPercentage.js`** - Set LAZY burn percentage for entry fees
- **`setPrng.js`** - Update PRNG contract address

**Emergency Controls:**
- **`pauseContract.js`** - Emergency pause/unpause entire contract

**Token Management:**
- **`withdrawTokens.js`** - Withdraw excess tokens (with safety checks)

**Promotional Tools:**
- **`grantEntry.js`** - Grant free entries to *any* address (in-memory entries, not NFTs)
- **`buyAndRedeemEntry.js`** - Create free NFT tickets for the **admin's own wallet only**

> 💡 To deliver free NFT tickets to **someone else** (e.g. a community manager) without
> triggering NFT royalties, use the two-step pattern described in
> [Delivering Free NFT Tickets to Another Address](#delivering-free-nft-tickets-to-another-address-royalty-free).
> Do **not** mint to yourself and then transfer — that secondary transfer pays royalties.

## Usage Examples

### Query Contract State

```bash
# Get comprehensive contract information
node scripts/interactions/LazyLotto/queries/masterInfo.js

# Get specific pool details
node scripts/interactions/LazyLotto/queries/poolInfo.js

# Check your tickets and prizes
node scripts/interactions/LazyLotto/queries/userState.js
```

### Buy and Play

```bash
# Buy tickets and keep in memory
node scripts/interactions/LazyLotto/user/buyEntry.js

# Buy tickets as NFTs
node scripts/interactions/LazyLotto/user/buyAndRedeemToNFT.js

# Buy and play immediately
node scripts/interactions/LazyLotto/user/buyAndRoll.js

# Roll existing tickets
node scripts/interactions/LazyLotto/user/rollTickets.js
```

### Claim Prizes

```bash
# Claim specific prize
node scripts/interactions/LazyLotto/user/claimPrize.js

# Claim all prizes at once
node scripts/interactions/LazyLotto/user/claimAllPrizes.js
```

### Admin Operations

```bash
# Create new pool
node scripts/interactions/LazyLotto/admin/createPool.js

# Add prizes to pool
node scripts/interactions/LazyLotto/admin/addPrizePackage.js

# Manage roles
node scripts/interactions/LazyLotto/admin/manageRoles.js
```

## Important Notes

### Gas Estimation

**All roll operations use 2x gas multiplier** to account for PRNG variability:
- `rollTickets.js` - 2x gas
- `buyAndRoll.js` - 2x gas
- Any operation with `roll` in the name - 2x gas

Other operations use standard gas estimates.

### Token Approvals

**Important**: Token approvals must be made to the **storage contract**, not LazyLotto:

```javascript
// Get storage address
const storageAddress = await lazyLottoContract.storageContract();

// Approve tokens to storage
await tokenContract.approve(storageAddress, amount);
```

Scripts will automatically handle this for you.

### Delivering Free NFT Tickets to Another Address (Royalty-Free)

**Goal:** give free, tradeable NFT tickets to a *different* account (a community manager,
a winner, a promo recipient) — not the admin's own wallet.

**Why you can't just mint-and-send:** `adminBuyAndRedeemEntry` (`buyAndRedeemEntry.js`)
hardcodes `msg.sender` as the recipient, so it only ever mints to the admin's own wallet.
If the admin then transfers those NFTs onward, that is a **secondary transfer** and the
pool ticket collection's **royalty fee is charged** — the "tricky to send" problem.

**Why the two-step pattern is free:** on Hedera, custom royalty fees are **not assessed
when the token treasury is the sender**. `LazyLottoStorage` *is* the treasury for pool
ticket NFTs and mints + transfers directly to the recipient in one operation
(`mintAndTransferNFT`). Because the recipient receives straight from treasury, no royalty
is charged. The admin wallet never touches the NFT, so there is no royalty-bearing hop.

**Steps (no contract change / redeploy required):**

```bash
# 1) Admin grants free in-memory entries to the recipient (not to themselves).
#    adminGrantEntry(poolId, ticketCount, recipient) — recipient is an arbitrary address.
node scripts/interactions/LazyLotto/admin/grantEntry.js
#    → enter poolId, ticketCount, and the recipient's account (e.g. the community manager)

# 2) The RECIPIENT redeems their granted entries to NFTs, from their OWN account.
#    redeemEntriesToNFT(poolId, ticketCount) uses msg.sender, so this must be run by them.
#    NFTs are minted treasury → recipient = royalty-free.
node scripts/interactions/LazyLotto/user/redeemEntriesToNFT.js
```

**Recipient prerequisites:**
- Must have **associated** the pool's ticket NFT token before step 2 (Hedera requires
  association to receive any token).
- Must run step 2 themselves (with their own key) — the redeem call is keyed to `msg.sender`.

**Cost:** the entries are free (granted with `isFreeOfPayment = true` in step 1); the
recipient pays only network gas for the redeem transaction. No entry fee, no royalty.

**Batch size — redeem in chunks of ~30:** redeeming mints NFTs in internal batches of 10,
and the entire redeem is a single transaction bound by Hedera's ~15M gas-per-transaction
cap. Redeeming too many at once reverts with `FailedNFTMintAndSend` (`0x5d06f460`) once gas
runs out mid-mint — observed on mainnet: a **90-at-once redeem consumed ~14.4M gas and
reverted** (pool #4). There is no way to fit 90 in one transaction regardless of the gas
setting. The failed transaction **fully reverts**, so the granted entries are preserved and
can simply be retried in smaller batches. Use **~30 per redeem** (≈5M gas, comfortable
margin); ~50 is the aggressive upper bound.

> If a single admin-only call that mints free tickets straight to an arbitrary address is
> ever needed, it requires a contract change (add a `recipient` param to
> `adminBuyAndRedeemEntry` / `_redeemEntriesToNFT`; `mintAndTransferNFT` already supports
> it) **plus a mainnet redeploy + migration**. The two-step pattern above achieves the
> identical royalty-free result with no redeploy and is the recommended approach.

### Input Formats

All scripts accept both Hedera and EVM address formats:
- **Hedera format**: `0.0.12345`
- **EVM format**: `0x0000000000000000000000000000000000003039`

Scripts will automatically convert between formats as needed.

### Safety Checks

Scripts include comprehensive safety checks:
- ✅ Token association verification before NFT operations
- ✅ Mirror node queries for NFT serial ownership
- ✅ Balance verification before transactions
- ✅ Allowance checks before token transfers
- ✅ Pool state validation

### Mirror Node Integration

Scripts use mirror node for real-time data:
- NFT serial ownership verification
- Token association checks
- Balance confirmations
- Independent state verification

## Error Handling

All scripts include:
- Input validation with clear error messages
- Pre-transaction safety checks
- Transaction status monitoring
- Helpful error explanations
- Retry suggestions when applicable

## Interactive Mode

Most scripts support interactive prompts:
- Guided input for required parameters
- Confirmation before expensive operations
- Clear progress indicators
- Result summaries

## Troubleshooting

**Issue: "Contract ID not found"**
- Ensure `LAZY_LOTTO_CONTRACT_ID` is set in `.env`

**Issue: "Insufficient allowance"**
- Scripts will prompt you to set allowances
- Approvals are made to storage contract automatically

**Issue: "Token not associated"**
- Scripts check associations before NFT operations
- Will prompt to associate if needed

**Issue: "Transaction failed"**
- Check account balance (HBAR for gas)
- Verify pool is not paused
- Ensure sufficient token balance for entry fees

**Issue: "Gas estimate exceeded"**
- Roll operations use 2x multiplier automatically
- If still failing, increase gas manually in script

## Support

For detailed business logic and use cases, see:
- `LazyLotto-BUSINESS_LOGIC.md`
- `LazyLotto-UX_IMPLEMENTATION_GUIDE.md`
- `LazyLotto-TESTING_PLAN.md`

For test examples, see:
- `test/LazyLotto.test.js`
