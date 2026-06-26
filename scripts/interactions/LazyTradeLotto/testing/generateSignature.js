/**
 * LazyTradeLotto - Generate a systemWallet roll signature (TestNet helper)
 *
 * Produces the ECDSA signature that `rollLotto()` requires. In production this
 * signature is produced by the off-chain Lazy Secure Trade scanner; on TestNet
 * this script lets you sign rolls yourself using the SIGNING_KEY in .env.
 *
 * The contract recovers the signer from:
 *   keccak256(abi.encodePacked(
 *     msg.sender, token, serial, nonce, buyer,
 *     winRateThreshold, minWinAmt, maxWinAmt, jackpotThreshold))
 * wrapped with the EIP-191 personal_sign prefix (ECDSA.toEthSignedMessageHash).
 * The recovered address MUST equal the contract's `systemWallet`.
 *
 * IMPORTANT: the signature binds `msg.sender` (the roller). The account that
 * submits rollLotto MUST be the same address passed as --roller here.
 *
 * Usage:
 *   node scripts/interactions/LazyTradeLotto/testing/generateSignature.js \
 *     --token 0.0.789 --serial 42 --nonce 1000 --buyer true \
 *     --winRate 50000000 --minWin 5 --maxWin 20 --jackpotRate 5000000 \
 *     [--roller 0.0.1234 | 0xabc...] [--rawAmounts]
 *
 * Flags (all support --name value or --name=value):
 *   --token        NFT collection from the trade (0.0.x or 0x EVM address)   [required]
 *   --serial       NFT serial / token id (must be > 0)                        [required]
 *   --nonce        Unique trade nonce (also seeds the PRNG)                   [required]
 *   --buyer        true = caller is buyer, false = seller        [default: true]
 *   --winRate      Regular-win threshold, out of 100,000,000 (=100%)  [default: 50000000]
 *   --minWin       Min regular prize, in WHOLE $LAZY (converted by decimals)  [default: 5]
 *   --maxWin       Max regular prize, in WHOLE $LAZY (converted by decimals)  [default: 20]
 *   --jackpotRate  Jackpot threshold, out of 100,000,000             [default: 5000000]
 *   --roller       Address that will submit the roll (default: .env ACCOUNT_ID)
 *   --rawAmounts   Treat --minWin/--maxWin as raw base units (skip decimal conversion)
 *
 * Env: SIGNING_KEY (ECDSA), ACCOUNT_ID (default roller), LAZY_DECIMALS (default 1)
 */

require('dotenv').config();
const { AccountId, TokenId } = require('@hashgraph/sdk');
const { ethers } = require('ethers');

const MAX_WIN_RATE_THRESHOLD = 100_000_000n;

/**
 * Parse `--name value`, `--name=value` and bare positional args.
 * Returns { flags, positionals }. Flag values are consumed during the walk, so a
 * flag's value (e.g. the 0.0.x after --token) is never mistaken for a positional.
 */
function parseArgs(argv) {
	const flags = {};
	const positionals = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith('--')) {
			positionals.push(a);
			continue;
		}
		const body = a.slice(2);
		const eq = body.indexOf('=');
		if (eq > -1) {
			flags[body.slice(0, eq)] = body.slice(eq + 1);
		}
		else {
			const next = argv[i + 1];
			if (next === undefined || next.startsWith('--')) {
				flags[body] = 'true';
			}
			else {
				flags[body] = next;
				i++;
			}
		}
	}
	return { flags, positionals };
}

/** Back-compat helper: return just the flag map. */
function parseFlags(argv) {
	return parseArgs(argv).flags;
}

const MIRROR = {
	test: 'https://testnet.mirrornode.hedera.com',
	testnet: 'https://testnet.mirrornode.hedera.com',
	main: 'https://mainnet-public.mirrornode.hedera.com',
	mainnet: 'https://mainnet-public.mirrornode.hedera.com',
	preview: 'https://previewnet.mirrornode.hedera.com',
	previewnet: 'https://previewnet.mirrornode.hedera.com',
};

/**
 * Is `accountId` associated with `tokenId`? Returns true/false, or null if the
 * check could not run (no token id or network error). Mirror-node based.
 * A win pays $LAZY to the roller via ERC20 transfer, which reverts on Hedera if
 * the recipient is not associated - so this guards the payout path.
 */
async function isTokenAssociated(env, accountId, tokenId) {
	if (!tokenId) return null;
	try {
		const base = MIRROR[(env || '').toLowerCase()] || MIRROR.test;
		const res = await fetch(`${base}/api/v1/accounts/${accountId}/tokens?token.id=${tokenId}`);
		const data = await res.json();
		return Array.isArray(data.tokens) && data.tokens.length > 0;
	}
	catch {
		return null;
	}
}

/**
 * Decode the roll outcome straight from the transaction record's event logs.
 * Authoritative and immediate - avoids the mirror-node indexing lag that makes
 * before/after getLottoStats diffs unreliable right after a roll.
 * @returns {{winAmount: bigint, jackpotWon: boolean, jackpotAmount: bigint, newJackpotPool: (bigint|null)}}
 */
function parseRollOutcome(record, iface) {
	const out = { winAmount: 0n, jackpotWon: false, jackpotAmount: 0n, newJackpotPool: null };
	const logs = record?.contractFunctionResult?.logs ?? [];
	for (const log of logs) {
		let parsed;
		try {
			parsed = iface.parseLog({
				topics: log.topics.map(t => ethers.hexlify(t)),
				data: ethers.hexlify(log.data),
			});
		}
		catch {
			continue;
		}
		if (!parsed) {
			continue;
		}
		if (parsed.name === 'LottoRoll') {
			out.winAmount = BigInt(parsed.args._winAmount);
		}
		else if (parsed.name === 'JackpotWin') {
			out.jackpotWon = true;
			out.jackpotAmount = BigInt(parsed.args._jackpotAmt);
		}
		else if (parsed.name === 'JackpotUpdate') {
			out.newJackpotPool = BigInt(parsed.args._amount);
		}
	}
	return out;
}

/** Normalise a 0.0.x or 0x.. address to a 0x-prefixed 20-byte EVM address. */
function toEvmAddress(value, label) {
	if (!value) throw new Error(`Missing ${label}`);
	let hex;
	if (value.startsWith('0.0.')) {
		// Hedera id -> long-zero solidity address (token ids and account ids differ in entity type only)
		hex = label === 'token'
			? TokenId.fromString(value).toSolidityAddress()
			: AccountId.fromString(value).toSolidityAddress();
	}
	else {
		hex = value.startsWith('0x') ? value.slice(2) : value;
	}
	if (hex.length !== 40) throw new Error(`${label} is not a 20-byte address: ${value}`);
	return ethers.getAddress(`0x${hex}`);
}

/**
 * Build the EIP-191 signature for a roll. Exported for reuse by rollLottoTest.js.
 * @returns {Promise<{signature: string, params: object}>}
 */
async function buildRollSignature({
	signingKey,
	roller,
	token,
	serial,
	nonce,
	buyer,
	winRateThreshold,
	minWinAmt,
	maxWinAmt,
	jackpotThreshold,
}) {
	const key = signingKey.startsWith('0x') ? signingKey : `0x${signingKey}`;
	const signer = new ethers.Wallet(key);

	const messageHash = ethers.solidityPackedKeccak256(
		['address', 'address', 'uint256', 'uint256', 'bool', 'uint256', 'uint256', 'uint256', 'uint256'],
		[roller, token, serial, nonce, buyer, winRateThreshold, minWinAmt, maxWinAmt, jackpotThreshold],
	);

	// signMessage applies the EIP-191 personal_sign prefix == ECDSA.toEthSignedMessageHash
	const signature = await signer.signMessage(ethers.getBytes(messageHash));

	return {
		signature,
		signerAddress: signer.address,
		messageHash,
		params: { roller, token, serial, nonce, buyer, winRateThreshold, minWinAmt, maxWinAmt, jackpotThreshold },
	};
}

/** Resolve CLI flags + env into fully-typed roll parameters. */
function resolveRollParams(flags) {
	const signingKey = process.env.SIGNING_KEY;
	if (!signingKey) throw new Error('SIGNING_KEY missing from .env (must be an ECDSA key)');

	const lazyDecimals = Number(process.env.LAZY_DECIMALS ?? 1);

	const rollerSrc = flags.roller || process.env.ACCOUNT_ID;
	if (!rollerSrc) throw new Error('No roller: pass --roller or set ACCOUNT_ID in .env');
	const roller = toEvmAddress(rollerSrc, 'roller');

	if (!flags.token) throw new Error('--token is required');
	const token = toEvmAddress(flags.token, 'token');

	const serial = BigInt(flags.serial ?? 0);
	if (serial <= 0n) throw new Error('--serial must be > 0');

	if (flags.nonce === undefined) throw new Error('--nonce is required');
	const nonce = BigInt(flags.nonce);

	const buyer = String(flags.buyer ?? 'true').toLowerCase() === 'true';

	const winRateThreshold = BigInt(flags.winRate ?? 50_000_000);
	const jackpotThreshold = BigInt(flags.jackpotRate ?? 5_000_000);
	if (winRateThreshold > MAX_WIN_RATE_THRESHOLD) throw new Error('--winRate exceeds 100,000,000 (100%)');
	if (jackpotThreshold > MAX_WIN_RATE_THRESHOLD) throw new Error('--jackpotRate exceeds 100,000,000 (100%)');

	const rawAmounts = flags.rawAmounts !== undefined;
	const factor = rawAmounts ? 1n : BigInt(10) ** BigInt(lazyDecimals);
	const minWinAmt = BigInt(flags.minWin ?? 5) * factor;
	const maxWinAmt = BigInt(flags.maxWin ?? 20) * factor;
	if (maxWinAmt === 0n) throw new Error('--maxWin must be > 0');
	if (minWinAmt > maxWinAmt) throw new Error('--minWin cannot exceed --maxWin');

	return { signingKey, lazyDecimals, roller, token, serial, nonce, buyer, winRateThreshold, minWinAmt, maxWinAmt, jackpotThreshold };
}

async function main() {
	const flags = parseFlags(process.argv.slice(2));

	if (flags.h !== undefined || flags.help !== undefined || !flags.token) {
		console.log(fs_help());
		return;
	}

	const p = resolveRollParams(flags);
	const result = await buildRollSignature(p);

	console.log('\n═══════════════════════════════════════════════════════════');
	console.log('        LazyTradeLotto - Roll Signature');
	console.log('═══════════════════════════════════════════════════════════\n');
	console.log('Roller (msg.sender):', p.roller);
	console.log('Token:              ', p.token);
	console.log('Serial:             ', p.serial.toString());
	console.log('Nonce:              ', p.nonce.toString());
	console.log('Buyer:              ', p.buyer);
	console.log('Win Rate Threshold: ', p.winRateThreshold.toString(), `(${Number(p.winRateThreshold) / 1_000_000}% chance)`);
	console.log('Min Win (raw):      ', p.minWinAmt.toString());
	console.log('Max Win (raw):      ', p.maxWinAmt.toString());
	console.log('Jackpot Threshold:  ', p.jackpotThreshold.toString(), `(${Number(p.jackpotThreshold) / 1_000_000}% chance)`);
	console.log('\nRecovered signer:   ', result.signerAddress);
	console.log('  -> this MUST equal the contract systemWallet (check getLottoInfo.js)');
	console.log('\nSignature:');
	console.log(result.signature);
	console.log('\n═══════════════════════════════════════════════════════════\n');
}

function fs_help() {
	return [
		'Usage: generateSignature.js --token <id> --serial <n> --nonce <n> [options]',
		'',
		'  --token <0.0.x|0x..>   NFT collection from the trade            [required]',
		'  --serial <n>           NFT serial (> 0)                          [required]',
		'  --nonce <n>            Unique trade nonce                        [required]',
		'  --buyer <true|false>   Caller is buyer/seller          [default: true]',
		'  --winRate <n>          Win threshold /100,000,000      [default: 50000000]',
		'  --minWin <n>           Min prize in whole $LAZY        [default: 5]',
		'  --maxWin <n>           Max prize in whole $LAZY        [default: 20]',
		'  --jackpotRate <n>      Jackpot threshold /100,000,000  [default: 5000000]',
		'  --roller <0.0.x|0x..>  Roller address (default: .env ACCOUNT_ID)',
		'  --rawAmounts           Treat min/max as raw base units (no decimal scaling)',
		'',
		'Requires SIGNING_KEY (ECDSA) in .env. Output binds msg.sender == roller.',
	].join('\n');
}

module.exports = { buildRollSignature, resolveRollParams, parseArgs, parseFlags, toEvmAddress, isTokenAssociated, parseRollOutcome, MAX_WIN_RATE_THRESHOLD };

if (require.main === module) {
	main()
		.then(() => process.exit(0))
		.catch(error => {
			console.error('ERROR:', error.message);
			process.exit(1);
		});
}
