# LazyLotto Pool Manager Scripts

Complete documentation for deploying, configuring, and interacting with the LazyLotto Pool Manager system.

## Naming Convention Note

**Important**: This codebase follows JavaScript camelCase naming conventions:
- **In Code**: Variables use camelCase (e.g., `lazyTokenId`, `poolManagerId`, `lazyGasStationId`)
- **In .env**: Environment variables use SCREAMING_SNAKE_CASE (e.g., `LAZY_TOKEN_ID`, `LAZY_LOTTO_POOL_MANAGER_ID`)

```javascript
// Example from deployment scripts:
const lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN_ID);
const poolManagerId = ContractId.fromString(process.env.LAZY_LOTTO_POOL_MANAGER_ID);
const lazyGasStationId = ContractId.fromString(process.env.LAZY_GAS_STATION_CONTRACT_ID);
```

## Prerequisites

1. **Deployed Contracts**: LazyLotto, LazyLottoStorage, LazyGasStation, LazyDelegateRegistry
2. **Environment File**: `.env` with contract addresses and credentials
3. **Tokens**: Sufficient HBAR and LAZY tokens in your wallet
4. **Dependencies**: Run `npm install` before using any scripts

## Quick Start

1. Deploy Pool Manager: `node scripts/deployments/LazyLotto/deploy-pool-manager.js`
2. Link contracts: `node scripts/deployments/LazyLotto/link-pool-manager.js`
3. Set creation fees: `node scripts/interactions/LazyLotto/admin/set-creation-fees.js`
4. Create a pool: `node scripts/interactions/LazyLotto/user/create-community-pool.js`

---

## Deployment Scripts

### Deploy Pool Manager

```bash
node scripts/deployments/LazyLotto/deploy-pool-manager.js
```

**Purpose**: Deploy the LazyLottoPoolManager contract to manage community pools and bonus configurations.

**What it does:**
- Deploys LazyLottoPoolManager contract with proper Hedera SDK
- Saves contract ID to `.env` file as `LAZY_LOTTO_POOL_MANAGER_ID`
- Reports contract size and deployment success

**Requirements:**
- `.env` file with: `LAZY_TOKEN_ID`, `LAZY_GAS_STATION_CONTRACT_ID`, `LAZY_DELEGATE_REGISTRY_CONTRACT_ID`
- Deployer account must have sufficient HBAR for deployment (~10-15 HBAR)

**Output:**
- Contract ID saved to environment file
- Contract size reported in bytes
- Deployment transaction ID

---

### Link Pool Manager

```bash
node scripts/deployments/LazyLotto/link-pool-manager.js
```

**Purpose**: Establish bidirectional link between LazyLotto and LazyLottoPoolManager contracts.

**What it does:**
- Calls `lazyLotto.setPoolManager(poolManagerAddress)` to register PoolManager
- Calls `poolManager.setLazyLotto(lazyLottoAddress)` to register LazyLotto
- Verifies bidirectional linkage via read-only queries
- Reports success/failure for each operation

**Requirements:**
- Both LazyLotto and LazyLottoPoolManager deployed
- `.env` file with: `LAZY_LOTTO_CONTRACT_ID`, `LAZY_LOTTO_POOL_MANAGER_ID`
- Deployer must be admin of both contracts

**Output:**
- Linkage status for each direction
- Transaction IDs for both operations
- Verification of bidirectional linkage

---

## Admin Scripts

### Set Creation Fees

```bash
# Interactive mode (prompts for values)
node scripts/interactions/LazyLotto/admin/set-creation-fees.js

# Command line arguments
node scripts/interactions/LazyLotto/admin/set-creation-fees.js --hbar 10 --lazy 1000
```

**Purpose**: Configure HBAR and LAZY fees required for community pool creation.

**What it does:**
- Shows current fees
- Prompts for new HBAR and LAZY fee amounts (or uses CLI args)
- Displays comparison (current vs new)
- Confirms before executing transaction
- Verifies updated fees after transaction

**Parameters:**
- `--hbar <amount>`: HBAR fee in whole units (e.g., 10 = 10 HBAR)
- `--lazy <amount>`: LAZY fee in whole units (e.g., 1000 = 1000 LAZY)

**Requirements:**
- Operator must be admin of PoolManager
- Both values must be non-negative

**Notes:**
- Fees only apply to community pools (user-created)
- Global pools (admin-created) always free
- Default suggestion: 10 HBAR + 1000 LAZY

---

### Add Global Prize Manager

```bash
# Interactive mode
node scripts/interactions/LazyLotto/admin/add-global-prize-manager.js

# Command line argument
node scripts/interactions/LazyLotto/admin/add-global-prize-manager.js --manager 0.0.1234
```

**Purpose**: Grant another account permission to manage prizes for global pools.

**What it does:**
- Verifies operator is admin
- Checks if target account is already a manager
- Displays manager details
- Confirms before granting permission
- Verifies manager status after transaction

**Parameters:**
- `--manager <accountId>`: Hedera account ID to add as manager (e.g., `0.0.1234`)

**Requirements:**
- Operator must be admin of PoolManager
- Target account must be a valid Hedera account

**Notes:**
- Global prize managers can configure prizes for any global pool
- Cannot manage community pools (owner-only)
- Multiple managers can exist simultaneously

---

### Transfer Pool Ownership

```bash
# Interactive mode
node scripts/interactions/LazyLotto/admin/transfer-pool-ownership.js

# Command line arguments
node scripts/interactions/LazyLotto/admin/transfer-pool-ownership.js --pool 5 --newowner 0.0.5678
```

**Purpose**: Transfer ownership of a community pool to a new account.

**What it does:**
- Fetches current pool owner
- Verifies operator is current owner OR admin
- Shows ownership transfer details (old → new)
- Warns that action is irreversible
- Confirms before executing transfer
- Verifies new owner after transaction

**Parameters:**
- `--pool <id>`: Pool ID to transfer (integer)
- `--newowner <accountId>`: New owner's Hedera account ID (e.g., `0.0.5678`)

**Requirements:**
- Pool must be a community pool (not global)
- Operator must be current pool owner OR admin
- New owner cannot be same as current owner

**Notes:**
- ⚠️ **Irreversible action** - new owner has full control
- New owner can withdraw proceeds, transfer ownership again, etc.
- Cannot transfer global pools (owned by zero address)

---

### Migrate Bonuses

```bash
# Using default configuration
node scripts/interactions/LazyLotto/admin/migrate-bonuses.js

# Using custom config file
node scripts/interactions/LazyLotto/admin/migrate-bonuses.js --config ./bonus-config.json
```

**Purpose**: Batch migration of bonus configurations from LazyLotto Storage to PoolManager.

**What it does:**
- Loads bonus configuration (default or from JSON file)
- Verifies operator is admin
- Displays summary of all bonuses to migrate
- Confirms before starting batch operations
- Executes transactions for each bonus:
  - Time bonuses (multiple entries)
  - NFT bonuses (multiple collections)
  - LAZY balance bonus (single entry)
- Reports success/failure for each operation
- Provides final summary

**Parameters:**
- `--config <path>`: Path to JSON config file (optional, uses defaults if omitted)

**Config File Format:**
```json
{
  "timeBonuses": [
    { "threshold": 86400, "multiplier": 110 },
    { "threshold": 2592000, "multiplier": 125 }
  ],
  "nftBonuses": [
    { "address": "0.0.1234", "multiplier": 115 }
  ],
  "lazyBalanceBonus": { 
    "threshold": 1000000, 
    "multiplier": 105 
  }
}
```

**Config Explained:**
- **timeBonuses**: Array of time-based multipliers
  - `threshold`: Seconds of token holding required (86400 = 1 day)
  - `multiplier`: Percentage multiplier (110 = 110% = 10% bonus)
- **nftBonuses**: Array of NFT collection bonuses
  - `address`: Hedera token ID (e.g., `0.0.1234`) or EVM address
  - `multiplier`: Percentage multiplier (115 = 115% = 15% bonus)
- **lazyBalanceBonus**: Single LAZY balance threshold
  - `threshold`: Minimum LAZY tokens required (consider decimals)
  - `multiplier`: Percentage multiplier (105 = 105% = 5% bonus)

**Default Configuration:**
- Time bonuses: 1 day (10%), 7 days (15%), 30 days (25%), 90 days (50%)
- NFT bonuses: None (empty array)
- LAZY balance: 1M tokens (5%)

**Requirements:**
- Operator must be admin of PoolManager
- Config file must be valid JSON with required structure

**Notes:**
- Operations are executed sequentially with 2-second delays
- Some operations may fail while others succeed (partial migration)
- Failed operations are reported in final summary
- Can be run multiple times to retry failed operations

---

## User Scripts

**Note on Naming Convention**: All scripts use camelCase for variable names (e.g., `lazyTokenId`, `poolManagerId`, `lazyGasStationId`) following JavaScript conventions. Environment variables in `.env` remain in SCREAMING_SNAKE_CASE for compatibility.

### Create Community Pool

```bash
node scripts/interactions/LazyLotto/user/create-community-pool.js
```

**Purpose**: Create a user-owned community pool with custom token and configuration.

**What it does:**
- **Interactive prompts** for all pool parameters:
  - Token name (e.g., "MyCoin")
  - Token symbol (e.g., "MYC")
  - Token memo (description)
  - Win rate (1-100, percentage of entries that win)
  - Entry fee (in tinybars, e.g., 100000000 = 1 HBAR)
  - Token CID (IPFS content identifier)
  - Metadata CID (IPFS content identifier)
- **Balance validation**:
  - Checks HBAR balance (needs ~20 HBAR for token creation + fees)
  - Checks LAZY balance (needs current creation fee)
- **Allowance management**:
  - Checks LAZY allowance to LazyGasStation
  - Prompts to set allowance if insufficient
- **Summary display**:
  - Shows all pool parameters
  - Displays fees (HBAR + LAZY)
  - Shows estimated costs
- **Final confirmation** before execution
- **Post-creation**:
  - Waits 5 seconds for mirror node sync
  - Fetches and displays new pool ID

**Requirements:**
- Sufficient HBAR (~20 HBAR recommended)
- Sufficient LAZY tokens (check current creation fees)
- LAZY allowance set to LazyGasStation

**Example Session:**
```
Enter token name: MyCoin
Enter token symbol: MYC
Enter token memo: My awesome community token
Enter win rate (1-100): 10
Enter entry fee (tinybars): 100000000
Enter token CID: Qm...
Enter metadata CID: Qm...

Current Balance: 100 HBAR
LAZY Balance: 5000 LAZY
Creation Fees: 10 HBAR + 1000 LAZY

Create this pool? (yes/no): yes
```

**Notes:**
- Token is created as fungible Hedera Token Service (HTS) token
- Pool owner receives initial token supply
- Win rate determines prize distribution (10 = 10% of entries win)
- Entry fee is in tinybars (100000000 = 1 HBAR)

---

### Withdraw Pool Proceeds

```bash
# For HBAR proceeds
node scripts/interactions/LazyLotto/user/withdraw-pool-proceeds.js --pool 5

# For fungible token proceeds
node scripts/interactions/LazyLotto/user/withdraw-pool-proceeds.js --pool 5 --token 0.0.1234
```

**Purpose**: Withdraw accumulated proceeds from community pool (owner only).

**What it does:**
- Fetches pool ownership information
- Verifies operator is pool owner (or admin as fallback)
- Fetches proceeds data (total collected, withdrawn, available)
- Displays 95/5 split (95% to owner, 5% to platform)
- Confirms before withdrawal
- Verifies updated proceeds after transaction

**Parameters:**
- `--pool <id>`: Pool ID to withdraw from (required)
- `--token <address>`: Token address for fungible tokens (optional, defaults to HBAR)

**Requirements:**
- Operator must be pool owner OR admin
- Pool must have available proceeds to withdraw
- Cannot withdraw from global pools (no owner)

**Split Details:**
- 95% goes to pool owner
- 5% goes to platform (LazyLotto treasury)
- Split applies to ALL proceeds (HBAR and tokens)

**Example Output:**
```
Pool #5 Proceeds (HBAR)
  Total Collected:  100 HBAR
  Withdrawn:        20 HBAR
  Available:        80 HBAR

Split Calculation:
  Your Share (95%): 76 HBAR
  Platform (5%):    4 HBAR

Proceed with withdrawal? (yes/no):
```

**Notes:**
- Can withdraw HBAR and multiple fungible tokens separately
- Proceeds accumulate from entry fees (after prize payouts)
- Platform fee funds LazyLotto development and operations

---

### View Pool Info (Extended)

```bash
# Interactive mode
node scripts/interactions/LazyLotto/user/view-pool-info.js

# Command line argument
node scripts/interactions/LazyLotto/user/view-pool-info.js --pool 5
```

**Purpose**: Display extended pool information including ownership and financial data (PoolManager-specific).

**What it does:**
- Fetches pool ownership (owner address or "Global")
- Shows HBAR proceeds (total, withdrawn, available)
- Shows LAZY proceeds (total, withdrawn, available)
- Displays pool type (Global vs Community)
- Suggests using `poolInfo.js` for configuration details

**Parameters:**
- `--pool <id>`: Pool ID to view (integer)

**Requirements:**
- None (read-only query)

**Example Output:**
```
╔════════════════════════════════════════════════════════════╗
║         LazyLotto Pool Info (Extended)                    ║
╚════════════════════════════════════════════════════════════╝

Environment: TESTNET
Pool: #5

═══════════════════════════════════════════════════════════
  OWNERSHIP
═══════════════════════════════════════════════════════════
  Type:             Community (User-owned)
  Owner:            0.0.1234
═══════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════
  HBAR PROCEEDS
═══════════════════════════════════════════════════════════
  Total Collected:  100 HBAR
  Withdrawn:        20 HBAR
  Available:        80 HBAR
═══════════════════════════════════════════════════════════

💡 For detailed pool configuration (win rate, prizes, etc.), use:
   node scripts/interactions/LazyLotto/queries/poolInfo.js 5
```

**Notes:**
- This script shows **financial and ownership data** from PoolManager
- For **pool configuration** (win rate, prizes, entries), use `queries/poolInfo.js`
- Complementary to `poolInfo.js` (they show different data)
- Global pools show "N/A (Global pool)" for owner

---

## Script Patterns

All scripts follow consistent Hedera SDK patterns:

### Interactive Validation
- ✅ Readline prompts for user input
- ✅ Balance checks before operations
- ✅ Allowance validation with prompts to set
- ✅ Formatted displays with box drawing characters
- ✅ Final confirmation before execution

### Transaction Flow
1. **Validate**: Check user permissions and balances
2. **Estimate**: Calculate gas requirements
3. **Confirm**: Show summary and await user confirmation
4. **Execute**: Send transaction with 20% gas buffer
5. **Verify**: Wait 5 seconds, query mirror node to verify state change

### Error Handling
- Clear error messages with specific failure reasons
- Transaction IDs provided for debugging
- Graceful exits with proper status codes

### LAZY Fee Pattern
- **LAZY allowances** always go to LazyGasStation (not Storage)
- Check allowance (camelCase in code):
  ```javascript
  const allowance = await checkMirrorAllowance(
    env,
    userId,
    lazyTokenId,
    lazyGasStationId
  );
  ```
- Set allowance (camelCase in code):
  ```javascript
  await setFTAllowance(
    client,
    lazyTokenId,
    userId,
    lazyGasStationId,
    amount
  );
  ```
- Scripts automatically prompt user if allowance insufficient

---

## Troubleshooting

### "You are not an admin"
- Verify your account is admin via `queryContract()`
- Check `.env` has correct `ACCOUNT_ID` and `PRIVATE_KEY`

### "Insufficient balance"
- Check HBAR balance: needs ~20 HBAR for pool creation
- Check LAZY balance: needs current creation fee amount
- Use `checkMirrorBalance()` to verify

### "Insufficient allowance"
- Set LAZY allowance to LazyGasStation
- Use `setFTAllowance()` helper or run creation script (it prompts)

### "Pool does not exist"
- Verify pool ID via `poolInfo.js`
- Check pool count via `queryContract()`

### "Mirror node timing issues"
- Wait 5-10 seconds between state-changing operations
- Scripts include `sleep(5000)` automatically
- If verification fails, manually recheck after 10 seconds

---

## Environment File

Required `.env` variables (SCREAMING_SNAKE_CASE):

```env
# Account
ACCOUNT_ID=0.0.1234
PRIVATE_KEY=302e...

# Network
ENVIRONMENT=test  # test, main, or preview

# Core Contracts
LAZY_TOKEN_ID=0.0.5678
LAZY_GAS_STATION_CONTRACT_ID=0.0.9012
LAZY_DELEGATE_REGISTRY_CONTRACT_ID=0.0.3456
LAZY_LOTTO_CONTRACT_ID=0.0.7890
LAZY_LOTTO_STORAGE=0.0.2345

# Pool Manager (automatically added by deployment script)
LAZY_LOTTO_POOL_MANAGER_ID=0.0.6789
```

**Note**: Variable names in code use camelCase:
```javascript
// How these are used in JavaScript:
const lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN_ID);
const lazyGasStationId = ContractId.fromString(process.env.LAZY_GAS_STATION_CONTRACT_ID);
const lazyDelegateRegistryId = ContractId.fromString(process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID);
const lazyLottoId = ContractId.fromString(process.env.LAZY_LOTTO_CONTRACT_ID);
const storageContractId = ContractId.fromString(process.env.LAZY_LOTTO_STORAGE);
const poolManagerId = ContractId.fromString(process.env.LAZY_LOTTO_POOL_MANAGER_ID);
```

---

## Additional Resources

- **Query Scripts**: Use `scripts/interactions/LazyLotto/queries/` for read-only operations
- **Pool Configuration**: Use `poolInfo.js` for detailed pool settings
- **Testing**: See `test/LazyLottoPoolManager.test.js` for integration tests
- **Helper Functions**: See `utils/solidityHelpers.js` and `utils/hederaHelpers.js`

---

## Support

For issues or questions:
1. Check error messages (include transaction IDs)
2. Verify environment file has all required variables
3. Ensure contracts are deployed and linked properly
4. Review Hedera mirror node status (testnet/mainnet)

---

*Last updated: 2024 - All scripts use Hedera SDK patterns (not ethers/hardhat)*

**Customization:**
Edit the `bonusConfig` object in the script:

```javascript
const bonusConfig = {
    timeBonuses: [
        { start: 1735689600, end: 1736294400, bonusBps: 1000 }, // 10% for a week
    ],
    nftBonuses: [
        { token: '0x...', bonusBps: 500 }, // 5% for NFT holders
    ],
    lazyBalanceBonus: {
        threshold: ethers.parseEther('10000'), // 10,000 LAZY
        bonusBps: 500, // 5% bonus
    },
};
```

## User Scripts

### 7. Create Community Pool

```bash
node scripts/interactions/LazyLotto/user/create-community-pool.js
```

**What it does:**
- Creates a new community pool
- Pays creation fees (HBAR + LAZY)
- Creator becomes pool owner

**Customization:**
Edit `poolParams` in the script:

```javascript
const poolParams = {
    name: 'My Lottery Pool',
    symbol: 'MLP',
    memo: 'Community lottery',
    winRate: 1000000, // 1% (in thousandths of bps)
    entryFee: ethers.parseEther('10'),
    feeToken: addresses.lazyToken, // or ZeroAddress for HBAR
};
```

**Cost:**
- HBAR: Creation fee + token creation cost (~30 HBAR total)
- LAZY: Creation fee (default 1000 LAZY)

### 8. Withdraw Pool Proceeds

```bash
# Withdraw HBAR proceeds
node scripts/interactions/LazyLotto/user/withdraw-pool-proceeds.js --pool 5

# Withdraw LAZY proceeds
node scripts/interactions/LazyLotto/user/withdraw-pool-proceeds.js --pool 5 --token 0x...
```

**What it does:**
- Withdraws 95% of pool proceeds to owner
- 5% retained as platform fee

**Parameters:**
- `--pool <poolId>`: Pool ID (required)
- `--token <address>`: Token address (optional, default: HBAR)

**Requirements:**
- Must be pool owner or admin
- Pool must have collected proceeds

### 9. View Pool Information

```bash
node scripts/interactions/LazyLotto/user/view-pool-info.js --pool 5
```

**What it does:**
- Shows pool ownership and type
- Shows pool details (entry fee, win rate, status)
- Shows proceeds for HBAR and LAZY

**Parameters:**
- `--pool <poolId>`: Pool ID (required)

## Deployment Workflow

### New Deployment

1. Deploy dependencies (if not already deployed):
   ```bash
   # Deploy in order:
   node scripts/deployments/deployLazyToken.js
   node scripts/deployments/deployGasStation.js
   node scripts/deployments/deployDelegateRegistry.js
   node scripts/deployments/LazyLotto/deployStorage.js
   node scripts/deployments/LazyLotto/deployLazyLotto.js
   ```

2. Deploy and link PoolManager:
   ```bash
   node scripts/deployments/LazyLotto/deploy-pool-manager.js
   node scripts/deployments/LazyLotto/link-pool-manager.js
   ```

3. Configure system:
   ```bash
   node scripts/interactions/LazyLotto/admin/set-creation-fees.js
   node scripts/interactions/LazyLotto/admin/migrate-bonuses.js
   ```

4. Test pool creation:
   ```bash
   node scripts/interactions/LazyLotto/user/create-community-pool.js
   ```

### Upgrading Existing LazyLotto

1. Deploy PoolManager:
   ```bash
   node scripts/deployments/LazyLotto/deploy-pool-manager.js
   ```

2. Deploy new LazyLotto (with PoolManager integration)

3. Link contracts:
   ```bash
   node scripts/deployments/LazyLotto/link-pool-manager.js
   ```

4. Migrate configuration:
   ```bash
   node scripts/interactions/LazyLotto/admin/set-creation-fees.js
   node scripts/interactions/LazyLotto/admin/migrate-bonuses.js
   # Migrate prize managers if any
   node scripts/interactions/LazyLotto/admin/add-global-prize-manager.js --address 0x...
   ```

5. Migrate existing pools (manual process):
   - Existing pools remain as global pools (address(0))
   - Only admins can manage them
   - No ownership migration needed

## Environment File Format

`.env.testnet.json` or `.env.mainnet.json`:

```json
{
  "lazyToken": "0x...",
  "lazyGasStation": "0x...",
  "lazyDelegateRegistry": "0x...",
  "lazyLottoStorage": "0x...",
  "lazyLotto": "0x...",
  "lazyLottoPoolManager": "0x..."
}
```

## Common Operations

### Check Pool Ownership

```bash
node scripts/interactions/LazyLotto/user/view-pool-info.js --pool 5
```

### Verify Creation Fees

```javascript
const poolManager = await ethers.getContractAt('LazyLottoPoolManager', addresses.lazyLottoPoolManager);
const fees = await poolManager.getCreationFees();
console.log('HBAR:', ethers.formatEther(fees.hbar));
console.log('LAZY:', ethers.formatEther(fees.lazy));
```

### Check Platform Balance

```javascript
const platformBalance = await poolManager.getPlatformBalance(ethers.ZeroAddress); // HBAR
console.log('Platform HBAR:', ethers.formatEther(platformBalance));
```

### Withdraw Platform Fees (Admin Only)

```javascript
// Add this to LazyLotto admin interactions
const tx = await lazyLotto.withdrawPlatformFees(ethers.ZeroAddress); // HBAR
await tx.wait();
```

## Testing

Run all tests:

```bash
npx hardhat test
```

Run PoolManager unit tests only:

```bash
npx hardhat test test/LazyLottoPoolManager.test.js
```

Run integration tests (to be created):

```bash
npx hardhat test test/LazyLotto.poolManager.integration.test.js
```

## Troubleshooting

### "LazyLottoAlreadySet" Error

**Issue:** Trying to set LazyLotto address twice  
**Solution:** PoolManager already linked, skip this step

### "NotAuthorized" Error

**Issue:** Caller is not admin, pool owner, or prize manager  
**Solution:** Check authorization with view-pool-info.js

### "InsufficientHbarFee" Error

**Issue:** Not enough HBAR sent for creation fee  
**Solution:** Check fees with getCreationFees() and send more HBAR

### "CannotTransferGlobalPools" Error

**Issue:** Trying to transfer ownership of a global pool  
**Solution:** Global pools (poolOwner = address(0)) cannot be transferred

### Contract Size Exceeds Limit

**Issue:** Contract over 24 KB after compilation  
**Solution:** Review architecture document, some features may need removal

## Security Notes

1. **Admin Keys**: Keep admin private keys secure
2. **One-Time Setters**: `setLazyLotto()` and `setPoolManager()` can only be called once
3. **Creation Fees**: Fees go to PoolManager contract (not admin wallet)
4. **Platform Fees**: 5% of proceeds retained for platform (adjustable by admin)
5. **Pool Ownership**: Cannot be revoked by admin (only transferred)

## Support

For issues or questions:
1. Check test files for usage examples
2. Review architecture document: `LazyLotto-POOL_MANAGER_ARCHITECTURE.md`
3. Review implementation guide: `LazyLotto-POOL_MANAGER_IMPLEMENTATION_GUIDE.md`
4. Check test plan: `LazyLotto-POOL_MANAGER_TEST_PLAN.md`
