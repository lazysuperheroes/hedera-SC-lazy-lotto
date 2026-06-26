# LazyTradeLotto - Interaction Scripts

Complete suite of CLI scripts for managing and querying the LazyTradeLotto contract.

## 📊 Migration Status

**✅ COMPLETE: 15/15 Scripts Implemented (100%)**

| Category | Complete | Total | Status |
|----------|----------|-------|--------|
| Query Scripts | 4 | 4 | ✅ 100% |
| Admin Scripts | 8 | 8 | ✅ 100% |
| Testing Scripts | 3 | 3 | ✅ 100% |
| **Total** | **15** | **15** | **✅ 100%** |

**Completed Actions:**
1. ✅ Created 3 new query scripts (getLottoInfo, getUserBurn, checkTradeHistory)
2. ✅ Migrated 7 admin scripts from root to admin/ folder
3. ✅ Migrated 1 query script (getLottoLogs) from root
4. ✅ Deleted 3 superseded root scripts (getLazyTradeLottoInfo, getBurnForUser, boostLottoJackpot)
5. ✅ Updated all import paths (../../utils → ../../../../utils for nested folders)
6. ✅ Created comprehensive README with signature-gated design explanation
7. ✅ Implemented 3 testing scripts (generateSignature, rollLottoTest, simulateTrade) for TestNet rolls

---

## �🔑 Important: Signature-Gated Design

**LazyTradeLotto uses a signature-based security model.** The main user function (`rollLotto`) requires a signature from the platform's `systemWallet` to execute. This means:

- ✅ **Admin/Config Scripts**: Full CLI functionality for contract management
- ✅ **Query Scripts**: Full CLI functionality for information retrieval
- ⚠️ **User Roll Function**: Only callable via the Lazy Secure Trade platform (or TestNet with systemWallet key)

### Why Signature-Gated?

The signature prevents abuse by ensuring:
1. Only legitimate trades can trigger lottery rolls
2. Platform controls win rates and prize amounts
3. No replay attacks (each trade rolled once per participant)
4. Trade parameters cannot be manipulated

The platform's backend holds the `systemWallet` private key and signs validated trade parameters before users can roll the lottery.

---

## 📁 Script Organization

### Query Scripts (`queries/`)
Information retrieval - no transactions, no gas costs

| Script | Description | Usage | Status |
|--------|-------------|-------|--------|
| `getLottoInfo.js` | Complete contract state | `node queries/getLottoInfo.js <contractId>` | ✅ Complete |
| `getUserBurn.js` | Check user's burn percentage | `node queries/getUserBurn.js <contractId> <userAddress>` | ✅ Complete |
| `checkTradeHistory.js` | Check if trade already rolled | `node queries/checkTradeHistory.js <contractId> <token> <serial> <nonce> <buyer>` | ✅ Complete |
| `getLottoLogs.js` | Query lottery events from mirror node | `node queries/getLottoLogs.js <contractId>` | ✅ Migrated |

### Admin Scripts (`admin/`)
Configuration and management - requires contract owner

All admin scripts support multi-signature mode with `--multisig` flag.

| Script | Description | Usage | Multi-Sig |
|--------|-------------|-------|-----------|
| `boostJackpot.js` | Add funds to jackpot pool | `node admin/boostJackpot.js <contractId> <amount>` | ✅ |
| `updateLottoBurnPercentage.js` | Change burn rate | `node admin/updateLottoBurnPercentage.js <contractId> <percentage>` | ✅ |
| `updateLottoJackpotIncrement.js` | Set per-roll increment | `node admin/updateLottoJackpotIncrement.js <contractId> <amount>` | ✅ |
| `updateMaxJackpotThreshold.js` | Set jackpot cap | `node admin/updateMaxJackpotThreshold.js <contractId> <amount>` | ✅ |
| `updateLottoSystemWallet.js` | Change signature wallet | `node admin/updateLottoSystemWallet.js <contractId> <newWallet>` | ✅ |
| `pauseLottoContract.js` | Emergency pause | `node admin/pauseLottoContract.js <contractId>` | ✅ |
| `unpauseLottoContract.js` | Resume operations | `node admin/unpauseLottoContract.js <contractId>` | ✅ |
| `transferHbarFromLotto.js` | Emergency withdrawal | `node admin/transferHbarFromLotto.js <contractId> <receiver> <amount>` | ✅ |

**Multi-sig examples:**
```bash
# Single-sig (default)
node admin/boostJackpot.js 0.0.123456 1000

# Multi-sig with 2-of-3 threshold
node admin/boostJackpot.js 0.0.123456 1000 --multisig --threshold=2

# Multi-sig help
node admin/boostJackpot.js --multisig-help
```

### Testing Scripts (`testing/`)
TestNet development tools - requires systemWallet private key

| Script | Description | Usage | Status |
|--------|-------------|-------|--------|
| `generateSignature.js` | Build a systemWallet roll signature (offline) | `node testing/generateSignature.js --token <id> --serial <n> --nonce <n> [opts]` | ✅ Complete |
| `rollLottoTest.js` | Sign + submit one roll, report outcome | `node testing/rollLottoTest.js [contractId] --token <id> --serial <n> --nonce <n> [opts]` | ✅ Complete |
| `simulateTrade.js` | Roll both buyer + seller of one trade | `node testing/simulateTrade.js [contractId] --token <id> --serial <n> --nonce <n> [opts]` | ✅ Complete |

> Testing scripts require `SIGNING_KEY` (ECDSA) in `.env` — the systemWallet that signs roll parameters. They are the in-repo stand-in for the production Lazy Secure Trade scanner. Run `generateSignature.js --help` for the full flag reference.

---

## 🔄 Migration Plan

### Scripts to Migrate from Root (`scripts/interactions/`)

**To `admin/` folder:**
```bash
# These scripts should be moved and renamed:
boostLottoJackpot.js          → admin/boostJackpot.js (✅ DONE)
updateLottoBurnPercentage.js  → admin/updateBurnPercentage.js
updateLottoJackpotIncrement.js → admin/updateJackpotIncrement.js
updateMaxJackpotThreshold.js  → admin/updateMaxJackpotPool.js
updateLottoSystemWallet.js    → admin/updateSystemWallet.js
pauseLottoContract.js         → admin/pauseContract.js
unpauseLottoContract.js       → admin/unpauseContract.js
transferHbarFromLotto.js      → admin/transferHbar.js
```

**To `queries/` folder:**
```bash
# These scripts should be moved:
getLazyTradeLottoLogs.js → queries/getLottoLogs.js

# These can be DELETED (superseded by better versions):
getLazyTradeLottoInfo.js → SUPERSEDED by queries/getLottoInfo.js ✅
getBurnForUser.js        → SUPERSEDED by queries/getUserBurn.js ✅
```

**Keep at Root** (different contracts):
```bash
# LazySecureTrade scripts:
setLazyBurnPercentage.js
setLazyCostForTrade.js
getLazySecureTradeLogs.js

# LazyDelegateRegistry scripts:
checkDelegations.js
delegateToken.js

# LazyGasStation scripts:
getLazyGasStationInfo.js

# Utility scripts:
getContractResultFromMirror.js
```

### Migration Steps

1. **Update import paths** in migrated scripts:
   ```javascript
   // OLD (root level)
   const { contractExecuteFunction } = require('../../utils/solidityHelpers');
   
   // NEW (admin/ or queries/)
   const { contractExecuteFunction } = require('../../../../utils/solidityHelpers');
   ```

2. **Update script headers** with new paths:
   ```javascript
   // Usage: node admin/boostJackpot.js <contractId> <amount>
   ```

3. **Update ABI loading path**:
   ```javascript
   // Remains the same - always relative to project root when run with `node`
   fs.readFileSync('./abi/LazyTradeLotto.json')
   ```

4. **Test each migrated script** to ensure imports work correctly

### Quick Migration Commands (PowerShell)

```powershell
# Navigate to interactions directory
cd scripts\interactions

# Migrate admin scripts (adjust paths in each after moving)
Move-Item boostLottoJackpot.js LazyTradeLotto\admin\boostJackpot.js
Move-Item updateLottoBurnPercentage.js LazyTradeLotto\admin\updateBurnPercentage.js
Move-Item updateLottoJackpotIncrement.js LazyTradeLotto\admin\updateJackpotIncrement.js
Move-Item updateMaxJackpotThreshold.js LazyTradeLotto\admin\updateMaxJackpotPool.js
Move-Item updateLottoSystemWallet.js LazyTradeLotto\admin\updateSystemWallet.js
Move-Item pauseLottoContract.js LazyTradeLotto\admin\pauseContract.js
Move-Item unpauseLottoContract.js LazyTradeLotto\admin\unpauseContract.js
Move-Item transferHbarFromLotto.js LazyTradeLotto\admin\transferHbar.js

# Migrate query script
Move-Item getLazyTradeLottoLogs.js LazyTradeLotto\queries\getLottoLogs.js

# Delete superseded scripts
Remove-Item getLazyTradeLottoInfo.js
Remove-Item getBurnForUser.js

# After migration, update each script:
# - Change require paths: ../../utils → ../../../../utils
# - Update usage comments with new path
# - Test with: node LazyTradeLotto/admin/scriptName.js --help
```

### Before & After Structure

**BEFORE (Current - Messy Root):**
```
scripts/interactions/
├── boostLottoJackpot.js              ← LazyTradeLotto
├── updateLottoBurnPercentage.js      ← LazyTradeLotto
├── updateLottoJackpotIncrement.js    ← LazyTradeLotto
├── updateMaxJackpotThreshold.js      ← LazyTradeLotto
├── pauseLottoContract.js             ← LazyTradeLotto
├── unpauseLottoContract.js           ← LazyTradeLotto
├── getLazyTradeLottoInfo.js          ← LazyTradeLotto (duplicate)
├── getBurnForUser.js                 ← LazyTradeLotto (duplicate)
├── setLazyBurnPercentage.js          ← LazySecureTrade
├── checkDelegations.js               ← LazyDelegateRegistry
├── getLazyGasStationInfo.js          ← LazyGasStation
└── LazyTradeLotto/
    ├── admin/
    │   └── boostJackpot.js ✅
    └── queries/
        ├── getLottoInfo.js ✅
        ├── getUserBurn.js ✅
        └── checkTradeHistory.js ✅
```

**AFTER (Clean & Organized):**
```
scripts/interactions/
├── setLazyBurnPercentage.js          ← LazySecureTrade
├── setLazyCostForTrade.js            ← LazySecureTrade
├── getLazySecureTradeLogs.js         ← LazySecureTrade
├── checkDelegations.js               ← LazyDelegateRegistry
├── delegateToken.js                  ← LazyDelegateRegistry
├── getLazyGasStationInfo.js          ← LazyGasStation
├── getContractResultFromMirror.js    ← Utility
│
└── LazyTradeLotto/
    ├── admin/
    │   ├── boostJackpot.js ✅
    │   ├── updateBurnPercentage.js
    │   ├── updateJackpotIncrement.js
    │   ├── updateMaxJackpotPool.js
    │   ├── updateSystemWallet.js
    │   ├── pauseContract.js
    │   ├── unpauseContract.js
    │   └── transferHbar.js
**Result:**
```
LazyTradeLotto/
    ├── admin/
    │   ├── boostJackpot.js ✅
    │   ├── pauseLottoContract.js ✅
    │   ├── unpauseLottoContract.js ✅
    │   ├── transferHbarFromLotto.js ✅
    │   ├── updateLottoBurnPercentage.js ✅
    │   ├── updateLottoJackpotIncrement.js ✅
    │   ├── updateLottoSystemWallet.js ✅
    │   └── updateMaxJackpotThreshold.js ✅
    ├── queries/
    │   ├── getLottoInfo.js ✅
    │   ├── getUserBurn.js ✅
    │   ├── checkTradeHistory.js ✅
    │   └── getLottoLogs.js ✅
    ├── testing/
    │   ├── rollLottoTest.js (TODO)
    │   ├── generateSignature.js (TODO)
    │   └── simulateTrade.js (TODO)
    └── README.md ✅
```

**Migration Complete:**
- ✅ All 8 admin scripts migrated and paths updated
- ✅ All 4 query scripts complete (3 new, 1 migrated)
- ✅ 3 superseded root scripts deleted
- ✅ Import paths corrected (../../../../utils for nested folders)
- ✅ Clean separation by functionality (admin/queries/testing)
- ✅ Easy to find and maintain
- ⏳ Testing scripts TODO (3 remaining for signature-gated rolls)

---

## 🚀 Quick Start

### Prerequisites

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials
```

### Environment Variables

```env
# Required for all scripts
ENVIRONMENT=testnet          # testnet, mainnet, preview, or local
ACCOUNT_ID=0.0.xxxxx        # Your account ID

# Required for admin/testing scripts
PRIVATE_KEY=302e...          # Your private key

# Required for proper $LAZY formatting
LAZY_TOKEN_ID=0.0.xxxxx     # $LAZY token ID
LAZY_DECIMALS=1              # $LAZY token decimals

# Required for testing scripts ONLY
SYSTEM_WALLET_KEY=...        # systemWallet private key (TestNet only!)
```

---

## 📊 Common Usage Patterns

### Check Contract Status
```bash
# Get full lottery information
node queries/getLottoInfo.js 0.0.123456

# Check if a user gets 0% burn (LSH NFT holder)
node queries/getUserBurn.js 0.0.123456 0x1234...abcd
```

### Admin Maintenance
```bash
# Boost jackpot for promotional event
node admin/boostJackpot.js 0.0.123456 5000

# Update burn percentage
node admin/updateBurnPercentage.js 0.0.123456 10

# Emergency pause
node admin/pauseContract.js 0.0.123456
```

### Testing on TestNet
```bash
# Simulate a lottery roll (requires systemWallet key)
node testing/rollLottoTest.js 0.0.123456 \\
  --token 0x1234...abcd \\
  --serial 42 \\
  --nonce 1000 \\
  --buyer true \\
  --winRate 10000000 \\
  --minWin 100 \\
  --maxWin 1000 \\
  --jackpotRate 100000
```

---

## 🔐 Multi-Signature Support

All 8 admin scripts support multi-signature transactions for enhanced security.

### Quick Start

```bash
# Enable multi-sig with interactive workflow (2-of-3 threshold)
node admin/boostJackpot.js 0.0.123456 1000 --multisig --threshold=2

# View multi-sig help
node admin/boostJackpot.js --multisig-help

# Offline workflow (air-gapped signing)
node admin/updateLottoSystemWallet.js 0.0.123456 0.0.789012 --multisig --export-only
# ... signers sign offline ...
node admin/updateLottoSystemWallet.js 0.0.123456 0.0.789012 \
  --multisig --offline --signatures=sig1.json,sig2.json
```

### Recommended Multi-Sig Configurations

| Operation | Risk | Recommended Setup |
|-----------|------|-------------------|
| `transferHbarFromLotto` | Critical | 2-of-3 offline |
| `updateLottoSystemWallet` | Critical | 2-of-3 offline |
| `pauseLottoContract` | High | 2-of-2 interactive |
| `unpauseLottoContract` | High | 2-of-2 interactive |
| `boostJackpot` | Medium | 2-of-3 interactive |
| `updateMaxJackpotThreshold` | Medium | 2-of-3 interactive |
| `updateLottoJackpotIncrement` | Medium | 2-of-3 interactive |
| `updateLottoBurnPercentage` | Medium | 2-of-3 interactive |

### Documentation

For complete multi-sig documentation, see:
- **User Guide**: `docs/MULTISIG_USER_GUIDE.md`
- **Developer Guide**: `docs/MULTISIG_DEVELOPER_GUIDE.md`
- **Security Guide**: `docs/MULTISIG_SECURITY.md`

---

## 🔒 Security Features

### Signature Validation
All `rollLotto()` calls require a valid signature from `systemWallet`:

```javascript
// Message signed by systemWallet
messageHash = keccak256(abi.encodePacked(
    msg.sender,          // User calling the function
    token,               // NFT contract address
    serial,              // NFT serial number
    nonce,               // Unique trade identifier
    buyer,               // Buyer (true) or seller (false)
    winRateThreshold,    // Win probability
    minWinAmt,           // Prize range min
    maxWinAmt,           // Prize range max
    jackpotThreshold     // Jackpot probability
));
```

### Replay Protection
Each trade is tracked by hash to prevent duplicate rolls:

```javascript
hash = keccak256(abi.encodePacked(token, serial, nonce, buyer));
history[hash] = true; // Marked as rolled
```

Use `checkTradeHistory.js` to verify roll status before attempting.

---

## 💰 LSH NFT Holder Benefits

Users who hold any of these NFTs get **0% burn** on lottery winnings:

- **LSH Gen1** (direct ownership or delegated)
- **LSH Gen2** (direct ownership or delegated)
- **LSH Gen1 Mutant** (direct ownership or delegated)

Check a user's burn status with:
```bash
node queries/getUserBurn.js <contractId> <userAddress>
```

---

## 📈 Lottery Statistics

The `getLottoInfo.js` script displays comprehensive statistics:

- **Jackpot Pool**: Current jackpot amount
- **Jackpot History**: Total wins and payouts
- **Regular Wins**: Total rolls, wins, and win rate
- **Configuration**: System wallet, burn percentage, pause status
- **Connected Contracts**: PRNG, LazyGasStation, LazyDelegateRegistry
- **LSH NFT Collections**: Gen1, Gen2, Mutant addresses

---

## 🛠️ Development Notes

### Gas Estimation
- Admin functions: ~250-500k gas
- Query functions: No gas (read-only)
- `rollLotto`: ~1-1.5M gas (PRNG + transfers)

### Error Handling
Common revert errors:
- `AlreadyRolled()`: Trade already rolled by this participant
- `InvalidTeamSignature()`: Signature validation failed
- `BadArguments(string message)`: Invalid parameters
- `Ownable: caller is not the owner`: Not contract owner

### Mirror Node Integration
All query scripts use mirror node for:
- Address conversion (EVM ↔ Hedera ID)
- Token information retrieval
- Read-only contract queries (no gas)

---

## 📝 Script Templates

### Creating New Admin Scripts (with Multi-Sig Support)
```javascript
const {
    executeContractFunction,
    checkMultiSigHelp,
    displayMultiSigBanner,
} = require('../../../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../../../utils/solidityHelpers');
const readlineSync = require('readline-sync');

const main = async () => {
    // 1. Check for multi-sig help request
    if (checkMultiSigHelp()) {
        process.exit(0);
    }

    // 2. Load ABI and parse arguments
    // 3. Initialize client
    // 4. Display multi-sig banner
    displayMultiSigBanner();

    // 5. Get current state via mirror node
    // 6. Display changes and confirm with user

    // 7. Execute with multi-sig support
    const result = await executeContractFunction({
        contractId,
        iface: ltlIface,
        client,
        functionName: 'myFunction',
        params: [param1, param2],
        gas: 300_000,
        payableAmount: 0,
    });

    if (!result.success) {
        console.log('Error:', result.error);
        return;
    }

    // 8. Display result
    const txId = result.receipt?.transactionId?.toString() ||
                 result.record?.transactionId?.toString() || 'N/A';
    console.log('Transaction ID:', txId);
};
```

### Creating New Query Scripts
```javascript
const { readOnlyEVMFromMirrorNode } = require('../../../../utils/solidityHelpers');

// 1. Load ABI
// 2. Parse arguments
// 3. Query contract via mirror node
// 4. Format and display results
```

### Multi-Sig Command-Line Options
```bash
--multisig                      # Enable multi-signature mode
--multisig-help                 # Display multi-sig help
--workflow=interactive|offline  # Choose workflow (default: interactive)
--export-only                   # Freeze and export (offline phase 1)
--signatures=f1.json,f2.json    # Execute with signatures (offline phase 3)
--threshold=N                   # Require N signatures
--signers=Alice,Bob,Charlie     # Label signers for clarity
```

---

## 🔗 Related Documentation

- **Contract**: `contracts/LazyTradeLotto.sol`
- **Business Logic**: `LazyTradeLotto-BUSINESS_LOGIC.md`
- **ABI**: `abi/LazyTradeLotto.json`

---

## 🆘 Troubleshooting

### "Must specify PRIVATE_KEY & ACCOUNT_ID"
- Ensure `.env` file exists and contains valid credentials
- Admin/testing scripts require private key

### "Ownable: caller is not the owner"
- Only contract owner can call admin functions
- Verify you're using the owner's account

### "InvalidTeamSignature"
- Signature from wrong wallet
- Parameters don't match signature
- Use `testing/generateSignature.js` to create valid signatures

### "AlreadyRolled"
- Trade already rolled by this participant
- Use `queries/checkTradeHistory.js` to verify
- Each trade can be rolled once by buyer and once by seller

---

## 📊 Version History

**v1.0.0** (Current)
- ✅ Complete query script suite (3 scripts)
- ✅ Essential admin scripts (7 scripts)
- ✅ Testing helper scripts (3 scripts)
- ✅ Comprehensive documentation
- ✅ Lint-clean, production-ready code

---

## 📄 License

Part of the LazyTradeLotto project. See main project LICENSE.
