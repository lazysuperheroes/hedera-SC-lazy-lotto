// get a list of files in the ../../artifacts/contracts/ directory
// read in the files and extract the .abi element from the JSON
// write the .abi to a file in the ../../abi/ directory using the same name as the contract
// then regenerate the bundler-friendly abi/*.js wrappers from the JSON sources

const fs = require('fs');
const path = require('path');
const { buildAbis } = require('../build-abis');

const contractDir = './artifacts/contracts/';
const abiDir = './abi/';

// check if the abi directory exists
if (!fs.existsSync(abiDir)) {
	fs.mkdirSync(abiDir);
}

const files = fs.readdirSync(contractDir);

const cwd = process.cwd();

files.forEach((file) => {
	// check the file ends in .sol
	if (!file.endsWith('.sol')) {
		return;
	}
	const abiFileName = file.split('.')[0] + '.json';
	const readPath = path.join(cwd, contractDir, file, abiFileName);

	const contractJSON = JSON.parse(
		fs.readFileSync(
			readPath,
		),
	);
	const abi = contractJSON.abi;
	const writePath = path.join(cwd, abiDir, abiFileName);

	fs.writeFileSync(
		writePath,
		JSON.stringify(abi, null, 4),
	);
},
);

// Regenerate the bundler-friendly .js wrappers so consumers via webpack /
// Rollup / esbuild / Vite / Next.js / serverless platforms can resolve the
// ABIs through static require() instead of runtime fs.readFileSync.
const generated = buildAbis(path.join(cwd, abiDir));
console.log(`Generated ${generated.length} ABI module wrapper(s).`);
