# LazyLotto Project - Script Organization

This folder contains interaction scripts for all contracts in the LazyLotto project, organized by contract for clarity and maintainability.

## 📁 Folder Structure

```
scripts/interactions/
├── LazyLotto/                  # Complete lottery game system (24 scripts)
│   ├── admin/                  # Pool management, roles, configuration, prize tools (11 scripts)
│   │   └── recipes/           # Prize config templates for generatePrizeConfig.js
│   ├── queries/                # Contract state and user info queries (3 scripts)
│   ├── user/                   # Player interactions - buy, roll, claim (8 scripts)
│   ├── README.md              # Detailed game mechanics and script guide
│   └── SCRIPTS_COMPLETE.md    # Complete script inventory with status
│
├── LazyTradeLotto/            # Trade-based lottery with jackpot (12 scripts)
│   ├── admin/                  # Jackpot, burn %, pause/unpause (8 scripts)
│   ├── queries/                # Lottery info, burn rates, history (4 scripts)
│   ├── testing/                # Test scripts for signature-gated roll (TODO)
│   └── README.md              # Signature-gated design explanation
│
├── LazySecureTrade/           # Secure peer-to-peer trading (3 scripts)
│   ├── getLazySecureTradeLogs.js    # Event logs query
│   ├── setLazyBurnPercentage.js     # Admin: Configure burn % for trades
│   └── setLazyCostForTrade.js       # Admin: Set LAZY fee per trade
│
├── LazyDelegateRegistry/      # Token delegation system (2 scripts)
│   ├── checkDelegations.js    # Query: View delegations for token/delegatee
│   └── delegateToken.js       # User: Delegate token to another account
│
├── LazyGasStation/            # Gas fee sponsorship (1 script)
│   └── getLazyGasStationInfo.js     # Query: View gas station config
│
└── Utilities/                 # General-purpose helpers (1 script)
    └── getContractResultFromMirror.js  # Fetch transaction results from mirror node
```

## 🎯 Contract Overview

### LazyLotto (Complete - 22/22 scripts)
**Purpose**: Full-featured lottery game with memory entries, prize NFTs, and multi-pool support.

**Key Features**:
- Multiple pool support with different entry costs
- Memory entries (redeemable to NFTs) and prize NFTs
- Bonus wheel system with randomized rewards
- Prize packages with token and HBAR distributions
- Role-based access control (OWNER, MANAGER, OPERATIONAL)

**Script Categories**:
- **Admin** (11): Pool creation, prize management, pause/unpause, roles, bonuses, prize config tools
- **Queries** (3): Master info, pool info, user state
- **User** (8): Buy entries, roll tickets, claim prizes, redeem to NFTs

**Status**: ✅ Complete - All scripts implemented, tested, and documented

---

### LazyTradeLotto (In Progress - 12/15 scripts, 80%)
**Purpose**: Lottery triggered by LazySecureTrade transactions with jackpot pool.

**Key Features**:
- **Signature-Gated Design**: `rollLotto()` requires systemWallet signature
- **Platform-Integrated**: Rolls executed by platform, not CLI users
- **LSH NFT Benefits**: Holders pay 0% burn (Gen1, Gen2, Mutant)
- **Configurable Jackpot**: Dynamic growth, caps, increment percentages
- **Burn Mechanism**: 10% default burn on winnings (0% for LSH holders)

**Script Categories**:
- **Admin** (8/8) ✅: Jackpot boost, burn %, pause/unpause, system wallet, config
- **Queries** (4/4) ✅: Lottery info, burn rates, trade history, logs
- **Testing** (0/3) ⏳: Roll signature test, generate signature, simulate trade

**Why Signature-Gated?**
- Prevents unauthorized lottery rolls
- Ensures trades are verified before rolling
- Platform controls roll timing and validation
- CLI scripts focus on admin/query operations

**Status**: 🔄 Core functionality complete, testing scripts TODO

---

### LazySecureTrade (Complete - 3/3 scripts)
**Purpose**: Secure peer-to-peer trading with LAZY token fees.

**Key Features**:
- Escrow-based trading system
- LAZY token fees per trade
- Configurable burn percentage on fees
- Connected to LazyTradeLotto for roll triggers

**Scripts**:
1. `getLazySecureTradeLogs.js` - Query trade events
2. `setLazyBurnPercentage.js` - Admin: Set burn % (0-100)
3. `setLazyCostForTrade.js` - Admin: Set LAZY fee per trade

**Status**: ✅ Complete - All admin and query scripts implemented

---

### LazyDelegateRegistry (Complete - 2/2 scripts)
**Purpose**: Token delegation for meta-transaction support.

**Key Features**:
- Delegate tokens without transferring ownership
- Query delegations by token or delegatee
- Supports Hedera token IDs and EVM addresses

**Scripts**:
1. `checkDelegations.js` - Query: View delegations
2. `delegateToken.js` - User: Delegate token to account

**Status**: ✅ Complete - Delegation and query scripts implemented

---

### LazyGasStation (Complete - 1/1 scripts)
**Purpose**: Gas fee sponsorship for users.

**Key Features**:
- Sponsored transactions for approved users
- Configurable gas limits and allowances

**Scripts**:
1. `getLazyGasStationInfo.js` - Query: View gas station configuration

**Status**: ✅ Complete - Query script implemented

---

### Utilities (Complete - 1/1 scripts)
**Purpose**: General-purpose helper scripts.

**Scripts**:
1. `getContractResultFromMirror.js` - Fetch transaction results from mirror node

**Status**: ✅ Complete

---

## 📊 Project Status Summary

| Contract | Total Scripts | Complete | Pending | Progress |
|----------|--------------|----------|---------|----------|
| **LazyLotto** | 24 | 24 | 0 | ✅ 100% |
| **LazyTradeLotto** | 15 | 12 | 3 | 🔄 80% |
| **LazySecureTrade** | 3 | 3 | 0 | ✅ 100% |
| **LazyDelegateRegistry** | 2 | 2 | 0 | ✅ 100% |
| **LazyGasStation** | 1 | 1 | 0 | ✅ 100% |
| **Utilities** | 1 | 1 | 0 | ✅ 100% |
| **TOTAL** | **46** | **43** | **3** | **93%** |

### Remaining Work
- [ ] LazyTradeLotto testing scripts (3):
  - `testing/rollLottoTest.js` - Test roll with signature
  - `testing/generateSignature.js` - Create systemWallet signatures
  - `testing/simulateTrade.js` - Complete trade → roll flow

---

## 🚀 Usage

### Running Scripts

All scripts follow consistent patterns:

**Query Scripts** (no transaction):
```powershell
node <ContractFolder>/<script.js> <contractId>
# Example: node LazyLotto/queries/masterInfo.js 0.0.123456
```

**Admin Scripts** (requires PRIVATE_KEY in .env):
```powershell
node <ContractFolder>/admin/<script.js> <contractId> <...params>
# Example: node LazyTradeLotto/admin/boostJackpot.js 0.0.123456 1000
```

**User Scripts** (requires PRIVATE_KEY in .env):
```powershell
node <ContractFolder>/user/<script.js> <contractId> <...params>
# Example: node LazyLotto/user/buyEntry.js 0.0.123456 1 10
```

### Environment Setup

All scripts require a `.env` file at project root:

```env
# Required for all scripts
ENVIRONMENT=testnet  # or mainnet
ACCOUNT_ID=0.0.xxxxx
PRIVATE_KEY=302e...  # ED25519 private key

# Contract-specific (if needed)
LAZY_TOKEN_ID=0.0.xxxxx
LAZY_DECIMALS=1
```

### Import Paths

Scripts use shared utility modules via relative paths:

```javascript
// All scripts use the shared CLI infrastructure:
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { prompt } = require('../../../../utils/promptHelpers');
const { queryContract } = require('../../../../utils/queryHelpers');

// Path depth varies by directory:
// LazyLotto/admin/*.js, LazyLotto/user/*.js, LazyLotto/queries/*.js → ../../../../utils/
// LazyDelegateRegistry/*.js, LazySecureTrade/*.js, LazyGasStation/*.js → ../../../utils/
// healthCheck.js → ../../utils/
```

---

## 🔐 Multi-Signature Support

All admin scripts in **LazyLotto** and **LazyTradeLotto** support multi-signature transactions for enhanced security.

### Quick Start

```bash
# Single-signature (default behavior)
node LazyLotto/admin/setPlatformFee.js 10

# Multi-signature (2-of-3 interactive)
node LazyLotto/admin/setPlatformFee.js 10 --multisig --threshold=2

# LazyTradeLotto with multi-sig
node LazyTradeLotto/admin/boostJackpot.js 0.0.123456 1000 --multisig --threshold=2
```

### Command-Line Flags

| Flag | Description |
|------|-------------|
| `--multisig` | Enable multi-signature mode |
| `--multisig-help` | Display multi-sig help |
| `--threshold=N` | Require N signatures (default: all) |
| `--signers=A,B,C` | Label signers for clarity |
| `--workflow=interactive\|offline` | Choose workflow (default: interactive) |
| `--export-only` | Freeze and export (offline phase 1) |
| `--signatures=s1.json,s2.json` | Execute with collected signatures (offline phase 3) |
| `--keyfiles=k1.enc,k2.enc` | Use encrypted key files |

### Supported Scripts

**LazyLotto (11 admin scripts):**
- `createPool.js`, `closePool.js`, `pauseContract.js`, `unpausePool.js`
- `setPlatformFee.js`, `setBonuses.js`, `setCreationFees.js`
- `addGlobalPrizeManager.js`, `withdrawTokens.js`
- `approveNFTsToStorage.js`, `generatePrizeConfig.js`

**LazyTradeLotto (8 admin scripts):**
- `boostJackpot.js`, `pauseLottoContract.js`, `unpauseLottoContract.js`
- `updateLottoBurnPercentage.js`, `updateLottoJackpotIncrement.js`
- `updateMaxJackpotThreshold.js`, `updateLottoSystemWallet.js`
- `transferHbarFromLotto.js`

### Documentation

For complete multi-sig documentation, see:
- **User Guide**: `docs/MULTISIG_USER_GUIDE.md`
- **Security Guide**: `docs/MULTISIG_SECURITY.md`
- **Developer Guide**: `docs/MULTISIG_DEVELOPER_GUIDE.md`

---

## 🎰 Prize Configuration Workflow

LazyLotto includes a recipe-based system for defining, generating, and uploading prize packages. This supports the free-roll ticket mechanism where admin-minted NFT tickets are packaged alongside HBAR/NFT prizes.

### Scripts

| Script | Purpose |
|--------|---------|
| `buyAndRedeemEntry.js` | Mint free-roll NFT tickets (admin creates free entries → auto-redeemed to tradeable NFT tickets) |
| `generatePrizeConfig.js` | Transform a recipe file into batch-upload JSON |
| `approveNFTsToStorage.js` | Verify/set NFT collection approvals to LazyLottoStorage |
| `addPrizesBatch.js` | Upload prize packages to contract (handles approvals automatically) |

### Recipe Format

Recipes define prize tiers and NFT inventory in a single JSON file. Templates are in `LazyLotto/admin/recipes/`:

```json
{
  "poolId": 0,
  "inventory": {
    "ticket": {"token": "0.0.POOL_TOKEN", "serials": [1, 2, 3, ...]},
    "gen2":   {"token": "0.0.GEN2_TOKEN", "serials": [42, 55]},
    "mutant": {"token": "0.0.MUTANT_TOKEN", "serials": [7]},
    "utility": {"token": "0.0.UTILITY_TOKEN", "serials": [10, 11, 12]},
    "lazy":   {"token": "0.0.LAZY_TOKEN"}
  },
  "tiers": [
    {"name": "Jackpot", "count": 1, "hbar": "500", "nfts": [{"label": "mutant", "perPrize": 1}]},
    {"name": "Great",   "count": 5, "hbar": "50",  "nfts": [{"label": "ticket", "perPrize": 1}]},
    {"name": "Decent",  "count": 10, "hbar": {"min": "10", "max": "25"}},
    {"name": "LAZY consolation", "count": 4, "ft": {"label": "lazy", "amount": "150"}}
  ]
}
```

**Key features:**
- **NFT inventory** — define token addresses and available serials once; the generator assigns them across tiers automatically
- **HBAR ranges** — `{"min": "10", "max": "25"}` randomizes amounts within a range
- **Free-roll tickets** — pool ticket NFTs (from `buyAndRedeemEntry.js`) are referenced as `"label": "ticket"` and packaged alongside HBAR
- **FT prizes** — fungible tokens like $LAZY use `"ft"` with a label referencing inventory
- **Multi-collection packages** — a single tier can bundle NFTs from multiple collections

### Complete Workflow

**Step 1: Mint free-roll tickets** (for pools using the ticket mechanism)
```bash
node LazyLotto/admin/buyAndRedeemEntry.js
# → Enter pool ID and ticket count
# → Note the serial numbers from output (e.g. serials: 1, 2, 3, ..., 157)
```

**Step 2: Prepare recipe**
```bash
# Copy a template
cp LazyLotto/admin/recipes/lazyLounge-stage1.json my-prizes.json

# Edit: fill in poolId, token addresses, and serial numbers
```

**Step 3: Validate recipe**
```bash
node LazyLotto/admin/generatePrizeConfig.js -f my-prizes.json -dry
# Validates inventory, checks serial counts, shows summary — no file written
```

**Step 4: Generate batch JSON**
```bash
node LazyLotto/admin/generatePrizeConfig.js -f my-prizes.json
# Outputs: prizes-pool0-my-prizes.json (compatible with addPrizesBatch.js)

# Optional flags:
#   -o custom-output.json    Custom output filename
#   -shuffle                 Randomize serial assignment order
```

**Step 5: Upload to contract**
```bash
# Dry run (validates ownership, balances, allowances)
node LazyLotto/admin/addPrizesBatch.js -f prizes-pool0-my-prizes.json -dry

# Live upload (sets allowances automatically, submits packages one by one)
node LazyLotto/admin/addPrizesBatch.js -f prizes-pool0-my-prizes.json
```

### Available Recipe Templates

| Template | Pool | Prizes | Description |
|----------|------|--------|-------------|
| `lazyLounge-stage1.json` | LAZY Lounge | 100 | 150 LAZY entry, HBAR + free-roll tickets, net LAZY burner |
| `luckyDip-initial.json` | Lucky Dip | 50 | 10 HBAR entry, HBAR ranges, LAZY consolations, Gen2 jackpot |

### Checking Approvals Independently

```bash
# Check if collections are approved to storage
node LazyLotto/admin/approveNFTsToStorage.js -tokens 0.0.12345,0.0.67890 -check

# Set approvals (interactive)
node LazyLotto/admin/approveNFTsToStorage.js
```

Note: `addPrizesBatch.js` handles approvals automatically during upload. The standalone script is useful for verification or pre-setup.

---

## 📚 Contract ABIs

ABIs are located in `abi/` folder at project root:
- `LazyLotto.json`
- `LazyTradeLotto.json`
- `LazyDelegateRegistry.json`
- `LazyGasStation.json`
- (LazySecureTrade uses HederaTokenService ABI)

---

## 🔗 Dependencies

All scripts use shared utility modules:

**CLI Infrastructure** (used by all scripts):
- `utils/clientFactory.js` - `createClient()`, `getEnvConfig()`, `getContractId()`
- `utils/abiLoader.js` - `loadInterface()` - cached ABI loading
- `utils/queryHelpers.js` - `queryContract()` - one-line read-only queries
- `utils/promptHelpers.js` - `prompt()`, `confirm()` - shared readline

**Domain Helpers**:
- `utils/solidityHelpers.js` - `contractExecuteFunction()`, `batchMirrorQuery()`
- `utils/scriptHelpers.js` - `executeContractFunction()` (multi-sig aware)
- `utils/hederaMirrorHelpers.js` - `getTokenDetails()`, `getEventsFromMirror()`, `checkMirrorHbarBalance()`
- `utils/nodeHelpers.js` - `getArgFlag()` - Parse CLI arguments

**`utils/transactionHelpers.js`**:
- Transaction signing and submission helpers

---

## 🎯 Best Practices

1. **Always check contract address**: Verify you're using correct testnet/mainnet address
2. **Test on testnet first**: All scripts work on testnet before mainnet
3. **Check gas costs**: Admin scripts estimate gas before execution
4. **Read contract state**: Use query scripts before admin operations
5. **Backup private keys**: Never commit `.env` files to version control

---

## 📝 Notes

### LazyTradeLotto Special Considerations
- **Cannot call `rollLotto()` from CLI**: Requires systemWallet signature
- **Use testing scripts**: For TestNet, generate signatures manually
- **Platform integration**: Rolls executed automatically by backend
- **LSH NFT benefits**: Check `getUserBurn.js` for 0% burn eligibility

### Script Naming Conventions
- **Query scripts**: Start with `get` or `check` (e.g., `getLottoInfo.js`)
- **Admin scripts**: Action verbs (e.g., `pauseLottoContract.js`, `boostJackpot.js`)
- **User scripts**: Player actions (e.g., `buyEntry.js`, `rollTickets.js`)

### Contract Interactions
```
LazySecureTrade ──[trade]──► LazyTradeLotto ──[roll]──► Prize Distribution
                                      │
                                      ├──[check burn]──► LazyDelegateRegistry
                                      └──[gas sponsor]──► LazyGasStation

LazyLotto ──[standalone]──► Memory Entries ──[redeem]──► Prize NFTs
```

---

## 🤝 Contributing

When adding new scripts:
1. Place in appropriate contract folder
2. Follow naming conventions (query: `get*`, admin: action verb)
3. Update this README with script description
4. Use correct import paths based on nesting level
5. Add usage examples in contract-specific README
6. Test on testnet before mainnet
7. Lint-check with ESLint

---

## 📞 Support

For issues or questions:
- Check contract-specific READMEs (LazyLotto, LazyTradeLotto)
- Review script comments for detailed usage
- Test on testnet with example values
- Verify `.env` configuration

---

**Last Updated**: Added prize config generator, NFT approval tool, and recipe templates (v1.1.0)
