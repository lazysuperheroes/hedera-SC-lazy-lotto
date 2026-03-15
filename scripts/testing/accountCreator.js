const { PrivateKey } = require('@hashgraph/sdk');
const { accountCreator } = require('../../utils/hederaHelpers');
const { getEnvConfig, createClient } = require('../../utils/clientFactory');

async function main() {
	// check arguments on command line if none supplied spit out usage
	// test or preview expected
	const envArg = process.argv[2];
	if (envArg == null) {
		console.log('Usage: node accountCreator.js <test|preview>');
		return;
	}

	if (envArg.toLowerCase() !== 'test' && envArg.toLowerCase() !== 'preview') {
		console.log('Usage: node accountCreator.js <test|preview>');
		return;
	}

	const { operatorId, operatorKey } = getEnvConfig();
	const client = createClient(envArg, operatorId, operatorKey);
	const bobPK = PrivateKey.generateED25519();
	const bobId = await accountCreator(client, bobPK, 25);
	console.log(
		'Bob account ID:',
		bobId.toString(),
		'\nkey:',
		bobPK.toString(),
	);
}

main();