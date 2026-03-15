/**
 * Prompt Helpers - Shared readline prompts
 *
 * Replaces the 12-line prompt() function duplicated in 52+ scripts.
 */

const readline = require('readline');

/**
 * Prompt the user for input (async)
 * @param {string} question - The prompt text
 * @returns {Promise<string>} User's answer
 */
function prompt(question) {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

/**
 * Prompt for yes/no confirmation. Supports --yes flag for non-interactive use.
 * @param {string} question - The confirmation prompt
 * @returns {Promise<boolean>} true if confirmed
 */
async function confirm(question) {
	// Support --yes / -y flag for CI/scripting
	if (process.argv.includes('--yes') || process.argv.includes('-y')) {
		return true;
	}

	const answer = await prompt(question);
	return answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y';
}

module.exports = {
	prompt,
	confirm,
};
