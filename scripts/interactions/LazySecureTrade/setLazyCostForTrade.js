require('dotenv').config();
const {
	ContractId,
	TokenId,
} = require('@hashgraph/sdk');
const readlineSync = require('readline-sync');
const { createClient, getEnvConfig } = require('../../../utils/clientFactory');
const { loadInterface } = require('../../../utils/abiLoader');
const { queryContract } = require('../../../utils/queryHelpers');
const { contractExecuteFunction } = require('../../../utils/solidityHelpers');
const { getArgFlag } = require('../../../utils/nodeHelpers');
const { getTokenDetails } = require('../../../utils/hederaMirrorHelpers');

const contractName = 'LazySecureTrade';
const LAZY_TOKEN_ID = process.env.LAZY_TOKEN_ID;

const { operatorId, operatorKey, env } = getEnvConfig();
let client;

const main = async () => {
	if (!LAZY_TOKEN_ID) {
		console.log('ERROR: Must specify LAZY_TOKEN_ID in the .env file');
		process.exit(1);
	}

	// Initialize client
	client = createClient(env, operatorId, operatorKey);

	const args = process.argv.slice(2);
	if (args.length != 2 || getArgFlag('h')) {
		console.log('Usage: setLazyCostForTrade.js 0.0.LST <cost>');
		console.log('		LST is the Lazy Secure Trade Contract address');
		console.log('		<cost> in $LAZY');
		return;
	}

	// Import ABI
	const lstIface = loadInterface(contractName);

	const contractId = ContractId.fromString(args[0]);
	const lazy = Number(args[1]);
	const lazyToken = TokenId.fromString(LAZY_TOKEN_ID);

	// get the $LAZY decimal from mirror node
	const lazyTokenDetails = await getTokenDetails(env, lazyToken);
	const lazyTokenDecimals = lazyTokenDetails.decimals;

	if (lazyTokenDecimals == null || lazyTokenDecimals == undefined) {
		console.log('ERROR: Unable to get $LAZY decimals');
		return;
	}

	// get the current cost from the mirror nodes
	const costResult = await queryContract(env, contractId, lstIface, 'lazyCostForTrade', [], operatorId);
	const currentLazyCost = Number(costResult[0]);

	console.log('\n-Using ENVIRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());
	console.log('\n-Using $LAZY:', lazy);
	console.log('\n-Current cost:', currentLazyCost / 10 ** lazyTokenDecimals, '$LAZY');
	console.log('\n-New value (allowing for decimal):', Math.floor(lazy * 10 ** lazyTokenDecimals));


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
		[Math.floor(lazy * 10 ** lazyTokenDecimals)],
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
