const fs = require("node:fs");
const path = require("node:path");

const apiUrl = process.env.ETHERSCAN_V2_API_URL || "https://api.etherscan.com/v2/api";
const projectRoot = path.join(__dirname, "..");
const targets = [
  path.join(projectRoot, "node_modules", "@nomicfoundation", "hardhat-verify", "internal", "etherscan.js"),
  path.join(projectRoot, "node_modules", "@nomicfoundation", "hardhat-verify", "src", "internal", "etherscan.ts"),
];

for (const file of targets) {
  if (!fs.existsSync(file)) {
    continue;
  }

  const source = fs.readFileSync(file, "utf8");
  const patched = source.replace(/https:\/\/api\.etherscan\.(?:io|com)\/v2\/api/g, apiUrl);
  if (patched !== source) {
    fs.writeFileSync(file, patched, "utf8");
    console.log(`[patch] hardhat-verify Etherscan V2 API => ${apiUrl}`);
  }
}
