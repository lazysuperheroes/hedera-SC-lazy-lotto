const { AccountAllowanceApproveTransaction, AccountId, TokenId } = require('@hashgraph/sdk');
const axios = require('axios');
const readlineSync = require('readline-sync');
const { checkHbarAllowances } = require('../../utils/hederaMirrorHelpers');
const { getEnvConfig, createClient } = require('../../utils/clientFactory');

async function main() {
	const { operatorId, operatorKey, env } = getEnvConfig();
	const client = createClient(env, operatorId, operatorKey);

	console.log('\n-Using ENVIRONMENT:', env);

	console.log('Checking:', operatorId.toString());

	let proceed = readlineSync.keyInYNStrict('Do you want strip all FT allowances?');

	if (proceed) {
		let b = 0;
		const url = `https://testnet.mirrornode.hedera.com/api/v1/accounts/${operatorId.toString()}/allowances/tokens?limit=100`;
		await axios(url).then((res) => {
			const allowances = res.data.allowances;
			// user an outer / inner loop to operate on batches of 20 allowances at a time
			for (let i = 0; i < allowances.length; i += 20) {
				const batch = allowances.slice(i, i + 20);
				const approvalTx =
					new AccountAllowanceApproveTransaction();
				for (let j = 0; j < batch.length; j++) {
					const allowance = batch[j];
					console.log(' -', allowance.owner, 'has allowance of', allowance.amount, 'for token', allowance.token_id, 'to', allowance.spender);
					approvalTx.approveTokenAllowance(TokenId.fromString(allowance.token_id), AccountId.fromString(allowance.owner), AccountId.fromString(allowance.spender), 0);
				}
				approvalTx.setTransactionMemo(`FT allowance reset (batch ${b++})`);
				approvalTx.freezeWith(client);
				approvalTx.execute(client).then((resp) => {
					resp.getReceipt(client).then((receipt) => {
						console.log('Receipt:', receipt.status.toString());
					});
				}).catch((err) => {
					console.error(err);
				});
			}
		}).catch(function (err) {
			console.error('Error Finding allowances', err);
		});
	}

	// ask on hbar allowances
	proceed = readlineSync.keyInYNStrict('Do you want strip all hbar allowances?');

	if (!proceed) {
		process.exit(0);
	}

	const hbarAllowances = await checkHbarAllowances(env, operatorId.toString());

	if (hbarAllowances.length === 0) {
		console.log('No HBAR allowances found');
		process.exit(0);
	}

	let b = 0;

	for (let i = 0; i < hbarAllowances.length; i += 20) {
		const batch = hbarAllowances.slice(i, i + 20);
		const approvalTx = new AccountAllowanceApproveTransaction();
		for (let j = 0; j < batch.length; j++) {
			const allowance = batch[j];
			console.log(' -', allowance.owner, 'has allowance of', allowance.amount, 'for HBAR to', allowance.spender);
			approvalTx.approveHbarAllowance(AccountId.fromString(allowance.owner), AccountId.fromString(allowance.spender), 0);
		}
		approvalTx.setTransactionMemo(`HBAR allowance reset (batch ${b++})`);
		approvalTx.freezeWith(client);
		approvalTx.execute(client).then((resp) => {
			resp.getReceipt(client).then((receipt) => {
				console.log('Receipt:', receipt.status.toString());
			});
		}).catch((err) => {
			console.error(err);
		});
	}

	// check if NFT all all needs to be removed using: https://mainnet-public.mirrornode.hedera.com/api/v1/accounts/${owner}/allowances/nfts?limit=100`;

	proceed = readlineSync.keyInYNStrict('Do you want strip "allow all" NFT allowances?');

	if (!proceed) {
		process.exit(0);
	}

	b = 0;
	const url = `https://testnet.mirrornode.hedera.com/api/v1/accounts/${operatorId.toString()}/allowances/nfts?limit=100`;
	await axios(url).then((res) => {
		const allowances = res.data.allowances;
		// user an outer / inner loop to operate on batches of 20 allowances at a time
		for (let i = 0; i < allowances.length; i += 20) {
			const batch = allowances.slice(i, i + 20);
			const approvalTx =
				new AccountAllowanceApproveTransaction();
			for (let j = 0; j < batch.length; j++) {
				const allowance = batch[j];
				console.log(' -', allowance.owner, 'has approved_for_all', allowance.approved_for_all, 'for token', allowance.token_id, 'to', allowance.spender);
				approvalTx.deleteTokenNftAllowanceAllSerials(
					allowance.token_id,
					allowance.owner,
					allowance.spender,
				);
			}
			approvalTx.setTransactionMemo(`NFT allowance removal (batch ${b++})`);
			approvalTx.freezeWith(client);
			approvalTx.execute(client).then((resp) => {
				resp.getReceipt(client).then((receipt) => {
					console.log('Receipt:', receipt.status.toString());
				});
			}).catch((err) => {
				console.error(err);
			});
		}
	}).catch(function (err) {
		console.error('Error Finding allowances', err);
	});
}

main();