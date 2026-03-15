# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Hedera smart contract project implementing two lottery systems: **LazyLotto** (multi-pool lottery with flexible prize management) and **LazyTradeLotto** (trade-based reward system). Built on Hedera network using Solidity 0.8.18, with extensive JavaScript testing and interaction scripts.

## Development Commands

### Build and Compilation
```bash
npx hardhat compile              # Compile all contracts (with optimizer + viaIR)
node scripts/deployments/extractABI.js  # Extract ABIs after compilation
```

### Testing
```bash
npm test                         # Run all test suites
npm run test-lotto               # LazyLotto.test.js only
npm run test-trade-lotto         # LazyTradeLotto.test.js only
npm run test-lotto-pool-manager  # LazyLottoPoolManager.test.js only
npm run test-delegate            # LazyDelegateRegistry.test.js only
npm run test-lazy                # LAZYTokenCreator.test.js only

REPORT_GAS=true npx hardhat test # Run with gas reporting
npx hardhat coverage             # Generate coverage report
```

### Code Quality
```bash
npx solhint 'contracts/**/*.sol' # Lint Solidity contracts
npx eslint scripts/ test/ utils/ # Lint JavaScript files
```

### Deployment
```bash
# Deploy to testnet (requires .env configuration)
npx hardhat run scripts/deployments/deployLazyTradeLotto.js --network testnet

# Note: LazyLotto deployment handled via specialized scripts
# See scripts/deployments/ for full deployment procedures
```

### Interaction Scripts
```bash
# Query operations (no gas cost)
node scripts/interactions/LazyLotto/queries/masterInfo.js 0.0.CONTRACT_ID
node scripts/interactions/LazyTradeLotto/queries/getLottoInfo.js 0.0.CONTRACT_ID

# Admin operations (requires owner private key in .env)
node scripts/interactions/LazyLotto/admin/createPool.js 0.0.CONTRACT_ID [params]
node scripts/interactions/LazyTradeLotto/admin/boostJackpot.js 0.0.CONTRACT_ID [amount]

# User operations
node scripts/interactions/LazyLotto/user/buyEntry.js 0.0.CONTRACT_ID [poolId] [count]
```

See `scripts/interactions/README.md` for complete script documentation (41 scripts organized by contract).

## Architecture Overview

### Core Contract Hierarchy

**LazyLotto System** (Multi-Pool Lottery):
- `LazyLotto.sol` - Main lottery contract (23.7KB, near size limit)
- `LazyLottoPoolManager.sol` - Community pool creation and management
- `LazyLottoStorage.sol` - Handles all HTS (Hedera Token Service) operations
- Supports two ticket modes: memory-based (gas efficient) and NFT-based (tradeable)
- Uses paginated queries for scalability (100+ prizes/pools)
- Prize types: HBAR, HTS tokens, NFTs (convertible to prize NFTs)

**LazyTradeLotto System** (Trade-Based Rewards):
- `LazyTradeLotto.sol` - Signature-gated lottery triggered by NFT trades
- Progressive jackpot with automatic growth
- Cryptographic validation via system wallet signature
- Anti-replay protection with trade fingerprinting

**Supporting Infrastructure**:
- `LazyGasStation.sol` - Automatic HBAR/$LAZY refills for contract operations
- `LazyDelegateRegistry.sol` - NFT delegation for bonus calculations
- `PrngSystemContract.sol` - Hedera's verifiable random number generation
- `HederaTokenService.sol` / `HederaTokenServiceLite.sol` - HTS integration wrappers

### Key Architectural Patterns

1. **Library Separation for Size Management**: LazyLotto delegates HTS operations to LazyLottoStorage to stay under 24KB contract size limit

2. **Storage Contract Pattern**: Users approve tokens to LazyLottoStorage address, not the main contract

3. **Dual-Layer Pool Management**: LazyLotto creates "global pools" (team-owned), LazyLottoPoolManager enables "community pools" (user-created with fees)

4. **Signature-Gated Design**: LazyTradeLotto requires systemWallet signature for roll parameters to prevent gaming (signature includes trade details + entropy)

5. **Multi-Admin with Last-Admin Protection**: LazyLotto uses role-based access control with safeguards against removing the last admin

6. **Paginated Queries**: All large-array queries use offset/limit parameters to handle 100+ items without gas issues

## Critical Implementation Details

### Hedera-Specific Considerations

1. **HTS Token Operations**: Use `HederaTokenService` precompile (0x167) for native token operations. All HTS calls return status codes from `HederaResponseCodes.sol`.

2. **PRNG Integration**: Random numbers obtained via `PrngSystemContract` at 0x169. Returns pseudo-random seed that must be processed for game mechanics.

3. **Token Association**: Users must associate tokens before receiving them. Scripts use `associateToken()` via Hedera SDK before transfers.

4. **Allowance System**: HTS tokens require explicit allowances. Scripts must set allowances to LazyLottoStorage address (not LazyLotto).

5. **Gas Optimization**: Batch operations critical due to Hedera's gas model. Use `batchMintNFT`, `batchTransferNFT` from LazyLottoStorage.

### Smart Contract Constraints

1. **Contract Size Limit**: Hedera enforces 24KB limit. LazyLotto at 23.782KB required library extraction and optimizer tuning (`viaIR: true`, `runs: 200`).

2. **ReentrancyGuard**: Applied to ALL state-changing functions in both LazyLotto and LazyLottoPoolManager.

3. **Pausability**: Both lottery contracts inherit OpenZeppelin's Pausable. Prize claims allowed even when paused.

4. **Fee Immutability**: Platform fee % locked at pool creation (stored per-pool) to prevent retroactive changes.

### JavaScript Utilities Architecture

**Location**: `utils/` folder contains shared helpers used across scripts and tests

**CLI Infrastructure** (shared across all scripts):
- `clientFactory.js` - `createClient()`, `getEnvConfig()`, `getContractId()` - centralized Hedera client initialization
- `abiLoader.js` - `loadInterface()` - cached ABI loading from abi/ or artifacts/
- `queryHelpers.js` - `queryContract()`, `batchQueryContract()` - one-line read-only contract queries
- `promptHelpers.js` - `prompt()`, `confirm()` - shared readline prompts
- `addressHelpers.js` - `convertToHederaId()`, `hbarToTinybarsBigInt()`, `tokenToBaseUnits()` - conversion helpers
- `tokenHelpers.js` - `getTokenDecimals()`, `getLazyDecimals()` - dynamic token decimal lookup
- `scriptHelpers.js` - `executeContractFunction()` - multi-sig aware contract execution
- `index.js` - barrel re-export of all utilities

**Domain Helpers** (specialized functionality):
- `hederaHelpers.js` - Account creation, token operations, NFT minting
- `hederaMirrorHelpers.js` - Mirror node API queries for events/transactions
- `transactionHelpers.js` - Transaction building and execution wrappers
- `solidityHelpers.js` - Low-level ABI encoding/decoding, contract interaction
- `gasHelpers.js` - Gas estimation and management
- `nodeHelpers.js` - Hedera node connection and client setup
- `LazyNFTStakingHelper.js` / `LazyFarmingHelper.js` - Legacy staking system utilities

**Pattern**: Scripts import from `utils/clientFactory`, `utils/abiLoader`, `utils/queryHelpers`, etc. to eliminate boilerplate. A typical script uses `getEnvConfig()` + `createClient()` + `loadInterface()` + `queryContract()` for setup, then focuses on business logic.

## Testing Architecture

### Test Structure

All tests in `test/` use Hardhat's local Hedera node with Hardhat Chai matchers:
- `LazyLotto.test.js` - 50+ test cases covering pools, tickets, prizes, bonuses, pagination
- `LazyTradeLotto.test.js` - Signature validation, jackpot mechanics, LSH NFT benefits
- `LazyLottoPoolManager.test.js` - Community pool creation, ownership, fee handling
- `LazyDelegateRegistry.test.js` - NFT delegation and registry operations

**Mocha Config**: 100-second timeout per test, 100-second slow threshold (in hardhat.config.js)

### Testing Pattern

1. Deploy contracts in `beforeEach` hook
2. Create test accounts via `accountCreator()` from utils
3. Associate tokens using Hedera SDK's `TokenAssociateTransaction`
4. Execute contract calls via `ContractExecuteTransaction`
5. Verify state via contract queries and event emissions
6. Use deterministic PRNG for predictable test outcomes

**Important**: Tests mock PRNG responses for deterministic behavior. Production uses Hedera's PRNG (0x169 precompile).

## Environment Configuration

### Required .env Variables

```env
ENVIRONMENT=testnet              # testnet, mainnet, preview, or local
ACCOUNT_ID=0.0.xxxxx            # Your Hedera account ID
PRIVATE_KEY=302e...             # ED25519 private key (hex format)

# Contract addresses (post-deployment)
LAZY_LOTTO_CONTRACT_ID=0.0.xxxxx
LAZY_LOTTO_STORAGE=0.0.xxxxx
LAZY_TRADE_LOTTO_CONTRACT_ID=0.0.xxxxx
LAZY_DELEGATE_REGISTRY_CONTRACT_ID=0.0.xxxxx
LAZY_GAS_STATION_CONTRACT_ID=0.0.xxxxx
LAZY_SCT_CONTRACT_ID=0.0.xxxxx  # LazySecureTrade (triggers TradeLotto)

# Token configuration
LAZY_TOKEN_ID=0.0.xxxxx         # $LAZY token ID
LAZY_DECIMALS=1
LSH_GEN1_TOKEN_ID=0.0.xxxxx     # LSH NFT collections for benefits
LSH_GEN2_TOKEN_ID=0.0.xxxxx
LSH_GEN1_MUTANT_TOKEN_ID=0.0.xxxxx

# System configuration
PRNG_CONTRACT_ID=0.0.8257116    # Hedera PRNG precompile
SIGNING_KEY=...                  # ECDSA key for LazyTradeLotto signature validation

# Deployment parameters
INITIAL_LOTTO_JACKPOT=2000      # In whole $LAZY units
LOTTO_LOSS_INCREMENT=50         # Jackpot increment on losses
```

Copy from `.env.example` and populate with your credentials.

## Security and Admin Powers

### What Admins Can Do
- Pause/unpause system for emergencies
- Create global pools with no creation fees
- Set platform fee % (capped at 25% maximum)
- Configure bonus systems (time windows, NFT holdings, $LAZY balance)
- Close malicious/abandoned pools (only if no outstanding entries)
- Withdraw platform fees (default 5% of pool proceeds)

### What Admins Cannot Do
- Steal prizes (enforced by contract math: `storageBalance - withdrawal >= prizesOwed`)
- Change fees retroactively (fee % frozen at pool creation)
- Withdraw prize-obligated tokens (safety checks prevent this)
- Access users' NFT tickets (users maintain custody)
- Prevent prize claims (claimable even when paused)

### Security Features
- ReentrancyGuard on all state-changing functions
- Multi-admin support with last-admin protection
- Platform fee cap (25% maximum)
- Prize obligation tracking prevents rug-pulls
- Signature validation in LazyTradeLotto prevents unauthorized rolls
- Anti-replay protection via trade fingerprinting

See `LazyLotto-SECURITY_ANALYSIS.md` for comprehensive security analysis.

## Breaking Changes and Migrations

**December 2025 - LazyLotto API v2.1**: Contract updated with paginated query functions to handle 100+ prizes/pools without gas issues. See `LazyLotto-API_BREAKING_CHANGES.md` for migration guide.

**Key Changes**:
- All large-array queries now accept `offset` and `limit` parameters
- `getUserPendingPrizes()` → paginated version required for users with 50+ prizes
- `getPoolPrizes()` → paginated for pools with 100+ prize packages
- Scripts updated to handle pagination automatically

## Documentation Structure

**Business/Product Docs** (root directory):
- `README.md` - Comprehensive project overview
- `LazyLotto-BUSINESS_LOGIC.md` - Game mechanics and use cases
- `LazyTradeLotto-BUSINESS_LOGIC.md` - Trade lottery design
- `LazyLotto-UX_IMPLEMENTATION_GUIDE.md` - User experience flows
- `LazyLotto-TESTING_PLAN.md` - Test strategy and coverage
- `LazyLotto-SECURITY_ANALYSIS.md` - Security analysis
- `LazyLotto-API_BREAKING_CHANGES.md` - Migration guide

**Technical Docs** (inline):
- NatSpec comments in all contract files
- README.md in `scripts/interactions/` (41 scripts documented)
- README.md in `scripts/deployments/`
- Generated HTML docs in `docs/` folder

**Testing Docs**:
- `LazyLotto-CODE_COVERAGE_ANALYSIS.md` - Line-by-line coverage analysis

**Multi-Signature Docs**:
- `docs/MULTISIG_USER_GUIDE.md` - End-user guide for multi-sig operations
- `docs/MULTISIG_DEVELOPER_GUIDE.md` - Technical implementation details
- `docs/MULTISIG_SECURITY.md` - Security model and threat analysis
- `docs/MULTISIG_ADMIN_INTEGRATION.md` - Admin script integration guide

## Multi-Signature System

### Overview

LazyLotto includes a production-grade multi-signature system for enhanced security on admin operations. All 21 admin scripts support multi-sig via the `--multisig` flag with full backward compatibility.

### Quick Start

```bash
# Single-signature (existing behavior)
node scripts/interactions/LazyLotto/admin/setPlatformFee.js 10

# Multi-signature (2-of-3 interactive)
node scripts/interactions/LazyLotto/admin/setPlatformFee.js 10 --multisig --threshold=2

# Multi-signature (offline/air-gapped)
node scripts/interactions/LazyLotto/admin/withdrawTokens.js 1000 --multisig --export-only
```

### Architecture

**Library Location**: `lib/multiSig/` (completely isolated, zero project dependencies)

**Integration Layer**: `utils/multiSigIntegration.js` + `utils/scriptHelpers.js`

**Key Components**:
- **Workflows**: InteractiveWorkflow (real-time <110s), OfflineWorkflow (asynchronous)
- **Key Management**: PromptKeyProvider, EncryptedFileProvider, EnvKeyProvider
- **Core**: TransactionFreezer, SignatureCollector, SignatureVerifier, TransactionExecutor
- **UI**: ProgressIndicator, ErrorFormatter, HelpText, TransactionDisplay

### Supported Features

✅ **Mixed Key Types**: Ed25519 and ECDSA in same multi-sig setup
✅ **Threshold Signatures**: M-of-N schemes (e.g., 2-of-3, 3-of-5)
✅ **Air-Gapped Signing**: Offline workflow with no timeout
✅ **Encrypted Key Storage**: AES-256-GCM encrypted key files
✅ **Audit Logging**: Complete audit trail of all operations
✅ **Backward Compatible**: All scripts work without --multisig flag

### Usage Patterns

**Interactive Mode** (all signers online, <110 seconds):
```bash
node scripts/interactions/LazyLotto/admin/createPool.js \
  --multisig --threshold=2 --signers=Alice,Bob,Charlie
```

**Offline Mode** (asynchronous, air-gapped):
```bash
# Phase 1: Freeze & export
node scripts/interactions/LazyLotto/admin/closePool.js 5 --multisig --export-only

# Phase 2: Signers sign offline (each signer)
node lib/multiSig/cli/sign.js multisig-transactions/tx-file.tx

# Phase 3: Execute with collected signatures
node scripts/interactions/LazyLotto/admin/closePool.js 5 \
  --multisig --offline --signatures=sig1.json,sig2.json
```

**Using Encrypted Key Files**:
```bash
# One-time: Create encrypted key file
node lib/multiSig/cli/createKeyFile.js
# Creates alice.enc with AES-256-GCM encryption

# Use in scripts
node scripts/interactions/LazyLotto/admin/setBonuses.js \
  --multisig --keyfiles=alice.enc,bob.enc
```

### Integration Pattern

**All admin scripts follow this pattern**:

1. **Import scriptHelpers**:
```javascript
const {
  executeContractFunction,
  checkMultiSigHelp,
  displayMultiSigBanner
} = require('../../../../utils/scriptHelpers');
```

2. **Check for help**:
```javascript
async function main() {
  if (checkMultiSigHelp()) {
    process.exit(0);
  }
  // ... rest of script
}
```

3. **Display multi-sig banner**:
```javascript
console.log('Script Banner...');
displayMultiSigBanner(); // Shows multi-sig status if enabled
```

4. **Execute with multi-sig support**:
```javascript
// Before (single-sig only)
const tx = await new ContractExecuteTransaction()
  .setContractId(contractId)
  .setGas(300000)
  .setFunction('myFunction', encoded)
  .execute(client);

// After (single-sig + multi-sig)
const result = await executeContractFunction({
  contractId,
  iface: contractInterface,
  client,
  functionName: 'myFunction',
  params: [param1, param2],
  gas: 300000,
  payableAmount: 0
});

if (!result.success) {
  throw new Error(result.error);
}
```

### Key Management

**Security Tiers** (highest to lowest):

1. **Prompt Input** 🔒🔒🔒: Interactive password prompts (no storage)
   - Use for: Critical operations, one-time use
   - Command: No special flags needed

2. **Encrypted Files** 🔒🔒: AES-256-GCM encrypted files
   - Use for: Regular operations, repeated use
   - Command: `--keyfiles=alice.enc,bob.enc`
   - Create: `node lib/multiSig/cli/createKeyFile.js`

3. **Environment Variables** 🔒: Process environment (dev/test only)
   - Use for: Development, testing only
   - NOT recommended for production

### CLI Tools

Located in `lib/multiSig/cli/`:

- **sign.js**: Standalone offline signing tool
- **createKeyFile.js**: Create encrypted key files
- **testKeyFile.js**: Validate encrypted key files
- **securityAudit.js**: Scan codebase for security issues

### Configuration

**Environment Variables** (optional, see `.env.example`):
```bash
MULTISIG_SIGNERS=0.0.123456,0.0.234567,0.0.345678  # Reference only
MULTISIG_THRESHOLD=2                                # M of N
MULTISIG_WORKFLOW=interactive                       # or offline
MULTISIG_EXPORT_DIR=./multisig-transactions
MULTISIG_AUDIT_LOG=./logs/audit.log
```

**Command-Line Flags**:
- `--multisig`: Enable multi-signature mode
- `--workflow=interactive|offline`: Choose workflow (default: interactive)
- `--threshold=N`: Require N signatures (default: all)
- `--signers=Alice,Bob,Charlie`: Label signers
- `--export-only`: Freeze and export (offline phase 1)
- `--signatures=s1.json,s2.json`: Execute with signatures (offline phase 3)
- `--keyfiles=k1.enc,k2.enc`: Use encrypted key files
- `--multisig-help`: Display multi-sig help

### Audit Logging

All multi-sig operations logged to `logs/audit.log`:

```json
{
  "timestamp": "2025-12-19T10:30:00.000Z",
  "transactionId": "0.0.98765@1701234567.890",
  "operation": "setPlatformFee",
  "contract": "0.0.123456",
  "parameters": {"percentage": 12},
  "signers": [
    {"account": "0.0.111111", "algorithm": "Ed25519"},
    {"account": "0.0.222222", "algorithm": "ECDSA"}
  ],
  "threshold": "2 of 3",
  "workflow": "interactive",
  "status": "success"
}
```

### Security Considerations

**Best Practices**:
- ✅ Use threshold signatures (M-of-N) for critical operations
- ✅ Use offline workflow for high-value transactions
- ✅ Store keys in encrypted files or prompt for them
- ✅ Never commit private keys or .enc files to version control
- ✅ Use different keys for testnet vs mainnet
- ✅ Review audit logs regularly
- ✅ Rotate keys periodically

**Security Features**:
- 110-second timeout (not 119s) for network latency buffer
- Cryptographic signature verification (Ed25519, ECDSA secp256k1)
- Transaction freezing prevents tampering
- Audit logging for accountability
- AES-256-GCM encryption for key storage
- PBKDF2 key derivation (100k iterations)

### Testing

**Test Files**:
- `test/keyProviders.test.js`: 28 tests for key provider functionality
- `test/multiKeyType.test.js`: 35 tests for mixed key types
- `test/workflows.test.js`: Workflow integration tests

**Run Tests**:
```bash
npm test -- test/keyProviders.test.js
npm test -- test/multiKeyType.test.js
```

### Documentation

**For Users**: `docs/MULTISIG_USER_GUIDE.md`
- Quick start examples
- Workflow explanations
- Troubleshooting guide

**For Developers**: `docs/MULTISIG_DEVELOPER_GUIDE.md`
- Architecture overview
- API reference
- Integration patterns
- Extension points

**For Security**: `docs/MULTISIG_SECURITY.md`
- Security model
- Threat analysis
- Best practices
- Incident response

**For Integration**: `docs/MULTISIG_ADMIN_INTEGRATION.md`
- Step-by-step integration guide
- Complete examples
- Testing checklist

## Common Pitfalls

1. **Allowances**: $LAZY allowances go to **LazyGasStation** (it handles burn logic). All other fungible token and NFT allowances go to **LazyLottoStorage** (NOT LazyLotto). HBAR requires no allowance (sent as msg.value).
2. **Token Association**: Always associate tokens before attempting transfers on Hedera
3. **Contract Size**: When modifying LazyLotto, watch contract size (23.782KB / 24KB). May need to extract more logic to libraries.
4. **Signature Validation**: LazyTradeLotto rolls require valid systemWallet signature with correct nonce + trade parameters
5. **Pagination**: When querying large datasets, always use offset/limit parameters to avoid gas issues
6. **HTS Response Codes**: Check return values from HTS operations (don't assume success). Use HederaResponseCodes mapping.
7. **PRNG Seed Processing**: Raw PRNG seed must be hashed with nonces for different random values (see LazyLotto's `_processPRNG()`)
8. **Pool Fee Lock-In**: Platform fee % cannot be changed after pool creation (per-pool immutable field)

## Quick Reference

### Contract Addresses
All contract IDs use Hedera's format: `0.0.XXXXXX` (e.g., `0.0.123456`)

### Token Standards
- HBAR represented as `address(0)` in contracts
- HTS tokens identified by their Hedera token address (converted from 0.0.X format)
- NFTs: serialNumber + token address identifies unique NFT

### Script Organization
```
scripts/interactions/
├── LazyLotto/              # 22 scripts
│   ├── admin/              # Pool management, configuration
│   ├── queries/            # Read-only queries
│   └── user/               # User actions (buy, roll, claim)
├── LazyTradeLotto/         # 12 scripts
│   ├── admin/              # Jackpot, configuration
│   └── queries/            # Contract state queries
├── LazyDelegateRegistry/   # 2 scripts
├── LazyGasStation/         # 1 script
├── LazySecureTrade/        # 3 scripts
└── Utilities/              # 1 script
```

### Hardhat Network Configuration
- Local Hedera node for testing (no external network config in hardhat.config.js)
- Optimizer: enabled with 200 runs, viaIR mode for size optimization
- Contract size checking enabled (strict mode)
- Auto-generate documentation on compile
