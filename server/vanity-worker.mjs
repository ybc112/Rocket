import { parentPort, workerData } from "node:worker_threads";
import { getAddress } from "ethers";
import { keccak_256 } from "@noble/hashes/sha3.js";

const search = createVanitySearchContext(workerData);
let found = null;

for (let offset = 0; offset < workerData.count; offset += 1) {
  const attempts = workerData.start + offset;
  const match = search(attempts);
  if (match) {
    found = { ok: true, attempts, ...match };
    break;
  }
}

parentPort?.postMessage(found || { ok: false });

function createVanitySearchContext({ creator, name, symbol, chainId, tokenDeployer, initCodeHash, suffix }) {
  const seed = Buffer.from(keccak_256(Buffer.from(`${Date.now()}:${Math.random()}:${creator}:${name}:${symbol}`))).subarray(0, 24);
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
