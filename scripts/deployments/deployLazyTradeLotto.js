const {
	PrivateKey,
	ContractId,
	TokenId,
	ContractFunctionParameters,
} = require('@hashgraph/sdk');
const fs = require('fs');
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const { contractDeployFunction, contractExecuteFunction } = require('../../utils/solidityHelpers');
const { getEnvConfig, createClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { verifyContract } = require('@lazysuperheroes/hedera-verify');

// Contract names and configuration
const lazyContractCreator = 'LAZYTokenCreator';
const lazyGasStationName = 'LazyGasStation';
const contractName = 'LazyTradeLotto';
const lazyDelegateRegistryName = 'LazyDelegateRegistry';
const prngName = 'PrngSystemContract';
const LAZY_BURN_PERCENT = process.env.LAZY_BURN_PERCENT ?? 25;
const LAZY_DECIMAL = Number(process.env.LAZY_DECIMALS ?? 1);
const LAZY_MAX_SUPPLY = process.env.LAZY_MAX_SUPPLY ?? 250_000_000;

// Variables used throughout the deployment process
let ldrId, prngId, signingWallet;
let lazyTokenId;
let client;
let lazySCT;
let lazyGasStationId;
let lazyIface, lazyGasStationIface;
let initialLottoJackpot, lottoLossIncrement;

const main = async () => {
	const { operatorId, operatorKey, env } = getEnvConfig();
	client = createClient(env, operatorId, operatorKey);

	console.log('\n-Using ENVIRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());

	// Step 1: Set up LAZY token creator and token
	if (process.env.LAZY_SCT_CONTRACT_ID && process.env.LAZY_TOKEN_ID) {
		console.log(
			'\n-Using existing LAZY SCT:',
			process.env.LAZY_SCT_CONTRACT_ID,
		);
		lazySCT = ContractId.fromString(process.env.LAZY_SCT_CONTRACT_ID);

		lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN_ID);
		console.log('\n-Using existing LAZY Token ID:', lazyTokenId.toString());
	}
	else {
		console.log('LAZY_SCT_CONTRACT_ID ->', process.env.LAZY_SCT_CONTRACT_ID);
		console.log('LAZY_TOKEN_ID ->', process.env.LAZY_TOKEN_ID);
		const proceed = readlineSync.keyInYNStrict('No LAZY SCT found, do you want to deploy it and mint $LAZY?');

		if (!proceed) {
			console.log('Aborting');
			return;
		}

		const lazyJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/legacy/${lazyContractCreator}.sol/${lazyContractCreator}.json`,
			),
		);

		const lazyContractBytecode = lazyJson.bytecode;
		lazyIface = new ethers.Interface(lazyJson.abi);

		console.log(
			'\n- Deploying contract...',
			lazyContractCreator,
			'\n\tgas@',
			800_000,
		);

		[lazySCT] = await contractDeployFunction(client, lazyContractBytecode);

		console.log(
			`Lazy Token Creator contract created with ID: ${lazySCT} / ${lazySCT.toSolidityAddress()}`,
		);

		// mint the $LAZY FT
		await mintLazy(
			'Test_Lazy',
			'TLazy',
			'Test Lazy FT',
			LAZY_MAX_SUPPLY * (10 ** LAZY_DECIMAL),
			LAZY_DECIMAL,
			LAZY_MAX_SUPPLY * (10 ** LAZY_DECIMAL),
			30,
		);
		console.log('$LAZY Token minted:', lazyTokenId.toString());
	}

	// Step 2: Set up Lazy Gas Station
	lazyGasStationIface = loadInterface(lazyGasStationName);

	const lazyGasStationJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${lazyGasStationName}.sol/${lazyGasStationName}.json`,
		),
	);

	if (process.env.LAZY_GAS_STATION_CONTRACT_ID) {
		console.log(
			'\n-Using existing Lazy Gas Station:',
			process.env.LAZY_GAS_STATION_CONTRACT_ID,
		);
		lazyGasStationId = ContractId.fromString(
			process.env.LAZY_GAS_STATION_CONTRACT_ID,
		);
	}
	else {
		console.log('LAZY_GAS_STATION_CONTRACT_ID ->', process.env.LAZY_GAS_STATION_CONTRACT_ID);
		const proceed = readlineSync.keyInYNStrict('No Lazy Gas Station found, do you want to deploy it?');

		if (!proceed) {
			console.log('Aborting');
			return;
		}

		const gasLimit = 1_500_000;
		console.log(
			'\n- Deploying contract...',
			lazyGasStationName,
			'\n\tgas@',
			gasLimit,
		);

		const lazyGasStationBytecode = lazyGasStationJSON.bytecode;

		const lazyGasStationParams = new ContractFunctionParameters()
			.addAddress(lazyTokenId.toSolidityAddress())
			.addAddress(lazySCT.toSolidityAddress());

		[lazyGasStationId] = await contractDeployFunction(
			client,
			lazyGasStationBytecode,
			gasLimit,
			lazyGasStationParams,
		);

		console.log(
			`Lazy Gas Station contract created with ID: ${lazyGasStationId} / ${lazyGasStationId.toSolidityAddress()}`,
		);
	}

	// Step 3: Set up Lazy Delegate Registry
	if (process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID) {
		console.log(
			'\n-Using existing Lazy Delegate Registry:',
			process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID,
		);
		ldrId = ContractId.fromString(
			process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID,
		);
	}
	else {
		console.log('LAZY_DELEGATE_REGISTRY_CONTRACT_ID ->', process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID);
		const proceed = readlineSync.keyInYNStrict('No Lazy Delegate Registry found, do you want to deploy it?');

		if (!proceed) {
			console.log('Aborting');
			return;
		}

		const gasLimit = 500_000;

		const ldrJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${lazyDelegateRegistryName}.sol/${lazyDelegateRegistryName}.json`,
			),
		);

		const ldrBytecode = ldrJson.bytecode;

		console.log('\n- Deploying contract...', lazyDelegateRegistryName, '\n\tgas@', gasLimit);

		[ldrId] = await contractDeployFunction(client, ldrBytecode, gasLimit);

		console.log(
			`Lazy Delegate Registry contract created with ID: ${ldrId} / ${ldrId.toSolidityAddress()}`,
		);
	}

	// Step 4: Set up PRNG System Contract
	if (process.env.PRNG_CONTRACT_ID) {
		console.log('\n-Using existing PRNG:', process.env.PRNG_CONTRACT_ID);
		prngId = ContractId.fromString(process.env.PRNG_CONTRACT_ID);
	}
	else {
		console.log('PRNG_CONTRACT_ID ->', process.env.PRNG_CONTRACT_ID);
		const proceed = readlineSync.keyInYNStrict('No PRNG found, do you want to deploy it?');

		if (!proceed) {
			console.log('Aborting');
			return;
		}

		const gasLimit = 800_000;
		console.log('\n- Deploying contract...', prngName, '\n\tgas@', gasLimit);
		const prngJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${prngName}.sol/${prngName}.json`,
			),
		);

		const prngBytecode = prngJson.bytecode;

		[prngId] = await contractDeployFunction(client, prngBytecode, gasLimit);

		console.log(
			`PRNG contract created with ID: ${prngId} / ${prngId.toSolidityAddress()}`,
		);
	}

	// Step 5: Set up signing wallet for message signatures
	if (process.env.SIGNING_KEY) {
		try {
			console.log('\n-Using existing SIGNING_KEY from file');
			signingWallet = PrivateKey.fromStringECDSA(process.env.SIGNING_KEY);
		}
		catch {
			console.log('ERROR: Invalid SIGNING_KEY format. Must be an ECDSA private key.');
			console.log('Creating a new signing wallet instead.');

			signingWallet = PrivateKey.generateECDSA();
			console.log('\nREMEMBER THIS KEY HAS VALUE - PROTECT IT');
			console.log('Consider adding it to your .env file as SIGNING_KEY=', signingWallet.toString());
		}
	}
	else {
		let proceed = readlineSync.keyInYNStrict('No SIGNING_KEY found, do you want to create one?');

		if (!proceed) {
			console.log('Aborting');
			return;
		}

		signingWallet = PrivateKey.generateECDSA();

		console.log('\nREMEMBER THIS KEY HAS VALUE - PROTECT IT');

		proceed = readlineSync.keyInYNStrict('Do you want to print the SIGNING_WALLET to a console?');

		if (proceed) {
			console.log(signingWallet.toString());
		}
		else {
			proceed = readlineSync.keyInYNStrict('Do you want to save the SIGNING_WALLET (unecrypted) to a file?');

			if (proceed) {
				fs.writeFileSync('./signingWallet.key', signingWallet.toString());
				console.log('Signing wallet saved to ./signingWallet.key');
			}
		}
	}

	console.log(
		`Off-chain signing wallet address: 0x${signingWallet.publicKey.toEvmAddress()}`,
	);

	// Step 6: Verify LSH tokens exist
	let LSH_GEN1, LSH_GEN2, LSH_GEN1_MUTANT;
	if (process.env.LSH_GEN1_TOKEN_ID) {
		LSH_GEN1 = TokenId.fromString(process.env.LSH_GEN1_TOKEN_ID);
		console.log('LSH_GEN1_TOKEN_ID -> ', LSH_GEN1.toString());
	}
	else {
		console.log('LSH_GEN1_TOKEN_ID -> ', process.env.LSH_GEN1_TOKEN_ID);
		console.log('Missing from .env file, please deploy the LSH Gen 1 Token first');
		return;
	}

	if (process.env.LSH_GEN2_TOKEN_ID) {
		LSH_GEN2 = TokenId.fromString(process.env.LSH_GEN2_TOKEN_ID);
		console.log('LSH_GEN2_TOKEN_ID -> ', LSH_GEN2.toString());
	}
	else {
		console.log('LSH_GEN2_TOKEN_ID -> ', process.env.LSH_GEN2_TOKEN_ID);
		console.log('Missing from .env file, please deploy the LSH Gen 2 Token first');
		return;
	}

	if (process.env.LSH_GEN1_MUTANT_TOKEN_ID) {
		LSH_GEN1_MUTANT = TokenId.fromString(process.env.LSH_GEN1_MUTANT_TOKEN_ID);
		console.log('LSH_GEN1_MUTANT_TOKEN_ID -> ', LSH_GEN1_MUTANT.toString());
	}
	else {
		console.log('LSH_GEN1_MUTANT_TOKEN_ID -> ', process.env.LSH_GEN1_MUTANT_TOKEN_ID);
		console.log('Missing from .env file, please deploy the LSH Gen 1 Mutant Token first');
		return;
	}

	// Step 7: Get jackpot configuration
	if (process.env.INITIAL_LOTTO_JACKPOT) {
		console.log('INITIAL_LOTTO_JACKPOT -> ', process.env.INITIAL_LOTTO_JACKPOT);
		initialLottoJackpot = Number(process.env.INITIAL_LOTTO_JACKPOT);
	}
	else {
		// take input from user
		initialLottoJackpot = readlineSync.questionInt('Enter the initial Lotto Jackpot amount: ');
		console.log(`INITIAL_LOTTO_JACKPOT: ${initialLottoJackpot}`);
	}

	// Validate initial jackpot
	if (isNaN(initialLottoJackpot) || initialLottoJackpot <= 0) {
		console.log('ERROR: Initial jackpot must be a positive number');
		return;
	}

	if (process.env.LOTTO_LOSS_INCREMENT) {
		console.log('LOTTO_LOSS_INCREMENT -> ', process.env.LOTTO_LOSS_INCREMENT);
		lottoLossIncrement = Number(process.env.LOTTO_LOSS_INCREMENT);
	}
	else {
		// take input from user
		lottoLossIncrement = readlineSync.questionInt('Enter the Lotto Loss Increment amount: ');
		console.log(`LOTTO_LOSS_INCREMENT: ${lottoLossIncrement}`);
	}

	// Validate loss increment
	if (isNaN(lottoLossIncrement) || lottoLossIncrement <= 0) {
		console.log('ERROR: Lotto loss increment must be a positive number');
		return;
	}

	// Validate burn percentage
	if (isNaN(LAZY_BURN_PERCENT) || LAZY_BURN_PERCENT < 0 || LAZY_BURN_PERCENT > 100) {
		console.log('ERROR: LAZY_BURN_PERCENT must be a number between 0 and 100');
		return;
	}

	console.log(`BURN_PERCENT: ${LAZY_BURN_PERCENT}%`);

	// Convert jackpot values to account for decimals
	const initialJackpotWithDecimals = initialLottoJackpot * (10 ** LAZY_DECIMAL);
	const lossIncrementWithDecimals = lottoLossIncrement * (10 ** LAZY_DECIMAL);

	// Step 8: Final confirmation before deploying LazyTradeLotto
	console.log('\n----- LazyTradeLotto Configuration Summary -----');
	console.log('Initial Jackpot: ', initialLottoJackpot, '$LAZY', '(raw:', initialJackpotWithDecimals, ')');
	console.log('Loss Increment: ', lottoLossIncrement, '$LAZY', '(raw:', lossIncrementWithDecimals, ')');
	console.log('Burn Percentage: ', LAZY_BURN_PERCENT, '%');
	console.log('$LAZY Decimals: ', LAZY_DECIMAL);
	console.log('LSH_GEN1: ', LSH_GEN1.toString());
	console.log('LSH_GEN2: ', LSH_GEN2.toString());
	console.log('LSH_GEN1_MUTANT: ', LSH_GEN1_MUTANT.toString());
	console.log('Lazy Token Creator: ', lazySCT.toString());
	console.log('Lazy Gas Station: ', lazyGasStationId.toString());
	console.log('Lazy Delegate Registry: ', ldrId.toString());
	console.log('PRNG System Contract: ', prngId.toString());
	console.log('Lazy Token ID: ', lazyTokenId.toString());
	console.log('System Wallet: ', `0x${signingWallet.publicKey.toEvmAddress()}`);

	const proceed = readlineSync.keyInYNStrict('Do you want to deploy Lazy Trade Lotto Contract with these parameters?');

	if (!proceed) {
		console.log('Aborting');
		return;
	}

	const gasLimit = 2_500_000;

	// Step 9: Deploy the LazyTradeLotto contract
	const lazyTradeLottoJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);

	const contractBytecode = lazyTradeLottoJSON.bytecode;

	console.log(
		'\n- Deploying contract...',
		contractName,
		'\n\tgas@',
		gasLimit,
	);

	const constructorParams = new ContractFunctionParameters()
		.addAddress(prngId.toSolidityAddress())
		.addAddress(lazyGasStationId.toSolidityAddress())
		.addAddress(ldrId.toSolidityAddress())
		.addAddress(LSH_GEN1.toSolidityAddress())
		.addAddress(LSH_GEN2.toSolidityAddress())
		.addAddress(LSH_GEN1_MUTANT.toSolidityAddress())
		.addAddress(signingWallet.publicKey.toEvmAddress())
		.addUint256(initialJackpotWithDecimals)
		.addUint256(lossIncrementWithDecimals)
		.addUint256(LAZY_BURN_PERCENT);

	const [ltlContractId, ltlContractAddress] = await contractDeployFunction(
		client,
		contractBytecode,
		gasLimit,
		constructorParams,
	);

	console.log(
		`Lazy Trade Lotto Contract created with ID: ${ltlContractId} / ${ltlContractAddress}`,
	);

	// Opt-in Sourcify source verification (read-only; no key/gas). Best-effort —
	// never abort the deploy on a verification hiccup.
	if (process.env.VERIFY_ON_DEPLOY === 'true' || process.env.VERIFY_ON_DEPLOY === '1') {
		console.log('\n- Verifying LazyTradeLotto source on Sourcify...');
		try {
			const verifyResult = await verifyContract({
				contractName,
				env,
				contractId: ltlContractId.toString(),
				// let the mirror node index the freshly-deployed contract first
				initialDelayMs: 10000,
				attempts: 4,
				retryDelayMs: 8000,
			});
			console.log(`  Sourcify: ${verifyResult.status}${verifyResult.match ? ` (${verifyResult.match})` : ''}`);
			if (verifyResult.repoUrl) console.log(`  ${verifyResult.repoUrl}`);
		}
		catch (verifyError) {
			console.warn(`  Sourcify verification skipped (non-fatal): ${verifyError.message}`);
		}
	}

	// Step 10: Add the contract as a user of the Gas Station
	console.log('\n- Adding LazyTradeLotto as a contract user of LazyGasStation...');
	const rslt = await contractExecuteFunction(
		lazyGasStationId,
		lazyGasStationIface,
		client,
		null,
		'addContractUser',
		[ltlContractId.toSolidityAddress()],
	);

	if (rslt[0]?.status.toString() != 'SUCCESS') {
		console.log('ERROR adding LazyTradeLotto to LazyGasStation:', rslt);
	}
	else {
		console.log('LazyTradeLotto added to LazyGasStation:', rslt[2].transactionId.toString());
	}

	// Final summary
	console.log('\n----- Deployment Complete -----');
	console.log('LazyTradeLotto Contract ID:', ltlContractId.toString());
	console.log('LazyTradeLotto Contract Address:', ltlContractAddress);
	console.log('\nNext steps:');
	console.log('1. Save these details for future reference');
	console.log('2. Send $LAZY tokens to the LazyGasStation for payouts');
	console.log('3. Consider using the helper scripts to manage your contract');
};

/**
 * Helper function to encapsulate minting an FT
 * @param {string} tokenName - Name of the token
 * @param {string} tokenSymbol - Symbol of the token
 * @param {string} tokenMemo - Memo for the token
 * @param {number} tokenInitalSupply - Initial supply (with decimals)
 * @param {number} decimal - Number of decimals
 * @param {number} tokenMaxSupply - Maximum supply (with decimals)
 * @param {number} payment - Payment amount for the transaction
 */
async function mintLazy(
	tokenName,
	tokenSymbol,
	tokenMemo,
	tokenInitalSupply,
	decimal,
	tokenMaxSupply,
	payment,
) {
	const gasLim = 800000;
	// call associate method
	const params = [
		tokenName,
		tokenSymbol,
		tokenMemo,
		tokenInitalSupply,
		decimal,
		tokenMaxSupply,
	];

	const [, , createTokenRecord] = await contractExecuteFunction(
		lazySCT,
		lazyIface,
		client,
		gasLim,
		'createFungibleWithBurn',
		params,
		payment,
	);
	const tokenIdSolidityAddr =
		createTokenRecord.contractFunctionResult.getAddress(0);
	lazyTokenId = TokenId.fromSolidityAddress(tokenIdSolidityAddr);
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
