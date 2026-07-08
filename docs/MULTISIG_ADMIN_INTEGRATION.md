# Multi-Signature Admin Integration Guide

## Overview

This guide explains how to add multi-signature support to LazyLotto admin scripts. The integration is designed to be:
- **Non-breaking**: Scripts work without `--multisig` flag (backward compatible)
- **Drop-in**: Minimal code changes required
- **Flexible**: Supports both interactive and offline workflows

## Quick Start

### Using Multi-Sig with Existing Scripts

Any admin script can be enhanced with multi-sig support by adding the `--multisig` flag:

```bash
# Single-signature (existing behavior)
node scripts/interactions/LazyLotto/admin/setPlatformFee.js 10

# Multi-signature - Interactive mode
node scripts/interactions/LazyLotto/admin/setPlatformFee.js 10 --multisig

# Multi-signature - Offline mode
node scripts/interactions/LazyLotto/admin/setPlatformFee.js 10 --multisig --export-only
```

## Integration Steps

### Step 1: Add Script Helpers Import

At the top of your admin script, add the script helpers import:

```javascript
// Add these imports to any admin script:
require('dotenv').config();
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { prompt } = require('../../../../utils/promptHelpers');
const { queryContract } = require('../../../../utils/queryHelpers');
const {
	executeContractFunction,
	checkMultiSigHelp,
	displayMultiSigBanner
} = require('../../../../utils/scriptHelpers');
```

### Step 2: Update Usage Documentation

Update the file header comment to include multi-sig usage examples:

```javascript
/**
 * Set Platform Fee Percentage
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyLotto/admin/setPlatformFee.js [percentage]
 *   Multi-sig:  node scripts/interactions/LazyLotto/admin/setPlatformFee.js [percentage] --multisig
 *   Help:       node scripts/interactions/LazyLotto/admin/setPlatformFee.js --multisig-help
 *
 * Multi-sig options:
 *   --multisig                      Enable multi-signature mode
 *   --workflow=interactive|offline  Choose workflow (default: interactive)
 *   --export-only                   Just freeze and export (offline mode)
 *   --signatures=f1.json,f2.json    Execute with collected signatures
 *   --threshold=N                   Require N signatures
 *   --signers=Alice,Bob,Charlie     Label signers for clarity
 */
```

### Step 3: Add Multi-Sig Help Check in main()

At the start of your `main()` function, check for help request:

```javascript
async function main() {
	// Check for multi-sig help request
	if (checkMultiSigHelp()) {
		process.exit(0);
	}

	// Rest of your main() code...
}
```

### Step 4: Display Multi-Sig Banner

After your script header output, display the multi-sig status:

```javascript
console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║         Set Platform Fee Percentage (Admin)               ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Display multi-sig status if enabled
displayMultiSigBanner();
```

### Step 5: Replace ContractExecuteTransaction

Replace the manual `ContractExecuteTransaction` code with `executeContractFunction`:

#### Before (Single-Sig Only):

```javascript
const encodedFunction = poolManagerIface.encodeFunctionData('setPlatformProceedsPercentage', [percentage]);

const tx = await new ContractExecuteTransaction()
	.setContractId(poolManagerId)
	.setGas(300000)
	.setFunction('setPlatformProceedsPercentage', Buffer.from(encodedFunction.slice(2), 'hex'))
	.execute(client);

const receipt = await tx.getReceipt(client);

if (receipt.status.toString() !== 'SUCCESS') {
	throw new Error(`Transaction failed with status: ${receipt.status.toString()}`);
}
```

#### After (Single-Sig + Multi-Sig):

```javascript
const executionResult = await executeContractFunction({
	contractId: poolManagerId,
	iface: poolManagerIface,
	client: client,
	functionName: 'setPlatformProceedsPercentage',
	params: [percentage],
	gas: 300000,
	payableAmount: 0 // Optional: HBAR to send
});

if (!executionResult.success) {
	throw new Error(executionResult.error || 'Transaction execution failed');
}

const { receipt, results } = executionResult;
```

### Step 6: Handle Receipt Variations

The receipt format may vary between single-sig and multi-sig. Handle both:

```javascript
// Handle different receipt formats
const txId = receipt.transactionId?.toString() || 'N/A';
const status = receipt.status?.toString() || 'SUCCESS';

console.log(`   Transaction: ${txId}`);
console.log(`   Status: ${status}\n`);
```

### Step 7: Filter Command Line Arguments

If your script accepts positional arguments, filter out flags:

```javascript
// Before
let percentage = process.argv[2];

// After
let percentage = process.argv[2];
if (percentage && percentage.startsWith('--')) {
	percentage = null; // It's a flag, not the argument we want
}
```

## Complete Example

See `examples/multiSigAdminExample.js` for a complete working example based on `setPlatformFee.js`.

## Usage Examples

### Interactive Mode (Real-Time Coordination)

Best for teams available simultaneously:

```bash
# 2-of-2 multi-sig (all signers required)
node scripts/interactions/LazyLotto/admin/createPool.js --multisig

# 2-of-3 multi-sig (specify threshold)
node scripts/interactions/LazyLotto/admin/setPlatformFee.js 10 --multisig --threshold=2

# With labeled signers
node scripts/interactions/LazyLotto/admin/closePool.js 5 --multisig \\
  --signers=Alice,Bob,Charlie --threshold=2
```

### Offline Mode (Air-Gapped Signing)

Best for high security, distributed teams:

#### Phase 1: Freeze & Export

```bash
node scripts/interactions/LazyLotto/admin/withdrawTokens.js \\
  0.0.123456 1000 --multisig --export-only
```

Output:
```
Transaction exported to: multisig-transactions/0-0-98765-1234567890-123456789.tx
Metadata exported to: multisig-transactions/0-0-98765-1234567890-123456789.json
```

#### Phase 2: Signers Sign Offline

Each signer runs on their machine (potentially air-gapped):

```bash
# Alice signs
npx @lazysuperheroes/hedera-multisig sign multisig-transactions/0-0-98765-1234567890-123456789.tx
# Creates: alice-signature.json

# Bob signs
npx @lazysuperheroes/hedera-multisig sign multisig-transactions/0-0-98765-1234567890-123456789.tx
# Creates: bob-signature.json
```

#### Phase 3: Execute with Collected Signatures

```bash
node scripts/interactions/LazyLotto/admin/withdrawTokens.js \\
  0.0.123456 1000 --multisig --offline \\
  --signatures=alice-signature.json,bob-signature.json
```

### Using Encrypted Key Files

For repeated operations without entering private keys:

```bash
# Create encrypted key files once
npx @lazysuperheroes/hedera-multisig create-key-file
# Follow prompts to create alice.enc

# Use in scripts
node scripts/interactions/LazyLotto/admin/setBonuses.js \\
  --multisig --keyfile=alice.enc,bob.enc --threshold=2
```

## Admin Scripts to Update

All 21 admin scripts in `scripts/interactions/LazyLotto/admin/` can benefit from multi-sig integration:

### Pool Management (7 scripts)
- [ ] `createPool.js` - Create new lottery pool
- [ ] `closePool.js` - Close an existing pool
- [ ] `pausePool.js` - Pause pool operations
- [ ] `unpausePool.js` - Resume pool operations
- [ ] `addPrizePackage.js` - Add prizes to pool
- [ ] `addPrizesBatch.js` - Batch add multiple prizes
- [ ] `removePrizes.js` - Remove prizes from pool

### Fee & Configuration (4 scripts)
- [ ] `setPlatformFee.js` - Set platform fee percentage
- [ ] `setCreationFees.js` - Set pool creation fees
- [ ] `setBonuses.js` - Configure bonus systems
- [ ] `setBurnPercentage.js` - Set burn percentage

### Access Control (3 scripts)
- [ ] `manageRoles.js` - Grant/revoke admin roles
- [ ] `addGlobalPrizeManager.js` - Add global prize manager
- [ ] `manageGlobalPrizeManagers.js` - Manage prize managers

### System Operations (3 scripts)
- [ ] `withdrawTokens.js` - Withdraw platform fees
- [ ] `pauseContract.js` - Pause entire contract
- [ ] `migrateBonuses.js` - Migrate bonus configuration

### User Operations (3 scripts)
- [ ] `grantEntry.js` - Grant free entry to user
- [ ] `buyAndRedeemEntry.js` - Buy and immediately redeem
- [ ] `transferPoolOwnership.js` - Transfer pool ownership

## Testing Checklist

### Backward Compatibility
- [ ] Script runs without `--multisig` flag (single-sig mode)
- [ ] All original functionality preserved
- [ ] No breaking changes to existing workflows

### Multi-Sig Functionality
- [ ] `--multisig` flag enables multi-sig mode
- [ ] `--multisig-help` displays help
- [ ] Interactive workflow completes successfully
- [ ] Offline workflow: freeze, sign, execute works
- [ ] `--threshold` parameter respected
- [ ] `--signers` labels displayed correctly
- [ ] `--export-only` creates transaction files
- [ ] `--signatures` executes with collected sigs

### Error Handling
- [ ] Invalid signatures rejected
- [ ] Expired transactions detected
- [ ] Insufficient signatures caught
- [ ] Clear error messages displayed
- [ ] Graceful fallback on failure

## Troubleshooting

### "Transaction expired" Error

**Problem**: Transaction took too long to collect signatures (>110 seconds)

**Solution**: Use offline workflow instead:
```bash
node script.js --multisig --export-only
# Signers sign offline at their own pace
node script.js --multisig --offline --signatures=s1.json,s2.json
```

### "Insufficient signatures" Error

**Problem**: Not enough valid signatures collected

**Solution**:
- Verify threshold is set correctly
- Ensure all signers have signed
- Check signature files are valid JSON

### "Invalid signature" Error

**Problem**: Signature doesn't match the transaction or account

**Solution**:
- Verify signer used correct private key
- Check transaction file wasn't modified
- Ensure key type matches (Ed25519 vs ECDSA)

### Script Still Uses Single-Sig

**Problem**: Added `--multisig` but script ignores it

**Solution**:
- Verify `executeContractFunction` is used (not `ContractExecuteTransaction`)
- Check script helpers are imported
- Ensure no errors in integration code

## Security Best Practices

### Key Management
- ✅ Use encrypted key files for repeated operations
- ✅ Use prompt-based input for highest security
- ✅ Never commit private keys to git
- ✅ Use different keys for testnet vs mainnet

### Workflow Selection
- ✅ Interactive mode: Coordinated teams, good connectivity
- ✅ Offline mode: High security, air-gapped systems, distributed teams
- ✅ Export-only: Share via encrypted channels only

### Signature Verification
- ✅ Always review transaction details before signing
- ✅ Verify transaction hash matches across all signers
- ✅ Confirm signer identities before accepting signatures
- ✅ Maintain audit logs of all multi-sig operations

## Additional Resources

- **Multi-Sig Library Documentation**: `docs/MULTISIG_USER_GUIDE.md`
- **Developer Guide**: `docs/MULTISIG_DEVELOPER_GUIDE.md`
- **Security Analysis**: `docs/MULTISIG_SECURITY.md`
- **npm Package**: `@lazysuperheroes/hedera-multisig`
- **CLI Tools** (via npx):
  - `npx @lazysuperheroes/hedera-multisig create-key-file` - Create encrypted key files
  - `npx @lazysuperheroes/hedera-multisig test-key-file` - Test encrypted key files
  - `npx @lazysuperheroes/hedera-multisig sign` - Offline transaction signing
  - `npx @lazysuperheroes/hedera-multisig security-audit` - Scan for security issues

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review error messages carefully
3. Check audit logs: `logs/audit.log`
4. Run security audit: `npx @lazysuperheroes/hedera-multisig security-audit`
5. Open an issue on GitHub with error details
