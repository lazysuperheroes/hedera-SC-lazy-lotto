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
- **`grantEntry.js`** - Grant free entries to users
- **`buyAndRedeemEntry.js`** - Create free NFT tickets for admin

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
