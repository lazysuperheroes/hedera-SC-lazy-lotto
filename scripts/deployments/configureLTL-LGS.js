/**
 * Configure LazyTradeLotto with LazyGasStation
 *
 * Adds LazyTradeLotto as a contract user of LazyGasStation.
 * Only the LazyGasStation owner/admin can perform this operation.
 *
 * Usage:
 *   Single-sig: node scripts/deployments/configureLTL-LGS.js
 *   Multi-sig:  node scripts/deployments/configureLTL-LGS.js --multisig
 *   Help:       node scripts/deployments/configureLTL-LGS.js --multisig-help
 *
 * Multi-sig options:
 *   --multisig                      Enable multi-signature mode
 *   --workflow=interactive|offline  Choose workflow (default: interactive)
 *   --export-only                   Just freeze and export (offline mode)
 *   --signatures=f1.json,f2.json    Execute with collected signatures
 *   --threshold=N                   Require N signatures
 *   --signers=Alice,Bob,Charlie     Label signers for clarity
 */

const readlineSync = require('readline-sync');
const {
	executeContractFunction,
	checkMultiSigHelp,
	displayMultiSigBanner,
} = require('../../utils/scriptHelpers');
const { getEnvConfig, createClient, getContractId } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');

const main = async () => {
	// Check for multi-sig help request
	if (checkMultiSigHelp()) {
		process.exit(0);
	}

	const { operatorId, operatorKey, env } = getEnvConfig();
	const client = createClient(env, operatorId, operatorKey);
	const ltlContractId = getContractId('LAZY_TRADE_LOTTO_CONTRACT_ID');
	const lazyGasStationId = getContractId('LAZY_GAS_STATION_CONTRACT_ID');

	console.log('\n-Using ENVIRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Lazy Trade Lotto Contract:', ltlContractId.toString());
	console.log('-Using Lazy Gas Station Contract:', lazyGasStationId.toString());

	// Display multi-sig status if enabled
	displayMultiSigBanner();

	const lazyGasStationIface = loadInterface('LazyGasStation');

	const proceed = readlineSync.keyInYNStrict('Do you want to update the Gas Station for this Lazy Trade Lotto Contract?');

	if (!proceed) {
		console.log('Exiting...');
		return;
	}

	// Add the Lazy Trade Lotto to the lazy gas station as a contract user
	const result = await executeContractFunction({
		contractId: lazyGasStationId,
		iface: lazyGasStationIface,
		client,
		functionName: 'addContractUser',
		params: [ltlContractId.toSolidityAddress()],
		gas: 300_000,
		payableAmount: 0,
	});

	if (!result.success) {
		console.log('ERROR adding LTL to LGS:', result.error);
		return;
	}

	console.log('Lazy Trade Lotto Contract added to Lazy Gas Station!');
	const txId = result.receipt?.transactionId?.toString() || result.record?.transactionId?.toString() || 'N/A';
	console.log('Transaction ID:', txId);
};

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
