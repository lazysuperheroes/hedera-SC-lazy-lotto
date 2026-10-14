const fs = require('fs');
const { ethers } = require('ethers');
const { expect } = require('chai');
const { describe, it, before } = require('mocha');
const {
	Client,
	AccountId,
	PrivateKey,
	TokenId,
	ContractId,
	ContractFunctionParameters,
	HbarUnit,
	Hbar,
} = require('@hashgraph/sdk');

const {
	contractDeployFunction,
	contractExecuteFunction,
	contractExecuteQuery,
	readOnlyEVMFromMirrorNode,
} = require('../utils/solidityHelpers');
const {
	accountCreator,
	associateTokensToAccount,
	mintNFT,
	sendHbar,
	sweepHbar,
} = require('../utils/hederaHelpers');
const { fail } = require('assert');
const {
	checkLastMirrorEvent,
	checkMirrorBalance,
	checkMirrorHbarBalance,
} = require('../utils/hederaMirrorHelpers');
const { sleep } = require('../utils/nodeHelpers');
require('dotenv').config();

// Get operator from .env file
let operatorKey;
let operatorId;
try {
	operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch {
	console.log('ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
}

const lazyContractCreator = 'LAZYTokenCreator';
const lazyGasStationName = 'LazyGasStation';
const contractName = 'LazyTradeLotto';
const lazyDelegateRegistryName = 'LazyDelegateRegistry';
const env = process.env.ENVIRONMENT ?? null;
const LAZY_DECIMAL = process.env.LAZY_DECIMALS ?? 1;
const LAZY_MAX_SUPPLY = process.env.LAZY_MAX_SUPPLY ?? 250_000_000;

const addressRegex = /(\d+\.\d+\.[1-9]\d+)/i;

// reused variables
let ltlContractAddress, ltlContractId, ldrAddress;
let lazyIface, lazyGasStationIface, lazyTradeLottoIface;
let lazyTokenId;
let alicePK, aliceId;
let client;
let lazySCT;
let lazyGasStationId, prngId;
let LSHGen1_TokenId,
	LSHGen2_TokenId,
	LSHMutant_TokenId;
const prngName = 'PrngSystemContract';
let signingKey;
const initialJackpot = 100;
const lottoLossIncrement = 50;
const LAZY_BURN_PERCENT = process.env.LOTTO_LAZY_BURN_PERCENT ? Number(process.env.LOTTO_LAZY_BURN_PERCENT) : 50;
// whole $LAZY; tests sign maxWinAmt of 20, so this only bites in the cap tests
const maxWinAmtCap = 1000;
// whole $LAZY payable per 24h window; generous so only the cap test trips it
const payoutWindowCap = 100_000;

// block.chainid per Hedera network - part of the v2 signed roll message
const HEDERA_CHAIN_IDS = { MAIN: 295, TEST: 296, PREVIEW: 297, LOCAL: 298 };

// v2 rolls sign burnExempt + a deadline; remember what each signature was made with so the
// rollLotto call passes the same values: [..., jackpotThreshold, ...rollTail(signature)]
const signedRollParams = new Map();
function rollTail(signature) {
	const signed = signedRollParams.get(signature) ?? {};
	return [signed.burnExempt ?? false, signed.deadline ?? Math.floor(Date.now() / 1000) + 3600, signature];
}

describe('Deployment', () => {
	it('Should deploy the contract and setup conditions', async () => {
		if (
			operatorKey === undefined ||
			operatorKey == null ||
			operatorId === undefined ||
			operatorId == null
		) {
			console.log(
				'Environment required, please specify PRIVATE_KEY & ACCOUNT_ID in the .env file',
			);
			process.exit(1);
		}

		console.log('\n-Using ENIVRONMENT:', env);

		if (env.toUpperCase() == 'TEST') {
			client = Client.forTestnet();
			console.log('testing in *TESTNET*');
		}
		else if (env.toUpperCase() == 'MAIN') {
			client = Client.forMainnet();
			console.log('testing in *MAINNET*');
		}
		else if (env.toUpperCase() == 'PREVIEW') {
			client = Client.forPreviewnet();
			console.log('testing in *PREVIEWNET*');
		}
		else if (env.toUpperCase() == 'LOCAL') {
			const node = { '127.0.0.1:50211': new AccountId(3) };
			client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
			console.log('testing in *LOCAL*');
			const rootId = AccountId.fromString('0.0.2');
			const rootKey = PrivateKey.fromStringED25519(
				'302e020100300506032b65700422042091132178e72057a1d7528025956fe39b0b847f200ab59b2fdd367017f3087137',
			);

			// create an operator account on the local node and use this for testing as operator
			client.setOperator(rootId, rootKey);
			operatorKey = PrivateKey.generateED25519();
			operatorId = await accountCreator(client, operatorKey, 1000);
		}
		else {
			console.log(
				'ERROR: Must specify either MAIN or TEST or PREVIEW or LOCAL as environment in .env file',
			);
			return;
		}

		client.setOperator(operatorId, operatorKey);
		// deploy the contract
		console.log('\n-Using Operator:', operatorId.toString());

		// moving account create up to fail fast is the service is busy.

		// create Alice account
		if (process.env.ALICE_ACCOUNT_ID && process.env.ALICE_PRIVATE_KEY) {
			aliceId = AccountId.fromString(process.env.ALICE_ACCOUNT_ID);
			alicePK = PrivateKey.fromStringED25519(process.env.ALICE_PRIVATE_KEY);
			console.log('\n-Using existing Alice:', aliceId.toString());

			// check if Alice has hbars
			const hbarBalance = await checkMirrorHbarBalance(env, aliceId);
			if (hbarBalance < Number(new Hbar(100, HbarUnit.Hbar).toTinybars())) {
				await sendHbar(client, operatorId, aliceId, 100, HbarUnit.Hbar);
			}
		}
		else {
			alicePK = PrivateKey.generateED25519();
			aliceId = await accountCreator(client, alicePK, 100);
			console.log(
				'Alice account ID:',
				aliceId.toString(),
				aliceId.toSolidityAddress(),
				'\nkey:',
				alicePK.toString(),
			);
		}
		expect(aliceId.toString().match(addressRegex).length == 2).to.be.true;

		// outside the if statement as we always need this abi
		// check if LAZY SCT has been deployed
		const lazyJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/legacy/${lazyContractCreator}.sol/${lazyContractCreator}.json`,
			),
		);

		// import ABIs
		lazyIface = new ethers.Interface(lazyJson.abi);

		const lazyContractBytecode = lazyJson.bytecode;

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
			const gasLimit = 800_000;

			console.log(
				'\n- Deploying contract...',
				lazyContractCreator,
				'\n\tgas@',
				gasLimit,
			);

			[lazySCT] = await contractDeployFunction(client, lazyContractBytecode);

			console.log(
				`Lazy Token Creator contract created with ID: ${lazySCT} / ${lazySCT.toSolidityAddress()}`,
			);

			expect(lazySCT.toString().match(addressRegex).length == 2).to.be.true;

			// mint the $LAZY FT
			await mintLazy(
				'Test_Lazy',
				'TLazy',
				'Test Lazy FT',
				LAZY_MAX_SUPPLY * 10 ** LAZY_DECIMAL,
				LAZY_DECIMAL,
				LAZY_MAX_SUPPLY * 10 ** LAZY_DECIMAL,
				30,
			);
			console.log('$LAZY Token minted:', lazyTokenId.toString());
		}

		expect(lazySCT.toString().match(addressRegex).length == 2).to.be.true;
		expect(lazyTokenId.toString().match(addressRegex).length == 2).to.be.true;

		const lazyGasStationJSON = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${lazyGasStationName}.sol/${lazyGasStationName}.json`,
			),
		);

		lazyGasStationIface = new ethers.Interface(lazyGasStationJSON.abi);
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
			const gasLimit = 1_600_000;
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

			expect(lazyGasStationId.toString().match(addressRegex).length == 2).to.be
				.true;
		}

		// deploy PRNG
		if (process.env.PRNG_CONTRACT_ID) {
			console.log('\n-Using existing PRNG:', process.env.PRNG_CONTRACT_ID);
			prngId = ContractId.fromString(process.env.PRNG_CONTRACT_ID);
		}
		else {
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

		expect(prngId.toString().match(addressRegex).length == 2).to.be.true;

		if (process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID) {
			console.log(
				'\n-Using existing Lazy Delegate Registry:',
				process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID,
			);
			ldrAddress = ContractId.fromString(
				process.env.LAZY_DELEGATE_REGISTRY_CONTRACT_ID,
			);
		}
		else {
			const gasLimit = 600_000;

			const ldrJson = JSON.parse(
				fs.readFileSync(
					`./artifacts/contracts/${lazyDelegateRegistryName}.sol/${lazyDelegateRegistryName}.json`,
				),
			);

			const ldrBytecode = ldrJson.bytecode;

			console.log('\n- Deploying contract...', lazyDelegateRegistryName, '\n\tgas@', gasLimit);

			[ldrAddress] = await contractDeployFunction(client, ldrBytecode, gasLimit);

			console.log(
				`Lazy Delegate Registry contract created with ID: ${ldrAddress} / ${ldrAddress.toSolidityAddress()}`,
			);

			expect(ldrAddress.toString().match(addressRegex).length == 2).to.be.true;
		}

		// mint NFTs from the 3rd party Alice Account
		// ensure royalties in place
		// Operator has no NFT so will be subject to burn
		/*
					3 x Different NFTs of size 3 each
				*/

		const nftSize = 3;

		client.setOperator(aliceId, alicePK);
		let [result, tokenId] = await mintNFT(
			client,
			aliceId,
			'testLSH Gen 1',
			'tLSHG1',
			nftSize,
		);
		expect(result).to.be.equal('SUCCESS');
		LSHGen1_TokenId = tokenId;

		[result, tokenId] = await mintNFT(
			client,
			aliceId,
			'test LSH Gen 2',
			'tLSHG2',
			nftSize,
		);
		expect(result).to.be.equal('SUCCESS');
		LSHGen2_TokenId = tokenId;

		[result, tokenId] = await mintNFT(
			client,
			aliceId,
			'test LSH Mutant',
			'tLSHMutant',
			nftSize,
		);
		expect(result).to.be.equal('SUCCESS');
		LSHMutant_TokenId = tokenId;

		// revert back to operator
		client.setOperator(operatorId, operatorKey);

		const gasLimit = 2_600_000;

		// now deploy main contract
		const lazySecureTradeJson = JSON.parse(
			fs.readFileSync(
				`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
			),
		);

		// import ABI
		lazyTradeLottoIface = ethers.Interface.from(lazySecureTradeJson.abi);

		const contractBytecode = lazySecureTradeJson.bytecode;

		console.log(
			'\n- Deploying contract...',
			contractName,
			'\n\tgas@',
			gasLimit,
		);

		// check if a signing wallet has been provided and if not create one and print to console.
		if (process.env.SIGNING_KEY) {
			try {
				signingKey = PrivateKey.fromStringECDSA(process.env.SIGNING_KEY);
			}
			catch (err) {
				console.log('ERROR: SIGNING_KEY is not valid ECDSA:', err);

				try {
					signingKey = PrivateKey.fromStringED25519(process.env.SIGNING_KEY);

					console.log('Ed25519 keys unsupported, using ECDSA instead.');
					signingKey = PrivateKey.generateECDSA();
					console.log(
						'Fresh key:',
						signingKey.toString(),
					);
				}
				catch (err) {
					console.log('ERROR: BAD KEY - GENERATING NEW:', err);
					signingKey = PrivateKey.generateECDSA();
					console.log(
						'Fresh key:',
						signingKey.toString(),
					);
				}
			}
			console.log('Using existing signing key (public key):', signingKey.publicKey.toString());
		}
		else {
			signingKey = PrivateKey.generateECDSA();
			console.log(
				'No signing key provided, generating new one:',
				signingKey.toString(),
			);
		}

		console.log(`Using signing key (public key): 0x${signingKey.publicKey.toEvmAddress()}`, '/', signingKey.publicKey.toStringDer());

		const constructorParams = new ContractFunctionParameters()
			.addAddress(prngId.toSolidityAddress())
			.addAddress(lazyGasStationId.toSolidityAddress())
			.addAddress(signingKey.publicKey.toEvmAddress())
			.addUint256(initialJackpot * 10 ** LAZY_DECIMAL)
			.addUint256(lottoLossIncrement * 10 ** LAZY_DECIMAL)
			.addUint256(LAZY_BURN_PERCENT)
			.addUint256(maxWinAmtCap * 10 ** LAZY_DECIMAL)
			.addUint256(payoutWindowCap * 10 ** LAZY_DECIMAL);

		[ltlContractId, ltlContractAddress] = await contractDeployFunction(
			client,
			contractBytecode,
			gasLimit,
			constructorParams,
		);

		expect(ltlContractId.toString().match(addressRegex).length == 2).to.be.true;

		console.log(
			`Lazy Lotto Contract created with ID: ${ltlContractId} / ${ltlContractAddress}`,
		);

		console.log('\n-Testing:', contractName);

		// ensure the contract is set as a contract user of the Lazy Gas Station
		result = await contractExecuteFunction(
			lazyGasStationId,
			lazyGasStationIface,
			client,
			null,
			'addContractUser',
			[ltlContractId.toSolidityAddress()],
		);
		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('ERROR adding LTL to LGS:', result);
			fail();
		}
		else {
			console.log('LTL added to LGS:', result[0]?.status.toString(), result[2]?.transactionId?.toString());
		}

		// associate the FTs & NFT to operator
		client.setOperator(operatorId, operatorKey);
		const operatorTokensToAssociate = [];
		// check if the lazy token is already associated to the operator
		if (await checkMirrorBalance(env, operatorId, lazyTokenId) === null) {
			operatorTokensToAssociate.push(lazyTokenId);
		}
		operatorTokensToAssociate.push(
			LSHGen1_TokenId,
			LSHGen2_TokenId,
			LSHMutant_TokenId,
		);

		result = await associateTokensToAccount(
			client,
			operatorId,
			operatorKey,
			operatorTokensToAssociate,
		);

		expect(result).to.be.equal('SUCCESS');

		// associate the token for Alice
		// alice has the NFTs already associated

		// check the balance of lazy tokens for Alice from mirror node
		const aliceLazyBalance = await checkMirrorBalance(
			env,
			aliceId,
			lazyTokenId,
		);

		if (!aliceLazyBalance) {
			result = await associateTokensToAccount(client, aliceId, alicePK, [
				lazyTokenId,
			]);
			expect(result).to.be.equal('SUCCESS');
		}

		// send $LAZY to all accounts
		client.setOperator(operatorId, operatorKey);
		result = await sendLazy(operatorId, 600);
		expect(result).to.be.equal('SUCCESS');
		result = await sendLazy(aliceId, 900);
		expect(result).to.be.equal('SUCCESS');
		result = await sendHbar(client, operatorId, AccountId.fromString(lazyGasStationId.toString()), 1, HbarUnit.Hbar);
		expect(result).to.be.equal('SUCCESS');

		// send $LAZY to the Lazy Gas Station
		// gas station will fuel payouts so ensure it has enough
		result = await sendLazy(lazyGasStationId, 100_000);
		expect(result).to.be.equal('SUCCESS');

		// add the LST to the lazy gas station as a contract user
		result = await contractExecuteFunction(
			lazyGasStationId,
			lazyGasStationIface,
			client,
			null,
			'addContractUser',
			[ltlContractId.toSolidityAddress()],
		);

		if (result[0]?.status.toString() != 'SUCCESS') {
			console.log('ERROR adding LST to LGS:', result);
			fail();
		}

		// check the GasStationAccessControlEvent on the mirror node
		await sleep(4500);
		const lgsEvent = await checkLastMirrorEvent(
			env,
			lazyGasStationId,
			lazyGasStationIface,
			1,
			true,
		);

		expect(lgsEvent.toSolidityAddress().toLowerCase()).to.be.equal(
			ltlContractId.toSolidityAddress(),
		);
	});
});

describe('Check Contract Deployment', () => {
	it('Should check the contract configuration', async () => {
		client.setOperator(operatorId, operatorKey);

		// v2 payout caps and caller policy
		const readUint = async (fn) => {
			const res = await readOnlyEVMFromMirrorNode(env, ltlContractId, lazyTradeLottoIface.encodeFunctionData(fn), operatorId, false);
			return lazyTradeLottoIface.decodeFunctionResult(fn, res)[0];
		};
		expect(Number(await readUint('maxWinAmtCap'))).to.be.equal(maxWinAmtCap * 10 ** LAZY_DECIMAL);
		expect(Number(await readUint('payoutWindowCap'))).to.be.equal(payoutWindowCap * 10 ** LAZY_DECIMAL);
		expect(await readUint('requireCodelessCaller')).to.be.false;

		// get prngSystemContract

		const prngResult = await readOnlyEVMFromMirrorNode(
			env,
			ltlContractId,
			lazyTradeLottoIface.encodeFunctionData('prngSystemContract'),
			operatorId,
			false,
		);

		const prngResultDecoded = lazyTradeLottoIface.decodeFunctionResult(
			'prngSystemContract',
			prngResult,
		);

		expect(prngResultDecoded[0].slice(2).toLowerCase()).to.be.equal(
			prngId.toSolidityAddress().toLowerCase(),
		);

		// lazyGasStation
		const lazyGasStationResult = await readOnlyEVMFromMirrorNode(
			env,
			ltlContractId,
			lazyTradeLottoIface.encodeFunctionData('lazyGasStation'),
			operatorId,
			false,
		);

		const lazyGasStationResultDecoded = lazyTradeLottoIface.decodeFunctionResult(
			'lazyGasStation',
			lazyGasStationResult,
		);

		expect(lazyGasStationResultDecoded[0].slice(2).toLowerCase()).to.be.equal(
			lazyGasStationId.toSolidityAddress().toLowerCase(),
		);

		// systemWallet
		const systemWalletResult = await readOnlyEVMFromMirrorNode(
			env,
			ltlContractId,
			lazyTradeLottoIface.encodeFunctionData('systemWallet'),
			operatorId,
			false,
		);

		const systemWalletResultDecoded = lazyTradeLottoIface.decodeFunctionResult(
			'systemWallet',
			systemWalletResult,
		);

		expect(systemWalletResultDecoded[0].slice(2).toLowerCase()).to.be.equal(
			signingKey.publicKey.toEvmAddress().toLowerCase(),
		);

		// burnPercentage
		const burnPercentageResult = await readOnlyEVMFromMirrorNode(
			env,
			ltlContractId,
			lazyTradeLottoIface.encodeFunctionData('burnPercentage'),
			operatorId,
			false,
		);

		const burnPercentageResultDecoded = lazyTradeLottoIface.decodeFunctionResult(
			'burnPercentage',
			burnPercentageResult,
		);

		expect(Number(burnPercentageResultDecoded[0])).to.be.equal(LAZY_BURN_PERCENT);

		// getLottoStats
		const lottoStatsResult = await readOnlyEVMFromMirrorNode(
			env,
			ltlContractId,
			lazyTradeLottoIface.encodeFunctionData('getLottoStats'),
			operatorId,
			false,
		);

		const lottoStatsResultDecoded = lazyTradeLottoIface.decodeFunctionResult(
			'getLottoStats',
			lottoStatsResult,
		);

		expect(Number(lottoStatsResultDecoded[0])).to.be.equal(initialJackpot * 10 ** LAZY_DECIMAL);
		expect(Number(lottoStatsResultDecoded[1])).to.be.equal(0);
		expect(Number(lottoStatsResultDecoded[2])).to.be.equal(0);
		expect(Number(lottoStatsResultDecoded[3])).to.be.equal(0);
		expect(Number(lottoStatsResultDecoded[4])).to.be.equal(0);
		expect(Number(lottoStatsResultDecoded[5])).to.be.equal(0);
		expect(Number(lottoStatsResultDecoded[6])).to.be.equal(lottoLossIncrement * 10 ** LAZY_DECIMAL);
	});

	it('Should check the contract is initially paused', async () => {
		client.setOperator(operatorId, operatorKey);

		// Check if the contract is paused
		const isPausedResult = await contractExecuteQuery(
			ltlContractId,
			lazyTradeLottoIface,
			client,
			null,
			'isPaused',
			[],
		);

		expect(isPausedResult[0]).to.be.true;
		console.log('Contract is initially paused as expected');
	});

	it('Should check access controls', async () => {
		let expectedErrors = 0;
		let unexpectedErrors = 0;

		// ALICE is not owner so expect failures
		client.setOperator(aliceId, alicePK);

		// boostJackpot
		try {
			const result = await contractExecuteFunction(
				ltlContractId,
				lazyTradeLottoIface,
				client,
				null,
				'boostJackpot',
				[1 * 10 ** LAZY_DECIMAL],
			);
			if (
				result[0].status.toString() ==
				'REVERT: Ownable: caller is not the owner'
			) {
				expectedErrors++;
			}
			else {
				console.log('Unexpected Result (boostJackpot):', result);
				unexpectedErrors++;
			}
		}
		catch (err) {
			console.log(err);
			unexpectedErrors++;
		}

		// updateJackpotLossIncrement
		try {
			const result = await contractExecuteFunction(
				ltlContractId,
				lazyTradeLottoIface,
				client,
				null,
				'updateJackpotLossIncrement',
				[1 * 10 ** LAZY_DECIMAL],
			);
			if (
				result[0].status.toString() ==
				'REVERT: Ownable: caller is not the owner'
			) {
				expectedErrors++;
			}
			else {
				console.log('Unexpected Result (updateJackpotLossIncrement):', result);
				unexpectedErrors++;
			}
		}
		catch (err) {
			console.log(err);
			unexpectedErrors++;
		}

		// updateBurnPercentage
		try {
			const result = await contractExecuteFunction(
				ltlContractId,
				lazyTradeLottoIface,
				client,
				null,
				'updateBurnPercentage',
				[1],
			);
			if (
				result[0].status.toString() ==
				'REVERT: Ownable: caller is not the owner'
			) {
				expectedErrors++;
			}
			else {
				console.log('Unexpected Result (updateBurnPercentage):', result);
				unexpectedErrors++;
			}
		}
		catch (err) {
			console.log(err);
			unexpectedErrors++;
		}

		// updateSystemWallet
		try {
			const result = await contractExecuteFunction(
				ltlContractId,
				lazyTradeLottoIface,
				client,
				null,
				'updateSystemWallet',
				[aliceId.toSolidityAddress()],
			);
			if (
				result[0].status.toString() ==
				'REVERT: Ownable: caller is not the owner'
			) {
				expectedErrors++;
			}
			else {
				console.log('Unexpected Result (updateSystemWallet):', result);
				unexpectedErrors++;
			}
		}
		catch (err) {
			console.log(err);
			unexpectedErrors++;
		}

		// pause - non-owner should not be able to pause
		try {
			const result = await contractExecuteFunction(
				ltlContractId,
				lazyTradeLottoIface,
				client,
				null,
				'pause',
				[],
			);
			if (
				result[0].status.toString() ==
				'REVERT: Ownable: caller is not the owner'
			) {
				expectedErrors++;
			}
			else {
				console.log('Unexpected Result (pause):', result);
				unexpectedErrors++;
			}
		}
		catch (err) {
			console.log(err);
			unexpectedErrors++;
		}

		// unpause - non-owner should not be able to unpause
		try {
			const result = await contractExecuteFunction(
				ltlContractId,
				lazyTradeLottoIface,
				client,
				null,
				'unpause',
				[],
			);
			if (
				result[0].status.toString() ==
				'REVERT: Ownable: caller is not the owner'
			) {
				expectedErrors++;
			}
			else {
				console.log('Unexpected Result (unpause):', result);
				unexpectedErrors++;
			}
		}
		catch (err) {
			console.log(err);
			unexpectedErrors++;
		}

		// updateMaxWinAmtCap - non-owner should not be able to raise the payout cap
		try {
			const result = await contractExecuteFunction(
				ltlContractId,
				lazyTradeLottoIface,
				client,
				null,
				'updateMaxWinAmtCap',
				[1_000_000 * 10 ** LAZY_DECIMAL],
			);
			if (
				result[0].status.toString() ==
				'REVERT: Ownable: caller is not the owner'
			) {
				expectedErrors++;
			}
			else {
				console.log('Unexpected Result (updateMaxWinAmtCap):', result);
				unexpectedErrors++;
			}
		}
		catch (err) {
			console.log(err);
			unexpectedErrors++;
		}

		// updatePayoutWindowCap - non-owner should not be able to change it
		try {
			const result = await contractExecuteFunction(
				ltlContractId,
				lazyTradeLottoIface,
				client,
				null,
				'updatePayoutWindowCap',
				[1_000_000_000 * 10 ** LAZY_DECIMAL],
			);
			if (
				result[0].status.toString() ==
				'REVERT: Ownable: caller is not the owner'
			) {
				expectedErrors++;
			}
			else {
				console.log('Unexpected Result (updatePayoutWindowCap):', result);
				unexpectedErrors++;
			}
		}
		catch (err) {
			console.log(err);
			unexpectedErrors++;
		}

		// setRequireCodelessCaller - non-owner should not be able to change it
		try {
			const result = await contractExecuteFunction(
				ltlContractId,
				lazyTradeLottoIface,
				client,
				null,
				'setRequireCodelessCaller',
				[true],
			);
			if (
				result[0].status.toString() ==
				'REVERT: Ownable: caller is not the owner'
			) {
				expectedErrors++;
			}
			else {
				console.log('Unexpected Result (setRequireCodelessCaller):', result);
				unexpectedErrors++;
			}
		}
		catch (err) {
			console.log(err);
			unexpectedErrors++;
		}

		console.log('Expected errors:', expectedErrors);
		console.log('Unexpected errors:', unexpectedErrors);

		expect(expectedErrors).to.be.equal(9);
		expect(unexpectedErrors).to.be.equal(0);
	});
});

describe('Check Burn Percentage Functionality', () => {
	it('Should expose the burn percentage applied to non-exempt winners', async () => {
		client.setOperator(operatorId, operatorKey);

		// v2: whether a winner is exempt (LSH holder / valid delegate) is resolved off-chain and
		// signed into the roll; the contract only holds the rate applied to non-exempt rolls.
		const encodedCommand = lazyTradeLottoIface.encodeFunctionData('burnPercentage');
		const response = await readOnlyEVMFromMirrorNode(env, ltlContractId, encodedCommand, operatorId, false);
		const burnPercentage = lazyTradeLottoIface.decodeFunctionResult('burnPercentage', response);

		expect(Number(burnPercentage[0])).to.be.equal(LAZY_BURN_PERCENT);
	});
});

describe('Check Pause Functionality', () => {
	let userNonce;
	let token;
	let serial;
	let winRateThreshold;
	let minWinAmt;
	let maxWinAmt;
	let jackpotThreshold;
	let signature;

	before(async () => {
		client.setOperator(operatorId, operatorKey);

		// Setup parameters for lotto rolls
		token = LSHGen1_TokenId.toSolidityAddress();
		serial = 1;
		// Random nonce
		userNonce = Math.floor(Math.random() * 1000000);
		// 50% chance of winning (out of 100_000_000)
		winRateThreshold = 50_000_000;
		minWinAmt = 5 * 10 ** LAZY_DECIMAL;
		maxWinAmt = 20 * 10 ** LAZY_DECIMAL;
		// 5% chance of jackpot (out of 100_000_000)
		jackpotThreshold = 5_000_000;

		// Create a valid signature for the roll
		signature = await createSignature(
			operatorId,
			token,
			serial,
			userNonce,
			true,
			winRateThreshold,
			minWinAmt,
			maxWinAmt,
			jackpotThreshold,
		);
	});

	it('Should fail to roll lotto when contract is paused', async () => {
		client.setOperator(operatorId, operatorKey);

		// Check if the contract is paused (it should be paused by default from constructor)
		const isPausedResult = await contractExecuteQuery(
			ltlContractId,
			lazyTradeLottoIface,
			client,
			null,
			'isPaused',
			[],
		);

		// Verify the contract is indeed paused
		expect(isPausedResult[0]).to.be.true;
		console.log('Verified contract is in paused state');

		// Try to roll the lotto while paused
		try {
			const result = await contractExecuteFunction(
				ltlContractId,
				lazyTradeLottoIface,
				client,
				600_000,
				'rollLotto',
				[
					token,
					serial,
					userNonce,
					true,
					winRateThreshold,
					minWinAmt,
					maxWinAmt,
					jackpotThreshold,
					...rollTail(signature),
				],
			);
			if (result[0]?.status?.toString() === 'SUCCESS') {
				console.log('ERROR: Should have failed with contract paused', result);
				fail();
			}
		}
		catch (err) {
			console.log('Expected error when contract is paused:', err.message);
			expect(err.message).to.include('Pausable: paused');
		}
	});

	it('Should allow only owner to unpause the contract', async () => {
		// Try as Alice (non-owner) first
		client.setOperator(aliceId, alicePK);

		try {
			const result = await contractExecuteFunction(
				ltlContractId,
				lazyTradeLottoIface,
				client,
				600_000,
				'unpause',
				[],
			);
			if (result[0]?.status?.toString() === 'SUCCESS') {
				console.log('ERROR: Non-owner should not be able to unpause the contract', result);
				fail();
			}
		}
		catch (err) {
			console.log('Expected error when non-owner tries to unpause:', err.message);
			expect(err.message).to.include('caller is not the owner');
		}

		// Now try as operator (owner)
		client.setOperator(operatorId, operatorKey);

		// Unpause the contract
		const result = await contractExecuteFunction(
			ltlContractId,
			lazyTradeLottoIface,
			client,
			600_000,
			'unpause',
			[],
		);

		expect(result[0]?.status?.toString()).to.be.equal('SUCCESS');
		console.log('Contract successfully unpaused by owner');

		// Check the contract is now unpaused
		const isPausedResult = await contractExecuteQuery(
			ltlContractId,
			lazyTradeLottoIface,
			client,
			null,
			'isPaused',
			[],
		);

		expect(isPausedResult[0]).to.be.false;
	});

	it('Should now allow lotto rolls when contract is unpaused', async () => {
		client.setOperator(operatorId, operatorKey);

		// Roll the lotto now that the contract is unpaused
		const result = await contractExecuteFunction(
			ltlContractId,
			lazyTradeLottoIface,
			client,
			600_000,
			'rollLotto',
			[
				token,
				serial,
				userNonce,
				true,
				winRateThreshold,
				minWinAmt,
				maxWinAmt,
				jackpotThreshold,
				...rollTail(signature),
			],
		);

		expect(result[0]?.status?.toString()).to.be.equal('SUCCESS');
		console.log('Lotto roll successful after unpausing');

		userNonce++;
	});

	it('Should allow owner to pause the contract again', async () => {
		client.setOperator(operatorId, operatorKey);

		// Pause the contract
		const result = await contractExecuteFunction(
			ltlContractId,
			lazyTradeLottoIface,
			client,
			600_000,
			'pause',
			[],
		);

		expect(result[0]?.status?.toString()).to.be.equal('SUCCESS');
		console.log('Contract successfully paused by owner');

		// Check the contract is now paused again
		const isPausedResult = await contractExecuteQuery(
			ltlContractId,
			lazyTradeLottoIface,
			client,
			null,
			'isPaused',
			[],
		);

		expect(isPausedResult[0]).to.be.true;
	});

	it('Should again prevent lotto rolls when contract is paused', async () => {
		client.setOperator(operatorId, operatorKey);
		userNonce++;

		// Create a new signature for the new nonce
		const newSignature = await createSignature(
			operatorId,
			token,
			serial,
			userNonce,
			true,
			winRateThreshold,
			minWinAmt,
			maxWinAmt,
			jackpotThreshold,
		);

		// Try to roll the lotto while paused
		try {
			const result = await contractExecuteFunction(
				ltlContractId,
				lazyTradeLottoIface,
				client,
				600_000,
				'rollLotto',
				[
					token,
					serial,
					userNonce,
					true,
					winRateThreshold,
					minWinAmt,
					maxWinAmt,
					jackpotThreshold,
					...rollTail(newSignature),
				],
			);
			if (result[0]?.status?.toString() === 'SUCCESS') {
				console.log('ERROR: Should have failed with contract paused', result);
				fail();
			}
		}
		catch (err) {
			console.log('Expected error when contract is paused:', err.message);
			expect(err.message).to.include('Pausable: paused');
		}
	});

	it('Should unpause the contract for remaining tests', async () => {
		client.setOperator(operatorId, operatorKey);

		// Unpause the contract for subsequent tests
		const result = await contractExecuteFunction(
			ltlContractId,
			lazyTradeLottoIface,
			client,
			600_000,
			'unpause',
			[],
		);

		expect(result[0]?.status?.toString()).to.be.equal('SUCCESS');
		console.log('Contract successfully unpaused for remaining tests');

		// Check the contract is now unpaused
		const isPausedResult = await contractExecuteQuery(
			ltlContractId,
			lazyTradeLottoIface,
			client,
			null,
			'isPaused',
			[],
		);

		expect(isPausedResult[0]).to.be.false;
	});
});

describe('Time to roll the lotto', () => {
	let userNonce;
	let lottoRoundNumber;
	let token;
	let serial;
	let winRateThreshold;
	let minWinAmt;
	let maxWinAmt;
	let jackpotThreshold;

	before(async () => {
		client.setOperator(operatorId, operatorKey);

		// Get the current lotto stats for validation
		// Get lotto stats from the mirror node
		// sleep to ensure in sync
		await sleep(4500);
		const encodedLottoStatsCommand = lazyTradeLottoIface.encodeFunctionData('getLottoStats');
		const lottoStatsResponse = await readOnlyEVMFromMirrorNode(
			env,
			ltlContractId,
			encodedLottoStatsCommand,
			operatorId,
			false,
		);
		const lottoStatsResult = lazyTradeLottoIface.decodeFunctionResult('getLottoStats', lottoStatsResponse);
		lottoRoundNumber = Number(lottoStatsResult[3]);

		console.log('Starting with totalRolls:', lottoRoundNumber);

		// Setup parameters for lotto rolls
		token = LSHGen1_TokenId.toSolidityAddress();
		serial = 1;
		// Random nonce
		userNonce = Math.floor(Math.random() * 1000000);
		// 50% chance of winning (out of 100_000_000)
		winRateThreshold = 50_000_000;
		minWinAmt = 5 * 10 ** LAZY_DECIMAL;
		maxWinAmt = 20 * 10 ** LAZY_DECIMAL;
		// 5% chance of jackpot (out of 100_000_000)
		jackpotThreshold = 50_000_000;

		console.log('Lotto parameters set up:');
		console.log('- Token:', token);
		console.log('- Serial:', serial);
		console.log('- Nonce:', userNonce);
		console.log('- Win rate threshold:', winRateThreshold, '(50%)');
		console.log('- Min/max win amounts:', minWinAmt / 10 ** LAZY_DECIMAL, '-', maxWinAmt / 10 ** LAZY_DECIMAL, '$LAZY');
		console.log('- Jackpot threshold:', jackpotThreshold, '(5%)');
	});

	it('Should fail to roll lotto with invalid token address', async () => {
		userNonce++;
		client.setOperator(operatorId, operatorKey);

		// Sign the hash with the system wallet
		const signature = await createSignature(
			operatorId,
			ethers.ZeroAddress,
			serial,
			userNonce,
			true,
			winRateThreshold,
			minWinAmt,
			maxWinAmt,
			jackpotThreshold,
		);

		// Try with invalid token address (zero address)
		try {
			const result = await contractExecuteFunction(
				ltlContractId,
				lazyTradeLottoIface,
				client,
				600_000,
				'rollLotto',
				[
					ethers.ZeroAddress,
					serial,
					userNonce,
					true,
					winRateThreshold,
					minWinAmt,
					maxWinAmt,
					jackpotThreshold,
					...rollTail(signature),
				],
			);
			if (result[0]?.status?.toString() === 'SUCCESS') {
				console.log('ERROR: Should have failed with invalid token address', result);
				fail();
			}
		}
		catch (err) {
			console.log('Expected error with invalid token address:', err.message);
			expect(err.message).to.include('BadArguments');
		}

		// Increment nonce for next test
		userNonce++;
	});

	it('Should fail to roll lotto with invalid min/max win amounts', async () => {
		userNonce++;
		client.setOperator(operatorId, operatorKey);

		// Create invalid parameters where minWin > maxWin
		const invalidMinWin = 30 * 10 ** LAZY_DECIMAL;
		const invalidMaxWin = 10 * 10 ** LAZY_DECIMAL;

		const signature = await createSignature(
			operatorId,
			token,
			1,
			userNonce,
			true,
			winRateThreshold,
			// Min > Max (invalid)
			invalidMinWin,
			invalidMaxWin,
			jackpotThreshold,
		);

		// Try with invalid win amounts
		try {
			const result = await contractExecuteFunction(
				ltlContractId,
				lazyTradeLottoIface,
				client,
				600_000,
				'rollLotto',
				[
					token,
					serial,
					userNonce,
					true,
					winRateThreshold,
					invalidMinWin,
					invalidMaxWin,
					jackpotThreshold,
					...rollTail(signature),
				],
			);
			if (result[0]?.status?.toString() === 'SUCCESS') {
				console.log('ERROR: Should have failed with invalid win amounts', result);
				fail();
			}
		}
		catch (err) {
			console.log('Expected error with invalid win amounts:', err.message);
			expect(err.message).to.include('BadArguments');
		}

		userNonce++;
	});

	it('Should fail to roll lotto with invalid win rate threshold', async () => {
		userNonce++;
		client.setOperator(operatorId, operatorKey);

		// Greater than MAX_WIN_RATE_THRESHOLD (100_000_000)
		const invalidThreshold = 200000000;

		const signatureHex = await createSignature(
			operatorId,
			token,
			serial,
			userNonce,
			false,
			invalidThreshold,
			minWinAmt,
			maxWinAmt,
			jackpotThreshold,
		);

		// Try with invalid win rate threshold
		try {
			const result = await contractExecuteFunction(
				ltlContractId,
				lazyTradeLottoIface,
				client,
				600_000,
				'rollLotto',
				[
					token,
					serial,
					userNonce,
					false,
					invalidThreshold,
					minWinAmt,
					maxWinAmt,
					jackpotThreshold,
					...rollTail(signatureHex),
				],
			);
			if (result[0]?.status?.toString() === 'SUCCESS') {
				console.log('ERROR: Should have failed with invalid win rate threshold', result);
				fail();
			}
		}
		catch (err) {
			console.log('Expected error with invalid win rate threshold:', err.message);
			expect(err.message).to.include('BadArguments');
		}

		userNonce++;
	});

	it('Should fail to roll lotto with invalid team signature', async () => {
		userNonce++;
		client.setOperator(operatorId, operatorKey);

		// Use a random invalid signature
		const invalidSignature = ethers.hexlify(ethers.randomBytes(65));

		// Try with invalid signature
		try {
			const result = await contractExecuteFunction(
				ltlContractId,
				lazyTradeLottoIface,
				client,
				600_000,
				'rollLotto',
				[
					token,
					serial,
					userNonce,
					true,
					winRateThreshold,
					minWinAmt,
					maxWinAmt,
					jackpotThreshold,
					...rollTail(invalidSignature),
				],
			);
			if (result[0]?.status?.toString() === 'SUCCESS') {
				console.log('ERROR: Should have failed with invalid signature');
				fail();
			}
		}
		catch (err) {
			console.log('Expected error with invalid signature:', err.message);
			expect(err.message).to.include('InvalidTeamSignature');
		}

		userNonce++;
	});

	it('Should build the same roll digest as the contract (signer parity)', async () => {
		// the off-chain signer and getRollMessageHash must agree byte-for-byte, incl. contract + chain
		const deadline = Math.floor(Date.now() / 1000) + 600;
		const roller = operatorId.toSolidityAddress();
		const params = [roller, token, serial, userNonce, true, winRateThreshold, minWinAmt, maxWinAmt, jackpotThreshold, true, deadline];

		const encoded = lazyTradeLottoIface.encodeFunctionData('getRollMessageHash', params);
		const response = await readOnlyEVMFromMirrorNode(env, ltlContractId, encoded, operatorId, false);
		const onChain = lazyTradeLottoIface.decodeFunctionResult('getRollMessageHash', response)[0];

		expect(onChain).to.be.equal(rollMessageHash(ltlContractId.toSolidityAddress(), ...params));
	});

	it('Should fail to roll lotto with an expired signature', async () => {
		userNonce++;
		client.setOperator(operatorId, operatorKey);

		const expired = Math.floor(Date.now() / 1000) - 60;
		const signature = await createSignature(
			operatorId,
			token,
			serial,
			userNonce,
			true,
			winRateThreshold,
			minWinAmt,
			maxWinAmt,
			jackpotThreshold,
			false,
			expired,
		);

		const result = await contractExecuteFunction(
			ltlContractId,
			lazyTradeLottoIface,
			client,
			600_000,
			'rollLotto',
			[token, serial, userNonce, true, winRateThreshold, minWinAmt, maxWinAmt, jackpotThreshold, false, expired, signature],
		);
		expect(result[0]?.status?.name).to.be.equal('SignatureExpired');

		userNonce++;
	});

	it('Should fail to roll lotto with a signature made for another contract', async () => {
		userNonce++;
		client.setOperator(operatorId, operatorKey);

		// same signer and parameters, but bound to a different deployment (cross-deployment replay)
		const signature = await createSignature(
			operatorId,
			token,
			serial,
			userNonce,
			true,
			winRateThreshold,
			minWinAmt,
			maxWinAmt,
			jackpotThreshold,
			false,
			undefined,
			lazyGasStationId.toSolidityAddress(),
		);

		const result = await contractExecuteFunction(
			ltlContractId,
			lazyTradeLottoIface,
			client,
			600_000,
			'rollLotto',
			[token, serial, userNonce, true, winRateThreshold, minWinAmt, maxWinAmt, jackpotThreshold, ...rollTail(signature)],
		);
		expect(result[0]?.status?.name).to.be.equal('InvalidTeamSignature');

		userNonce++;
	});

	it('Should fail to roll lotto above the max win cap even with a valid signature', async () => {
		userNonce++;
		client.setOperator(operatorId, operatorKey);

		const overCap = (maxWinAmtCap + 1) * 10 ** LAZY_DECIMAL;
		const signature = await createSignature(
			operatorId,
			token,
			serial,
			userNonce,
			true,
			winRateThreshold,
			minWinAmt,
			overCap,
			jackpotThreshold,
		);

		const result = await contractExecuteFunction(
			ltlContractId,
			lazyTradeLottoIface,
			client,
			600_000,
			'rollLotto',
			[token, serial, userNonce, true, winRateThreshold, minWinAmt, overCap, jackpotThreshold, ...rollTail(signature)],
		);
		expect(result[0]?.status?.name).to.be.equal('BadArguments');
		expect(result[0]?.status?.args?.[0]).to.be.equal('Win Cap');

		userNonce++;
	});

	it('Should reject a contract caller even with a valid signature (EOA-only)', async () => {
		userNonce++;
		client.setOperator(operatorId, operatorKey);

		const forwarderJson = JSON.parse(
			fs.readFileSync('./artifacts/contracts/mocks/CallForwarder.sol/CallForwarder.json'),
		);
		const [forwarderId] = await contractDeployFunction(client, forwarderJson.bytecode, 500_000);

		// sign for the forwarder as roller so only the EOA guard can reject the call
		const signature = await createSignature(
			forwarderId.toSolidityAddress(),
			token,
			serial,
			userNonce,
			true,
			winRateThreshold,
			minWinAmt,
			maxWinAmt,
			jackpotThreshold,
		);
		const rollData = lazyTradeLottoIface.encodeFunctionData('rollLotto', [
			token, serial, userNonce, true, winRateThreshold, minWinAmt, maxWinAmt, jackpotThreshold, ...rollTail(signature),
		]);

		// decode the bubbled-up revert with the lotto's custom errors
		const forwarderIface = new ethers.Interface([
			...forwarderJson.abi,
			...lazyTradeLottoIface.fragments.filter((f) => f.type === 'error'),
		]);
		const result = await contractExecuteFunction(
			forwarderId,
			forwarderIface,
			client,
			800_000,
			'forward',
			[ltlContractId.toSolidityAddress(), rollData],
		);
		expect(result[0]?.status?.name).to.be.equal('OnlyEOA');

		userNonce++;
	});

	it('Should fail to roll lotto when the signed burn exemption is altered', async () => {
		userNonce++;
		client.setOperator(operatorId, operatorKey);

		// signed as NOT exempt; submitting burnExempt = true must not recover the system wallet
		const signature = await createSignature(
			operatorId,
			token,
			serial,
			userNonce,
			true,
			winRateThreshold,
			minWinAmt,
			maxWinAmt,
			jackpotThreshold,
			false,
		);
		const [, deadline] = rollTail(signature);

		const result = await contractExecuteFunction(
			ltlContractId,
			lazyTradeLottoIface,
			client,
			600_000,
			'rollLotto',
			[token, serial, userNonce, true, winRateThreshold, minWinAmt, maxWinAmt, jackpotThreshold, true, deadline, signature],
		);
		expect(result[0]?.status?.name).to.be.equal('InvalidTeamSignature');

		userNonce++;
	});

	it('Should stop wins with PayoutCapReached once the payout window cap is used up', async () => {
		userNonce++;
		client.setOperator(operatorId, operatorKey);

		// a 1-base-unit window cap means any regular win exceeds it
		let result = await contractExecuteFunction(ltlContractId, lazyTradeLottoIface, client, null, 'updatePayoutWindowCap', [1]);
		expect(result[0]?.status?.toString()).to.be.equal('SUCCESS');

		try {
			// 100% win rate -> guaranteed regular win -> the payout trips the window cap
			const signature = await createSignature(
				operatorId,
				token,
				serial,
				userNonce,
				true,
				100_000_000,
				minWinAmt,
				maxWinAmt,
				jackpotThreshold,
			);
			result = await contractExecuteFunction(
				ltlContractId,
				lazyTradeLottoIface,
				client,
				600_000,
				'rollLotto',
				[token, serial, userNonce, true, 100_000_000, minWinAmt, maxWinAmt, jackpotThreshold, ...rollTail(signature)],
			);
			expect(result[0]?.status?.name).to.be.equal('PayoutCapReached');
		}
		finally {
			result = await contractExecuteFunction(
				ltlContractId,
				lazyTradeLottoIface,
				client,
				null,
				'updatePayoutWindowCap',
				[payoutWindowCap * 10 ** LAZY_DECIMAL],
			);
			expect(result[0]?.status?.toString()).to.be.equal('SUCCESS');
		}

		userNonce++;
	});

	it('Should still accept a plain EOA when the owner requires codeless callers', async () => {
		userNonce++;
		client.setOperator(operatorId, operatorKey);

		let result = await contractExecuteFunction(ltlContractId, lazyTradeLottoIface, client, null, 'setRequireCodelessCaller', [true]);
		expect(result[0]?.status?.toString()).to.be.equal('SUCCESS');

		try {
			// an undelegated Hedera account reports empty code, so the extra check must not block it
			const signature = await createSignature(
				operatorId,
				token,
				serial,
				userNonce,
				true,
				winRateThreshold,
				minWinAmt,
				maxWinAmt,
				jackpotThreshold,
			);
			result = await contractExecuteFunction(
				ltlContractId,
				lazyTradeLottoIface,
				client,
				600_000,
				'rollLotto',
				[token, serial, userNonce, true, winRateThreshold, minWinAmt, maxWinAmt, jackpotThreshold, ...rollTail(signature)],
			);
			if (result[0]?.status?.toString() !== 'SUCCESS') console.log('codeless-caller roll result:', result);
			expect(result[0]?.status?.toString()).to.be.equal('SUCCESS');
		}
		finally {
			result = await contractExecuteFunction(ltlContractId, lazyTradeLottoIface, client, null, 'setRequireCodelessCaller', [false]);
			expect(result[0]?.status?.toString()).to.be.equal('SUCCESS');
		}

		userNonce++;
	});

	it('Should successfully roll the lotto with valid parameters', async () => {
		userNonce++;
		client.setOperator(operatorId, operatorKey);

		const signature = await createSignature(
			operatorId,
			token,
			serial,
			userNonce,
			true,
			winRateThreshold,
			minWinAmt,
			maxWinAmt,
			jackpotThreshold,
		);

		// Roll the lotto with valid parameters
		const result = await contractExecuteFunction(
			ltlContractId,
			lazyTradeLottoIface,
			client,
			600_000,
			'rollLotto',
			[
				token,
				serial,
				userNonce,
				true,
				winRateThreshold,
				minWinAmt,
				maxWinAmt,
				jackpotThreshold,
				...rollTail(signature),
			],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to roll lotto:', result);
			fail();
		}
		else {
			console.log('Lotto rolled successfully:', result[0]?.status.toString());
		}

		// Let mirror node catch up
		await sleep(5000);

		// Check if lotto round number incremented
		const encodedLottoStatsCommand = lazyTradeLottoIface.encodeFunctionData('getLottoStats');
		const lottoStatsResponse = await readOnlyEVMFromMirrorNode(
			env,
			ltlContractId,
			encodedLottoStatsCommand,
			operatorId,
			false,
		);
		const lottoStatsAfterRoll = lazyTradeLottoIface.decodeFunctionResult('getLottoStats', lottoStatsResponse);

		const newLottoRound = Number(lottoStatsAfterRoll[3]);
		expect(newLottoRound).to.be.equal(lottoRoundNumber + 1);

		// Check if a win or jackpot occurred and record the relevant amounts
		const totalWins = Number(lottoStatsAfterRoll[4]);
		const totalPaid = Number(lottoStatsAfterRoll[5]);
		const jackpotsWon = Number(lottoStatsAfterRoll[1]);

		console.log('After roll:');
		console.log('- Total rolls:', newLottoRound);
		console.log('- Total wins:', totalWins);
		console.log('- Total paid:', totalPaid / 10 ** LAZY_DECIMAL, '$LAZY');
		console.log('- Jackpots won:', jackpotsWon);

		userNonce++;
	});

	it('Should prevent replay attacks by rejecting a duplicate roll', async () => {
		// do not increment userNonce here to simulate a replay attack
		client.setOperator(operatorId, operatorKey);

		// Attempt to replay the previous roll by reusing the same parameters
		const previousNonce = userNonce - 1;

		const signatureHex = await createSignature(
			operatorId,
			token,
			serial,
			previousNonce,
			true,
			winRateThreshold,
			minWinAmt,
			maxWinAmt,
			jackpotThreshold,
		);

		// Attempt to roll with same parameters
		try {
			const result = await contractExecuteFunction(
				ltlContractId,
				lazyTradeLottoIface,
				client,
				600_000,
				'rollLotto',
				[
					token,
					serial,
					previousNonce,
					true,
					winRateThreshold,
					minWinAmt,
					maxWinAmt,
					jackpotThreshold,
					...rollTail(signatureHex),
				],
			);
			if (result[0]?.status?.toString() === 'SUCCESS') {
				console.log('ERROR: Should have failed with replayed parameters', result);
				fail();
			}
		}
		catch (err) {
			console.log('Expected error with replayed parameters:', err.message, err);
			expect(err.message).to.include('AlreadyRolled');
		}
	});

	it('Should allow both buyer and seller to roll separately for the same trade', async () => {
		userNonce++;
		client.setOperator(operatorId, operatorKey);

		// First roll as buyer
		// Create a valid signature from the system wallet
		const signature = await createSignature(
			operatorId,
			token,
			serial,
			userNonce,
			true,
			winRateThreshold,
			minWinAmt,
			maxWinAmt,
			jackpotThreshold,
		);

		// Roll as buyer
		let result = await contractExecuteFunction(
			ltlContractId,
			lazyTradeLottoIface,
			client,
			600_000,
			'rollLotto',
			[
				token,
				serial,
				userNonce,
				true,
				winRateThreshold,
				minWinAmt,
				maxWinAmt,
				jackpotThreshold,
				...rollTail(signature),
			],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to roll lotto as buyer:', result);
			fail();
		}

		console.log('Rolled successfully as buyer');

		// Now roll as seller with same parameters (except buyer flag)
		const signatureHex = await createSignature(
			operatorId,
			token,
			serial,
			userNonce,
			false,
			winRateThreshold,
			minWinAmt,
			maxWinAmt,
			jackpotThreshold,
		);

		// Roll as seller
		result = await contractExecuteFunction(
			ltlContractId,
			lazyTradeLottoIface,
			client,
			600_000,
			'rollLotto',
			[
				token,
				serial,
				userNonce,
				false,
				winRateThreshold,
				minWinAmt,
				maxWinAmt,
				jackpotThreshold,
				...rollTail(signatureHex),
			],
		);

		expect(result[0]?.status?.toString()).to.be.equal('SUCCESS');
		console.log('Rolled successfully as seller');

		// Let mirror node catch up
		await sleep(5000);

		// Check total rolls increased by 2
		const encodedLottoStatsCommand = lazyTradeLottoIface.encodeFunctionData('getLottoStats');
		const lottoStatsResponse = await readOnlyEVMFromMirrorNode(
			env,
			ltlContractId,
			encodedLottoStatsCommand,
			operatorId,
			false,
		);
		const lottoStatsAfterRoll = lazyTradeLottoIface.decodeFunctionResult('getLottoStats', lottoStatsResponse);

		const totalRolls = Number(lottoStatsAfterRoll[3]);
		// +1 from previous test and +2 from this test
		expect(totalRolls).to.be.equal(lottoRoundNumber + 3);

		userNonce++;
	});

	it('Should validate jackpot behavior after a win or loss', async () => {
		userNonce++;
		client.setOperator(operatorId, operatorKey);

		// Get current stats for comparison
		const encodedStatsCommand = lazyTradeLottoIface.encodeFunctionData('getLottoStats');
		const statsBeforeResponse = await readOnlyEVMFromMirrorNode(
			env,
			ltlContractId,
			encodedStatsCommand,
			operatorId,
			false,
		);
		const statsBefore = lazyTradeLottoIface.decodeFunctionResult('getLottoStats', statsBeforeResponse);

		const jackpotBefore = Number(statsBefore[0]);
		const jackpotsWonBefore = Number(statsBefore[1]);
		const jackpotIncrement = Number(statsBefore[6]);

		console.log('Before roll:');
		console.log('- Jackpot:', jackpotBefore / 10 ** LAZY_DECIMAL, '$LAZY');
		console.log('- Jackpots won:', jackpotsWonBefore);

		// Use high jackpot threshold for testing
		// 99.9% chance of winning (out of 100_000_000)
		const highJackpotThreshold = 99_900_000;

		// Create a valid signature from the system wallet
		const signatureHex = await createSignature(
			operatorId,
			token,
			serial,
			userNonce,
			true,
			50_000_000,
			minWinAmt,
			maxWinAmt,
			highJackpotThreshold,
		);

		// Roll with high jackpot threshold
		const result = await contractExecuteFunction(
			ltlContractId,
			lazyTradeLottoIface,
			client,
			600_000,
			'rollLotto',
			[
				token,
				serial,
				userNonce,
				true,
				50_000_000,
				minWinAmt,
				maxWinAmt,
				highJackpotThreshold,
				...rollTail(signatureHex),
			],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to roll lotto with high jackpot threshold:', result);
			fail();
		}

		// Let mirror node catch up
		await sleep(5000);

		// Check state after roll
		const statsAfterResponse = await readOnlyEVMFromMirrorNode(
			env,
			ltlContractId,
			encodedStatsCommand,
			operatorId,
			false,
		);
		const statsAfter = lazyTradeLottoIface.decodeFunctionResult('getLottoStats', statsAfterResponse);

		const jackpotAfter = Number(statsAfter[0]);
		const jackpotsWonAfter = Number(statsAfter[1]);

		console.log('After roll:');
		console.log('- Jackpot:', jackpotAfter / 10 ** LAZY_DECIMAL, '$LAZY');
		console.log('- Jackpots won:', jackpotsWonAfter);

		if (jackpotsWonAfter > jackpotsWonBefore) {
			// Jackpot was won
			expect(jackpotAfter).to.be.equal(lottoLossIncrement * 10 ** LAZY_DECIMAL);
			console.log('✓ Jackpot was reset to one loss increment after win');
		}
		else {
			// No jackpot won
			expect(jackpotAfter).to.be.equal(jackpotBefore + jackpotIncrement);
			console.log('✓ Jackpot was incremented by', jackpotIncrement / 10 ** LAZY_DECIMAL, '$LAZY after no win');
		}

		userNonce++;
	});

	it('Should allow the owner to boost the jackpot', async () => {
		userNonce++;
		client.setOperator(operatorId, operatorKey);

		// Get current jackpot
		const encodedStatsCommand = lazyTradeLottoIface.encodeFunctionData('getLottoStats');
		const lottoStatsBeforeResponse = await readOnlyEVMFromMirrorNode(
			env,
			ltlContractId,
			encodedStatsCommand,
			operatorId,
			false,
		);
		const lottoStatsBefore = lazyTradeLottoIface.decodeFunctionResult('getLottoStats', lottoStatsBeforeResponse);

		const jackpotBefore = Number(lottoStatsBefore[0]);
		console.log('Jackpot before boost:', jackpotBefore / 10 ** LAZY_DECIMAL);

		// Boost amount
		const boostAmount = 1000 * 10 ** LAZY_DECIMAL;

		// Boost the jackpot
		const result = await contractExecuteFunction(
			ltlContractId,
			lazyTradeLottoIface,
			client,
			null,
			'boostJackpot',
			[boostAmount],
		);

		expect(result[0]?.status?.toString()).to.be.equal('SUCCESS');

		// Let mirror node catch up
		await sleep(5000);

		// Check jackpot after boost
		const lottoStatsAfterResponse = await readOnlyEVMFromMirrorNode(
			env,
			ltlContractId,
			encodedStatsCommand,
			operatorId,
			false,
		);
		const lottoStatsAfter = lazyTradeLottoIface.decodeFunctionResult('getLottoStats', lottoStatsAfterResponse);

		const jackpotAfter = Number(lottoStatsAfter[0]);
		console.log('Jackpot after boost:', jackpotAfter / 10 ** LAZY_DECIMAL);

		// Verify the jackpot increased by the boost amount
		expect(jackpotAfter).to.be.equal(jackpotBefore + boostAmount);
	});

	it('Should apply burn percentage when the signed roll is not burn-exempt (operator, no LSH NFT)', async () => {
		userNonce++;
		client.setOperator(operatorId, operatorKey);

		// v2: the signer resolves LSH holdings off-chain; the operator holds none -> burnExempt = false
		console.log(`Operator roll signed burnExempt=false -> expect ${LAZY_BURN_PERCENT}% burn`);

		// Get initial balance before winning
		const initialBalance = await checkMirrorBalance(
			env,
			operatorId,
			lazyTokenId,
		);
		console.log('Initial $LAZY balance for operator:', initialBalance / 10 ** LAZY_DECIMAL);

		// get the current stats before rolling for comparison
		const statsBeforeResponse = await readOnlyEVMFromMirrorNode(
			env,
			ltlContractId,
			lazyTradeLottoIface.encodeFunctionData('getLottoStats'),
			operatorId,
			false,
		);

		const statsBefore = lazyTradeLottoIface.decodeFunctionResult('getLottoStats', statsBeforeResponse);
		const jackpotBefore = Number(statsBefore[0]);
		const jackpotsWonBefore = Number(statsBefore[1]);
		const totalPaidBefore = Number(statsBefore[5]);
		const totalWinsBefore = Number(statsBefore[4]);

		// Use very high win rate to ensure operator wins
		// 99.999% chance to win
		const guaranteedWinRate = 99_999_000;

		// Set to 0.000001% for testing
		const lowJackpotThreshold = 1;

		// Create a valid signature for guaranteed win
		const signatureHex = await createSignature(
			operatorId.toSolidityAddress(),
			token,
			serial,
			userNonce,
			true,
			guaranteedWinRate,
			minWinAmt,
			maxWinAmt,
			lowJackpotThreshold,
			false,
		);

		// Roll the lotto with high win probability
		const result = await contractExecuteFunction(
			ltlContractId,
			lazyTradeLottoIface,
			client,
			600_000,
			'rollLotto',
			[
				token,
				serial,
				userNonce,
				true,
				guaranteedWinRate,
				minWinAmt,
				maxWinAmt,
				lowJackpotThreshold,
				...rollTail(signatureHex),
			],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to roll lotto with high win probability:', result);
			fail();
		}
		console.log('Lotto rolled with high win probability:', result[0]?.status.toString(), 'tx:', result[2]?.transactionId.toString());

		// Let mirror node catch up
		await sleep(5000);

		// Check stats after roll to confirm win
		const statsAfterResponse = await readOnlyEVMFromMirrorNode(
			env,
			ltlContractId,
			lazyTradeLottoIface.encodeFunctionData('getLottoStats'),
			operatorId,
			false,
		);
		const statsAfter = lazyTradeLottoIface.decodeFunctionResult('getLottoStats', statsAfterResponse);

		const jackpotAfter = Number(statsAfter[0]);
		const jackpotsWonAfter = Number(statsAfter[1]);
		const totalWins = Number(statsAfter[4]);
		const totalPaid = Number(statsAfter[5]);

		if (totalWins > totalWinsBefore) {
			// Win occurred

			// Expect at least one win and some payment
			expect(totalWins).to.be.greaterThan(0);
			expect(totalPaid).to.be.greaterThan(0);
			console.log('Win confirmed - Total wins:', totalWins, 'Total paid:', totalPaid / 10 ** LAZY_DECIMAL);

			console.log('Total paid increment:', (totalPaid - totalPaidBefore) / 10 ** LAZY_DECIMAL);

			// Check final balance to verify burn was applied to the payment
			const finalBalance = await checkMirrorBalance(
				env,
				operatorId,
				lazyTokenId,
			);
			console.log('Final $LAZY balance for operator:', finalBalance / 10 ** LAZY_DECIMAL);

			// Calculate expected payout after burn
			const payout = finalBalance - initialBalance;
			console.log('Actual payout received:', payout / 10 ** LAZY_DECIMAL);

			// this payout could be a jackpot or a win, so we need to check from the contract what has happened

			// Check if a jackpot was won
			const jackpotWon = jackpotsWonAfter > jackpotsWonBefore;
			// check if there was a regular win
			const regularWin = totalWins > totalWinsBefore;

			const jackpotPayout = jackpotWon ? jackpotBefore * (1 - LAZY_BURN_PERCENT / 100) : 0;
			const regularWinPayout = regularWin ? (totalPaid - totalPaidBefore) * (1 - LAZY_BURN_PERCENT / 100) : 0;

			const expectedPayout = jackpotPayout + regularWinPayout;
			console.log('Expected payout after burn:', expectedPayout / 10 ** LAZY_DECIMAL);


			// Verify payout is in the expected range and burn was applied
			// Small buffer for rounding
			if (regularWin) {
				expect(regularWinPayout).to.be.greaterThanOrEqual(minWinAmt * (1 - LAZY_BURN_PERCENT / 100) * 0.98);
				expect(regularWinPayout).to.be.lessThanOrEqual(maxWinAmt * (1 - LAZY_BURN_PERCENT / 100) * 1.02);
			}

			if (jackpotWon) {
				// check the jackpot was reset to 1 loss increment
				expect(jackpotAfter).to.be.equal(lottoLossIncrement);

				console.log('✓ Jackpot was reset to 1 loss increment after win');
			}

			expect(payout).to.be.greaterThanOrEqual(expectedPayout * 0.98);
			expect(payout).to.be.lessThanOrEqual(expectedPayout * 1.02);

			console.log('✓ Burn percentage was properly applied to operator payout');
			console.log('✓ Operator win confirmed - Total wins:', totalWins, 'Total paid:', totalPaid / 10 ** LAZY_DECIMAL);
		}

		userNonce++;
	});

	it('Should apply zero burn when the signed roll is burn-exempt (Alice, LSH holder)', async () => {
		userNonce++;
		// Use Alice as operator for this test (she has NFTs)
		client.setOperator(aliceId, alicePK);

		// v2: the signer resolves Alice's LSH holdings off-chain -> burnExempt = true
		console.log('Alice roll signed burnExempt=true -> expect 0% burn');

		// Get initial balance before winning
		const initialBalance = await checkMirrorBalance(
			env,
			aliceId,
			lazyTokenId,
		);
		console.log('Initial $LAZY balance for Alice:', initialBalance / 10 ** LAZY_DECIMAL);

		// get the current stats before rolling for comparison
		const statsBeforeResponse = await readOnlyEVMFromMirrorNode(
			env,
			ltlContractId,
			lazyTradeLottoIface.encodeFunctionData('getLottoStats'),
			operatorId,
			false,
		);

		const statsBefore = lazyTradeLottoIface.decodeFunctionResult('getLottoStats', statsBeforeResponse);
		const jackpotBefore = Number(statsBefore[0]);
		const jackpotsWonBefore = Number(statsBefore[1]);
		const totalPaidBefore = Number(statsBefore[5]);
		const totalWinsBefore = Number(statsBefore[4]);

		// Use very high win rate to ensure Alice wins
		const guaranteedWinRate = 99_999_000;

		// Set to 0.000001% for testing
		const lowJackpotThreshold = 1;

		// Create a valid signature for guaranteed win
		const signatureHex = await createSignature(
			aliceId.toSolidityAddress(),
			token,
			serial,
			userNonce,
			true,
			guaranteedWinRate,
			minWinAmt,
			maxWinAmt,
			lowJackpotThreshold,
			true,
		);


		// Roll the lotto with high win probability
		const result = await contractExecuteFunction(
			ltlContractId,
			lazyTradeLottoIface,
			client,
			600_000,
			'rollLotto',
			[
				token,
				serial,
				userNonce,
				true,
				guaranteedWinRate,
				minWinAmt,
				maxWinAmt,
				lowJackpotThreshold,
				...rollTail(signatureHex),
			],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Failed to roll lotto with high win probability:', result);
			fail();
		}
		console.log('Lotto rolled with high win probability for Alice:', result[0]?.status.toString(), 'tx:', result[2]?.transactionId.toString());

		// Let mirror node catch up
		await sleep(5000);

		// Check stats after roll to confirm win
		const statsAfterResponse = await readOnlyEVMFromMirrorNode(
			env,
			ltlContractId,
			lazyTradeLottoIface.encodeFunctionData('getLottoStats'),
			operatorId,
			false,
		);
		const statsAfter = lazyTradeLottoIface.decodeFunctionResult('getLottoStats', statsAfterResponse);

		const jackpotAfter = Number(statsAfter[0]);
		const jackpotsWonAfter = Number(statsAfter[1]);
		const totalWins = Number(statsAfter[4]);
		const totalPaid = Number(statsAfter[5]);

		if (totalWins > totalWinsBefore) {
			// Win occurred

			// Expect at least one win and some payment
			expect(totalWins).to.be.greaterThan(0);
			expect(totalPaid).to.be.greaterThan(0);
			console.log('Win confirmed - Total wins:', totalWins, 'Total paid:', totalPaid / 10 ** LAZY_DECIMAL);

			console.log('Total paid increment:', (totalPaid - totalPaidBefore) / 10 ** LAZY_DECIMAL);

			// Check final balance to verify burn was applied to the payment
			const finalBalance = await checkMirrorBalance(
				env,
				aliceId,
				lazyTokenId,
			);
			console.log('Final $LAZY balance for ALICE:', finalBalance / 10 ** LAZY_DECIMAL);

			// Calculate expected payout after burn
			const payout = finalBalance - initialBalance;
			console.log('Actual payout received by ALICE:', payout / 10 ** LAZY_DECIMAL);

			// this payout could be a jackpot or a win, so we need to check from the contract what has happened

			// Check if a jackpot was won
			const jackpotWon = jackpotsWonAfter > jackpotsWonBefore;
			// check if there was a regular win
			const regularWin = totalWins > totalWinsBefore;

			const jackpotPayout = jackpotWon ? jackpotBefore : 0;
			const regularWinPayout = regularWin ? (totalPaid - totalPaidBefore) : 0;

			const expectedPayout = jackpotPayout + regularWinPayout;
			console.log('Expected payout after burn:', expectedPayout / 10 ** LAZY_DECIMAL);


			// Verify payout is in the expected range and burn was applied
			// Small buffer for rounding
			if (regularWin) {
				expect(regularWinPayout).to.be.greaterThanOrEqual(minWinAmt * 0.98);
				expect(regularWinPayout).to.be.lessThanOrEqual(maxWinAmt * 1.02);
			}

			if (jackpotWon) {
				// check the jackpot was reset to 1 loss increment
				expect(jackpotAfter).to.be.equal(lottoLossIncrement);

				console.log('✓ Jackpot was reset to 1 loss increment after win');
			}

			expect(payout).to.be.greaterThanOrEqual(expectedPayout * 0.98);
			expect(payout).to.be.lessThanOrEqual(expectedPayout * 1.02);

			console.log('✓ No burn percentage was applied to Alice\'s payout (NFT holder)');
			console.log('✓ ALICE win confirmed - Total wins:', totalWins, 'Total paid:', totalPaid / 10 ** LAZY_DECIMAL);
		}

		// Switch back to operator for subsequent tests
		client.setOperator(operatorId, operatorKey);
		userNonce++;
	});

	// Last in this suite: it leaves the jackpot at its maximum, so no rolls may follow it.
	it('Should clamp a jackpot boost to maxJackpotPool', async () => {
		client.setOperator(operatorId, operatorKey);

		const encodedStatsCommand = lazyTradeLottoIface.encodeFunctionData('getLottoStats');
		const statsBefore = lazyTradeLottoIface.decodeFunctionResult(
			'getLottoStats',
			await readOnlyEVMFromMirrorNode(env, ltlContractId, encodedStatsCommand, operatorId, false),
		);
		const maxJackpotPool = Number(statsBefore[7]);

		// boost by the full maximum: previously the pool would overshoot until the next roll
		const result = await contractExecuteFunction(
			ltlContractId,
			lazyTradeLottoIface,
			client,
			null,
			'boostJackpot',
			[maxJackpotPool],
		);
		expect(result[0]?.status?.toString()).to.be.equal('SUCCESS');

		await sleep(5000);

		const statsAfter = lazyTradeLottoIface.decodeFunctionResult(
			'getLottoStats',
			await readOnlyEVMFromMirrorNode(env, ltlContractId, encodedStatsCommand, operatorId, false),
		);
		expect(Number(statsAfter[0])).to.be.equal(maxJackpotPool);
	});
});

describe('Clean-up', () => {
	it('sweep hbar from the test accounts', async () => {
		await sleep(5000);
		client.setOperator(operatorId, operatorKey);
		let balance = await checkMirrorHbarBalance(env, aliceId, alicePK);
		balance -= 1_000_000;
		console.log('sweeping alice', balance / 10 ** 8);
		const result = await sweepHbar(client, aliceId, alicePK, operatorId, new Hbar(balance, HbarUnit.Tinybar));
		console.log('alice:', result);
	});
});

/**
 * Helper function to encpapsualte minting an FT
 * @param {string} tokenName
 * @param {string} tokenSymbol
 * @param {string} tokenMemo
 * @param {number} tokenInitalSupply
 * @param {number} tokenDecimal
 * @param {number} tokenMaxSupply
 * @param {number} payment
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

/**
 * Use the LSCT to send $LAZY out
 * @param {AccountId} receiverId
 * @param {*} amt
 */
async function sendLazy(receiverId, amt) {
	const result = await contractExecuteFunction(
		lazySCT,
		lazyIface,
		client,
		300_000,
		'transferHTS',
		[lazyTokenId.toSolidityAddress(), receiverId.toSolidityAddress(), amt],
	);
	if (result[0]?.status?.toString() !== 'SUCCESS') {
		console.log('Failed to send $LAZY:', result);
		fail();
	}
	return result[0]?.status.toString();
}

/**
 * Helper to create a signed message
 * @param {String | AccountId} roller
 * @param {String | TokenId} tokenId
 * @param {Number} serial
 * @param {Number} nonce
 * @param {boolean} buyer
 * @param {Number} winRateThreshold
 * @param {Number} minWinAmt
 * @param {Number} maxWinAmt
 * @param {Number} jackpotThreshold
 * @param {boolean} burnExempt roller pays 0% burn (LSH holder / valid delegate, resolved by the signer)
 * @param {Number} deadline unix seconds after which the contract rejects the signature
 * @param {string} contractAddress the LazyTradeLotto the signature is valid for (defaults to the one under test)
 * @return {string} signature
 */
async function createSignature(
	roller,
	tokenId,
	serial,
	nonce,
	buyer,
	winRateThreshold,
	minWinAmt,
	maxWinAmt,
	jackpotThreshold,
	burnExempt = false,
	deadline = Math.floor(Date.now() / 1000) + 3600,
	contractAddress = ltlContractId.toSolidityAddress(),
) {
	const signer = new ethers.Wallet(`0x${signingKey.toStringRaw()}`);

	if (roller instanceof AccountId) {
		roller = roller.toSolidityAddress();
	}

	if (tokenId instanceof TokenId) {
		tokenId = tokenId.toSolidityAddress();
	}

	const messageHash = rollMessageHash(
		contractAddress,
		roller,
		tokenId,
		serial,
		nonce,
		buyer,
		winRateThreshold,
		minWinAmt,
		maxWinAmt,
		jackpotThreshold,
		burnExempt,
		deadline,
	);

	// Sign the hash directly (EIP-191 personal_sign format)
	const signature = await signer.signMessage(ethers.getBytes(messageHash));
	signedRollParams.set(signature, { burnExempt, deadline });

	return signature;
}

/**
 * The v2 roll digest, mirroring LazyTradeLotto.getRollMessageHash: binds the contract and chain
 * so a signature cannot be replayed on another deployment or network.
 */
function rollMessageHash(
	contractAddress,
	roller,
	tokenId,
	serial,
	nonce,
	buyer,
	winRateThreshold,
	minWinAmt,
	maxWinAmt,
	jackpotThreshold,
	burnExempt,
	deadline,
) {
	return ethers.solidityPackedKeccak256(
		['address', 'uint256', 'address', 'address', 'uint256', 'uint256', 'bool', 'uint256', 'uint256', 'uint256', 'uint256', 'bool', 'uint256'],
		[
			ethers.getAddress(`0x${contractAddress.replace(/^0x/, '')}`),
			HEDERA_CHAIN_IDS[env.toUpperCase()],
			roller,
			tokenId,
			serial,
			nonce,
			buyer,
			winRateThreshold,
			minWinAmt,
			maxWinAmt,
			jackpotThreshold,
			burnExempt,
			deadline,
		],
	);
}