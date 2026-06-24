require('dotenv').config();
require('@nomicfoundation/hardhat-ethers');
require('@nomicfoundation/hardhat-verify');

function privateKeyAccounts() {
  const privateKey = process.env.PRIVATE_KEY || '';
  if (!privateKey) return [];
  return [privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`];
}

module.exports = {
  solidity: {
    compilers: [
      {
        version: '0.8.28',
        preferWasm: true,
        settings: {
          viaIR: true,
          evmVersion: 'cancun',
          optimizer: {
            enabled: true,
            runs: 1,
          },
        },
      },
    ],
  },
  networks: {
    hardhat: {},
    bsc: {
      url: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/',
      chainId: 56,
      accounts: privateKeyAccounts(),
    },
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC_URL || 'https://data-seed-prebsc-1-s1.binance.org:8545/',
      chainId: 97,
      accounts: privateKeyAccounts(),
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || process.env.BSCSCAN_API_KEY || '',
    customChains: [],
  },
  sourcify: {
    enabled: false,
  },
};
