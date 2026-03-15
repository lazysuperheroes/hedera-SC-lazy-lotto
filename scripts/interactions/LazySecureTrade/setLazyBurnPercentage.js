require('dotenv').config();
const {
	ContractId,
} = require('@hashgraph/sdk');
const readlineSync = require('readline-sync');
const { createClient, getEnvConfig } = require('../../../utils/clientFactory');
const { loadInterface } = require('../../../utils/abiLoader');
const { queryContract } = require('../../../utils/queryHelpers');
const { contractExecuteFunction } = require('../../../utils/solidityHelpers');
const { getArgFlag } = require('../../../utils/nodeHelpers');

const contractName = 'LazySecureTrade';

const { operatorId, operatorKey, env } = getEnvConfig();
let client;

const main = async () => {
	// Initialize client
	client = createClient(env, operatorId, operatorKey);

	const args = process.argv.slice(2);
	if (args.length != 2 || getArgFlag('h')) {
		console.log('Usage: setLazyBurnPercentage.js 0.0.LST <cost>');
		console.log('		LST is the Lazy Secure Trade Contract address');
		console.log('		<cost> in $LAZY');
		return;
	}

	// Import ABI
	const lstIface = loadInterface(contractName);

	const contractId = ContractId.fromString(args[0]);
	const burnPerc = parseInt(args[1]);

	// get the current burn percentage from the mirror nodes
	const burnResult = await queryContract(env, contractId, lstIface, 'lazyBurnPercentage', [], operatorId);
	const currentBurn = Number(burnResult[0]);

	console.log('\n-Using ENVIRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());
	console.log('\n-Using Burn:', burnPerc, '%');
	console.log('\n-Current Burn:', currentBurn, '%');


	const proceed = readlineSync.keyInYNStrict('Do you want to update the cost?');
	if (!proceed) {
		console.log('User Aborted');
		return;
	}

	const result = await contractExecuteFunction(
		contractId,
		lstIface,
		client,
		300_000,
		'setLazyCostForTrade',
		[burnPerc],
	);

	if (result[0]?.status?.toString() != 'SUCCESS') {
		console.log('Error updating:', result);
		return;
	}

	console.log('$LAZY cost updated. Transaction ID:', result[2]?.transactionId?.toString());
};


main()
	.then(() => {
		process.exit(0);
	})
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
