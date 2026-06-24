import type { AllocationKey, AllocationState, FormState, LaunchTemplate } from './types'

export const BNB_CHAIN = {
  chainId: '0x38',
  chainName: 'BNB Smart Chain',
  nativeCurrency: {
    name: 'BNB',
    symbol: 'BNB',
    decimals: 18,
  },
  rpcUrls: ['https://bsc.publicnode.com'],
  blockExplorerUrls: ['https://bscscan.com'],
}

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
export const USDT_ADDRESS = '0x55d398326f99059fF775485246999027B3197955'

export const initialForm: FormState = {
  tokenName: 'Rocket Launchpad',
  symbol: 'ROCKET',
  description: '',
  supply: '1000000',
  mintCount: '300',
  publicMintCount: '210',
  whitelistMintCount: '90',
  maxMintPerWallet: '0',
  mintPrice: '0.01',
  paymentToken: ZERO_ADDRESS,
  rewardToken: '',
  rewardThreshold: '1',
  receiverWallet: '',
  telegram: '',
  xLink: '',
  website: '',
}

export const initialAllocation: AllocationState = {
  marketing: 0,
  liquidity: 0,
  rewards: 30,
  burn: 70,
}

export const templates: LaunchTemplate[] = [
  {
    id: 'standard',
    name: 'Standard Mint',
    tag: 'Core',
    fee: '0.005 BNB',
    summary: 'Deploy an independent ERC20 and Vault. Users mint by quantity, suitable for fast community asset launches.',
    bestFor: 'Community launches, event passes, lightweight asset issuance',
    checks: ['Fixed supply', 'Public mint count', 'Independent Vault', 'Creator receiver wallet'],
  },
  {
    id: 'time',
    name: 'Timed Launch',
    tag: 'Time',
    fee: '0.005 BNB',
    summary: 'Supports warm-up, queueing, batch openings, whitelist windows, and launch timing parameters.',
    bestFor: 'Warm-up campaigns, queued launches, staged openings',
    checks: ['Opening time', 'Cooldown window', 'Progress tracking', 'Public parameters'],
  },
  {
    id: 'buyback',
    name: 'Auto Buyback',
    tag: '70/30',
    fee: '0.005 BNB',
    summary: 'Routes tax into a 70% buyback burn pool and 30% holder dividend flow.',
    bestFor: 'Whitelist launches, auto buyback tokens, holder reward communities',
    checks: ['Buy/sell tax', '70% buyback burn', '30% holder dividends', 'Whitelist vault'],
  },
  {
    id: 'nftReward',
    name: 'Reward Vault',
    tag: 'Reward',
    fee: '0.005 BNB',
    summary: 'Records reward token and holding threshold, ready for NFT, task, or membership rewards later.',
    bestFor: 'Task communities, holder rewards, gamified launches',
    checks: ['Reward token', 'Threshold record', 'Template ID', 'Future upgrades'],
  },
]

export const allocationMeta: Array<{
  key: AllocationKey
  label: string
  hint: string
  color: string
}> = [
  {
    key: 'burn',
    label: 'Buyback burn',
    hint: '70% burn side',
    color: '#d4af37',
  },
  {
    key: 'marketing',
    label: 'Treasury',
    hint: '0% route',
    color: '#27ae60',
  },
  {
    key: 'liquidity',
    label: 'Liquidity',
    hint: 'LP route',
    color: '#7dd3fc',
  },
  {
    key: 'rewards',
    label: 'Holder dividends',
    hint: '30% dividend side',
    color: '#b8c7ff',
  },
]

export const paymentTokens = [
  {
    label: 'BNB',
    symbol: 'BNB',
    address: ZERO_ADDRESS,
    note: 'Native BNB mint',
  },
]
