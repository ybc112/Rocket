require("dotenv").config();

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const { AbiCoder, Contract, JsonRpcProvider, getAddress, isAddress } = require("ethers");

const rootDir = process.cwd();
const factoryArtifact = readJson("artifacts/contracts/AppleLaunchFactory.sol/AppleLaunchFactory.json");
const tokenAbi = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
];

const networkName = process.env.VERIFY_NETWORK || "bsc";
const deployment = readFirstJson(
  [
    "deployments/bsc-AppleLaunchFactory.json",
    "deployments/bsc.json",
    "deployments/hardhat-AppleLaunchFactory.json",
  ],
  {},
);
const factoryAddress = readAddress(
  process.env.FACTORY_ADDRESS ||
    process.env.PEPE_FACTORY_ADDRESS ||
    process.env.APPLE_FACTORY_ADDRESS ||
    process.env.VITE_FACTORY_CONTRACT ||
    process.env.VITE_LAUNCHPAD_FACTORY_ADDRESS ||
    deployment.factory ||
    "",
  "FACTORY_ADDRESS or VITE_FACTORY_CONTRACT",
);
const tokenAddress = readTokenAddress();
const rpcUrl =
  process.env.BSC_RPC_URL ||
  process.env.PEPE_RPC_URL ||
  process.env.APPLE_RPC_URL ||
  (networkName === "bscTestnet" ? process.env.BSC_TESTNET_RPC_URL : "") ||
  "https://bsc.publicnode.com";
const chainId = Number(process.env.PEPE_CHAIN_ID || process.env.APPLE_CHAIN_ID || process.env.VITE_CHAIN_ID || (networkName === "bscTestnet" ? 97 : 56));
const provider = new JsonRpcProvider(rpcUrl, chainId);
const factory = new Contract(factoryAddress, factoryArtifact.abi, provider);

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const project = await factory.getProject(tokenAddress);
  if (String(project.token).toLowerCase() !== tokenAddress.toLowerCase()) {
    throw new Error(`Token ${tokenAddress} is not indexed in Factory ${factoryAddress}.`);
  }

  const liquidityRouter = await factory.liquidityRouter();
  const token = new Contract(tokenAddress, tokenAbi, provider);
  const [name, symbol] = await Promise.all([token.name(), token.symbol()]);
  const tokenConstructorArgs = [
    [
      name,
      symbol,
      project.metadataUri,
      project.templateId,
      project.receiver,
      project.platformFeeReceiver,
      project.paymentToken,
      project.rewardToken,
      project.rewardThreshold,
      project.totalSupply,
    ],
    [
      project.buyTaxBps,
      project.sellTaxBps,
      project.transferTaxBps,
      project.addLiquidityTaxBps,
      project.removeLiquidityTaxBps,
      project.launchProtectionTaxBps,
      project.launchProtectionBlocks,
      project.claimWait,
      project.fundFeeBps,
      project.lpFeeBps,
      project.dividendFeeBps,
      project.burnFeeBps,
    ],
    factoryAddress,
  ];
  const vaultConstructorArgs = [
    tokenAddress,
    liquidityRouter,
    project.paymentToken,
    project.creator,
    project.receiver,
    project.totalSupply,
    project.mintCount,
    project.mintPrice,
    project.maxMintPerWallet || 0n,
    project.whitelistMintCount,
    project.whitelistEnabled,
    project.liquidityTokenBps,
  ];

  console.log("Verifying project contracts");
  console.log("Network:", networkName);
  console.log("Factory:", factoryAddress);
  console.log("Token:", tokenAddress);
  console.log("Vault:", project.vault);

  const argsDir = path.join(rootDir, "work", "verify-args", tokenAddress.toLowerCase());
  fs.mkdirSync(argsDir, { recursive: true });
  const tokenArgsPath = path.join(argsDir, "token.cjs");
  const vaultArgsPath = path.join(argsDir, "vault.cjs");
  writeArgsFile(tokenArgsPath, tokenConstructorArgs);
  writeArgsFile(vaultArgsPath, vaultConstructorArgs);

  await verifyOne({
    address: tokenAddress,
    constructorArgs: tokenConstructorArgs,
    constructorArgsPath: tokenArgsPath,
    contract: "contracts/AppleToken.sol:AppleToken",
    label: "Token",
  });
  await verifyOne({
    address: project.vault,
    constructorArgs: vaultConstructorArgs,
    constructorArgsPath: vaultArgsPath,
    contract: "contracts/AppleMintVault.sol:AppleMintVault",
    label: "Vault",
  });
}

function readTokenAddress() {
  const cliValue = process.argv.find((arg) => isAddress(arg));
  return readAddress(process.env.PROJECT_TOKEN || cliValue || "", "PROJECT_TOKEN");
}

async function verifyOne({ address, constructorArgs, constructorArgsPath, contract, label }) {
  console.log(`Verifying ${label}: ${address}`);
  if (process.env.BSCSCAN_API_KEY || process.env.ETHERSCAN_API_KEY) {
    try {
      await verifyWithEtherscanV2({ address, constructorArgs, contract, label });
      return;
    } catch (error) {
      console.warn(`Etherscan v2 verify failed for ${label}; retrying with Hardhat verify.`);
      console.warn(error instanceof Error ? error.message : String(error));
    }
  }

  try {
    await runCommand("npx", [
      "hardhat",
      "--config",
      "hardhat.config.cjs",
      "verify",
      "--network",
      networkName,
      "--contract",
      contract,
      "--constructor-args",
      constructorArgsPath,
      address,
    ]);
  } catch (error) {
    throw error;
  }
}

async function verifyWithEtherscanV2({ address, constructorArgs, contract, label }) {
  const [sourceName, contractName] = contract.split(":");
  const artifactPath = path.join(rootDir, "artifacts", sourceName, `${contractName}.json`);
  const dbgPath = path.join(rootDir, "artifacts", sourceName, `${contractName}.dbg.json`);
  const artifact = readJson(path.relative(rootDir, artifactPath));
  const dbg = readJson(path.relative(rootDir, dbgPath));
  const buildInfoRef = String(dbg.buildInfo || "").replace(/\\/g, "/");
  const buildInfoPath = path.resolve(path.dirname(dbgPath), buildInfoRef);
  const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, "utf8"));
  const compilerVersion = String(buildInfo.solcLongVersion || "").startsWith("v")
    ? buildInfo.solcLongVersion
    : `v${buildInfo.solcLongVersion}`;
  const encodedArgs = encodeConstructorArgs(artifact.abi, constructorArgs);
  const apiUrl =
    process.env.ETHERSCAN_V2_API_URL ||
    process.env.BSCSCAN_API_URL ||
    "https://api.etherscan.com/v2/api";
  const apiKey = process.env.ETHERSCAN_API_KEY || process.env.BSCSCAN_API_KEY || "";
  const verifyChainId = String(process.env.ETHERSCAN_CHAIN_ID || process.env.BSCSCAN_CHAIN_ID || chainId);
  const apiQuery = { chainid: verifyChainId };

  const submit = await requestJson({
    method: "POST",
    url: apiUrl,
    query: apiQuery,
    body: {
      module: "contract",
      action: "verifysourcecode",
      apikey: apiKey,
      contractaddress: address,
      sourceCode: JSON.stringify(buildInfo.input),
      codeformat: "solidity-standard-json-input",
      contractname: contract,
      compilerversion: compilerVersion,
      optimizationUsed: "1",
      runs: "1",
      constructorArguements: encodedArgs,
      licenseType: "3",
    },
  });

  if (submit.status !== "1") {
    const result = String(submit.result || "");
    if (/already verified/i.test(result)) {
      console.log(`${label} already verified.`);
      return;
    }
    throw new Error(`Etherscan v2 submit failed for ${label}: ${submit.message || ""} ${result}`);
  }

  const guid = String(submit.result || "");
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    await delay(6000);
    const status = await requestJson({
      method: "GET",
      url: apiUrl,
      query: {
        ...apiQuery,
        module: "contract",
        action: "checkverifystatus",
        apikey: apiKey,
        guid,
      },
    });
    const result = String(status.result || "");
    if (status.status === "1" || /pass - verified|already verified/i.test(result)) {
      console.log(`${label} verified with Etherscan v2.`);
      return;
    }
    if (/pending in queue|in progress/i.test(result)) {
      continue;
    }
    throw new Error(`Etherscan v2 verify failed for ${label}: ${status.message || ""} ${result}`);
  }

  throw new Error(`Etherscan v2 verify timed out for ${label}.`);
}

function encodeConstructorArgs(abi, args) {
  const constructor = abi.find((item) => item.type === "constructor");
  const inputs = constructor?.inputs || [];
  if (inputs.length === 0) {
    return "";
  }
  return AbiCoder.defaultAbiCoder().encode(inputs.map(abiParamType), args).replace(/^0x/, "");
}

function abiParamType(input) {
  if (String(input.type).startsWith("tuple")) {
    const suffix = String(input.type).slice("tuple".length);
    return `(${(input.components || []).map(abiParamType).join(",")})${suffix}`;
  }
  return input.type;
}

function requestJson({ method, url, query = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") {
        target.searchParams.set(key, String(value));
      }
    }
    const payload = body ? new URLSearchParams(body).toString() : "";
    const request = https.request(
      target,
      {
        method,
        headers: payload
          ? {
              "content-type": "application/x-www-form-urlencoded",
              "content-length": Buffer.byteLength(payload),
            }
          : {},
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(raw));
          } catch {
            reject(new Error(`Invalid explorer response: ${raw.slice(0, 240)}`));
          }
        });
      },
    );
    request.on("error", reject);
    request.setTimeout(120000, () => request.destroy(new Error("Explorer request timed out.")));
    if (payload) {
      request.write(payload);
    }
    request.end();
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeArgsFile(filePath, args) {
  const normalized = JSON.stringify(args, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
  fs.writeFileSync(filePath, `module.exports = ${normalized};\n`);
}

function readAddress(value, label) {
  if (!isAddress(String(value || ""))) {
    throw new Error(`${label} is invalid: ${value}`);
  }
  return getAddress(value);
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(rootDir, filePath), "utf8"));
  } catch {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error(`Missing ${filePath}. Run npm run hardhat:compile first.`);
  }
}

function readFirstJson(filePaths, fallback) {
  for (const filePath of filePaths) {
    const value = readJson(filePath, null);
    if (value) {
      return value;
    }
  }
  return fallback;
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const logs = [];
    const child = spawn(command, args, {
      cwd: rootDir,
      env: process.env,
      shell: process.platform === "win32",
    });

    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      logs.push(text);
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      logs.push(text);
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const output = logs.join("");
      if (/already verified|already been verified|contract source code already verified/i.test(output)) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}
