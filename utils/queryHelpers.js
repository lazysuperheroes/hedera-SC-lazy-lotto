/**
 * Query Helpers - One-line contract queries
 *
 * Replaces the 3-line encode/call/decode pattern repeated hundreds of times:
 *   let encoded = iface.encodeFunctionData('foo', params);
 *   let result = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
 *   let decoded = iface.decodeFunctionResult('foo', result);
 */

const { readOnlyEVMFromMirrorNode, batchMirrorQuery } = require('./solidityHelpers');

/**
 * Execute a read-only contract query via mirror node in one call.
 *
 * @param {string} env - Environment (testnet, mainnet, etc.)
 * @param {ContractId} contractId - Contract to query
 * @param {ethers.Interface} iface - Contract interface
 * @param {string} fnName - Function name to call
 * @param {Array} [params=[]] - Function parameters
 * @param {AccountId|string} from - Account making the query
 * @param {Object} [options] - Additional options
 * @param {boolean} [options.estimate=false] - Whether to estimate gas
 * @param {number} [options.gas=300000] - Gas limit
 * @param {number} [options.value=0] - HBAR value in tinybars
 * @returns {Promise<ethers.Result>} Decoded function result
 */
async function queryContract(env, contractId, iface, fnName, params = [], from, options = {}) {
	const { estimate = false, gas = 300_000, value = 0 } = options;

	const encoded = iface.encodeFunctionData(fnName, params);
	const result = await readOnlyEVMFromMirrorNode(env, contractId, encoded, from, estimate, gas, value);
	return iface.decodeFunctionResult(fnName, result);
}

/**
 * Execute multiple read-only queries in parallel via mirror node.
 *
 * @param {string} env - Environment
 * @param {ethers.Interface} iface - Contract interface (shared across all queries)
 * @param {Array<{contractId: ContractId, fnName: string, params?: Array, label?: string}>} queries
 * @param {AccountId|string} from - Account making the queries
 * @param {Object} [options] - Options passed to batchMirrorQuery
 * @returns {Promise<Array<{decoded: ethers.Result|null, error: Error|null, label?: string}>>}
 */
async function batchQueryContract(env, iface, queries, from, options = {}) {
	const batchQueries = queries.map(q => ({
		contractId: q.contractId,
		encoded: iface.encodeFunctionData(q.fnName, q.params || []),
		label: q.label || q.fnName,
	}));

	const results = await batchMirrorQuery(env, batchQueries, from, options);

	return results.map((r, idx) => {
		if (r.error || !r.result) {
			return { decoded: null, error: r.error, label: r.label };
		}
		try {
			const decoded = iface.decodeFunctionResult(queries[idx].fnName, r.result);
			return { decoded, error: null, label: r.label };
		}
		catch (err) {
			return { decoded: null, error: err, label: r.label };
		}
	});
}

module.exports = {
	queryContract,
	batchQueryContract,
};
