/**
 * LazyTradeLotto - Update System Wallet (Admin)
 *
 * Updates the system wallet address used to sign lotto roll transactions.
 * Only the contract owner can perform this operation.
 *
 * WARNING: This is a critical operation! Make sure you have the private key
 * for the new wallet address, otherwise you won't be able to sign any lotto rolls!
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyTradeLotto/admin/updateLottoSystemWallet.js 0.0.LTL 0.0.WALLET
 *   Multi-sig:  node scripts/interactions/LazyTradeLotto/admin/updateLottoSystemWallet.js 0.0.LTL 0.0.WALLET --multisig
 *   Help:       node scripts/interactions/LazyTradeLotto/admin/updateLottoSystemWallet.js --multisig-help
 *
 * Multi-sig options:
 *   --multisig                      Enable multi-signature mode
 *   --workflow=interactive|offline  Choose workflow (default: interactive)
 *   --export-only                   Just freeze and export (offline mode)
 *   --signatures=f1.json,f2.json    Execute with collected signatures
 *   --threshold=N                   Require N signatures
 *   --signers=Alice,Bob,Charlie     Label signers for clarity
 */

require('dotenv').config();
const {
	AccountId,
	ContractId,
} = require('@hashgraph/sdk');
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
	if (args.length !== 2 || getArgFlag('h')) {
		console.log('Usage: updateLottoSystemWallet.js 0.0.LTL 0.0.WALLET');
		console.log('       LTL is the LazyTradeLotto contract address');
		console.log('       WALLET is the Hedera account ID or EVM address of the new system wallet');
		console.log('\nMulti-sig: Add --multisig flag for multi-signature mode');
		console.log('           Use --multisig-help for multi-sig options');
		return;
	}

	// Import ABI
	const ltlIface = loadInterface(contractName);

	const contractId = ContractId.fromString(args[0]);
	let newWalletAddress;

	// Check if the wallet is an account ID or EVM address
	if (args[1].startsWith('0x')) {
		// EVM address provided
		newWalletAddress = args[1];
	}
	else {
		try {
			// Try to parse as Hedera account ID
			const newWalletAccount = AccountId.fromString(args[1]);
			newWalletAddress = newWalletAccount.toSolidityAddress();
		}
		catch {
			console.log('ERROR: Invalid wallet address format. Please provide a valid Hedera account ID or EVM address.');
			return;
		}
	}

	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());

	// Display multi-sig status if enabled
	displayMultiSigBanner();

	// Get current system wallet
	const systemWalletResult = await queryContract(env, contractId, ltlIface, 'systemWallet', [], operatorId);
	const currentSystemWallet = systemWalletResult[0];

	console.log('\n-Current System Wallet: ', `${currentSystemWallet} (${AccountId.fromEvmAddress(0, 0, currentSystemWallet).toString()})`);
	console.log('\n-New System Wallet: ', `${newWalletAddress} (${args[1]})`);

	const proceed = readlineSync.keyInYNStrict('Do you want to update the system wallet?');
	if (!proceed) {
		console.log('Operation canceled by user.');
		return;
	}

	const warningMessage = 'WARNING: This will change the system wallet used to sign lotto transactions!\n' +
		'Make sure you have the private key for this new wallet address, otherwise you won\'t be able to sign any lotto rolls!';
	console.log(`\n${warningMessage}`);

	const confirmProceed = readlineSync.keyInYNStrict('Are you sure you want to proceed?');
	if (!confirmProceed) {
		console.log('Operation canceled by user.');
		return;
	}

	// Update system wallet using multi-sig aware function
	const result = await executeContractFunction({
		contractId,
		iface: ltlIface,
		client,
		functionName: 'updateSystemWallet',
		params: [newWalletAddress],
		gas: 300_000,
		payableAmount: 0,
	});

	if (!result.success) {
		console.log('Error updating system wallet:', result.error);
		return;
	}

	console.log('\nSystem wallet updated successfully!');
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
