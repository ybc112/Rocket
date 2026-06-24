const fs = require('node:fs');
const path = require('node:path');
const hre = require('hardhat');

const DEFAULT_FEE_RECIPIENT = '0x8D944D45aa683BCaE0f15c8f1D479fB121aE616c';
const DEFAULT_PANCAKE_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';

function privateKeyRequired() {
  const liveNetwork = !['hardhat', 'localhost'].includes(hre.network.name);
  if (liveNetwork && !process.env.PRIVATE_KEY) {
    throw new Error('Missing PRIVATE_KEY in .env for live deployment.');
  }
}

function readAddress(name, fallback) {
  const value = process.env[name] || fallback;
  if (!hre.ethers.isAddress(value)) {
    throw new Error(`${name} is not a valid address: ${value}`);
  }
  return hre.ethers.getAddress(value);
}

function parseRequiredSuffix() {
  const value = String(process.env.REQUIRED_TOKEN_SUFFIX || process.env.VITE_VANITY_SUFFIX || 'eeee')
    .trim()
    .replace(/^0x/i, '')
    .toLowerCase();
  if (!/^[0-9a-f]{1,4}$/.test(value)) {
    throw new Error('REQUIRED_TOKEN_SUFFIX must be 1-4 hex characters.');
  }
  return Number.parseInt(value, 16);
}

async function maybeVerify(address, constructorArguments, contract) {
  if (process.env.VERIFY_AFTER_DEPLOY !== 'true') return;
  if (!process.env.BSCSCAN_API_KEY) {
    console.log('Skip verify: BSCSCAN_API_KEY is empty.');
    return;
  }

  const confirmations = Number(process.env.VERIFY_CONFIRMATIONS || '5');
  if (confirmations > 0) {
    const startBlock = await hre.ethers.provider.getBlockNumber();
    const targetBlock = startBlock + confirmations;
    console.log(`Waiting ${confirmations} blocks before verification...`);
    while ((await hre.ethers.provider.getBlockNumber()) < targetBlock) {
      await new Promise((resolve) => setTimeout(resolve, 8000));
    }
  }

  await hre.run('verify:verify', {
    address,
    constructorArguments,
    contract,
  });
}

async function main() {
  privateKeyRequired();

  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error('No deployer account available.');

  const feeRecipient = readAddress('FACTORY_FEE_RECEIVER', process.env.FEE_RECIPIENT || DEFAULT_FEE_RECIPIENT);
  const liquidityRouter = readAddress('PANCAKE_ROUTER', process.env.PANCAKE_V2_ROUTER_ADDRESS || DEFAULT_PANCAKE_ROUTER);
  const creationFeeBnb = process.env.FACTORY_CREATION_FEE_BNB || process.env.CREATION_FEE_BNB || '0.005';
  const creationFee = hre.ethers.parseEther(creationFeeBnb);
  const requiredTokenSuffix = parseRequiredSuffix();

  console.log(`Network: ${hre.network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Fee recipient: ${feeRecipient}`);
  console.log(`Liquidity router: ${liquidityRouter}`);
  console.log(`Creation fee: ${creationFeeBnb} BNB (${creationFee.toString()} wei)`);
  console.log(`Required token suffix: 0x${requiredTokenSuffix.toString(16).padStart(4, '0')}`);

  const AppleTokenDeployer = await hre.ethers.getContractFactory('AppleTokenDeployer');
  const tokenDeployer = await AppleTokenDeployer.deploy();
  await tokenDeployer.waitForDeployment();
  const tokenDeployerAddress = await tokenDeployer.getAddress();
  const tokenDeployerTx = tokenDeployer.deploymentTransaction();
  console.log(`AppleTokenDeployer deployed: ${tokenDeployerAddress}`);

  const AppleMintVaultDeployer = await hre.ethers.getContractFactory('AppleMintVaultDeployer');
  const vaultDeployer = await AppleMintVaultDeployer.deploy();
  await vaultDeployer.waitForDeployment();
  const vaultDeployerAddress = await vaultDeployer.getAddress();
  const vaultDeployerTx = vaultDeployer.deploymentTransaction();
  console.log(`AppleMintVaultDeployer deployed: ${vaultDeployerAddress}`);

  const AppleLaunchFactory = await hre.ethers.getContractFactory('AppleLaunchFactory');
  const factory = await AppleLaunchFactory.deploy(
    feeRecipient,
    creationFee,
    liquidityRouter,
    tokenDeployerAddress,
    vaultDeployerAddress,
    requiredTokenSuffix,
  );
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  const factoryTx = factory.deploymentTransaction();
  console.log(`AppleLaunchFactory deployed: ${factoryAddress}`);

  await (await tokenDeployer.setFactory(factoryAddress)).wait();
  await (await vaultDeployer.setFactory(factoryAddress)).wait();
  console.log('Deployers bound to factory.');

  const constructorArguments = [
    feeRecipient,
    creationFee.toString(),
    liquidityRouter,
    tokenDeployerAddress,
    vaultDeployerAddress,
    requiredTokenSuffix,
  ];

  const deploymentRecord = {
    network: hre.network.name,
    chainId: Number((await hre.ethers.provider.getNetwork()).chainId),
    contract: 'AppleLaunchFactory',
    factory: factoryAddress,
    tokenDeployer: tokenDeployerAddress,
    vaultDeployer: vaultDeployerAddress,
    feeRecipient,
    liquidityRouter,
    creationFeeWei: creationFee.toString(),
    creationFeeBnb: hre.ethers.formatEther(creationFee),
    requiredTokenSuffix: `0x${requiredTokenSuffix.toString(16).padStart(4, '0')}`,
    deploymentTx: factoryTx?.hash || '',
    tokenDeployerDeploymentTx: tokenDeployerTx?.hash || '',
    vaultDeployerDeploymentTx: vaultDeployerTx?.hash || '',
    deployer: deployer.address,
    constructorArguments,
    deployedAt: new Date().toISOString(),
    verifyCommand: `npx hardhat verify --network ${hre.network.name} ${factoryAddress} ${constructorArguments.join(' ')}`,
  };

  const outputDir = path.join(process.cwd(), 'deployments');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${hre.network.name}-AppleLaunchFactory.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(deploymentRecord, null, 2)}\n`);
  console.log(`Saved deployment record: ${outputPath}`);

  await maybeVerify(tokenDeployerAddress, [], 'contracts/AppleLaunchDeployers.sol:AppleTokenDeployer');
  await maybeVerify(vaultDeployerAddress, [], 'contracts/AppleLaunchDeployers.sol:AppleMintVaultDeployer');
  await maybeVerify(
    factoryAddress,
    [
      feeRecipient,
      creationFee,
      liquidityRouter,
      tokenDeployerAddress,
      vaultDeployerAddress,
      requiredTokenSuffix,
    ],
    'contracts/AppleLaunchFactory.sol:AppleLaunchFactory',
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
