const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const solc = require('solc');

const root = process.cwd();
const activeSources = [
  'contracts/AppleAuditRegistry.sol',
  'contracts/AppleLaunchFactory.sol',
  'contracts/AppleLaunchDeployers.sol',
  'contracts/AppleMintVault.sol',
  'contracts/AppleToken.sol',
];

const resolvedSources = new Map();

function readSource(file) {
  const content = fs.readFileSync(path.join(root, file), 'utf8');
  resolvedSources.set(file, { content });
  return content;
}

function findImport(importPath) {
  const candidates = [
    path.join(root, importPath),
    path.join(root, 'node_modules', importPath),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const contents = fs.readFileSync(candidate, 'utf8');
      resolvedSources.set(importPath, { content: contents });
      return { contents };
    }
  }

  return { error: `File not found: ${importPath}` };
}

function writeArtifact(sourceName, contractName, compiled, buildInfoPath) {
  const artifact = {
    _format: 'hh-sol-artifact-1',
    contractName,
    sourceName,
    abi: compiled.abi,
    bytecode: `0x${compiled.evm.bytecode.object || ''}`,
    deployedBytecode: `0x${compiled.evm.deployedBytecode.object || ''}`,
    linkReferences: compiled.evm.bytecode.linkReferences || {},
    deployedLinkReferences: compiled.evm.deployedBytecode.linkReferences || {},
  };
  const outputDir = path.join(root, 'artifacts', sourceName);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, `${contractName}.json`),
    `${JSON.stringify(artifact, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(outputDir, `${contractName}.dbg.json`),
    `${JSON.stringify(
      {
        _format: 'hh-sol-dbg-1',
        buildInfo: path.relative(outputDir, buildInfoPath).replace(/\\/g, '/'),
      },
      null,
      2,
    )}\n`,
  );
}

const input = {
  language: 'Solidity',
  sources: Object.fromEntries(
    activeSources.map((sourceName) => [sourceName, { content: readSource(sourceName) }]),
  ),
  settings: {
    viaIR: true,
    evmVersion: 'cancun',
    optimizer: {
      enabled: true,
      runs: 1,
    },
    outputSelection: {
      '*': {
        '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode', 'evm.methodIdentifiers', 'metadata'],
        '': ['ast'],
      },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImport }));
const errors = (output.errors || []).filter((item) => item.severity === 'error');
if (errors.length > 0) {
  for (const error of errors) {
    console.error(error.formattedMessage || error.message);
  }
  process.exitCode = 1;
  return;
}

let count = 0;
const buildInfoInput = {
  ...input,
  sources: Object.fromEntries([...resolvedSources.entries()].sort(([left], [right]) => left.localeCompare(right))),
};
const buildInfo = {
  id: createHash('md5').update(JSON.stringify(buildInfoInput)).update(JSON.stringify(output)).digest('hex'),
  _format: 'hh-sol-build-info-1',
  solcVersion: solc.version().split('+')[0],
  solcLongVersion: solc.version().replace(/\.Emscripten\.clang$/, ''),
  input: buildInfoInput,
  output,
};
const buildInfoDir = path.join(root, 'artifacts', 'build-info');
fs.mkdirSync(buildInfoDir, { recursive: true });
const buildInfoPath = path.join(buildInfoDir, `${buildInfo.id}.json`);
fs.writeFileSync(buildInfoPath, `${JSON.stringify(buildInfo, null, 2)}\n`);

for (const [sourceName, contracts] of Object.entries(output.contracts || {})) {
  if (!sourceName.startsWith('contracts/')) continue;
  for (const [contractName, compiled] of Object.entries(contracts)) {
    writeArtifact(sourceName, contractName, compiled, buildInfoPath);
    count += 1;
  }
}

console.log(`Compiled ${count} launch contract artifacts with solc ${solc.version()}.`);
