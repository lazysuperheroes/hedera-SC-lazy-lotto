/**
 * LazyTradeLotto - Require Codeless Callers (Admin)
 *
 * Turns the HIP-1340 / EIP-7702 guard on or off. When on, rollLotto also requires the caller's
 * address to have no code, which rejects EOAs that have set a code delegation (they still pass
 * tx.origin == msg.sender, so could otherwise inspect and revert a losing roll). Off by default:
 * enable it once HIP-1340 is live and the behaviour has been validated on testnet.
 * Only the contract owner can perform this operation.
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyTradeLotto/admin/setRequireCodelessCaller.js 0.0.LTL [on|off]
 *   Multi-sig:  node scripts/interactions/LazyTradeLotto/admin/setRequireCodelessCaller.js 0.0.LTL <on|off> --multisig
 *   Help:       node scripts/interactions/LazyTradeLotto/admin/setRequireCodelessCaller.js --multisig-help
 *
 * Multi-sig options:
 *   --multisig                      Enable multi-signature mode
 *   --workflow=interactive|offline  Choose workflow (default: interactive)
 *   --export-only                   Just freeze and export (offline mode)
 *   --signatures=f1.json,f2.json    Execute with collected signatures
 *   --threshold=N                   Require N signatures
 *   --signers=Alice,Bob,Charlie     Label signers for clarity
 *
 * If no value is provided, the current setting will be displayed.
 */

require('dotenv').config();
const { ContractId } = require('@hashgraph/sdk');
const readlineSync = require('readline-sync');
const { createClient, getEnvConfig } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { queryContract } = require('../../../../utils/queryHelpers');
const { getArgFlag } = require('../../../../utils/nodeHelpers');
const {
	executeContractFunction,
	checkMultiSigHelp,
	displayMultiSigBanner,
} = require('../../../../utils/scriptHelpers');

const contractName = 'LazyTradeLotto';

const { operatorId, operatorKey, env } = getEnvConfig();
let client;

const main = async () => {
	// Check for multi-sig help request
	if (checkMultiSigHelp()) {
		process.exit(0);
	}

	console.log('\n-Using ENVIRONMENT:', env);

	// Initialize client
	client = createClient(env, operatorId, operatorKey);

	const args = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
	if (args.length < 1 || getArgFlag('h')) {
		console.log('Usage: setRequireCodelessCaller.js 0.0.LTL [on|off]');
		console.log('       LTL is the LazyTradeLotto contract address');
		console.log('       on  = rollLotto rejects callers whose address has code (HIP-1340 delegated EOAs)');
		console.log('       off = tx.origin == msg.sender only (default)');
		console.log('');
		console.log('If no value is provided, the current setting will be displayed');
		console.log('\nMulti-sig: Add --multisig flag for multi-signature mode');
		console.log('           Use --multisig-help for multi-sig options');
		return;
	}

	// Import ABI
	const ltlIface = loadInterface(contractName);

	const contractId = ContractId.fromString(args[0]);

	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());

	// Display multi-sig status if enabled
	displayMultiSigBanner();

	const currentRes = await queryContract(env, contractId, ltlIface, 'requireCodelessCaller', [], operatorId);
	console.log('\n-Require codeless caller:', currentRes[0] ? 'ON' : 'off');

	// If no new value is provided, exit after showing the current value
	if (args.length < 2) {
		console.log('\nTo change it, pass on or off as the second argument.');
		return;
	}

	const value = args[1].toLowerCase();
	if (!['on', 'off', 'true', 'false'].includes(value)) {
		console.log('ERROR: value must be on or off');
		return;
	}
	const enabled = value === 'on' || value === 'true';

	if (enabled) {
		console.log('\nOnly enable this once HIP-1340 delegation is live and validated on testnet:');
		console.log('rolls from accounts with a code delegation will revert OnlyEOA.');
	}

	const proceed = readlineSync.keyInYNStrict(`Do you want to turn the codeless-caller requirement ${enabled ? 'ON' : 'off'}?`);
	if (!proceed) {
		console.log('Operation canceled by user.');
		return;
	}

	const result = await executeContractFunction({
		contractId,
		iface: ltlIface,
		client,
		functionName: 'setRequireCodelessCaller',
		params: [enabled],
		gas: 300_000,
		payableAmount: 0,
	});

	if (!result.success) {
		console.log('Error updating codeless-caller requirement:', result.error);
		return;
	}

	console.log(`\nCodeless-caller requirement is now ${enabled ? 'ON' : 'off'}.`);
	const txId = result.receipt?.transactionId?.toString() || result.record?.transactionId?.toString() || 'N/A';
	console.log('Transaction ID:', txId);
};

main()
	.then(() => {
		process.exit(0);
	})
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
