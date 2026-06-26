import "dotenv/config";

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  Wallet,
  ZeroAddress,
  getAddress,
  hexlify,
  id,
  isAddress,
  keccak256,
  randomBytes,
} from "ethers";
import { keccak_256 } from "@noble/hashes/sha3.js";

const rootDir = process.cwd();
const deployment = readFirstJson(
  [
    "deployments/bsc-AppleLaunchFactory.json",
    "deployments/bsc.json",
    "deployments/hardhat-AppleLaunchFactory.json",
  ],
  {},
);
const factoryArtifact = readJson("artifacts/contracts/AppleLaunchFactory.sol/AppleLaunchFactory.json");
const tokenArtifact = readJson("artifacts/contracts/AppleToken.sol/AppleToken.json");
const factorySource =
  process.env.PEPE_FACTORY_ADDRESS ||
  process.env.APPLE_FACTORY_ADDRESS ||
  process.env.VITE_FACTORY_CONTRACT ||
  process.env.FACTORY_ADDRESS ||
  process.env.VITE_LAUNCHPAD_FACTORY_ADDRESS ||
  deployment.factory ||
  "";

if (!isAddress(factorySource)) {
  throw new Error("Missing PEPE_FACTORY_ADDRESS or VITE_FACTORY_CONTRACT for PEPE backend.");
}

const chainId = Number(process.env.PEPE_CHAIN_ID || process.env.APPLE_CHAIN_ID || process.env.VITE_CHAIN_ID || 56);
const rpcUrl = process.env.PEPE_RPC_URL || process.env.APPLE_RPC_URL || process.env.BSC_RPC_URL || "https://bsc.publicnode.com";
const factoryAddress = getAddress(factorySource);
const provider = new JsonRpcProvider(rpcUrl, chainId);
const factory = new Contract(factoryAddress, factoryArtifact.abi, provider);
const port = Number(process.env.PEPE_BACKEND_PORT || process.env.APPLE_BACKEND_PORT || 8787);
const backendToken = process.env.PEPE_BACKEND_TOKEN || process.env.APPLE_BACKEND_TOKEN || "";
const autoVerify = process.env.AUTO_VERIFY_PROJECTS !== "false";
const autoProcess = process.env.AUTO_PROCESS_PROJECTS === "true";
const pollMs = Number(process.env.VERIFY_POLL_MS || 30000);
const autoProcessPollMs = Number(process.env.AUTO_PROCESS_POLL_MS || 60000);
const autoProcessGasLimit = BigInt(process.env.AUTO_PROCESS_GAS_LIMIT || 1800000);
const autoProcessMinNative = 0n;
const backfillCount = Number(process.env.VERIFY_BACKFILL_COUNT || 12);
const verifyInitialDelayMs = Number(process.env.VERIFY_INITIAL_DELAY_MS || 20000);
const verifyRetryDelayMs = Number(process.env.VERIFY_RETRY_DELAY_MS || 60000);
const verifyRetryLimit = Number(process.env.VERIFY_RETRY_LIMIT || 5);
const rateWindowMs = Number(process.env.PEPE_RATE_WINDOW_MS || process.env.APPLE_RATE_WINDOW_MS || 60000);
const verifyRateLimit = Number(process.env.PEPE_VERIFY_RATE_LIMIT || process.env.APPLE_VERIFY_RATE_LIMIT || 30);
const vanityRateLimit = Number(process.env.PEPE_VANITY_RATE_LIMIT || process.env.APPLE_VANITY_RATE_LIMIT || 8);
const assetRateLimit = Number(process.env.PEPE_ASSET_RATE_LIMIT || process.env.APPLE_ASSET_RATE_LIMIT || 20);
const vanityWorkerCount = Math.max(
  1,
  Math.min(Number(process.env.VANITY_WORKERS || os.availableParallelism?.() || 1), 4),
);
const assetDir = path.resolve(process.env.PEPE_ASSET_DIR || process.env.APPLE_ASSET_DIR || path.join(rootDir, "work", "assets"));
const jobs = new Map();
const rateBuckets = new Map();
let lastTokenCount = 0;
let verifying = false;
let keeperInitError = "";
const keeperPrivateKey = String(process.env.KEEPER_PRIVATE_KEY || process.env.PRIVATE_KEY || "").trim();
const keeperWallet = createKeeperWallet(keeperPrivateKey);
const keeperStatus = {
  enabled: autoProcess,
  ready: Boolean(keeperWallet),
  running: false,
  pollMs: autoProcessPollMs,
  minNativeWei: autoProcessMinNative.toString(),
  lastRunAt: "",
  lastError: keeperInitError,
  lastChecked: 0,
  lastProcessed: 0,
  lastTx: "",
};

const server = createServer(async (request, response) => {
  try {
    setCors(response);
    if (request.method === "OPTIONS") {
      sendJson(response, 204, {});
      return;
    }

    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        chainId,
        factory: factoryAddress,
        requiredTokenSuffix: await readFactoryRequiredSuffix(),
        autoVerify,
        verifierReady: Boolean(process.env.BSCSCAN_API_KEY),
        autoProcess,
        keeperReady: Boolean(keeperWallet),
        keeper: keeperStatus,
        queued: [...jobs.values()].filter((job) => job.status === "queued").length,
        running: [...jobs.values()].filter((job) => job.status === "running").length,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/verify-status") {
      const token = normalizeAddress(url.searchParams.get("token") || "");
      sendJson(response, 200, { token, job: jobs.get(token.toLowerCase()) || null });
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/assets/")) {
      await sendAsset(response, url.pathname);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/assets") {
      limitRequest(request, "asset", assetRateLimit);
      const body = await readBody(request);
      const asset = await saveDataUrlAsset(body.dataUrl, request);
      sendJson(response, 201, { ok: true, ...asset });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/verify-project") {
      limitRequest(request, "verify", verifyRateLimit);
      const body = await readBody(request);
      const token = normalizeAddress(body.token);
      await assertFactoryProject(token);
      queueVerify(token, "api");
      sendJson(response, 202, { ok: true, token, job: jobs.get(token.toLowerCase()) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/vanity-salt") {
      limitRequest(request, "vanity", vanityRateLimit);
      requireToken(request);
      const body = await readBody(request);
      sendJson(response, 200, await findVanitySalt(body));
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, () => {
  console.log(`PEPE backend listening on :${port}`);
  console.log(`Factory: ${factoryAddress}`);
  console.log(`RPC: ${rpcUrl}`);
  if (autoVerify) {
    void syncProjects(true);
    setInterval(() => void syncProjects(false), pollMs);
  }
  if (autoProcess) {
    if (keeperWallet) {
      void runAutoProcessCycle();
      setInterval(() => void runAutoProcessCycle(), autoProcessPollMs);
    } else {
      console.warn("Auto process keeper is enabled but KEEPER_PRIVATE_KEY/PRIVATE_KEY is not configured.");
    }
  }
});

async function syncProjects(backfill) {
  try {
    const count = Number(await factory.allTokensLength());
    const start = backfill ? Math.max(0, count - backfillCount) : lastTokenCount;
    for (let index = start; index < count; index += 1) {
      const token = getAddress(await factory.allTokens(index));
      queueVerify(token, backfill ? "backfill" : "monitor");
    }
    lastTokenCount = count;
  } catch (error) {
    console.error("Project sync failed:", error instanceof Error ? error.message : error);
  }
}

function createKeeperWallet(privateKey) {
  if (!autoProcess || !privateKey) {
    return null;
  }

  try {
    return new Wallet(privateKey, provider);
  } catch (error) {
    keeperInitError = error instanceof Error ? error.message : String(error);
    console.error("Auto process keeper key is invalid:", keeperInitError);
    return null;
  }
}

async function runAutoProcessCycle() {
  if (!autoProcess || !keeperWallet || keeperStatus.running) {
    return;
  }

  keeperStatus.running = true;
  keeperStatus.lastRunAt = new Date().toISOString();
  keeperStatus.lastChecked = 0;
  keeperStatus.lastProcessed = 0;
  let lastError = "";

  try {
    const count = Number(await factory.allTokensLength());
    for (let index = 0; index < count; index += 1) {
      const tokenAddress = getAddress(await factory.allTokens(index));
      keeperStatus.lastChecked += 1;

      try {
        const token = new Contract(tokenAddress, tokenArtifact.abi, keeperWallet);
        const processState = await readTokenProcessState(token);
        if (!processState.ready) {
          continue;
        }

        const overrides = autoProcessGasLimit > 0n ? { gasLimit: autoProcessGasLimit } : {};
        const tx = await token.processTaxTokens(overrides);
        keeperStatus.lastTx = tx.hash;
        await tx.wait(1);
        keeperStatus.lastProcessed += 1;
      } catch (error) {
        lastError = `${tokenAddress}: ${error instanceof Error ? error.message : String(error)}`;
        console.error("Auto process token failed:", lastError);
      }
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    console.error("Auto process cycle failed:", lastError);
  } finally {
    keeperStatus.lastError = lastError;
    keeperStatus.running = false;
  }
}

async function readTokenProcessState(token) {
  const [
    tradingEnabled,
    lastAutoBuybackAt,
    pendingPlatformNative,
    pendingMarketingNative,
    pendingAutoBuybackNative,
    pendingAutoRewardNative,
    tokensForPlatform,
    tokensForMarketing,
    tokensForLiquidity,
    tokensForDividends,
    tokensForBuybackBurn,
    swapThreshold,
  ] = await Promise.all([
    readContractBool(token, "tradingEnabled", false),
    readContractBigInt(token, "lastAutoBuybackAt"),
    readContractBigInt(token, "pendingPlatformNative"),
    readContractBigInt(token, "pendingMarketingNative"),
    readContractBigInt(token, "pendingAutoBuybackNative"),
    readContractBigInt(token, "pendingAutoRewardNative"),
    readContractBigInt(token, "tokensForPlatform"),
    readContractBigInt(token, "tokensForMarketing"),
    readContractBigInt(token, "tokensForLiquidity"),
    readContractBigInt(token, "tokensForDividends"),
    readContractBigInt(token, "tokensForBuybackBurn"),
    readContractBigInt(token, "swapThreshold"),
  ]);

  if (!tradingEnabled) {
    return { ready: false };
  }

  const pendingNative =
    pendingPlatformNative + pendingMarketingNative + pendingAutoBuybackNative + pendingAutoRewardNative;
  const feeTokens =
    tokensForPlatform + tokensForMarketing + tokensForLiquidity + tokensForDividends + tokensForBuybackBurn;
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  const intervalReady = lastAutoBuybackAt === 0n || nowSeconds >= lastAutoBuybackAt + 60n;
  const nativeReady = pendingNative > 0n && pendingNative >= autoProcessMinNative && intervalReady;
  const taxSwapReady = swapThreshold > 0n && feeTokens >= swapThreshold;

  return {
    ready: nativeReady || taxSwapReady,
    pendingNative,
    feeTokens,
  };
}

async function readContractBigInt(contract, method, fallback = 0n) {
  try {
    return BigInt(await contract[method]());
  } catch {
    return fallback;
  }
}

async function readContractBool(contract, method, fallback = false) {
  try {
    return Boolean(await contract[method]());
  } catch {
    return fallback;
  }
}

function queueVerify(token, source) {
  const key = token.toLowerCase();
  const current = jobs.get(key);
  if (current && ["queued", "running", "success"].includes(current.status)) {
    return;
  }

  jobs.set(key, {
    token,
    source,
    status: "queued",
    attempts: 0,
    logs: [],
    nextRunAt: source === "backfill" ? "" : new Date(Date.now() + verifyInitialDelayMs).toISOString(),
    updatedAt: new Date().toISOString(),
  });
  void drainVerifyQueue();
}

async function drainVerifyQueue() {
  if (verifying) {
    return;
  }
  verifying = true;

  try {
    while (true) {
      const now = Date.now();
      const queuedJobs = [...jobs.values()].filter((item) => item.status === "queued");
      const job = queuedJobs.find((item) => !item.nextRunAt || Date.parse(item.nextRunAt) <= now);
      if (!job) {
        const nextRunAt = queuedJobs
          .map((item) => (item.nextRunAt ? Date.parse(item.nextRunAt) : now))
          .filter((time) => Number.isFinite(time))
          .sort((left, right) => left - right)[0];
        if (nextRunAt) {
          setTimeout(() => void drainVerifyQueue(), Math.max(1000, nextRunAt - now));
        }
        return;
      }

      job.status = "running";
      job.nextRunAt = "";
      job.updatedAt = new Date().toISOString();

      try {
        const logs = await runVerify(job.token);
        job.status = "success";
        job.logs = logs;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        job.attempts = Number(job.attempts || 0) + 1;
        job.logs = [message];
        if (job.attempts < verifyRetryLimit) {
          job.status = "queued";
          job.nextRunAt = new Date(Date.now() + verifyRetryDelayMs * job.attempts).toISOString();
        } else {
          job.status = "error";
          job.nextRunAt = "";
        }
      }
      job.updatedAt = new Date().toISOString();
    }
  } finally {
    verifying = false;
  }
}

function runVerify(token) {
  return new Promise((resolve, reject) => {
    const logs = [];
    const child = spawn("npm", ["run", "contracts:verify:project"], {
      cwd: rootDir,
      env: {
        ...process.env,
        PROJECT_TOKEN: token,
        FACTORY_ADDRESS: factoryAddress,
        PEPE_FACTORY_ADDRESS: factoryAddress,
        APPLE_FACTORY_ADDRESS: factoryAddress,
        BSC_RPC_URL: rpcUrl,
        PEPE_RPC_URL: rpcUrl,
        APPLE_RPC_URL: rpcUrl,
      },
      shell: process.platform === "win32",
    });

    child.stdout.on("data", (chunk) => logs.push(String(chunk)));
    child.stderr.on("data", (chunk) => logs.push(String(chunk)));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(logs.slice(-80));
        return;
      }

      reject(new Error(logs.join("") || `verify exited with code ${code}`));
    });
  });
}

async function findVanitySalt(body) {
  const requestedSuffix = String(body.suffix || process.env.VITE_VANITY_SUFFIX || "8888")
    .toLowerCase()
    .replace(/^0x/, "");
  const factoryRequiredSuffix = await readFactoryRequiredSuffix();
  const suffix = factoryRequiredSuffix || requestedSuffix;
  if (!/^[0-9a-f]{1,6}$/.test(suffix)) {
    throw new Error("suffix must be 1-6 hex characters.");
  }
  if (factoryRequiredSuffix && requestedSuffix.padStart(factoryRequiredSuffix.length, "0") !== factoryRequiredSuffix) {
    throw new Error(`factory requires token suffix ${factoryRequiredSuffix}.`);
  }

  const creator = normalizeAddress(body.creator);
  const params = normalizeLaunchParams(body.params || {});
  const maxIterations = clampIterations(body.maxIterations);
  const tokenFactory = new ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode);
  const rewardToken =
    params.rewardToken === ZeroAddress
      ? process.env.DEFAULT_REWARD_TOKEN || "0xbA2aE424d960c26247Dd6c32edC70B295c744C43"
      : params.rewardToken;
  const [platformFeeReceiver, tokenDeployer] = await Promise.all([
    factory.feeRecipient().then((value) => getAddress(value)),
    factory.tokenDeployer().then((value) => getAddress(value)),
  ]);
  const deployTx = await tokenFactory.getDeployTransaction(
    {
      name: params.name,
      symbol: params.symbol,
      projectUri: params.metadataUri,
      templateId: params.templateId,
      receiver: params.receiver,
      platformFeeReceiver,
      paymentToken: params.paymentToken,
      rewardToken,
      rewardThreshold: params.rewardThreshold,
      totalSupply: params.totalSupply,
    },
    {
      buyTaxBps: params.buyTaxBps,
      sellTaxBps: params.sellTaxBps,
      transferTaxBps: params.transferTaxBps,
      addLiquidityTaxBps: params.addLiquidityTaxBps,
      removeLiquidityTaxBps: params.removeLiquidityTaxBps,
      launchProtectionTaxBps: params.launchProtectionTaxBps,
      launchProtectionBlocks: params.launchProtectionBlocks,
      claimWait: params.claimWait,
      fundFeeBps: params.fundFeeBps,
      lpFeeBps: params.lpFeeBps,
      dividendFeeBps: params.dividendFeeBps,
      burnFeeBps: params.burnFeeBps,
    },
    factoryAddress,
  );
  if (!deployTx.data) {
    throw new Error("Token init code is empty.");
  }

  const initCodeHash = keccak256(deployTx.data);
  const startedAt = Date.now();
  const searchContext = {
    creator,
    name: params.name,
    symbol: params.symbol,
    chainId,
    tokenDeployer,
    initCodeHash,
    suffix,
  };
  const workerMatch = await findVanitySaltInWorkers(searchContext, maxIterations);
  if (workerMatch) {
    return {
      ok: true,
      suffix,
      salt: workerMatch.salt,
      tokenSalt: workerMatch.tokenSalt,
      tokenAddress: workerMatch.tokenAddress,
      factory: factoryAddress,
      chainId,
      attempts: workerMatch.attempts,
      elapsedMs: Date.now() - startedAt,
    };
  }

  const vanitySearch = createVanitySearchContext(searchContext);

  for (let attempts = 1; attempts <= maxIterations; attempts += 1) {
    const match = vanitySearch(attempts);
    if (match) {
      return {
        ok: true,
        suffix,
        salt: match.salt,
        tokenSalt: match.tokenSalt,
        tokenAddress: match.tokenAddress,
        factory: factoryAddress,
        chainId,
        attempts,
        elapsedMs: Date.now() - startedAt,
      };
    }
  }

  return {
    ok: false,
    suffix,
    factory: factoryAddress,
    chainId,
    attempts: maxIterations,
    elapsedMs: Date.now() - startedAt,
  };
}

async function readFactoryRequiredSuffix() {
  try {
    const suffix = Number(await factory.requiredTokenSuffix());
    const nibbles = await factory.requiredTokenSuffixNibbles().then(Number).catch(() => 6);
    return nibbles > 0 ? suffix.toString(16).padStart(nibbles, "0") : "";
  } catch {
    return "";
  }
}

function normalizeLaunchParams(params) {
  return {
    name: requiredString(params.name, "params.name"),
    symbol: requiredString(params.symbol, "params.symbol"),
    metadataUri: String(params.metadataUri || ""),
    totalSupply: requiredBigInt(params.totalSupply, "params.totalSupply"),
    mintCount: requiredBigInt(params.mintCount, "params.mintCount"),
    mintPrice: requiredBigInt(params.mintPrice, "params.mintPrice"),
    maxMintPerWallet: BigInt(params.maxMintPerWallet || 0),
    paymentToken: normalizeAddress(params.paymentToken || ZeroAddress),
    rewardToken: normalizeAddress(params.rewardToken || ZeroAddress),
    rewardThreshold: BigInt(params.rewardThreshold || 0),
    receiver: normalizeAddress(params.receiver),
    templateId: normalizeTemplateId(params.templateId || "standard"),
    buyTaxBps: Number(params.buyTaxBps || 0),
    sellTaxBps: Number(params.sellTaxBps || 0),
    transferTaxBps: Number(params.transferTaxBps || 0),
    addLiquidityTaxBps: Number(params.addLiquidityTaxBps || 0),
    removeLiquidityTaxBps: Number(params.removeLiquidityTaxBps || 0),
    launchProtectionTaxBps: Number(params.launchProtectionTaxBps || 0),
    launchProtectionBlocks: Number(params.launchProtectionBlocks || 0),
    claimWait: Number(params.claimWait || 60),
    fundFeeBps: Number(params.fundFeeBps || 0),
    lpFeeBps: Number(params.lpFeeBps || 0),
    dividendFeeBps: Number(params.dividendFeeBps || 0),
    burnFeeBps: Number(params.burnFeeBps || 0),
    whitelistMintCount: BigInt(params.whitelistMintCount || 0),
    whitelistEnabled: Boolean(params.whitelistEnabled),
  };
}

async function assertFactoryProject(token) {
  const project = await factory.getProject(token);
  if (String(project.token).toLowerCase() !== token.toLowerCase()) {
    throw new Error("Token is not indexed by the configured Factory.");
  }
}

async function saveDataUrlAsset(dataUrl, request) {
  const raw = String(dataUrl || "");
  const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif|svg\+xml));base64,([a-zA-Z0-9+/=]+)$/i.exec(raw);
  if (!match) {
    throw new Error("Invalid asset data URL.");
  }

  const mimeType = normalizeAssetMimeType(match[1]);
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 260 * 1024) {
    throw new Error("Asset is too large.");
  }

  const hash = createHash("sha256").update(mimeType).update(bytes).digest("hex");
  const filename = `${hash.slice(0, 32)}.${assetExtension(mimeType)}`;
  fs.mkdirSync(assetDir, { recursive: true });
  const filePath = path.join(assetDir, filename);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, bytes);
  }

  return {
    url: `${publicBaseUrl(request)}/api/assets/${filename}`,
    mimeType,
    bytes: bytes.length,
  };
}

async function sendAsset(response, pathname) {
  const filename = path.basename(decodeURIComponent(pathname));
  if (!/^[0-9a-f]{32}\.(?:png|jpg|webp|gif|svg)$/.test(filename)) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  const filePath = path.join(assetDir, filename);
  if (!fs.existsSync(filePath)) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  response.writeHead(200, {
    "content-type": mimeTypeForAsset(filename),
    "cache-control": "public, max-age=31536000, immutable",
  });
  fs.createReadStream(filePath).pipe(response);
}

function publicBaseUrl(request) {
  const configured = String(process.env.PEPE_PUBLIC_BASE_URL || process.env.APPLE_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  if (configured) {
    return configured;
  }

  const proto = String(request.headers["x-forwarded-proto"] || "http").split(",")[0].trim() || "http";
  const host = request.headers["x-forwarded-host"] || request.headers.host || `localhost:${port}`;
  return `${proto}://${host}`;
}

function normalizeAssetMimeType(mimeType) {
  const lower = String(mimeType).toLowerCase();
  return lower === "image/jpg" ? "image/jpeg" : lower;
}

function assetExtension(mimeType) {
  if (mimeType === "image/jpeg") {
    return "jpg";
  }
  if (mimeType === "image/svg+xml") {
    return "svg";
  }
  return mimeType.replace("image/", "");
}

function mimeTypeForAsset(filename) {
  if (filename.endsWith(".jpg")) {
    return "image/jpeg";
  }
  if (filename.endsWith(".svg")) {
    return "image/svg+xml";
  }
  return `image/${filename.split(".").pop()}`;
}

function clampIterations(value) {
  const nextValue = Number(value || 5000000);
  if (!Number.isFinite(nextValue) || nextValue <= 0) {
    return 5000000;
  }
  return Math.min(Math.floor(nextValue), 50000000);
}

function findVanitySaltInWorkers(context, maxIterations) {
  if (vanityWorkerCount <= 1 || maxIterations < 100000) {
    return null;
  }

  return new Promise((resolve, reject) => {
    const workers = [];
    let settled = false;
    let completed = 0;
    const perWorker = Math.ceil(maxIterations / vanityWorkerCount);

    const finish = (value, error = null) => {
      if (settled) {
        return;
      }
      settled = true;
      for (const worker of workers) {
        worker.terminate().catch(() => {});
      }
      if (error) {
        reject(error);
        return;
      }
      resolve(value);
    };

    for (let index = 0; index < vanityWorkerCount; index += 1) {
      const start = index * perWorker + 1;
      const count = Math.max(0, Math.min(perWorker, maxIterations - index * perWorker));
      if (count <= 0) {
        completed += 1;
        continue;
      }

      const worker = new Worker(new URL("./vanity-worker.mjs", import.meta.url), {
        workerData: {
          ...context,
          start,
          count,
        },
      });
      workers.push(worker);

      worker.on("message", (message) => {
        if (message?.ok) {
          finish(message);
          return;
        }
        completed += 1;
        if (completed >= workers.length && !settled) {
          finish(null);
        }
      });
      worker.on("error", (error) => finish(null, error));
      worker.on("exit", (code) => {
        if (!settled && code !== 0) {
          finish(null, new Error(`vanity worker exited with code ${code}`));
        }
      });
    }

    if (!workers.length) {
      resolve(null);
    }
  });
}

function createVanitySearchContext({ creator, name, symbol, chainId, tokenDeployer, initCodeHash, suffix }) {
  const seed = Buffer.from(randomBytes(24));
  const saltBytes = Buffer.alloc(32);
  seed.copy(saltBytes, 0);

  const tokenSaltPrefix = addressBytes(creator);
  const tokenSaltSuffix = Buffer.concat([
    Buffer.from(name, "utf8"),
    Buffer.from(symbol, "utf8"),
    uint256Bytes(chainId),
  ]);
  const deployerBytes = addressBytes(tokenDeployer);
  const initHashBytes = hexBytes(initCodeHash, 32);
  const create2Input = Buffer.alloc(85);
  create2Input[0] = 0xff;
  deployerBytes.copy(create2Input, 1);
  initHashBytes.copy(create2Input, 53);
  const suffixBytes = suffix.length % 2 === 0 ? Buffer.from(suffix, "hex") : null;

  return (attempts) => {
    saltBytes.writeBigUInt64BE(BigInt(attempts), 24);
    const tokenSalt = Buffer.from(keccak_256(Buffer.concat([tokenSaltPrefix, saltBytes, tokenSaltSuffix])));
    tokenSalt.copy(create2Input, 21);
    const addressBytesValue = Buffer.from(keccak_256(create2Input)).subarray(12);

    if (!addressMatchesSuffix(addressBytesValue, suffix, suffixBytes)) {
      return null;
    }

    return {
      salt: `0x${saltBytes.toString("hex")}`,
      tokenSalt: `0x${tokenSalt.toString("hex")}`,
      tokenAddress: getAddress(`0x${addressBytesValue.toString("hex")}`),
    };
  };
}

function addressMatchesSuffix(addressBytesValue, suffix, suffixBytes) {
  if (suffixBytes && suffixBytes.length <= addressBytesValue.length) {
    const offset = addressBytesValue.length - suffixBytes.length;
    for (let index = 0; index < suffixBytes.length; index += 1) {
      if (addressBytesValue[offset + index] !== suffixBytes[index]) {
        return false;
      }
    }
    return true;
  }

  return addressBytesValue.toString("hex").endsWith(suffix);
}

function addressBytes(value) {
  return hexBytes(value, 20);
}

function hexBytes(value, expectedBytes) {
  const hex = String(value || "").replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== expectedBytes * 2) {
    throw new Error(`Invalid ${expectedBytes}-byte hex value.`);
  }
  return Buffer.from(hex, "hex");
}

function uint256Bytes(value) {
  const bytes = Buffer.alloc(32);
  bytes.writeBigUInt64BE(BigInt(value), 24);
  return bytes;
}

function normalizeAddress(value) {
  if (!isAddress(String(value || ""))) {
    throw new Error(`Invalid address: ${value}`);
  }
  return getAddress(value);
}

function requiredString(value, label) {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(`${label} is required.`);
  }
  return text;
}

function requiredBigInt(value, label) {
  const nextValue = BigInt(value || 0);
  if (nextValue <= 0n) {
    throw new Error(`${label} must be greater than 0.`);
  }
  return nextValue;
}

function normalizeTemplateId(value) {
  const text = String(value || "standard");
  return /^0x[0-9a-fA-F]{64}$/.test(text) ? text : id(text);
}

function requireToken(request) {
  if (!backendToken) {
    return;
  }
  const header = request.headers.authorization || "";
  if (header !== `Bearer ${backendToken}`) {
    throw new Error("Unauthorized.");
  }
}

function limitRequest(request, scope, maxRequests) {
  if (!Number.isFinite(maxRequests) || maxRequests <= 0) {
    return;
  }

  const forwardedFor = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = forwardedFor || request.socket.remoteAddress || "unknown";
  const key = `${scope}:${ip}`;
  const now = Date.now();
  const current = rateBuckets.get(key);

  if (!current || now - current.startedAt > rateWindowMs) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return;
  }

  current.count += 1;
  if (current.count > maxRequests) {
    throw new Error("Rate limit exceeded. Try again later.");
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error("Request body too large."));
      }
    });
    request.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  if (statusCode === 204) {
    response.end();
    return;
  }
  response.end(JSON.stringify(payload, jsonReplacer));
}

function setCors(response) {
  response.setHeader("access-control-allow-origin", process.env.PEPE_CORS_ORIGIN || process.env.APPLE_CORS_ORIGIN || "*");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type,authorization");
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

function jsonReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}
