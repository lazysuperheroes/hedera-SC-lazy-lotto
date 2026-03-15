/**
 * LazyLotto Add Prize Package Script
 *
 * Adds prizes to a lottery pool. Supports:
 * - Single prize package (FT + NFTs)
 * - Multiple fungible prizes (batch)
 *
 * Requires ADMIN or PRIZE_MANAGER role.
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyLotto/admin/addPrizePackage.js [poolId]
 *   Multi-sig:  node scripts/interactions/LazyLotto/admin/addPrizePackage.js [poolId] --multisig
 *   Help:       node scripts/interactions/LazyLotto/admin/addPrizePackage.js --multisig-help
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
	ContractId,
	Hbar,
	HbarUnit,
	TokenId,
} = require('@hashgraph/sdk');
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { prompt } = require('../../../../utils/promptHelpers');
const { queryContract } = require('../../../../utils/queryHelpers');
const { getTokenDetails, checkMirrorBalance, checkMirrorHbarBalance, getSerialsOwned, checkFTAllowances, getNFTApprovedForAllAllowances } = require('../../../../utils/hederaMirrorHelpers');
const { homebrewPopulateAccountNum, EntityType } = require('../../../../utils/hederaMirrorHelpers');
const { setFTAllowance, setNFTAllowanceAll } = require('../../../../utils/hederaHelpers');
const { sleep } = require('../../../../utils/nodeHelpers');
const { estimateGas } = require('../../../../utils/gasHelpers');
const {
	executeContractFunction,
	checkMultiSigHelp,
	displayMultiSigBanner,
} = require('../../../../utils/scriptHelpers');

// Environment setup
const { operatorId, operatorKey, env } = getEnvConfig();
const contractId = getContractId('LAZY_LOTTO_CONTRACT_ID');

// Helper: Convert address formats
function convertToEvmAddress(hederaId) {
	if (hederaId.startsWith('0x')) return hederaId;
	const parts = hederaId.split('.');
	const num = parts[parts.length - 1];
	return '0x' + BigInt(num).toString(16).padStart(40, '0');
}

async function convertToHederaId(evmAddress, entityType = null) {
	if (!evmAddress.startsWith('0x')) return evmAddress;
	if (evmAddress === '0x0000000000000000000000000000000000000000') return 'HBAR';
	return await homebrewPopulateAccountNum(env, evmAddress, entityType);
}

// Helper: Format HBAR
function formatHbar(tinybars) {
	return new Hbar(Number(tinybars), HbarUnit.Tinybar).toString();
}

async function addPrizePackage() {
	// Check for multi-sig help request
	if (checkMultiSigHelp()) {
		process.exit(0);
	}

	let client;

	try {
		// Get pool ID
		let poolIdStr = process.argv[2];

		// Filter out flag arguments
		if (poolIdStr && poolIdStr.startsWith('--')) {
			poolIdStr = null;
		}

		if (!poolIdStr) {
			poolIdStr = await prompt('Enter pool ID: ');
		}

		const poolId = parseInt(poolIdStr);
		if (isNaN(poolId) || poolId < 0) {
			console.error('❌ Invalid pool ID');
			process.exit(1);
		}

		// Initialize client
		client = createClient(env, operatorId, operatorKey);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║         LazyLotto Add Prize Package (Admin)              ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 Contract: ${contractId.toString()}`);
		console.log(`🎰 Pool: #${poolId}\n`);

		// Display multi-sig status if enabled
		displayMultiSigBanner();

		// Load contract ABI
		const lazyLottoIface = loadInterface('LazyLotto');

		// Fetch contract dependencies (poolManager, lazyToken, gasStation, storage)
		console.log('🔍 Fetching contract dependencies...');
		const userEvmAddress = '0x' + operatorId.toSolidityAddress();

		const poolManagerAddrResult = await queryContract(env, contractId, lazyLottoIface, 'poolManager', [], operatorId);
		const poolManagerAddr = poolManagerAddrResult[0];
		const poolManagerIdStr = await convertToHederaId(poolManagerAddr, EntityType.CONTRACT);

		const lazyTokenAddrResult = await queryContract(env, contractId, lazyLottoIface, 'lazyToken', [], operatorId);
		const lazyTokenAddr = lazyTokenAddrResult[0];
		const lazyTokenId = await convertToHederaId(lazyTokenAddr, EntityType.TOKEN);

		const lazyGasStationAddrResult = await queryContract(env, contractId, lazyLottoIface, 'lazyGasStation', [], operatorId);
		const lazyGasStationAddr = lazyGasStationAddrResult[0];
		const lazyGasStationId = await convertToHederaId(lazyGasStationAddr, EntityType.CONTRACT);

		const storageAddrResult = await queryContract(env, contractId, lazyLottoIface, 'storageContract', [], operatorId);
		const storageAddr = storageAddrResult[0];
		const storageId = await convertToHederaId(storageAddr, EntityType.CONTRACT);

		console.log(`✅ Pool Manager:  ${poolManagerIdStr}`);
		console.log(`✅ LAZY Token:    ${lazyTokenId}`);
		console.log(`✅ LazyGasStation:${lazyGasStationId}`);
		console.log(`✅ Storage:       ${storageId}\n`);

		// Load PoolManager ABI and check canAddPrizes (covers admin, global prize manager, pool owner, pool prize manager)
		console.log('🔍 Verifying permissions...');
		const poolManagerIface = loadInterface('LazyLottoPoolManager');
		const poolManagerContractId = ContractId.fromString(poolManagerIdStr);

		// canAddPrizes needs a poolId — use the one from the CLI arg or prompt (captured below in outer scope)
		// We do a preliminary check against poolId=0 for global admins / global prize managers first;
		// the pool-specific check happens again after poolId is known.
		const canAddGlobalResult = await queryContract(env, poolManagerContractId, poolManagerIface, 'canAddPrizes', [0, userEvmAddress], operatorId);
		const canAddGlobal = canAddGlobalResult[0];

		if (!canAddGlobal) {
			console.error('❌ You do not have permission to add prizes (not an admin or global prize manager)');
			console.error('   Pool-specific owners/managers are validated after pool selection.');
			// Don't exit — pool-specific check will catch it after poolId is known
		}
		else {
			console.log('✅ Permission verified (admin or global prize manager)\n');
		}

		// Pool-specific permission check (covers pool owner and pool prize manager too)
		if (!canAddGlobal) {
			const canAddPoolResult = await queryContract(env, poolManagerContractId, poolManagerIface, 'canAddPrizes', [poolId, userEvmAddress], operatorId);
			const canAddPool = canAddPoolResult[0];
			if (!canAddPool) {
				console.error(`❌ You do not have permission to add prizes to pool #${poolId}`);
				process.exit(1);
			}
			console.log(`✅ Permission verified (pool #${poolId} owner or prize manager)\n`);
		}

		// Get pool details - query individual fields to avoid large response issues
		// Check if pool is closed
		const poolBasicInfoResult = await queryContract(env, contractId, lazyLottoIface, 'getPoolBasicInfo', [poolId], operatorId);
		const [, , , , prizeCount, , poolTokenId, poolPaused, poolClosed] = poolBasicInfoResult;

		if (poolClosed) {
			console.error('❌ Pool is closed. Cannot add prizes.');
			process.exit(1);
		}

		console.log('═══════════════════════════════════════════════════════════');
		console.log('  POOL INFORMATION');
		console.log('═══════════════════════════════════════════════════════════');
		console.log(`  Pool Token:       ${await convertToHederaId(poolTokenId, EntityType.TOKEN)}`);
		console.log(`  Current Prizes:   ${Number(prizeCount)}`);
		console.log(`  State:            ${poolPaused ? 'PAUSED' : 'ACTIVE'}`);
		console.log('═══════════════════════════════════════════════════════════\n');

		// Ask for prize type
		const prizeType = await prompt('Add (1) Single prize package or (2) Multiple fungible prizes? (1/2): ');

		if (prizeType === '2') {
			await addMultipleFungiblePrizes(client, lazyLottoIface, poolId, lazyTokenId, lazyGasStationId, storageId, poolManagerIface, poolManagerContractId, userEvmAddress);
		}
		else {
			await addSinglePrizePackage(client, lazyLottoIface, poolId, lazyTokenId, lazyGasStationId, storageId, poolManagerIface, poolManagerContractId, userEvmAddress);
		}

	}
	catch (error) {
		console.error('\n❌ Error adding prize:', error.message);
		if (error.status) {
			console.error('Status:', error.status.toString());
		}
		process.exit(1);
	}
	finally {
		if (client) {
			client.close();
		}
	}
}

async function addSinglePrizePackage(client, lazyLottoIface, poolId, lazyTokenId, lazyGasStationId, storageId) {
	console.log('\n═══════════════════════════════════════════════════════════');
	console.log('  SINGLE PRIZE PACKAGE');
	console.log('═══════════════════════════════════════════════════════════\n');

	// Get FT component
	const ftTokenStr = await prompt('Enter FT token (0.0.xxxxx or "HBAR" or "none"): ');
	let ftToken = '0x0000000000000000000000000000000000000000';
	let ftAmount = '0';

	if (ftTokenStr.toLowerCase() !== 'none') {
		if (ftTokenStr.toUpperCase() === 'HBAR') {
			ftToken = '0x0000000000000000000000000000000000000000';

			// Check HBAR balance
			const hbarBalance = await checkMirrorHbarBalance(env, operatorId);
			if (hbarBalance !== null) {
				console.log(`💰 Your HBAR balance: ${new Hbar(hbarBalance, HbarUnit.Tinybar).toString()}\n`);
			}
		}
		else {
			ftToken = convertToEvmAddress(ftTokenStr);

			// Check FT balance
			const ftBalance = await checkMirrorBalance(env, operatorId, ftTokenStr);
			if (ftBalance !== null) {
				const tokenDets = await getTokenDetails(env, ftTokenStr);
				const humanReadable = ftBalance / (10 ** tokenDets.decimals);
				console.log(`💰 Your ${tokenDets.symbol} balance: ${humanReadable} ${tokenDets.symbol}\n`);
			}
		}

		const amountStr = await prompt('Enter FT amount: ');
		ftAmount = amountStr;

		if (isNaN(Number(ftAmount)) || Number(ftAmount) <= 0) {
			console.error('❌ Invalid FT amount');
			process.exit(1);
		}

		// Convert amount based on token decimals
		if (ftToken === '0x0000000000000000000000000000000000000000') {
			// HBAR: convert to tinybars
			ftAmount = Math.floor(Number(new Hbar(Number(ftAmount), HbarUnit.Hbar).toTinybars()));
		}
		else {
			// FT: get decimals and convert
			const tokenDets = await getTokenDetails(env, ftTokenStr);
			ftAmount = Math.floor(Number(ftAmount) * (10 ** tokenDets.decimals));
		}
	}
	const nftTokens = [];
	const nftSerials = [];

	const includeNfts = await prompt('Include NFTs in this prize? (yes/no): ');

	if (includeNfts.toLowerCase() === 'yes' || includeNfts.toLowerCase() === 'y') {
		let addingNfts = true;

		while (addingNfts) {
			const nftTokenStr = await prompt('Enter NFT token ID (0.0.xxxxx): ');
			const nftToken = nftTokenStr;

			// Check NFT ownership
			const ownedSerials = await getSerialsOwned(env, operatorId.toString(), nftToken);

			if (ownedSerials && ownedSerials.length > 0) {
				console.log(`🎨 You own ${ownedSerials.length} NFT(s) from this collection`);
				console.log(`   Serials: ${ownedSerials.join(', ')}\n`);
			}
			else {
				console.log(`⚠️  You don't own any NFTs from collection ${nftToken}\n`);
			}

			const serialsStr = await prompt('Enter serial numbers (comma-separated): ');
			const serialsArray = serialsStr.split(',').map(s => s.trim());

			// Verify ownership
			for (const serial of serialsArray) {
				const serialNum = parseInt(serial);
				if (!ownedSerials || !ownedSerials.includes(serialNum)) {
					console.error(`❌ You don't own serial #${serialNum} of ${nftToken}`);
					process.exit(1);
				}
			}

			nftTokens.push(convertToEvmAddress(nftToken));
			nftSerials.push(serialsArray.map(s => parseInt(s)));

			const addMore = await prompt('Add another NFT collection to this prize? (yes/no): ');
			addingNfts = addMore.toLowerCase() === 'yes' || addMore.toLowerCase() === 'y';
		}
	}

	// Validate at least one component
	if (ftAmount === '0' && nftTokens.length === 0) {
		console.error('❌ Prize must contain at least FT amount or NFTs');
		process.exit(1);
	}

	// Display summary
	console.log('\n═══════════════════════════════════════════════════════════');
	console.log('  PRIZE SUMMARY');
	console.log('═══════════════════════════════════════════════════════════');

	if (ftAmount !== '0') {
		const tokenId = await convertToHederaId(ftToken, EntityType.TOKEN);
		console.log(`  FT:   ${tokenId === 'HBAR' ? formatHbar(ftAmount) : `${ftAmount} ${tokenId}`}`);
	}

	if (nftTokens.length > 0) {
		console.log(`  NFTs: ${nftTokens.length} collection(s)`);
		for (let i = 0; i < nftTokens.length; i++) {
			const tokenId = await convertToHederaId(nftTokens[i], EntityType.TOKEN);
			console.log(`        - ${tokenId}: ${nftSerials[i].length} serial(s)`);
		}
	}

	console.log('═══════════════════════════════════════════════════════════\n');

	// Set allowance if FT prize (not HBAR) - MUST be done before gas estimation
	if (ftToken !== '0x0000000000000000000000000000000000000000' && ftAmount !== '0') {
		const prizeTokenId = await convertToHederaId(ftToken, EntityType.TOKEN);
		const isLazy = prizeTokenId === lazyTokenId;
		const spenderId = isLazy ? lazyGasStationId : storageId;
		const spenderIdObj = isLazy ? ContractId.fromString(lazyGasStationId) : ContractId.fromString(storageId);

		console.log('🔐 Setting token allowance...');
		console.log(`   Token: ${prizeTokenId}`);
		console.log(`   Spender: ${spenderId} (${isLazy ? 'LazyGasStation' : 'Storage'})`);
		console.log(`   Amount: ${ftAmount}\n`);

		// get the FT allowance
		const allowanceInPlace = await checkFTAllowances(
			env,
			operatorId,
		);

		// find if the allowance for this token and spender is sufficient
		let sufficientAllowance = false;
		for (const allowance of allowanceInPlace) {
			if (allowance.tokenId === prizeTokenId.toString() && allowance.spenderId === spenderId) {
				if (Number(allowance.amount) >= Number(ftAmount)) {
					sufficientAllowance = true;
					break;
				}
			}
		}

		if (!sufficientAllowance) {
			try {
				const allowanceStatus = await setFTAllowance(
					client,
					TokenId.fromString(prizeTokenId),
					operatorId,
					spenderIdObj,
					Number(ftAmount),
					`LazyLotto Prize Pool #${poolId}`,
				);

				if (allowanceStatus !== 'SUCCESS') {
					console.error('❌ Failed to set token allowance:', allowanceStatus);
					process.exit(1);
				}
				console.log('✅ Allowance set successfully\n');
			}
			catch (error) {
				console.error('❌ Error setting allowance:', error.message);
				process.exit(1);
			}
		}
	}

	// Set NFT allowances if NFTs are included - MUST be done before gas estimation
	if (nftTokens.length > 0) {
		console.log('🔐 Setting NFT allowances...');
		console.log(`   Collections: ${nftTokens.length}`);
		console.log(`   Spender: ${storageId} (Storage)\n`);

		try {
			// get currently applied NFT allowances
			const allowanceInPlace = await getNFTApprovedForAllAllowances(
				env,
				operatorId,
			);
			// Convert NFT token addresses to TokenId objects
			const nftTokenIdList = [];
			const storageIdString = ContractId.fromString(storageId).toString();

			for (const nftTokenAddr of nftTokens) {
				const tokenId = await convertToHederaId(nftTokenAddr, EntityType.TOKEN);
				// Check if allowance exists for this spender and if the token is already approved
				const spenderAllowances = allowanceInPlace.get(storageIdString) || [];
				if (!spenderAllowances.includes(tokenId.toString())) {
					nftTokenIdList.push(TokenId.fromString(tokenId));
				}
			}

			if (nftTokenIdList.length === 0) {
				console.log('✅ All NFT allowances already in place. Skipping.\n');
			}
			else {
				const allowanceStatus = await setNFTAllowanceAll(
					client,
					nftTokenIdList,
					operatorId,
					ContractId.fromString(storageId),
					`LazyLotto NFT Prize Pool #${poolId}`,
				);

				if (allowanceStatus !== 'SUCCESS') {
					console.error('❌ Failed to set NFT allowances:', allowanceStatus);
					process.exit(1);
				}
				console.log('✅ NFT allowances set successfully\n');
			}
		}
		catch (error) {
			console.error('❌ Error setting NFT allowances:', error.message);
			process.exit(1);
		}
	}

	await sleep(5000);
	// Wait for allowances to propagate

	// Check NFT token associations with storage contract and calculate extra gas needed
	let tokenAssociationGas = 0;
	if (nftTokens.length > 0) {
		console.log('🔍 Checking NFT token associations with storage contract...');
		for (const nftToken of nftTokens) {
			const tokenIdStr = await convertToHederaId(nftToken, EntityType.TOKEN);
			const balance = await checkMirrorBalance(env, storageId, tokenIdStr);
			if (balance === null) {
				// Token not associated - need extra gas for association
				tokenAssociationGas += 1_000_000;
				console.log(`   ⚠️  ${tokenIdStr} not associated with storage (+1M gas)`);
			}
			else {
				console.log(`   ✅ ${tokenIdStr} already associated with storage`);
			}
		}
		if (tokenAssociationGas > 0) {
			console.log(`   📊 Total association gas to add: +${tokenAssociationGas.toLocaleString()}\n`);
		}
		else {
			console.log();
		}
	}

	// Estimate gas
	console.log('\n⛽ Estimating gas...');
	const fallbackGas = 800000 + tokenAssociationGas;
	const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, 'addPrizePackage', [
		poolId,
		ftToken,
		ftAmount,
		nftTokens,
		nftSerials,
	], fallbackGas, ftToken === '0x0000000000000000000000000000000000000000' ? ftAmount : '0');
	const gasEstimate = gasInfo.gasLimit;

	// Show final gas with association info if applicable
	if (tokenAssociationGas > 0) {
		console.log(`   Gas Estimate: ~${gasEstimate.toLocaleString()}`);
		console.log(`   💡 (Includes +${tokenAssociationGas.toLocaleString()} for ${(tokenAssociationGas / 1_000_000)} token association(s))\n`);
	}
	else {
		console.log(`   Gas: ~${gasEstimate}\n`);
	}

	// Calculate HBAR needed
	const payableAmount = ftToken === '0x0000000000000000000000000000000000000000' ? ftAmount : '0';
	if (payableAmount !== '0') {
		console.log(`💰 HBAR required: ${formatHbar(payableAmount)}\n`);
	}

	// Confirm
	const confirm = await prompt('Proceed with adding prize? (yes/no): ');
	if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
		console.log('\n❌ Operation cancelled');
		process.exit(0);
	}

	// Execute
	console.log('🔄 Adding prize package...');

	const gasLimit = Math.floor(gasEstimate * 1.2);

	const executionResult = await executeContractFunction({
		contractId: contractId,
		iface: lazyLottoIface,
		client: client,
		functionName: 'addPrizePackage',
		params: [poolId, ftToken, ftAmount, nftTokens, nftSerials],
		gas: gasLimit,
		payableAmount: new Hbar(payableAmount, HbarUnit.Tinybar),
	});

	if (!executionResult.success) {
		throw new Error(executionResult.error || 'Transaction execution failed');
	}

	const { receipt, record } = executionResult;

	console.log('\n✅ Prize package added successfully!');
	const txId = receipt.transactionId?.toString() || record?.transactionId?.toString() || 'N/A';
	console.log(`📋 Transaction: ${txId}\n`);
}

async function addMultipleFungiblePrizes(client, lazyLottoIface, poolId, lazyTokenId, lazyGasStationId, storageId) {
	console.log('\n═══════════════════════════════════════════════════════════');
	console.log('  MULTIPLE FUNGIBLE PRIZES');
	console.log('═══════════════════════════════════════════════════════════\n');

	// Get token
	const tokenStr = await prompt('Enter token (0.0.xxxxx or "HBAR"): ');
	let token;

	if (tokenStr.toUpperCase() === 'HBAR') {
		token = '0x0000000000000000000000000000000000000000';

		// Check HBAR balance
		const hbarBalance = await checkMirrorHbarBalance(env, operatorId);
		if (hbarBalance !== null) {
			console.log(`💰 Your HBAR balance: ${new Hbar(hbarBalance, HbarUnit.Tinybar).toString()}\n`);
		}
	}
	else {
		token = convertToEvmAddress(tokenStr);

		// Check FT balance
		const ftBalance = await checkMirrorBalance(env, operatorId, tokenStr);
		if (ftBalance !== null) {
			const tokenDets = await getTokenDetails(env, tokenStr);
			const humanReadable = ftBalance / (10 ** tokenDets.decimals);
			console.log(`💰 Your ${tokenDets.symbol} balance: ${humanReadable} ${tokenDets.symbol}\n`);
		}
	}

	// Get amounts
	const amountsStr = await prompt('Enter amounts (comma-separated, in human-readable units): ');
	const amountsInput = amountsStr.split(',').map(s => s.trim());

	if (amountsInput.length === 0) {
		console.error('❌ Must provide at least one amount');
		process.exit(1);
	}

	// Validate amounts
	for (const amount of amountsInput) {
		if (isNaN(Number(amount)) || Number(amount) <= 0) {
			console.error(`❌ Invalid amount: ${amount}`);
			process.exit(1);
		}
	}

	// Convert amounts based on token decimals
	let amounts;
	if (token === '0x0000000000000000000000000000000000000000') {
		// HBAR: convert to tinybars
		amounts = amountsInput.map(amt => Math.floor(Number(new Hbar(Number(amt), HbarUnit.Hbar).toTinybars())));
	}
	else {
		// FT: get decimals and convert
		const tokenDets = await getTokenDetails(env, tokenStr);
		amounts = amountsInput.map(amt => Math.floor(Number(amt) * (10 ** tokenDets.decimals)));
	}

	const totalAmount = amounts.reduce((sum, amt) => sum + BigInt(amt), BigInt(0));

	// Calculate HBAR needed
	const payableAmount = token === '0x0000000000000000000000000000000000000000' ? totalAmount.toString() : '0';
	if (payableAmount !== '0') {
		console.log(`💰 HBAR required: ${formatHbar(payableAmount)}\n`);
	}

	// Display summary
	console.log('\n═══════════════════════════════════════════════════════════');
	console.log('  PRIZES SUMMARY');
	console.log('═══════════════════════════════════════════════════════════');
	const tokenId = await convertToHederaId(token, EntityType.TOKEN);
	console.log(`  Token:         ${tokenId}`);
	console.log(`  Prize Count:   ${amounts.length}`);
	console.log(`  Total Amount:  ${tokenId === 'HBAR' ? new Hbar(Number(totalAmount), HbarUnit.Tinybar).toString() : totalAmount.toString()}`);
	console.log('═══════════════════════════════════════════════════════════\n');

	// Set allowance if FT prizes (not HBAR) - MUST be done before gas estimation
	if (token !== '0x0000000000000000000000000000000000000000') {
		const prizeTokenId = await convertToHederaId(token, EntityType.TOKEN);
		const isLazy = prizeTokenId === lazyTokenId;
		const spenderId = isLazy ? lazyGasStationId : storageId;
		const spenderIdObj = isLazy ? ContractId.fromString(lazyGasStationId) : ContractId.fromString(storageId);

		console.log('🔐 Setting token allowance...');
		console.log(`   Token: ${prizeTokenId}`);
		console.log(`   Spender: ${spenderId} (${isLazy ? 'LazyGasStation' : 'Storage'})`);
		console.log(`   Total Amount: ${totalAmount.toString()}\n`);

		// get the FT allowance
		const allowanceInPlace = await checkFTAllowances(
			env,
			operatorId,
		);

		// find if the allowance for this token and spender is sufficient
		let sufficientAllowance = false;
		for (const allowance of allowanceInPlace) {
			if (allowance.tokenId === prizeTokenId.toString() && allowance.spenderId === spenderId) {
				if (Number(allowance.amount) >= Number(totalAmount)) {
					sufficientAllowance = true;
					break;
				}
			}
		}

		if (sufficientAllowance) {
			console.log('✅ Sufficient allowance already in place. Skipping allowance setting.\n');
		}
		else {
			try {
				const allowanceStatus = await setFTAllowance(
					client,
					TokenId.fromString(prizeTokenId),
					operatorId,
					spenderIdObj,
					Number(totalAmount),
					`LazyLotto Multi-Prize Pool #${poolId}`,
				);

				if (allowanceStatus !== 'SUCCESS') {
					console.error('❌ Failed to set token allowance:', allowanceStatus);
					process.exit(1);
				}
				console.log('✅ Allowance set successfully\n');
			}
			catch (error) {
				console.error('❌ Error setting allowance:', error.message);
				process.exit(1);
			}
		}
	}

	await sleep(5000);

	// Estimate gas — scale fallback with number of prizes (500k base + 50k per prize)
	const fallbackGas = 500_000 + amounts.length * 50_000;
	console.log('⛽ Estimating gas...');
	const gasInfo = await estimateGas(env, contractId, lazyLottoIface, operatorId, 'addMultipleFungiblePrizes', [
		poolId,
		token,
		amounts,
	], fallbackGas, payableAmount);
	const gasEstimate = gasInfo.gasLimit;
	console.log(`   Gas: ~${gasEstimate.toLocaleString()} (${amounts.length} prizes)\n`);

	// Confirm
	const confirm = await prompt('Proceed with adding prizes? (yes/no): ');
	if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
		console.log('\n❌ Operation cancelled');
		process.exit(0);
	}

	// Execute
	console.log('🔄 Adding prizes...');

	const gasLimit = Math.floor(gasEstimate * 1.2);

	const executionResult = await executeContractFunction({
		contractId: contractId,
		iface: lazyLottoIface,
		client: client,
		functionName: 'addMultipleFungiblePrizes',
		params: [poolId, token, amounts],
		gas: gasLimit,
		payableAmount: new Hbar(payableAmount, HbarUnit.Tinybar),
	});

	if (!executionResult.success) {
		throw new Error(executionResult.error || 'Transaction execution failed');
	}

	const { receipt, record } = executionResult;

	console.log('\n✅ Prizes added successfully!');
	const txId = receipt.transactionId?.toString() || record?.transactionId?.toString() || 'N/A';
	console.log(`📋 Transaction: ${txId}\n`);
}

// Run the script
addPrizePackage();
