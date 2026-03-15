const { getArgFlag } = require('../../utils/nodeHelpers');
const readlineSync = require('readline-sync');
const { mintNFT } = require('../../utils/hederaHelpers');
const { getEnvConfig, createClient } = require('../../utils/clientFactory');

const main = async () => {
	const { operatorId, operatorKey, env } = getEnvConfig();
	const client = createClient(env, operatorId, operatorKey);

	const args = process.argv.slice(2);
	if (args.length != 3 || getArgFlag('h')) {
		console.log('Usage: createTestNFT.js "Token Name" "Token Symbol" <quantity>');
		console.log('Example: createTestNFT.js "Test NFT" "TST" 10');
		return;
	}

	const nftName = args[0];
	const nftSymbol = args[1];
	const quantity = parseInt(args[2]);

	console.log('\n-Using ENVIRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using NFT Name:', nftName);
	console.log('\n-Using NFT Symbol:', nftSymbol);
	console.log('\n-Using Quantity:', quantity);

	// ask user if they want to skip royalties
	const includeFee = readlineSync.keyInYNStrict('Do you want to add royalties?');
	// if yes, check if user wants a fallback fee
	const includeFallback = includeFee ? readlineSync.keyInYNStrict('Do you want to add a fallback fee?') : false;

	const proceed = readlineSync.keyInYNStrict('Do you want to proceed?');
	if (!proceed) {
		console.log('User Aborted');
		return;
	}

	const [result, tokenId] = await mintNFT(
		client,
		operatorId,
		nftName,
		nftSymbol,
		quantity,
		50,
		null,
		null,
		!includeFallback,
		!includeFee,
	);

	console.log('Result:', result);
	console.log('Token ID:', tokenId.toString());

};


main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
