import {
  AlertCircle,
  ArrowUpDown,
  AtSign,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileCode2,
  Globe2,
  Home,
  ImagePlus,
  Menu,
  MessageCircle,
  Plus,
  Rocket,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  UserPlus,
  Wallet,
  X,
} from 'lucide-react'
import { type CSSProperties, type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { isAddress } from 'ethers'
import {
  BNB_CHAIN,
  USDT_ADDRESS,
  ZERO_ADDRESS,
  allocationMeta,
  initialAllocation,
  initialForm,
  paymentTokens,
  templates,
} from './data'
import {
  approveProjectRefundTokens,
  approveProjectMintPayment,
  claimProjectDividend,
  claimProjectRefund,
  createLaunchToken,
  fetchLaunchProjects,
  isLaunchpadConfigured,
  launchpadConfig,
  mintLaunchProject,
  queueProjectVerification,
  readLaunchCreatedToken,
  setProjectWhitelistAllowances,
  setProjectWhitelistEnabled,
  type WhitelistAllowanceEntry,
  waitForTransactionReceipt,
  watchLaunchProjectEvents,
} from './contracts/launchpad'
import {
  buildPancakeSwapUrl,
} from './contracts/pancake'
import type {
  AllocationKey,
  AllocationState,
  AdvancedTaxState,
  DeployState,
  FormState,
  LaunchProject,
  LaunchTemplate,
  PageKey,
  TemplateId,
  WalletState,
} from './types'
import {
  getAccounts,
  getChainId,
  getProvider,
  readProviderErrorMessage,
  requestAccounts,
  shortAddress,
  switchToBnbChain,
  targetChainId,
} from './wallet'

const pages: PageKey[] = ['home', 'launch', 'community', 'verify', 'detail']
const appBuildId = 'rocket-20260625-factory-32949c'
const appName = String(import.meta.env.VITE_APP_NAME ?? 'Rocket Launchpad')
const appSymbol = String(import.meta.env.VITE_APP_SYMBOL ?? 'ROCKET')
const factoryExplorerUrl = `${BNB_CHAIN.blockExplorerUrls[0]}/address/${launchpadConfig.factoryAddress}#code`

type Language = 'zh' | 'en'

type Notice = {
  kind: 'success' | 'error' | 'info'
  message: string
}

type ProjectsStatus = 'idle' | 'loading' | 'ready' | 'error'
type ProjectFilter = 'all' | 'minting' | 'whitelist' | 'completed'

const defaultDescriptions: Record<Language, string> = {
  zh: '',
  en: '',
}

const avatarAcceptedTypes = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/gif', 'image/webp']
const avatarAccept = avatarAcceptedTypes.join(',')
const avatarMaxSourceBytes = 1024 * 1024
const avatarMaxMetadataBytes = 220 * 1024
const avatarCanvasSize = 256

const copy = {
  zh: {
    language: '中文',
    menuOpen: '展开菜单',
    menuClose: '收起菜单',
    mainNav: '主导航',
    optional: '可选',
    wallet: {
      connect: '连接钱包',
      connecting: '连接中',
      missing: '未检测到浏览器钱包，请安装 MetaMask、OKX Wallet 或 TokenPocket。',
      missingShort: '未检测到浏览器钱包。',
      noAccount: '钱包没有返回可用账号。',
      noProviderForTx: '未检测到浏览器钱包，无法提交链上交易。',
    },
    nav: {
      home: '返回首页',
      community: '社区',
      verify: '合约开源',
      swap: '交易所',
      launch: '部署代币',
    },
    notice: {
      confirmDeploy: '请在钱包里确认部署交易，部署费为 0.005 BNB。',
      prepareLaunch: '正在请求后端准备靓号合约地址和自动开源任务。',
      txSubmitted: (hash: string) => `部署交易已提交：${hash}，正在等待链上确认。`,
      txSubmittedWithVanity: (hash: string, suffix: string, token: string) =>
        `部署交易已提交：${hash}，已匹配尾号 ${suffix}：${token}。`,
      txConfirmed: '交易已确认，项目已经写入链上列表。',
      txConfirmedWithBackend: (token: string) => `交易已确认，合约 ${token} 已提交后端开源队列。`,
      confirmWhitelist: '请在钱包里确认白名单列表交易。',
      whitelistSubmitted: (hash: string) => `白名单交易已提交：${hash}，正在等待链上确认。`,
      whitelistConfirmed: '白名单列表已写入链上。',
      confirmWhitelistMode: '请在钱包里确认白名单开关交易。',
      whitelistModeConfirmed: '白名单模式已更新。',
      confirmMintApproval: '请先在钱包里授权付款代币给 Vault。',
      mintApprovalSubmitted: (hash: string) => `Mint 授权已提交：${hash}，正在等待链上确认。`,
      mintApprovalConfirmed: 'Mint 授权已确认，继续提交 mint 交易。',
      confirmMint: '请在钱包里确认 mint 交易。',
      mintSubmitted: (hash: string) => `Mint 交易已提交：${hash}，正在等待链上确认。`,
      mintConfirmed: 'Mint 已完成，项目进度已刷新。',
      confirmRefundApproval: '请先在钱包里授权 Vault 取回你的发射代币。',
      refundApprovalSubmitted: (hash: string) => `退款授权已提交：${hash}，正在等待链上确认。`,
      refundApprovalConfirmed: '退款授权已确认，继续提交退款交易。',
      confirmRefund: '请在钱包里确认退款交易。退款会把你的代币退回 Vault，再退回付款。',
      refundSubmitted: (hash: string) => `退款交易已提交：${hash}，正在等待链上确认。`,
      refundConfirmed: '退款已完成。',
      confirmSwapApproval: '请在钱包里授权 PancakeSwap Router 使用你的代币。',
      swapApprovalSubmitted: (hash: string) => `Swap 授权已提交：${hash}，正在等待链上确认。`,
      swapApprovalConfirmed: 'Swap 授权已确认。',
      confirmSwap: '请在钱包里确认 PancakeSwap 兑换交易。',
      swapSubmitted: (hash: string) => `Swap 交易已提交：${hash}，正在等待链上确认。`,
      swapConfirmed: 'Swap 交易已确认。',
    },
    home: {
      eyebrow: `${appName} 发射擂台`,
      title: '把新币送上 PEPE 擂台',
      subtitle:
        '创建独立 ERC20 和 Mint 金库，配置 mint、税收、奖励和接收钱包。每一次上擂都会写入链上，确认后自动进入项目列表。',
      launch: '部署新币',
      openCommunity: '加入社区',
      consoleAria: 'PEPE 擂台发射流程',
      consoleStats: [
        ['擂台', appSymbol, '100,000'],
        ['铸造', '300', '0.01 BNB'],
        ['税费', '3 / 3', '销毁 + 持币分红'],
        ['模式', 'Mint', '白名单可用'],
      ],
      consoleFlow: ['钱包', '工厂合约', '代币 + 金库'],
      features: [
        ['01 上擂台', '0.005 BNB 创建发射合约', '连接钱包后直接发送真实部署交易；Factory 已部署并开源，项目确认后进入链上擂台。'],
        ['02 开 Mint', 'Mint + 金库独立运行', '每个项目拥有独立 ERC20 和 Mint 金库，用户 mint 后立即获得真实代币余额。'],
        ['03 守规则', '白名单和税收上链', '买卖税、奖励、销毁和白名单模式随项目创建写入链上，开盘和退款按合约规则执行。'],
      ],
    },
    projects: {
      search: '输入代币名称、符号或合约地址搜索',
      tabs: {
        all: '链上项目',
        minting: '铸造中',
        whitelist: '白名单',
        completed: '已完成',
      },
      emptyTitle: '暂无可展示项目',
      notConfiguredTitle: 'Factory 还未配置',
      readErrorTitle: '链上项目读取失败',
      firstAction: '发布第一个项目',
      deployAction: '去部署项目',
      loading: '项目加载中',
      progress: '铸造进度',
      statusMinting: '铸造中',
      statusTrading: '已开盘',
      statusCompleted: '已完成',
      statusWhitelist: '白名单',
      viewBscScan: '在 BscScan 查看',
      copyAddress: '复制合约',
      copied: '已复制',
      detail: '查看机制',
      trade: '去交易',
      website: '官网',
      fallbackDescription: `${appName} 链上发射项目`,
      quota: (whitelistMinted: string, whitelistTotal: string, publicMinted: string, publicTotal: string) =>
        `白名单 ${whitelistMinted}/${whitelistTotal} · 公开 ${publicMinted}/${publicTotal}`,
      whitelistManage: '添加白名单',
      whitelistAddress: '批量粘贴白名单地址：每行一个，也支持空格、逗号或无 0x 地址',
      whitelistAllowance: '白名单列表',
      whitelistSubmit: '批量保存',
      whitelistPending: '等待确认',
      whitelistBatchHint: '单次最多识别 200 个地址，可分批提交；白名单份数只是可 mint 名额，不限制名单地址数量。',
      openPublicMint: '开放公开 Mint',
      mint: 'Mint',
      mintQuantity: 'Mint 数量',
      mintCost: (amount: string) => `合计 ${amount}`,
      approveMint: '授权付款',
      whitelistRemaining: (amount: string) => `白名单剩余 ${amount} 份`,
      mintClosed: '已结束',
      refund: '申请退款',
      refundAvailable: (amount: string) => `可退款 ${amount}`,
      refundTip: '24 小时未打满后可退款',
      refundOpensIn: (time: string) => `退款将在 ${time} 后开放`,
      refundConnectWallet: '连接参与 Mint 的钱包后可查看退款',
      refundNoPosition: '当前钱包没有可退份额',
      refundFinalized: '项目已打满开盘，不能退款',
      refundLocked: '暂不可退',
    },
    detail: {
      eyebrow: '项目详情',
      title: (name: string) => `${name} 详情`,
      loading: '正在读取链上项目详情',
      missingTitle: '没有找到这个项目',
      missingDesc: '项目可能还在确认中，或者当前 Factory 列表里暂时没有这个 Token。',
      back: '返回项目列表',
      mechanism: '代币机制',
      taxMechanism: '税费机制',
      rewardBadge: (address: string) => `分红 ${shortAddress(address)}`,
      contractBalance: '合约余额',
      vaultBalanceHint: 'Vault 未铸造余额',
      buyTax: '买入税',
      sellTax: '卖出税',
      marketing: '营销分配',
      liquidity: '回流分配',
      rewards: '持币分红',
      burn: '销毁分配',
      rewardThreshold: '分红门槛',
      receiver: '接收钱包',
      vault: 'Vault 地址',
      token: 'Token 合约',
      whitelist: '白名单',
      mintProgress: '铸造进度',
      supply: '发行总量',
      tradingState: '权限状态',
      tradingFinalized: '已开盘，Token 与 Vault 权限已进入黑洞',
      tradingPending: '内盘阶段，打满后自动开盘并丢权限',
      enabled: '开启',
      disabled: '关闭',
      unallocated: '未分配',
      toReceiver: (address: string) => `进入 ${shortAddress(address)}`,
      toBlackHole: '进入黑洞',
      toRewardToken: (address: string) => `指定代币 ${shortAddress(address)}`,
      toBurn: '直接销毁',
      taxPortionPair: (buy: string, sell: string) => (buy === sell ? buy : `买入 ${buy} / 卖出 ${sell}`),
      copyToken: '复制 Token',
      copyVault: '复制 Vault',
      openExplorer: '查看 BscScan',
      trade: '去交易',
      noTax: '无税费',
      tokenUnit: (symbol: string) => symbol,
    },
    swap: {
      title: 'PancakeSwap 交易',
      desc: '通过 PancakeSwap V2 Router 直接兑换，成交取决于项目是否已经添加 BNB 流动性。',
      selectProject: '选择项目',
      customToken: '自定义代币',
      tokenAddress: '代币合约地址',
      amount: '数量',
      slippage: '滑点',
      buy: '买入',
      sell: '卖出',
      quote: '获取报价',
      refresh: '刷新报价',
      approve: '授权代币',
      swap: '确认兑换',
      pending: '等待确认',
      route: '路由',
      expected: '预计得到',
      minimum: '最低收到',
      router: '薄饼 Router',
      noProjects: '暂无已开盘项目，可以手动输入已加 LP 的代币合约。',
      quoteHint: '报价来自 PancakeSwap，含税代币实际到账可能低于显示值。',
      openPancake: '打开薄饼',
    },
    launch: {
      network: '当前网络',
      waitingNetwork: '等待切换到 BNB Smart Chain',
      walletHint: '连接钱包后会自动填入创建者接收地址',
      switchNetwork: '切换网络',
      factoryUnset: '未配置',
      section01: '01 基础信息',
      title: '部署你的发射代币',
      intro: '填写名称、符号、头像和项目简介。',
      feeBadge: '部署费 0.005 BNB',
      tokenName: '代币名称',
      tokenNamePlaceholder: '输入代币名称',
      tokenSymbol: '代币符号',
      tokenSymbolPlaceholder: '输入代币符号',
      avatar: '头像图片',
      avatarTitle: '上传项目头像',
      avatarReady: '头像已加入部署信息',
      avatarHint: '支持 PNG、JPEG、SVG、GIF、WebP，建议小于 1MB，会自动压缩后写入 metadata',
      avatarChange: '更换',
      avatarRemove: '移除',
      avatarInvalid: '请选择 PNG、JPEG、SVG、GIF 或 WebP 图片。',
      avatarTooLarge: '图片不能超过 1MB。',
      avatarMetadataTooLarge: '头像压缩后仍然偏大，请换一张更小的图。',
      description: '代币简介（选填）',
      descriptionPlaceholder: '',
      section02: '02 模板',
      templateTitle: '选择合约模板',
      section03: '03 铸造参数',
      mintTitle: 'Mint 价格与供应',
      supply: '发行总量',
      mintCount: '总铸造次数',
      publicMintCount: '公开份数',
      whitelistMintCount: '白名单份数',
      maxMintPerWallet: '单钱包最多 Mint',
      mintPrice: '单次价格',
      whitelistTitle: '开启白名单 Mint',
      whitelistDesc: '开启后，只有项目方加入白名单列表的钱包可以 mint。',
      section04: '04 税收分配',
      taxTitle: '买卖税与四项分配',
      total: (value: number) => `总计 ${value}%`,
      buyTax: '买入税',
      sellTax: '卖出税',
      unallocated: (value: number) => `未分配 ${value}%`,
      allocationOverflow: '分配总和超过 100%，合约会拒绝部署。',
      section05: '05 链上配置',
      receiverTitle: '接收与分红',
      onchain: '链上记录',
      receiverWallet: '接收钱包',
      rewardToken: '分红代币地址',
      rewardTokenPlaceholder: '留空默认 USDT',
      rewardTokenDefault: `默认 USDT：${shortAddress(USDT_ADDRESS)}`,
      rewardThreshold: '持仓门槛',
      section06: '06 可选链接',
      linksTitle: '社区入口',
      linksDesc: 'Telegram、X 和官网会随项目简介一起保存，留空不会影响部署。',
      telegram: 'Telegram 链接',
      x: 'X 链接',
      website: '官网链接',
      configWarning:
        '真实交易已经接好，前端源码已内置当前 Factory 地址；如果这里仍提示异常，请检查源码默认地址或覆盖配置。',
      pending: '等待钱包确认',
      submit: '部署并进入链上列表',
      currentTemplate: '当前模板',
      mode: '品牌发射模式',
      preview: '交易预览',
      deployFee: '部署费',
      paymentToken: '付款代币',
      mintQuota: '铸造份数',
      whitelist: '白名单',
      enabled: '开启',
      disabled: '关闭',
      taxRate: '税率',
      totalAllocation: '总分配',
      factory: '工厂',
    },    verify: {
      title: '工厂合约已开源',
      subtitle: '当前发射工厂已在 BscScan 完成源码验证，用户可以直接检查构造参数和合约代码。',
      button: '查看 BscScan',
    },
  },
  en: {
    language: 'English',
    menuOpen: 'Open menu',
    menuClose: 'Close menu',
    mainNav: 'Main navigation',
    optional: 'Optional',
    wallet: {
      connect: 'Connect wallet',
      connecting: 'Connecting',
      missing: 'No browser wallet found. Please install MetaMask, OKX Wallet, or TokenPocket.',
      missingShort: 'No browser wallet found.',
      noAccount: 'The wallet did not return an available account.',
      noProviderForTx: 'No browser wallet found, so the on-chain transaction cannot be submitted.',
    },
    nav: {
      home: 'Home',
      community: 'Community',
      verify: 'Verified',
      swap: 'Swap',
      launch: 'Launch token',
    },
    notice: {
      confirmDeploy: 'Confirm the deployment transaction in your wallet. The launch fee is 0.005 BNB.',
      prepareLaunch: 'Preparing the vanity contract address and auto-verification task on the backend.',
      txSubmitted: (hash: string) => `Deployment transaction submitted: ${hash}. Waiting for confirmation.`,
      txSubmittedWithVanity: (hash: string, suffix: string, token: string) =>
        `Deployment transaction submitted: ${hash}. Matched suffix ${suffix}: ${token}.`,
      txConfirmed: 'Transaction confirmed. The project is now recorded in the on-chain list.',
      txConfirmedWithBackend: (token: string) => `Transaction confirmed. Contract ${token} was queued for backend verification.`,
      confirmWhitelist: 'Confirm the whitelist list transaction in your wallet.',
      whitelistSubmitted: (hash: string) => `Whitelist transaction submitted: ${hash}. Waiting for confirmation.`,
      whitelistConfirmed: 'Whitelist list is now recorded on-chain.',
      confirmWhitelistMode: 'Confirm the whitelist mode transaction in your wallet.',
      whitelistModeConfirmed: 'Whitelist mode has been updated.',
      confirmMintApproval: 'Approve the payment token for the Vault first.',
      mintApprovalSubmitted: (hash: string) => `Mint approval submitted: ${hash}. Waiting for confirmation.`,
      mintApprovalConfirmed: 'Mint approval confirmed. Continue with the mint transaction.',
      confirmMint: 'Confirm the mint transaction in your wallet.',
      mintSubmitted: (hash: string) => `Mint transaction submitted: ${hash}. Waiting for confirmation.`,
      mintConfirmed: 'Mint complete. Project progress refreshed.',
      confirmRefundApproval: 'First approve the Vault to take back your launch tokens.',
      refundApprovalSubmitted: (hash: string) => `Refund approval submitted: ${hash}. Waiting for confirmation.`,
      refundApprovalConfirmed: 'Refund approval confirmed. Continue with the refund transaction.',
      confirmRefund: 'Confirm the refund transaction. Your tokens will be returned to the Vault before payment is refunded.',
      refundSubmitted: (hash: string) => `Refund transaction submitted: ${hash}. Waiting for confirmation.`,
      refundConfirmed: 'Refund complete.',
      confirmSwapApproval: 'Approve the PancakeSwap Router to use your tokens.',
      swapApprovalSubmitted: (hash: string) => `Swap approval submitted: ${hash}. Waiting for confirmation.`,
      swapApprovalConfirmed: 'Swap approval confirmed.',
      confirmSwap: 'Confirm the PancakeSwap transaction in your wallet.',
      swapSubmitted: (hash: string) => `Swap transaction submitted: ${hash}. Waiting for confirmation.`,
      swapConfirmed: 'Swap transaction confirmed.',
    },
    home: {
      eyebrow: `${appName} Launch Protocol`,
      title: 'Institutional-grade token launches on BNB Chain',
      subtitle:
        'Deploy ERC20 tokens with whitelist mint vaults, 20% marketing, automated buyback burn, and holder dividend mechanics. Every launch is governed by auditable on-chain smart contracts.',
      launch: 'Deploy token',
      openCommunity: 'Mission control',
      consoleAria: 'Rocket launch flow',
      consoleStats: [
        ['Ticker', appSymbol, '1,000,000'],
        ['Mints', '300', '0.01 BNB'],
        ['Tax', '3 / 3', '20 marketing / 56 burn / 24 rewards'],
        ['Mode', 'Whitelist', 'Auto buyback'],
      ],
      consoleFlow: ['Wallet', 'Factory', 'Token + Vault'],
      features: [
        ['01 Issuance', '0.005 BNB deployment fee', 'Submit a real on-chain deployment transaction through the verified Factory contract. Confirmed projects are recorded in the launch registry.'],
        ['02 Whitelist mint', 'Independent Token + Vault', 'Each project deploys its own ERC20 and mint vault. Whitelisted wallets mint during the private phase before public mint opens.'],
        ['03 Auto buyback', '20% marketing + 56% burn + 24% dividends', 'Tax flow accumulates BNB, processes 10% per 60-second cycle above the 0.02 BNB floor, then routes the configured buyback bucket to burn and the reward bucket to holder rewards.'],
      ],
    },
    projects: {
      search: 'Search by token name, symbol, or contract address',
      tabs: {
        all: 'On-chain',
        minting: 'Minting',
        whitelist: 'Whitelist',
        completed: 'Completed',
      },
      emptyTitle: 'No projects to show',
      notConfiguredTitle: 'Factory not configured',
      readErrorTitle: 'Could not load on-chain projects',
      firstAction: 'Launch first project',
      deployAction: 'Launch project',
      loading: 'Loading projects',
      progress: 'Mint progress',
      statusMinting: 'Minting',
      statusTrading: 'Trading',
      statusCompleted: 'Completed',
      statusWhitelist: 'Whitelist',
      viewBscScan: 'View on BscScan',
      copyAddress: 'Copy contract',
      copied: 'Copied',
      detail: 'Mechanism',
      trade: 'Trade',
      website: 'Website',
      fallbackDescription: `${appName} Rocket launch project`,
      quota: (whitelistMinted: string, whitelistTotal: string, publicMinted: string, publicTotal: string) =>
        `Whitelist ${whitelistMinted}/${whitelistTotal} | Public ${publicMinted}/${publicTotal}`,
      whitelistManage: 'Add whitelist',
      whitelistAddress: 'Paste whitelist addresses in bulk. One per line; spaces, commas, and no-0x addresses also work.',
      whitelistAllowance: 'Whitelist list',
      whitelistSubmit: 'Batch save',
      whitelistPending: 'Waiting',
      whitelistBatchHint: 'Up to 200 addresses per transaction; submit more in batches. Slots cap mint quota, not listed address count.',
      openPublicMint: 'Open public mint',
      mint: 'Mint',
      mintQuantity: 'Mint quantity',
      mintCost: (amount: string) => `Total ${amount}`,
      approveMint: 'Approve payment',
      whitelistRemaining: (amount: string) => `Whitelist slots left ${amount}`,
      mintClosed: 'Closed',
      refund: 'Claim refund',
      refundAvailable: (amount: string) => `Refundable ${amount}`,
      refundTip: 'Refunds open if not sold out after 24h',
      refundOpensIn: (time: string) => `Refunds open in ${time}`,
      refundConnectWallet: 'Connect the wallet that minted to check refunds',
      refundNoPosition: 'No refundable position for this wallet',
      refundFinalized: 'Sold out and trading is live. Refunds are closed',
      refundLocked: 'Not available',
    },
    detail: {
      eyebrow: 'Project details',
      title: (name: string) => `${name} details`,
      loading: 'Loading on-chain project details',
      missingTitle: 'Project not found',
      missingDesc: 'The project may still be confirming, or this token is not in the current Factory list.',
      back: 'Back to projects',
      mechanism: 'Token mechanism',
      taxMechanism: 'Tax mechanism',
      rewardBadge: (address: string) => `Reward ${shortAddress(address)}`,
      contractBalance: 'Contract balance',
      vaultBalanceHint: 'Vault unminted balance',
      buyTax: 'Buy tax',
      sellTax: 'Sell tax',
      marketing: 'Treasury allocation',
      liquidity: 'Liquidity allocation',
      rewards: 'Holder dividends',
      burn: 'Buyback burn',
      rewardThreshold: 'Reward threshold',
      receiver: 'Receiver wallet',
      vault: 'Vault address',
      token: 'Token contract',
      whitelist: 'Whitelist',
      mintProgress: 'Mint progress',
      supply: 'Total supply',
      tradingState: 'Permission state',
      tradingFinalized: 'Trading is live. Token and Vault ownership are in the black hole.',
      tradingPending: 'Launch phase. Sellout automatically opens trading and burns permissions.',
      enabled: 'Enabled',
      disabled: 'Off',
      unallocated: 'Unallocated',
      toReceiver: (address: string) => `Sent to ${shortAddress(address)}`,
      toBlackHole: 'Sent to black hole',
      toRewardToken: (address: string) => `Reward token ${shortAddress(address)}`,
      toBurn: 'BNB buyback to burn address',
      taxPortionPair: (buy: string, sell: string) => (buy === sell ? buy : `Buy ${buy} / sell ${sell}`),
      copyToken: 'Copy Token',
      copyVault: 'Copy Vault',
      openExplorer: 'View BscScan',
      trade: 'Trade',
      noTax: 'No tax',
      tokenUnit: (symbol: string) => symbol,
    },
    swap: {
      title: 'PancakeSwap Trading',
      desc: 'Swap directly through the PancakeSwap V2 Router. Execution depends on the project having BNB liquidity.',
      selectProject: 'Select project',
      customToken: 'Custom token',
      tokenAddress: 'Token contract address',
      amount: 'Amount',
      slippage: 'Slippage',
      buy: 'Buy',
      sell: 'Sell',
      quote: 'Get quote',
      refresh: 'Refresh quote',
      approve: 'Approve token',
      swap: 'Confirm swap',
      pending: 'Waiting',
      route: 'Route',
      expected: 'Expected output',
      minimum: 'Minimum received',
      router: 'Pancake Router',
      noProjects: 'No trading projects yet. You can manually enter a token that already has LP.',
      quoteHint: 'Quote comes from PancakeSwap. Taxed tokens may arrive below the displayed estimate.',
      openPancake: 'Open Pancake',
    },
    launch: {
      network: 'Current network',
      waitingNetwork: 'Waiting for BNB Smart Chain',
      walletHint: 'Connect a wallet to auto-fill the creator receiver address',
      switchNetwork: 'Switch network',
      factoryUnset: 'Not configured',
      section01: '01 Basics',
      title: 'Configure a token launch',
      intro: 'Set the mint parameters, whitelist gate, launch taxes, 20% marketing, and auto buyback dividend flow.',
      feeBadge: 'Deployment fee 0.005 BNB',
      tokenName: 'Token name',
      tokenNamePlaceholder: 'Enter token name',
      tokenSymbol: 'Token symbol',
      tokenSymbolPlaceholder: 'Enter token symbol',
      avatar: 'Avatar image',
      avatarTitle: 'Upload project avatar',
      avatarReady: 'Avatar added to deploy metadata',
      avatarHint: 'PNG, JPEG, SVG, GIF, or WebP. Keep it under 1MB; raster images are compressed before metadata is written.',
      avatarChange: 'Change',
      avatarRemove: 'Remove',
      avatarInvalid: 'Choose a PNG, JPEG, SVG, GIF, or WebP image.',
      avatarTooLarge: 'Image must be under 1MB.',
      avatarMetadataTooLarge: 'Avatar is still too large after compression. Use a smaller image.',
      description: 'Token intro (optional)',
      descriptionPlaceholder: '',
      section02: '02 Template',
      templateTitle: 'Choose contract template',
      section03: '03 Mint settings',
      mintTitle: 'Mint price and supply',
      supply: 'Total supply',
      mintCount: 'Mint count',
      publicMintCount: 'Public count',
      whitelistMintCount: 'Whitelist count',
      maxMintPerWallet: 'Max mint per wallet',
      mintPrice: 'Price per mint',
      liquidityTokenPercent: 'Opening price level',
      liquidityTokenHint: '50% matches the mint price. Below 50% opens lower; above 50% opens higher. The contract calculates LP token reserve automatically.',
      whitelistTitle: 'Whitelist mint gate',
      whitelistDesc: 'Listed wallets mint first from the Vault. Public mint opens after the whitelist allocation is filled or manually released.',
      section04: '04 Taxes and dividends',
      taxTitle: 'Taxes, buyback burn, and dividends',
      total: (value: number) => `Total ${value}%`,
      buyTax: 'Buy tax',
      sellTax: 'Sell tax',
      unallocated: (value: number) => `Unallocated ${value}%`,
      allocationOverflow: 'Allocation exceeds 100%; the contract will reject deployment.',
      section05: '05 On-chain config',
      receiverTitle: 'Rewards and operations',
      onchain: 'On-chain record',
      receiverWallet: 'Receiver wallet',
      rewardToken: 'Holder reward token',
      rewardTokenPlaceholder: 'Blank defaults to USDT',
      rewardTokenDefault: `24% dividend-side rewards default to USDT: ${shortAddress(USDT_ADDRESS)}`,
      rewardThreshold: 'Reward threshold',
      section06: '06 Optional links',
      linksTitle: 'Community links',
      linksDesc: 'Telegram, X, and website are saved with the project metadata. Leaving them empty will not block deployment.',
      telegram: 'Telegram link',
      x: 'X link',
      website: 'Website link',
      configWarning:
        'Real transactions are wired and the current Factory address is built into the frontend source. Check the default address or override config only if this warning appears.',
      pending: 'Waiting for wallet',
      submit: 'Deploy token',
      currentTemplate: 'Current template',
      mode: 'Launch mode',
      preview: 'Deployment preview',
      deployFee: 'Deployment fee',
      paymentToken: 'Payment token',
      mintQuota: 'Mint quota',
      whitelist: 'Whitelist',
      enabled: 'Enabled',
      disabled: 'Off',
      taxRate: 'Tax rate',
      totalAllocation: 'Total allocation',
      factory: 'Factory',
    },    verify: {
      title: 'Factory verified',
      subtitle: 'The launch Factory source code is verified on BscScan. Users can inspect constructor arguments and contract code directly.',
      button: 'View BscScan',
    },
  },
} as const

const templateTranslations: Record<Language, Partial<Record<TemplateId, Partial<LaunchTemplate>>>> = {
  zh: {
    standard: {
      name: '标准发射',
      tag: '基础',
    },
    time: {
      name: '分批开放',
      tag: '时间',
    },
    buyback: {
      name: '回流核心',
      tag: '回流',
    },
    nftReward: {
      name: '持币分红',
      tag: '分红',
    },
  },
  en: {
    standard: {
      name: 'Standard Mint',
      tag: 'Core',
      summary: 'Deploy an independent ERC20 and Vault. Users mint by quantity, suitable for fast community asset launches.',
      bestFor: 'Community launches, event passes, lightweight asset issuance',
      checks: ['Fixed supply', 'Public mint count', 'Independent Vault', 'Creator receiver wallet'],
    },
    time: {
      name: 'Timed Launch',
      tag: 'Time',
      summary: 'Supports warm-up, queueing, batch openings, whitelist windows, and launch timing parameters.',
      bestFor: 'Warm-up campaigns, queued launches, staged openings',
      checks: ['Opening time', 'Cooldown window', 'Progress tracking', 'Public parameters'],
    },
    buyback: {
      name: 'Auto Buyback',
      tag: '20 + 70/30',
      summary: 'Routes 20% to marketing, then splits the remaining tax 70% buyback burn and 30% holder dividends.',
      bestFor: 'Whitelist launches, auto buyback tokens, holder reward communities',
      checks: ['20% marketing', '56% buyback burn', '24% holder dividends', 'Whitelist vault'],
    },
    nftReward: {
      name: 'Reward Vault',
      tag: 'Reward',
      summary: 'Records reward token and holding threshold, ready for NFT, task, or membership rewards later.',
      bestFor: 'Task communities, holder rewards, gamified launches',
      checks: ['Reward token', 'Threshold record', 'Template ID', 'Future upgrades'],
    },
  },
}

const allocationTranslations: Record<Language, Record<AllocationKey, { label: string; hint: string }>> = {
  zh: {
    marketing: { label: '营销', hint: '进入接收钱包' },
    liquidity: { label: '回流', hint: '开盘锁 LP' },
    rewards: { label: '持币分红', hint: '进入分红池' },
    burn: { label: '销毁', hint: '减少供应' },
  },
  en: {
    marketing: { label: 'Marketing', hint: '20% route' },
    liquidity: { label: 'Liquidity', hint: 'LP route' },
    rewards: { label: 'Holder dividends', hint: '24% dividend side' },
    burn: { label: 'Buyback burn', hint: '56% burn side' },
  },
}

const paymentTokenNotes: Record<Language, Record<string, string>> = {
  zh: {
    BNB: '原生 BNB mint',
    USDT: 'BSC USDT',
  },
  en: {
    BNB: 'Native BNB mint',
    USDT: 'BSC USDT',
  },
}

const initialAdvancedTax: AdvancedTaxState = {
  transferTax: 0,
  addLiquidityTax: 0,
  removeLiquidityTax: 0,
  launchProtectionTax: 0,
  launchProtectionBlocks: '0',
  claimWaitSeconds: '60',
}

function App() {
  const [page, setPage] = useState<PageKey>(() => readPageFromHash())
  const [menuOpen, setMenuOpen] = useState(false)
  const [language] = useState<Language>('en')
  const [wallet, setWallet] = useState<WalletState>({
    account: '',
    chainId: '',
    status: 'idle',
    error: '',
  })
  const [form, setForm] = useState<FormState>(() => ({
    ...initialForm,
    description: defaultDescriptions.en,
  }))
  const [templateId, setTemplateId] = useState<TemplateId>('buyback')
  const [allocation, setAllocation] = useState<AllocationState>(initialAllocation)
  const [advancedTax, setAdvancedTax] = useState<AdvancedTaxState>(initialAdvancedTax)
  const [buyTax, setBuyTax] = useState(3)
  const [sellTax, setSellTax] = useState(3)
  const [avatar, setAvatar] = useState('')
  const [whitelistEnabled, setWhitelistEnabled] = useState(true)
  const [liquidityTokenPercent, setLiquidityTokenPercent] = useState('50')
  const [deployState, setDeployState] = useState<DeployState>('draft')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [projects, setProjects] = useState<LaunchProject[]>([])
  const [projectsStatus, setProjectsStatus] = useState<ProjectsStatus>('idle')
  const [projectsError, setProjectsError] = useState('')
  const [projectQuery, setProjectQuery] = useState('')
  const [projectsRefreshKey, setProjectsRefreshKey] = useState(0)
  const text = copy[language]

  const allocationTotal = useMemo(
    () => Object.values(allocation).reduce((sum, value) => sum + value, 0),
    [allocation],
  )
  const unallocated = Math.max(0, 100 - allocationTotal)
  const onTargetNetwork = wallet.chainId.toLowerCase() === targetChainId
  const refreshProjects = useCallback(() => {
    setProjectsRefreshKey((current) => current + 1)
  }, [])

  useEffect(() => {
    document.documentElement.lang = 'en'
    document.documentElement.dataset.rocketBuild = appBuildId
    localStorage.setItem('rocket-launch-language', 'en')
  }, [language])

  useEffect(() => {
    if (allocationTotal <= 100) {
      return
    }

    setAllocation((current) => normalizeAllocation(current))
  }, [allocationTotal])

  useEffect(() => {
    let active = true

    if (!isLaunchpadConfigured) {
      setProjects([])
      setProjectsStatus('ready')
      setProjectsError('')
      return () => {
        active = false
      }
    }

    setProjectsStatus((current) => (current === 'ready' ? current : 'loading'))
    setProjectsError('')

    fetchLaunchProjects(wallet.account)
      .then((items) => {
        if (!active) {
          return
        }

        setProjects(items)
        setProjectsStatus('ready')
      })
      .catch((error) => {
        if (!active) {
          return
        }

        setProjects([])
        setProjectsStatus('error')
        setProjectsError(readProviderErrorMessage(error))
      })

    return () => {
      active = false
    }
  }, [projectsRefreshKey, wallet.account])

  useEffect(() => {
    if (!isLaunchpadConfigured || !projects.some((project) => !project.finalized)) {
      return
    }

    const stopWatching = watchLaunchProjectEvents(projects, refreshProjects)
    const fallbackTimer = window.setInterval(refreshProjects, 15_000)

    return () => {
      stopWatching()
      window.clearInterval(fallbackTimer)
    }
  }, [projects, refreshProjects])


  useEffect(() => {
    const handleHashChange = () => {
      setPage(readPageFromHash())
      setMenuOpen(false)
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  useEffect(() => {
    const provider = getProvider()

    if (!provider) {
      setWallet((current) => ({ ...current, status: 'missing' }))
      return
    }

    let active = true

    Promise.all([getAccounts(provider), getChainId(provider)])
      .then(([accounts, chainId]) => {
        if (!active) {
          return
        }

        const account = accounts[0] ?? ''
        setWallet({
          account,
          chainId,
          status: account ? 'connected' : 'idle',
          error: '',
        })

        if (account) {
          setForm((current) => ({ ...current, receiverWallet: current.receiverWallet || account }))
        }
      })
      .catch((error) => {
        setWallet({
          account: '',
          chainId: '',
          status: 'error',
          error: readProviderErrorMessage(error),
        })
      })

    const handleAccountsChanged = (...args: unknown[]) => {
      const accounts = Array.isArray(args[0]) ? (args[0] as string[]) : []
      const account = accounts[0] ?? ''

      setWallet((current) => ({
        ...current,
        account,
        status: account ? 'connected' : 'idle',
        error: '',
      }))

      if (account) {
        setForm((current) => ({ ...current, receiverWallet: current.receiverWallet || account }))
      }
    }

    const handleChainChanged = (...args: unknown[]) => {
      setWallet((current) => ({
        ...current,
        chainId: String(args[0] ?? '').toLowerCase(),
        error: '',
      }))
    }

    provider.on?.('accountsChanged', handleAccountsChanged)
    provider.on?.('chainChanged', handleChainChanged)

    return () => {
      active = false
      provider.removeListener?.('accountsChanged', handleAccountsChanged)
      provider.removeListener?.('chainChanged', handleChainChanged)
    }
  }, [])

  const connectWallet = async () => {
    const provider = getProvider()

    if (!provider) {
      setWallet({
        account: '',
        chainId: '',
        status: 'missing',
        error: text.wallet.missing,
      })
      return
    }

    setWallet((current) => ({ ...current, status: 'connecting', error: '' }))

    try {
      const accounts = await requestAccounts(provider)
      const chainId = await getChainId(provider)
      const account = accounts[0] ?? ''

      if (!account) {
        throw new Error(text.wallet.noAccount)
      }

      setWallet({
        account,
        chainId,
        status: 'connected',
        error: '',
      })
      setForm((current) => ({ ...current, receiverWallet: current.receiverWallet || account }))
    } catch (error) {
      setWallet((current) => ({
        ...current,
        status: 'error',
        error: readProviderErrorMessage(error),
      }))
    }
  }

  const switchNetwork = async () => {
    const provider = getProvider()

    if (!provider) {
      setWallet((current) => ({ ...current, status: 'missing', error: text.wallet.missingShort }))
      return
    }

    try {
      const chainId = await switchToBnbChain(provider)
      setWallet((current) => ({ ...current, chainId, error: '' }))
    } catch (error) {
      setWallet((current) => ({ ...current, status: 'error', error: readProviderErrorMessage(error) }))
    }
  }

  const updateForm = <Key extends keyof FormState>(key: Key, value: FormState[Key]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const updateAllocation = (key: AllocationKey, value: number) => {
    setAllocation((current) => {
      const nextValue = Math.max(0, Math.min(100, value))

      return { ...current, [key]: nextValue }
    })
  }

  const updateAdvancedTax = <Key extends keyof AdvancedTaxState>(
    key: Key,
    value: AdvancedTaxState[Key],
  ) => {
    setAdvancedTax((current) => ({ ...current, [key]: value }))
  }

  const submitLaunch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!wallet.account) {
      await connectWallet()
      return
    }

    if (!onTargetNetwork) {
      await switchNetwork()
      return
    }

    const provider = getProvider()
    if (!provider) {
      setNotice({ kind: 'error', message: text.wallet.noProviderForTx })
      return
    }

    setDeployState('pending')
    setNotice({
      kind: 'info',
      message: launchpadConfig.backendUrl ? text.notice.prepareLaunch : text.notice.confirmDeploy,
    })

    try {
      const result = await createLaunchToken(
        provider,
        {
          form,
          allocation,
          advancedTax,
          buyTax,
          sellTax,
          templateId,
          avatar,
          whitelistEnabled: whitelistEnabled || Number(form.whitelistMintCount) > 0,
          liquidityTokenPercent,
        },
        language,
      )

      setDeployState('sent')
      setNotice({
        kind: 'info',
        message:
          result.predictedTokenAddress && result.vanitySuffix
            ? text.notice.txSubmittedWithVanity(
                shortHash(result.hash),
                result.vanitySuffix,
                shortAddress(result.predictedTokenAddress),
              )
            : text.notice.txSubmitted(shortHash(result.hash)),
      })

      try {
        const receipt = await waitForTransactionReceipt(provider, result.hash, 120_000, language)
        const tokenAddress = readLaunchCreatedToken(receipt)
        let verificationQueued = false
        if (tokenAddress && launchpadConfig.backendUrl) {
          const verifyResult = await queueProjectVerification(tokenAddress).catch(() => null)
          verificationQueued = Boolean(verifyResult?.ok)
        }
        setNotice({
          kind: 'success',
          message:
            tokenAddress && verificationQueued
              ? text.notice.txConfirmedWithBackend(shortAddress(tokenAddress))
              : text.notice.txConfirmed,
        })
        setProjectsRefreshKey((current) => current + 1)
        navigate('home')
      } catch (error) {
        const message = readProviderErrorMessage(error)
        const failed = /失败|failed|revert/i.test(message)
        setDeployState(failed ? 'blocked' : 'sent')
        setNotice({ kind: failed ? 'error' : 'info', message })
        setProjectsRefreshKey((current) => current + 1)
      }
    } catch (error) {
      setDeployState('blocked')
      setNotice({ kind: 'error', message: readProviderErrorMessage(error) })
    }
  }

  const submitWhitelistAllowances = async (project: LaunchProject, entries: WhitelistAllowanceEntry[]) => {
    const provider = getProvider()
    if (!provider) {
      setNotice({ kind: 'error', message: text.wallet.noProviderForTx })
      return
    }

    setNotice({ kind: 'info', message: text.notice.confirmWhitelist })

    try {
      if (wallet.account && !onTargetNetwork) {
        await switchNetwork()
      }

      if (!wallet.account) {
        const accounts = await requestAccounts(provider)
        const chainId = await getChainId(provider)
        setWallet({
          account: accounts[0] ?? '',
          chainId,
          status: accounts[0] ? 'connected' : 'idle',
          error: accounts[0] ? '' : text.wallet.noAccount,
        })
      }

      const result = await setProjectWhitelistAllowances(provider, project.vault, entries, language)
      setNotice({ kind: 'info', message: text.notice.whitelistSubmitted(shortHash(result.hash)) })
      await waitForTransactionReceipt(provider, result.hash, 120_000, language)
      setNotice({ kind: 'success', message: text.notice.whitelistConfirmed })
      setProjectsRefreshKey((current) => current + 1)
    } catch (error) {
      setNotice({ kind: 'error', message: readProviderErrorMessage(error) })
    }
  }

  const submitWhitelistMode = async (project: LaunchProject, enabled: boolean) => {
    const provider = getProvider()
    if (!provider) {
      setNotice({ kind: 'error', message: text.wallet.noProviderForTx })
      return
    }

    setNotice({ kind: 'info', message: text.notice.confirmWhitelistMode })

    try {
      if (wallet.account && !onTargetNetwork) {
        await switchNetwork()
      }

      if (!wallet.account) {
        const accounts = await requestAccounts(provider)
        const chainId = await getChainId(provider)
        setWallet({
          account: accounts[0] ?? '',
          chainId,
          status: accounts[0] ? 'connected' : 'idle',
          error: accounts[0] ? '' : text.wallet.noAccount,
        })
      }

      const result = await setProjectWhitelistEnabled(provider, project.vault, enabled, language)
      setNotice({ kind: 'info', message: text.notice.whitelistSubmitted(shortHash(result.hash)) })
      await waitForTransactionReceipt(provider, result.hash, 120_000, language)
      setNotice({ kind: 'success', message: text.notice.whitelistModeConfirmed })
      setProjectsRefreshKey((current) => current + 1)
    } catch (error) {
      setNotice({ kind: 'error', message: readProviderErrorMessage(error) })
    }
  }

  const submitProjectMint = async (project: LaunchProject, quantity: string) => {
    try {
      const provider = await prepareWalletTransaction()
      if (!provider) {
        return
      }

      const cost = getMintCostWei(project, quantity)

      if (
        project.paymentToken.toLowerCase() !== '0x0000000000000000000000000000000000000000' &&
        BigInt(project.mintPaymentAllowance || '0') < cost
      ) {
        setNotice({ kind: 'info', message: text.notice.confirmMintApproval })
        const approval = await approveProjectMintPayment(
          provider,
          project.paymentToken,
          project.vault,
          cost.toString(),
          language,
        )
        setNotice({ kind: 'info', message: text.notice.mintApprovalSubmitted(shortHash(approval.hash)) })
        await waitForTransactionReceipt(provider, approval.hash, 120_000, language)
        setNotice({ kind: 'info', message: text.notice.mintApprovalConfirmed })
      }

      setNotice({ kind: 'info', message: text.notice.confirmMint })
      const result = await mintLaunchProject(provider, project, quantity, language)
      setNotice({ kind: 'info', message: text.notice.mintSubmitted(shortHash(result.hash)) })
      await waitForTransactionReceipt(provider, result.hash, 120_000, language)
      setNotice({ kind: 'success', message: text.notice.mintConfirmed })
      setProjectsRefreshKey((current) => current + 1)
    } catch (error) {
      setNotice({ kind: 'error', message: readProviderErrorMessage(error) })
    }
  }

  const submitProjectRefund = async (project: LaunchProject) => {
    const provider = getProvider()
    if (!provider) {
      setNotice({ kind: 'error', message: text.wallet.noProviderForTx })
      return
    }

    try {
      if (wallet.account && !onTargetNetwork) {
        await switchNetwork()
      }

      if (!wallet.account) {
        const accounts = await requestAccounts(provider)
        const chainId = await getChainId(provider)
        setWallet({
          account: accounts[0] ?? '',
          chainId,
          status: accounts[0] ? 'connected' : 'idle',
          error: accounts[0] ? '' : text.wallet.noAccount,
        })
      }

      if (project.refundNeedsApproval) {
        setNotice({ kind: 'info', message: text.notice.confirmRefundApproval })
        const approval = await approveProjectRefundTokens(
          provider,
          project.token,
          project.vault,
          project.refundTokenAmount,
          language,
        )
        setNotice({ kind: 'info', message: text.notice.refundApprovalSubmitted(shortHash(approval.hash)) })
        await waitForTransactionReceipt(provider, approval.hash, 120_000, language)
        setNotice({ kind: 'info', message: text.notice.refundApprovalConfirmed })
      }

      setNotice({ kind: 'info', message: text.notice.confirmRefund })
      const result = await claimProjectRefund(provider, project.vault, language)
      setNotice({ kind: 'info', message: text.notice.refundSubmitted(shortHash(result.hash)) })
      await waitForTransactionReceipt(provider, result.hash, 120_000, language)
      setNotice({ kind: 'success', message: text.notice.refundConfirmed })
      setProjectsRefreshKey((current) => current + 1)
    } catch (error) {
      setNotice({ kind: 'error', message: readProviderErrorMessage(error) })
    }
  }

  const prepareWalletTransaction = async () => {
    const provider = getProvider()
    if (!provider) {
      setNotice({ kind: 'error', message: text.wallet.noProviderForTx })
      return null
    }

    let nextChainId = wallet.chainId
    if (!wallet.account) {
      const accounts = await requestAccounts(provider)
      const chainId = await getChainId(provider)
      nextChainId = chainId
      setWallet({
        account: accounts[0] ?? '',
        chainId,
        status: accounts[0] ? 'connected' : 'idle',
        error: accounts[0] ? '' : text.wallet.noAccount,
      })
    }

    if (nextChainId.toLowerCase() !== targetChainId) {
      await switchNetwork()
    }

    return provider
  }

  const submitProjectDividend = async (project: LaunchProject) => {
    try {
      const provider = await prepareWalletTransaction()
      if (!provider) {
        return
      }

      setNotice({
        kind: 'info',
        message: language === 'zh' ? '请在钱包里确认领取分红交易。' : 'Confirm the dividend claim transaction in your wallet.',
      })
      const result = await claimProjectDividend(provider, project.token, language)
      setNotice({
        kind: 'info',
        message:
          language === 'zh'
            ? `领取分红交易已提交：${shortHash(result.hash)}，正在等待链上确认。`
            : `Dividend claim submitted: ${shortHash(result.hash)}. Waiting for confirmation.`,
      })
      await waitForTransactionReceipt(provider, result.hash, 120_000, language)
      setNotice({
        kind: 'success',
        message: language === 'zh' ? '分红已领取，项目数据已刷新。' : 'Dividend claimed. Project data refreshed.',
      })
      setProjectsRefreshKey((current) => current + 1)
    } catch (error) {
      setNotice({ kind: 'error', message: readProviderErrorMessage(error) })
    }
  }

  const navigate = (nextPage: PageKey) => {
    window.location.hash = nextPage === 'home' ? '#/' : `#/${nextPage}`
    setPage(nextPage)
    setMenuOpen(false)
  }

  const openSwap = (tokenAddress?: string) => {
    if (tokenAddress) {
      window.open(buildPancakeSwapUrl(tokenAddress, 'buy'), '_blank', 'noreferrer')
    }
    setMenuOpen(false)
  }

  const openProjectDetail = (tokenAddress: string) => {
    window.location.hash = `#/detail?token=${tokenAddress}`
    setPage('detail')
    setMenuOpen(false)
  }

  const openFactory = () => {
    window.open(factoryExplorerUrl, '_blank', 'noreferrer')
  }

  const visibleNotice = wallet.error ? { kind: 'error' as const, message: wallet.error } : notice

  return (
    <div className="app">
      <Header
        activePage={page}
        connectWallet={connectWallet}
        menuOpen={menuOpen}
        navigate={navigate}
        setMenuOpen={setMenuOpen}
        text={text}
        wallet={wallet}
      />

      {visibleNotice && (
        <div className={`toast ${visibleNotice.kind}`}>
          {visibleNotice.kind === 'error' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
          {visibleNotice.message}
        </div>
      )}

      {page === 'home' && (
        <HomePage
          language={language}
          navigate={navigate}
          openProjectDetail={openProjectDetail}
          openSwap={openSwap}
          projectQuery={projectQuery}
          projects={projects}
          projectsError={projectsError}
          projectsStatus={projectsStatus}
          setProjectQuery={setProjectQuery}
          submitProjectMint={submitProjectMint}
          submitProjectRefund={submitProjectRefund}
          submitWhitelistAllowances={submitWhitelistAllowances}
          submitWhitelistMode={submitWhitelistMode}
          text={text}
          wallet={wallet}
        />
      )}
      {page === 'detail' && (
        <ProjectDetailPage
          initialTokenAddress={readDetailTokenFromHash()}
          language={language}
          navigate={navigate}
          openSwap={openSwap}
          projects={projects}
          projectsStatus={projectsStatus}
          submitProjectDividend={submitProjectDividend}
          text={text}
          wallet={wallet}
        />
      )}
      {page === 'launch' && (
        <LaunchPage
          advancedTax={advancedTax}
          allocation={allocation}
          allocationTotal={allocationTotal}
          avatar={avatar}
          buyTax={buyTax}
          deployState={deployState}
          form={form}
          isConfigured={isLaunchpadConfigured}
          language={language}
          liquidityTokenPercent={liquidityTokenPercent}
          onSubmit={submitLaunch}
          onTargetNetwork={onTargetNetwork}
          sellTax={sellTax}
          setAvatar={setAvatar}
          setBuyTax={setBuyTax}
          setLiquidityTokenPercent={setLiquidityTokenPercent}
          setSellTax={setSellTax}
          setTemplateId={setTemplateId}
          setWhitelistEnabled={setWhitelistEnabled}
          switchNetwork={switchNetwork}
          templateId={templateId}
          text={text}
          unallocated={unallocated}
          updateAdvancedTax={updateAdvancedTax}
          updateAllocation={updateAllocation}
          updateForm={updateForm}
          wallet={wallet}
          whitelistEnabled={whitelistEnabled}
        />
      )}
      {page === 'community' && (
        <CommunityPage
          language={language}
          navigate={navigate}
          openFactory={openFactory}
          projects={projects}
          projectsStatus={projectsStatus}
        />
      )}
      {page === 'verify' && (
        <SimplePanel
          button={text.verify.button}
          icon={<FileCode2 size={24} />}
          onClick={openFactory}
          subtitle={text.verify.subtitle}
          title={text.verify.title}
        />
      )}
    </div>
  )
}

function Header({
  activePage,
  connectWallet,
  menuOpen,
  navigate,
  setMenuOpen,
  text,
  wallet,
}: {
  activePage: PageKey
  connectWallet: () => void
  menuOpen: boolean
  navigate: (page: PageKey) => void
  setMenuOpen: (value: boolean) => void
  text: (typeof copy)[Language]
  wallet: WalletState
}) {
  const nav = [
    { page: 'home' as PageKey, label: text.nav.home, icon: <Home size={17} /> },
    { page: 'community' as PageKey, label: text.nav.community, icon: <MessageCircle size={17} /> },
    { page: 'verify' as PageKey, label: text.nav.verify, icon: <FileCode2 size={17} /> },
  ]
  const socialLinks = [
    { href: normalizeExternalUrl(import.meta.env.VITE_TELEGRAM_URL), label: 'Telegram', icon: <Send size={17} /> },
    { href: normalizeExternalUrl(import.meta.env.VITE_X_URL), label: 'X', icon: <AtSign size={17} /> },
  ].filter((item) => item.href)

  return (
    <header className="topbar">
      <a
        className="brand"
        href="#/"
        onClick={(event) => {
          event.preventDefault()
          navigate('home')
        }}
        aria-label={appName}
      >
        <span className="brand-mark">
          <img src="/rocket-logo.jpg" alt="" />
        </span>
        <span>
          <strong>{appName}</strong>
          <small>
            {activePage === 'launch'
              ? 'Mint'
              : activePage === 'community'
                ? 'Club'
                : 'Launch'}
          </small>
        </span>
      </a>

      <button
        className="menu-button"
        type="button"
        aria-label={menuOpen ? text.menuClose : text.menuOpen}
        onClick={() => setMenuOpen(!menuOpen)}
      >
        {menuOpen ? <X size={22} /> : <Menu size={22} />}
      </button>

      <nav className={menuOpen ? 'nav is-open' : 'nav'} aria-label={text.mainNav}>
        {socialLinks.map((item) => (
          <a href={item.href} key={item.label} target="_blank" rel="noreferrer" title={item.label}>
            {item.icon}
            <span>{item.label}</span>
          </a>
        ))}
        {nav.map((item) => (
          <button
            className={activePage === item.page ? 'nav-button active' : 'nav-button'}
            key={item.page}
            type="button"
            onClick={() => navigate(item.page)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
        <button className="deploy-nav" type="button" onClick={() => navigate('launch')}>
          <Rocket size={17} />
          {text.nav.launch}
        </button>
        <button className="wallet-button" type="button" onClick={connectWallet}>
          <Wallet size={17} />
          {wallet.status === 'connecting' ? text.wallet.connecting : wallet.account ? shortAddress(wallet.account) : text.wallet.connect}
        </button>
      </nav>
    </header>
  )
}

function HomePage({
  language,
  navigate,
  openProjectDetail,
  openSwap,
  projectQuery,
  projects,
  projectsError,
  projectsStatus,
  setProjectQuery,
  submitProjectMint,
  submitProjectRefund,
  submitWhitelistAllowances,
  submitWhitelistMode,
  text,
  wallet,
}: {
  language: Language
  navigate: (page: PageKey) => void
  openProjectDetail: (tokenAddress: string) => void
  openSwap: (tokenAddress?: string) => void
  projectQuery: string
  projects: LaunchProject[]
  projectsError: string
  projectsStatus: ProjectsStatus
  setProjectQuery: (value: string) => void
  submitProjectMint: (project: LaunchProject, quantity: string) => Promise<void>
  submitProjectRefund: (project: LaunchProject) => Promise<void>
  submitWhitelistAllowances: (project: LaunchProject, entries: WhitelistAllowanceEntry[]) => Promise<void>
  submitWhitelistMode: (project: LaunchProject, enabled: boolean) => Promise<void>
  text: (typeof copy)[Language]
  wallet: WalletState
}) {
  const [filter, setFilter] = useState<ProjectFilter>('all')
  const normalizedQuery = projectQuery.trim().toLowerCase()
  const filteredProjects = useMemo(
    () =>
      projects.filter((project) => {
        const matchesQuery =
          !normalizedQuery ||
          project.name.toLowerCase().includes(normalizedQuery) ||
          project.symbol.toLowerCase().includes(normalizedQuery) ||
          project.token.toLowerCase().includes(normalizedQuery) ||
          project.vault.toLowerCase().includes(normalizedQuery)

        if (!matchesQuery) {
          return false
        }

        if (filter === 'whitelist') {
          return project.whitelistEnabled && Number(project.whitelistMintCount) > 0
        }

        if (filter === 'completed') {
          return project.progress >= 100
        }

        if (filter === 'minting') {
          return project.progress < 100
        }

        return true
      }),
    [filter, normalizedQuery, projects],
  )

  const filterTabs: Array<{ key: ProjectFilter; label: string }> = [
    { key: 'all', label: text.projects.tabs.all },
    { key: 'minting', label: text.projects.tabs.minting },
    { key: 'whitelist', label: text.projects.tabs.whitelist },
    { key: 'completed', label: text.projects.tabs.completed },
  ]
  const activeProjects = projects.filter((project) => project.progress < 100).length
  const whitelistProjects = projects.filter(
    (project) => project.whitelistEnabled && Number(project.whitelistMintCount) > 0,
  ).length

  return (
    <main className="page page-command">
      <section className="home-deck">
        <div className="deck-copy">
          <div className="hero-kicker">
            <p>{text.home.eyebrow}</p>
            <em>BNB Smart Chain</em>
          </div>
          <h1>{text.home.title}</h1>
          <span>{text.home.subtitle}</span>
          <div className="banner-actions">
            <button className="primary-button" type="button" onClick={() => navigate('launch')}>
              <Rocket size={18} />
              {text.home.launch}
            </button>
            <button className="ghost-button" type="button" onClick={() => navigate('community')}>
              <MessageCircle size={18} />
              {text.home.openCommunity}
            </button>
          </div>
          <div className="deck-metrics" aria-label="Rocket tokenomics">
            <span>
              <b>20%</b>
              Marketing
            </span>
            <span>
              <b>56%</b>
              Buyback burn
            </span>
            <span>
              <b>24%</b>
              Holder rewards
            </span>
            <span>
              <b>10%</b>
              Cycle size
            </span>
            <span>
              <b>60s</b>
              Buyback cycle
            </span>
            <span>
              <b>0.02</b>
              BNB floor
            </span>
          </div>
        </div>

        <div className="deck-stage" aria-label={text.home.consoleAria}>
          <div className="orbit-radar">
            <span className="radar-ring ring-a" />
            <span className="radar-ring ring-b" />
            <span className="radar-ring ring-c" />
            <img src="/rocket-logo.jpg" alt="" />
          </div>
          <div className="stage-caption">
            <span>Protocol status</span>
            <strong>Auto buyback active</strong>
            <em>Whitelist mint open</em>
          </div>
        </div>

        <aside className="deck-panel">
          <div className="console-head">
            <span>{appSymbol} Launch Protocol</span>
            <strong>0.005 BNB</strong>
          </div>
          <div className="console-grid">
            {text.home.consoleStats.map((item) => (
              <div key={item[0]}>
                <small>{item[0]}</small>
                <strong>{item[1]}</strong>
                <span>{item[2]}</span>
              </div>
            ))}
          </div>
          <div className="console-flow">
            <span>{text.home.consoleFlow[0]}</span>
            <i />
            <span>{text.home.consoleFlow[1]}</span>
            <i />
            <span>{text.home.consoleFlow[2]}</span>
          </div>
        </aside>
      </section>

      <section className="mission-lanes">
        {text.home.features.map((feature) => (
          <article className="feature-card mission-card" key={feature[0]}>
            <p>{feature[0]}</p>
            <h2>{feature[1]}</h2>
            <span>{feature[2]}</span>
          </article>
        ))}
      </section>

      <section className="project-board radar-board">
        <div className="board-header">
          <div>
            <p>Launch registry</p>
            <h2>Live token launches</h2>
            <span>Filter minting, whitelist, and completed launches from the on-chain factory registry.</span>
          </div>
          <div className="board-stats">
            <span>
              <b>{projects.length}</b>
              Total
            </span>
            <span>
              <b>{activeProjects}</b>
              Active
            </span>
            <span>
              <b>{whitelistProjects}</b>
              Whitelist
            </span>
          </div>
        </div>

        <div className="radar-workspace">
          <aside className="radar-controls">
            <label className="project-search">
              <Search size={20} />
              <input
                placeholder={text.projects.search}
                value={projectQuery}
                onChange={(event) => setProjectQuery(event.target.value)}
              />
            </label>
            <div className="filter-tabs">
              {filterTabs.map((item) => (
                <button
                  className={filter === item.key ? 'active' : ''}
                  key={item.key}
                  type="button"
                  onClick={() => setFilter(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="radar-signal">
              <span>Factory</span>
              <strong>{isLaunchpadConfigured ? 'Online' : 'Offline'}</strong>
              <em>{isLaunchpadConfigured ? shortAddress(launchpadConfig.factoryAddress) : 'Not configured'}</em>
            </div>
          </aside>

          <div className="radar-feed">
            {projectsStatus === 'loading' && (
              <div className="project-grid">
                <ProjectSkeleton label={text.projects.loading} />
                <ProjectSkeleton label={text.projects.loading} />
                <ProjectSkeleton label={text.projects.loading} />
              </div>
            )}

            {projectsStatus !== 'loading' && projectsError && (
              <ProjectEmptyState
                actionLabel={text.projects.deployAction}
                message={projectsError}
                title={text.projects.readErrorTitle}
                onAction={() => navigate('launch')}
              />
            )}

            {projectsStatus !== 'loading' && !projectsError && filteredProjects.length === 0 && (
              <ProjectEmptyState
                actionLabel={text.projects.firstAction}
                message={readProjectEmptyMessage(projects.length, normalizedQuery, language)}
                title={isLaunchpadConfigured ? text.projects.emptyTitle : text.projects.notConfiguredTitle}
                onAction={() => navigate('launch')}
              />
            )}

            {projectsStatus !== 'loading' && !projectsError && filteredProjects.length > 0 && (
              <div className="project-grid">
                {filteredProjects.map((project) => (
                  <ProjectCard
                    key={project.token}
                    language={language}
                    openProjectDetail={openProjectDetail}
                    openSwap={openSwap}
                    project={project}
                    submitProjectMint={submitProjectMint}
                    submitProjectRefund={submitProjectRefund}
                    submitWhitelistAllowances={submitWhitelistAllowances}
                    submitWhitelistMode={submitWhitelistMode}
                    text={text}
                    wallet={wallet}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  )
}

function ProjectSkeleton({ label }: { label: string }) {
  return (
    <article className="project-card project-skeleton" aria-label={label}>
      <div className="project-head">
        <span />
        <div>
          <h3 />
          <p />
        </div>
        <em />
      </div>
      <div className="progress-track" />
      <div className="project-meta">
        <span />
        <span />
      </div>
    </article>
  )
}

function ProjectEmptyState({
  actionLabel,
  message,
  onAction,
  title,
}: {
  actionLabel: string
  message: string
  onAction: () => void
  title: string
}) {
  return (
    <div className="project-empty">
      <div className="simple-icon">
        <Rocket size={22} />
      </div>
      <h3>{title}</h3>
      <p>{message}</p>
      <button type="button" onClick={onAction}>
        {actionLabel}
      </button>
    </div>
  )
}

function ProjectCard({
  language,
  openProjectDetail,
  openSwap,
  project,
  submitProjectMint,
  submitProjectRefund,
  submitWhitelistAllowances,
  submitWhitelistMode,
  text,
  wallet,
}: {
  language: Language
  openProjectDetail: (tokenAddress: string) => void
  openSwap: (tokenAddress?: string) => void
  project: LaunchProject
  submitProjectMint: (project: LaunchProject, quantity: string) => Promise<void>
  submitProjectRefund: (project: LaunchProject) => Promise<void>
  submitWhitelistAllowances: (project: LaunchProject, entries: WhitelistAllowanceEntry[]) => Promise<void>
  submitWhitelistMode: (project: LaunchProject, enabled: boolean) => Promise<void>
  text: (typeof copy)[Language]
  wallet: WalletState
}) {
  const [copied, setCopied] = useState(false)
  const [mintQuantity, setMintQuantity] = useState('1')
  const [mintPending, setMintPending] = useState(false)
  const [whitelistBatch, setWhitelistBatch] = useState('')
  const [whitelistError, setWhitelistError] = useState('')
  const [whitelistSaving, setWhitelistSaving] = useState(false)
  const [whitelistModeSaving, setWhitelistModeSaving] = useState(false)
  const [refundPending, setRefundPending] = useState(false)
  const detectedWhitelistCount = collectWhitelistAccounts(whitelistBatch).length
  const progress = Math.min(100, Math.max(0, project.progress))
  const mintExpired = project.refundDeadline > 0 && Date.now() >= project.refundDeadline * 1000
  const mintOpen = !project.finalized && progress < 100 && !mintExpired
  const mintQuantityValue = Number(mintQuantity)
  const whitelistTotal = Number(project.whitelistMintCount)
  const whitelistMinted = Number(project.whitelistMintedCount)
  const totalWhitelistListed = Number(project.totalWhitelistAllowance || '0')
  const whitelistSlotsRemaining = Math.max(0, whitelistTotal - whitelistMinted)
  const userWhitelistRemaining = Number(project.whitelistRemaining || '0')
  const maxMintPerWallet = Number(project.maxMintPerWallet || '0')
  const userMintedCount = Number(project.userMintedCount || '0')
  const walletMintLimitRemaining =
    maxMintPerWallet > 0 ? Math.max(0, maxMintPerWallet - userMintedCount) : Number.POSITIVE_INFINITY
  const whitelistPhaseActive = project.whitelistEnabled && whitelistTotal > 0 && whitelistSlotsRemaining > 0
  const whitelistAllowsMint =
    !wallet.account ||
    !whitelistPhaseActive ||
    (userWhitelistRemaining > 0 &&
      (mintQuantityValue <= userWhitelistRemaining || userWhitelistRemaining >= whitelistSlotsRemaining))
  const walletLimitAllowsMint =
    !wallet.account || maxMintPerWallet <= 0 || mintQuantityValue <= walletMintLimitRemaining
  const phaseAllowsMint = whitelistAllowsMint && walletLimitAllowsMint
  const mintActionOpen = mintOpen && phaseAllowsMint
  const walletLimitText =
    maxMintPerWallet > 0
      ? language === 'zh'
        ? `单钱包最多 ${maxMintPerWallet} 份，当前还能 ${walletMintLimitRemaining} 份`
        : `Max ${maxMintPerWallet} per wallet, ${walletMintLimitRemaining} left`
      : language === 'zh'
        ? '单钱包不限份数'
        : 'No per-wallet cap'
  const whitelistStatusText = !project.whitelistEnabled || whitelistTotal <= 0
    ? language === 'zh'
      ? '公开 Mint'
      : 'Public mint'
    : !wallet.account
      ? language === 'zh'
        ? '连接钱包后查看白名单状态'
        : 'Connect wallet to check whitelist status'
      : whitelistPhaseActive && userWhitelistRemaining <= 0
        ? language === 'zh'
          ? '当前钱包不在白名单，不能 Mint'
          : 'Current wallet is not whitelisted'
        : whitelistPhaseActive
          ? language === 'zh'
            ? `当前钱包已加白，池内剩余 ${userWhitelistRemaining} 份`
            : `Wallet whitelisted, ${userWhitelistRemaining} pool slots left`
          : language === 'zh'
            ? '白名单阶段已结束，按公开规则 Mint'
            : 'Whitelist phase ended; public rules apply'
  const directMintText = project.paymentToken.toLowerCase() === '0x0000000000000000000000000000000000000000'
    ? language === 'zh'
      ? `转账即 Mint 请转 Token 合约 ${shortAddress(project.token)}，不要直接转 Vault`
      : `For transfer-to-mint, send BNB to Token ${shortAddress(project.token)}, not the Vault`
    : language === 'zh'
      ? '代币支付需要先授权，请使用 Mint 按钮'
      : 'Token payment requires approval; use the Mint button'
  const mintCostWei = getMintCostWei(project, mintQuantity)
  const mintNeedsApproval =
    project.paymentToken.toLowerCase() !== '0x0000000000000000000000000000000000000000' &&
    BigInt(project.mintPaymentAllowance || '0') < mintCostWei
  const mintButtonText = mintPending
    ? text.projects.whitelistPending
    : !mintOpen
      ? text.projects.mintClosed
      : !walletLimitAllowsMint
        ? language === 'zh' ? '超过单钱包限制' : 'Wallet limit'
        : !whitelistAllowsMint
        ? language === 'zh' ? '公开未开放' : 'Public locked'
        : mintNeedsApproval ? text.projects.approveMint : text.projects.mint
  const status = project.finalized
    ? text.projects.statusTrading
    : progress >= 100
      ? text.projects.statusCompleted
      : project.whitelistEnabled && Number(project.whitelistMintCount) > 0 ? text.projects.statusWhitelist : text.projects.statusMinting
  const explorerUrl = `${BNB_CHAIN.blockExplorerUrls[0]}/address/${project.token}`
  const canManageWhitelist =
    mintOpen &&
    project.whitelistEnabled &&
    Number(project.whitelistMintCount) > 0 &&
    Boolean(wallet.account) &&
    wallet.account.toLowerCase() === project.creator.toLowerCase()
  const createdAt =
    project.createdAt > 0
      ? new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }).format(project.createdAt * 1000)
      : language === 'zh'
        ? '链上记录'
        : 'On-chain'
  const refundStatusText = readRefundStatusText(project, wallet, progress, language, text)
  const refundButtonDisabled = !project.canRefund || refundPending

  return (
    <article className="project-card">
      <div className="project-head">
        <ProjectAvatar project={project} />
        <div>
          <h3>{project.name}</h3>
          <div className="project-identity">
            <span>
              {project.symbol} · {shortAddress(project.token)} · {createdAt}
            </span>
            <button
              className={copied ? 'copy-address copied' : 'copy-address'}
              type="button"
              title={copied ? text.projects.copied : text.projects.copyAddress}
              onClick={async () => {
                await copyTextToClipboard(project.token)
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1400)
              }}
            >
              <Copy size={13} />
              {copied ? text.projects.copied : text.projects.copyAddress}
            </button>
          </div>
        </div>
        <em>{status}</em>
      </div>
      <p className="project-description">{project.description || text.projects.fallbackDescription}</p>
      <div className="progress-row">
        <span>{text.projects.progress}</span>
        <strong>{progress.toFixed(2)}%</strong>
      </div>
      <div className="progress-track">
        <i style={{ width: `${progress}%` }} />
      </div>
      <div className="project-meta">
        <span>
          {project.mintedCount}/{project.mintCount}
        </span>
        <span>{project.mintPrice}</span>
      </div>
      <div className="project-quota">
        {formatQuotaText(project, text, language)}
      </div>
      <div className={project.canRefund ? 'refund-state available' : 'refund-state'}>
        <span>{refundStatusText}</span>
        <button
          className="refund-button"
          type="button"
          disabled={refundButtonDisabled}
          onClick={async () => {
            if (refundButtonDisabled) {
              return
            }
            setRefundPending(true)
            try {
              await submitProjectRefund(project)
            } finally {
              setRefundPending(false)
            }
          }}
        >
          <Wallet size={15} />
          {project.canRefund ? (refundPending ? text.projects.whitelistPending : text.projects.refund) : text.projects.refundLocked}
        </button>
      </div>
      {!project.finalized && progress < 100 && (
        <form
          className="mint-panel"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!mintActionOpen || mintPending) {
              return
            }
            setMintPending(true)
            try {
              await submitProjectMint(project, mintQuantity)
            } finally {
              setMintPending(false)
            }
          }}
        >
          <div>
            <label>
              <span>{text.projects.mintQuantity}</span>
              <input
                inputMode="numeric"
                max={maxMintPerWallet > 0 ? String(Math.max(1, walletMintLimitRemaining)) : undefined}
                min="1"
                type="number"
                value={mintQuantity}
                onChange={(event) => setMintQuantity(normalizeMintInput(event.target.value))}
              />
            </label>
            <strong>{text.projects.mintCost(formatMintCost(project, mintQuantity))}</strong>
          </div>
          {project.whitelistEnabled && wallet.account && (
            <em>{text.projects.whitelistRemaining(project.whitelistRemaining)}</em>
          )}
          <div className="mint-rule-list">
            <span>{whitelistStatusText}</span>
            <span>{walletLimitText}</span>
            <span>{directMintText}</span>
          </div>
          {whitelistPhaseActive && wallet.account && !whitelistAllowsMint && (
            <em>{language === 'zh' ? '白名单阶段，公开会在白名单打满后开放' : 'Whitelist phase is active. Public mint opens after whitelist fills.'}</em>
          )}
          {wallet.account && !walletLimitAllowsMint && (
            <em>{language === 'zh' ? '当前数量超过单钱包上限，请改成剩余额度以内。' : 'Quantity exceeds this wallet limit. Reduce it to the remaining allowance.'}</em>
          )}
          <button className="submit-button" type="submit" disabled={!mintActionOpen || mintPending}>
            <Rocket size={16} />
            {mintButtonText}
          </button>
        </form>
      )}
      <div className="project-links">
        {project.website && (
          <a href={project.website} target="_blank" rel="noreferrer" title={text.projects.website}>
            <Globe2 size={15} />
          </a>
        )}
        {project.telegram && (
          <a href={project.telegram} target="_blank" rel="noreferrer" title="Telegram">
            <Send size={15} />
          </a>
        )}
        {project.xLink && (
          <a href={project.xLink} target="_blank" rel="noreferrer" title="X">
            <AtSign size={15} />
          </a>
        )}
      </div>
      <div className="project-actions">
        <button type="button" onClick={() => window.open(explorerUrl, '_blank', 'noreferrer')}>
          <ExternalLink size={16} />
          {text.projects.viewBscScan}
        </button>
        <button type="button" onClick={() => openProjectDetail(project.token)}>
          <FileCode2 size={16} />
          {text.projects.detail}
        </button>
        {project.finalized && (
          <button type="button" onClick={() => openSwap(project.token)}>
            <ArrowUpDown size={16} />
            {text.projects.trade}
          </button>
        )}
      </div>
      {canManageWhitelist && (
        <form
          className="whitelist-manager"
          onSubmit={async (event) => {
            event.preventDefault()
            setWhitelistSaving(true)
            setWhitelistError('')
            try {
              const entries = parseWhitelistBatch(whitelistBatch, language)
              await submitWhitelistAllowances(project, entries)
              setWhitelistBatch('')
            } catch (error) {
              setWhitelistError(readProviderErrorMessage(error))
            } finally {
              setWhitelistSaving(false)
            }
          }}
        >
          <strong>
            <UserPlus size={15} />
            {text.projects.whitelistManage}
          </strong>
          <div className="whitelist-capacity">
            <span>{language === 'zh' ? '白名单列表' : 'Whitelist list'}</span>
            <strong>
              {language === 'zh' ? `${totalWhitelistListed} 个地址` : `${totalWhitelistListed} addresses`}
            </strong>
            <em>{language === 'zh' ? `剩余可 mint ${whitelistSlotsRemaining} 份` : `${whitelistSlotsRemaining} mint slots left`}</em>
          </div>
          {whitelistPhaseActive && (
            <button
              className="whitelist-mode-button"
              type="button"
              disabled={whitelistModeSaving}
              onClick={async () => {
                setWhitelistModeSaving(true)
                setWhitelistError('')
                try {
                  await submitWhitelistMode(project, false)
                } finally {
                  setWhitelistModeSaving(false)
                }
              }}
            >
              <Rocket size={15} />
              {whitelistModeSaving ? text.projects.whitelistPending : text.projects.openPublicMint}
            </button>
          )}
          <textarea
            className="whitelist-batch-input"
            autoCapitalize="none"
            autoCorrect="off"
            placeholder={text.projects.whitelistAddress}
            rows={8}
            spellCheck={false}
            value={whitelistBatch}
            onChange={(event) => setWhitelistBatch(event.target.value)}
          />
          <div className="whitelist-count simple">
            <span>{language === 'zh' ? `已识别 ${detectedWhitelistCount} 个地址` : `${detectedWhitelistCount} addresses detected`}</span>
            <strong>{language === 'zh' ? '名单可超额添加，mint 时按剩余份数先到先得' : 'List can be overbooked; mint slots are first come, first served'}</strong>
          </div>
          <em>{text.projects.whitelistBatchHint}</em>
          {whitelistError && <small className="form-error">{whitelistError}</small>}
          <button type="submit" disabled={whitelistSaving}>
            {whitelistSaving ? text.projects.whitelistPending : text.projects.whitelistSubmit}
          </button>
        </form>
      )}
    </article>
  )
}

function ProjectDetailPage({
  initialTokenAddress,
  language,
  navigate,
  openSwap,
  projects,
  projectsStatus,
  submitProjectDividend,
  text,
  wallet,
}: {
  initialTokenAddress: string
  language: Language
  navigate: (page: PageKey) => void
  openSwap: (tokenAddress?: string) => void
  projects: LaunchProject[]
  projectsStatus: ProjectsStatus
  submitProjectDividend: (project: LaunchProject) => Promise<void>
  text: (typeof copy)[Language]
  wallet: WalletState
}) {
  const [copiedKey, setCopiedKey] = useState('')
  const [dividendPending, setDividendPending] = useState(false)
  const normalizedToken = initialTokenAddress.toLowerCase()
  const project = projects.find((item) => item.token.toLowerCase() === normalizedToken)
  const allocation = allocationTranslations[language]

  const copyAddress = async (key: string, value: string) => {
    await copyTextToClipboard(value)
    setCopiedKey(key)
    window.setTimeout(() => setCopiedKey(''), 1400)
  }

  if (projectsStatus === 'loading') {
    return (
      <main className="page narrow">
        <section className="simple-panel">
          <div className="simple-icon">
            <Rocket size={22} />
          </div>
          <h1>{text.detail.loading}</h1>
          <p>{initialTokenAddress || launchpadConfig.factoryAddress}</p>
        </section>
      </main>
    )
  }

  if (!project) {
    return (
      <main className="page narrow">
        <section className="simple-panel">
          <div className="simple-icon">
            <AlertCircle size={22} />
          </div>
          <h1>{text.detail.missingTitle}</h1>
          <p>{text.detail.missingDesc}</p>
          <button className="submit-button" type="button" onClick={() => navigate('home')}>
            <Rocket size={18} />
            {text.detail.back}
          </button>
        </section>
      </main>
    )
  }

  const explorerUrl = `${BNB_CHAIN.blockExplorerUrls[0]}/address/${project.token}`
  const splitTotal = project.fundFeeBps + project.lpFeeBps + project.dividendFeeBps + project.burnFeeBps
  const unallocatedBps = Math.max(0, 10_000 - splitTotal)
  const marketingSplitBps = project.fundFeeBps + unallocatedBps
  const marketingReceiver =
    project.platformFeeReceiver &&
    isAddress(project.platformFeeReceiver) &&
    project.platformFeeReceiver.toLowerCase() !== ZERO_ADDRESS.toLowerCase()
      ? project.platformFeeReceiver
      : project.receiver
  const taxShare = (taxBps: number, shareBps: number) => (taxBps * shareBps) / 10_000
  const visibleTaxPortion = (taxBps: number, splitBps: number) => taxShare(taxBps, splitBps)
  const portionPair = (splitBps: number) =>
    text.detail.taxPortionPair(
      formatTaxPortionBps(visibleTaxPortion(project.buyTaxBps, splitBps)),
      formatTaxPortionBps(visibleTaxPortion(project.sellTaxBps, splitBps)),
    )
  const taxSummary = (taxBps: number) => {
    if (taxBps <= 0) {
      return text.detail.noTax
    }

    const splitSummary = [
      `${allocation.marketing.label} ${formatTaxPortionBps(visibleTaxPortion(taxBps, marketingSplitBps))}`,
      `${allocation.liquidity.label} ${formatTaxPortionBps(visibleTaxPortion(taxBps, project.lpFeeBps))}`,
      `${allocation.rewards.label} ${formatTaxPortionBps(visibleTaxPortion(taxBps, project.dividendFeeBps))}`,
      `${allocation.burn.label} ${formatTaxPortionBps(visibleTaxPortion(taxBps, project.burnFeeBps))}`,
    ]

    return `${formatBps(taxBps)} (${splitSummary.join(' / ')})`
  }
  const progress = Math.min(100, Math.max(0, project.progress))
  const unpaidDividendWei = BigInt(project.userDividendUnpaid || '0')
  const rewardLabel = project.rewardToken.toLowerCase() === USDT_ADDRESS.toLowerCase()
    ? 'USDT'
    : shortAddress(project.rewardToken)
  const dividendDisplay = `${formatDisplayAmount(project.userDividendUnpaidFormatted)} ${rewardLabel}`

  return (
    <main className="page detail-page">
      <section className="detail-hero">
        <div className="detail-title">
          <ProjectAvatar project={project} size="detail" />
          <div>
            <p>{text.detail.eyebrow}</p>
            <h1>{text.detail.title(project.name)}</h1>
            <small>
              {project.symbol} · {shortAddress(project.token)}
            </small>
          </div>
        </div>
        <div className="detail-actions">
          <button type="button" onClick={() => navigate('home')}>
            <Rocket size={16} />
            {text.detail.back}
          </button>
          <button type="button" onClick={() => copyAddress('token', project.token)}>
            <Copy size={16} />
            {copiedKey === 'token' ? text.projects.copied : text.detail.copyToken}
          </button>
          <button type="button" onClick={() => window.open(explorerUrl, '_blank', 'noreferrer')}>
            <ExternalLink size={16} />
            {text.detail.openExplorer}
          </button>
          {project.finalized && (
            <button className="submit-button" type="button" onClick={() => openSwap(project.token)}>
              <ArrowUpDown size={16} />
              {text.detail.trade}
            </button>
          )}
        </div>
      </section>

      <section className="detail-grid">
        <div className="mechanism-panel">
          <div className="mechanism-head">
            <div>
              <p>{text.detail.taxMechanism}</p>
              <h2>{text.detail.mechanism}</h2>
            </div>
            <span>{text.detail.rewardBadge(project.rewardToken)}</span>
          </div>

          <DetailRow
            label={text.detail.contractBalance}
            value={`${formatDisplayAmount(project.vaultTokenBalance)} ${project.symbol}`}
            helper={text.detail.vaultBalanceHint}
          />
          <DetailRow label={text.detail.buyTax} value={taxSummary(project.buyTaxBps)} />
          <DetailRow label={text.detail.sellTax} value={taxSummary(project.sellTaxBps)} />
          <DetailRow
            label={language === 'zh' ? '转账税' : 'Transfer tax'}
            value={taxSummary(project.transferTaxBps)}
          />
          <DetailRow
            label={language === 'zh' ? '加池税' : 'Add LP tax'}
            value={taxSummary(project.addLiquidityTaxBps)}
          />
          <DetailRow
            label={language === 'zh' ? '撤池税' : 'Remove LP tax'}
            value={taxSummary(project.removeLiquidityTaxBps)}
          />
          <DetailRow
            label={language === 'zh' ? '开盘保护' : 'Launch guard'}
            value={
              project.launchProtectionTaxBps > 0 && project.launchProtectionBlocks > 0
                ? `${formatBps(project.launchProtectionTaxBps)} / ${project.launchProtectionBlocks} ${
                    language === 'zh' ? '区块' : 'blocks'
                  }`
                : text.detail.disabled
            }
          />
          <DetailRow
            label={language === 'zh' ? '分红间隔' : 'Claim wait'}
            value={`${project.claimWait}s`}
          />
          <DetailRow
            label={text.detail.marketing}
            value={`${portionPair(marketingSplitBps)} -> ${text.detail.toReceiver(marketingReceiver)}`}
          />
          <DetailRow
            label={text.detail.liquidity}
            value={`${portionPair(project.lpFeeBps)} -> ${text.detail.toBlackHole}`}
          />
          <DetailRow
            label={text.detail.rewards}
            value={`${portionPair(project.dividendFeeBps)} -> ${text.detail.toRewardToken(project.rewardToken)}`}
          />
          <DetailRow
            label={text.detail.burn}
            value={`${portionPair(project.burnFeeBps)} -> ${text.detail.toBurn}`}
          />
          <DetailRow
            label={text.detail.rewardThreshold}
            value={`${formatDisplayAmount(project.rewardThreshold)} ${text.detail.tokenUnit(project.symbol)}`}
          />
          <DetailRow
            label={text.detail.tradingState}
            value={project.finalized ? text.detail.tradingFinalized : text.detail.tradingPending}
          />
        </div>

        <aside className="detail-side">
          <div className="detail-stat-panel">
            <p>{text.detail.mintProgress}</p>
            <strong>{progress.toFixed(2)}%</strong>
            <div className="progress-track">
              <i style={{ width: `${progress}%` }} />
            </div>
            <span>
              {project.mintedCount}/{project.mintCount}
            </span>
          </div>

          <div className="detail-stat-panel dividend-claim-panel">
            <p>{language === 'zh' ? '可领分红' : 'Claimable dividends'}</p>
            <strong>{dividendDisplay}</strong>
            <span>
              {wallet.account
                ? language === 'zh' ? '来自链上分红池' : 'From the on-chain dividend pool'
                : language === 'zh' ? '连接钱包后读取' : 'Connect wallet to read'}
            </span>
            <button
              className="submit-button"
              type="button"
              disabled={!wallet.account || unpaidDividendWei <= 0n || dividendPending}
              onClick={async () => {
                setDividendPending(true)
                try {
                  await submitProjectDividend(project)
                } finally {
                  setDividendPending(false)
                }
              }}
            >
              <Wallet size={16} />
              {dividendPending
                ? language === 'zh' ? '等待确认' : 'Waiting'
                : language === 'zh' ? '领取分红' : 'Claim dividends'}
            </button>
          </div>

          <div className="detail-stat-list">
            <DetailMiniStat label={text.detail.supply} value={`${formatDisplayAmount(project.totalSupply)} ${project.symbol}`} />
            <DetailMiniStat
              label={text.detail.whitelist}
              value={project.whitelistEnabled ? text.detail.enabled : text.detail.disabled}
            />
            <DetailMiniStat label={text.detail.receiver} value={shortAddress(project.receiver)} />
          </div>

          <div className="address-panel">
            <AddressLine
              copied={copiedKey === 'token'}
              label={text.detail.token}
              value={project.token}
              copiedText={text.projects.copied}
              copyText={text.detail.copyToken}
              onCopy={() => copyAddress('token', project.token)}
            />
            <AddressLine
              copied={copiedKey === 'vault'}
              label={text.detail.vault}
              value={project.vault}
              copiedText={text.projects.copied}
              copyText={text.detail.copyVault}
              onCopy={() => copyAddress('vault', project.vault)}
            />
          </div>
        </aside>
      </section>
    </main>
  )
}

function DetailRow({ helper, label, value }: { helper?: string; label: string; value: string }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
      {helper && <em>{helper}</em>}
    </div>
  )
}

function DetailMiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function AddressLine({
  copied,
  copiedText,
  copyText,
  label,
  onCopy,
  value,
}: {
  copied: boolean
  copiedText: string
  copyText: string
  label: string
  onCopy: () => void
  value: string
}) {
  return (
    <div className="address-line">
      <span>{label}</span>
      <strong>{shortAddress(value)}</strong>
      <button type="button" onClick={onCopy}>
        <Copy size={14} />
        {copied ? copiedText : copyText}
      </button>
    </div>
  )
}

function LaunchPage({
  advancedTax,
  allocation,
  allocationTotal,
  avatar,
  buyTax,
  deployState,
  form,
  isConfigured,
  language,
  liquidityTokenPercent,
  onSubmit,
  onTargetNetwork,
  sellTax,
  setAvatar,
  setBuyTax,
  setLiquidityTokenPercent,
  setSellTax,
  setTemplateId,
  setWhitelistEnabled,
  switchNetwork,
  templateId,
  text,
  unallocated,
  updateAdvancedTax,
  updateAllocation,
  updateForm,
  wallet,
  whitelistEnabled,
}: {
  advancedTax: AdvancedTaxState
  allocation: AllocationState
  allocationTotal: number
  avatar: string
  buyTax: number
  deployState: DeployState
  form: FormState
  isConfigured: boolean
  language: Language
  liquidityTokenPercent: string
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onTargetNetwork: boolean
  sellTax: number
  setAvatar: (value: string) => void
  setBuyTax: (value: number) => void
  setLiquidityTokenPercent: (value: string) => void
  setSellTax: (value: number) => void
  setTemplateId: (value: TemplateId) => void
  setWhitelistEnabled: (value: boolean) => void
  switchNetwork: () => void
  templateId: TemplateId
  text: (typeof copy)[Language]
  unallocated: number
  updateAdvancedTax: <Key extends keyof AdvancedTaxState>(key: Key, value: AdvancedTaxState[Key]) => void
  updateAllocation: (key: AllocationKey, value: number) => void
  updateForm: <Key extends keyof FormState>(key: Key, value: FormState[Key]) => void
  wallet: WalletState
  whitelistEnabled: boolean
}) {
  const selectedTemplate = templates.find((item) => item.id === templateId) ?? templates[0]
  const selectedTemplateText = translateTemplate(selectedTemplate, language)
  const selectedPayment =
    paymentTokens.find((token) => token.address.toLowerCase() === form.paymentToken.toLowerCase()) ??
    paymentTokens[0]
  const totalMintCount = Number(form.publicMintCount || 0) + Number(form.whitelistMintCount || 0)
  const guardDurationHint = formatGuardDuration(advancedTax.launchProtectionBlocks, language)
  const advancedTaxCopy = language === 'zh'
    ? {
        title: '高级税收',
        transferTax: '转账税',
        addLiquidityTax: '加池税',
        removeLiquidityTax: '撤池税',
        launchProtectionTax: '开盘保护税',
        launchProtectionBlocks: '保护区块',
        claimWait: '分红间隔(秒)',
      }
    : {
        title: 'Advanced taxes',
        transferTax: 'Transfer tax',
        addLiquidityTax: 'Add LP tax',
        removeLiquidityTax: 'Remove LP tax',
        launchProtectionTax: 'Launch guard tax',
        launchProtectionBlocks: 'Guard blocks',
        claimWait: 'Claim wait (sec)',
      }
  const [avatarError, setAvatarError] = useState('')

  const handleAvatarFile = async (file?: File) => {
    if (!file) {
      return
    }

    setAvatarError('')

    try {
      const nextAvatar = await normalizeAvatarFile(file)
      setAvatar(nextAvatar)
    } catch (error) {
      const message = error instanceof Error ? error.message : ''

      if (message === 'avatar-invalid') {
        setAvatarError(text.launch.avatarInvalid)
      } else if (message === 'avatar-source-large') {
        setAvatarError(text.launch.avatarTooLarge)
      } else {
        setAvatarError(text.launch.avatarMetadataTooLarge)
      }
    }
  }

  return (
    <main className="page narrow page-launch">
      <section className="status-strip launch-status-deck">
        <div className={wallet.account ? 'status-dot ok' : 'status-dot'} />
        <div>
          <p>{text.launch.network}</p>
          <strong>{onTargetNetwork ? BNB_CHAIN.chainName : text.launch.waitingNetwork}</strong>
          <span>
            {wallet.account
              ? `${shortAddress(wallet.account)} | ${text.launch.factory} ${
                  isConfigured ? shortAddress(launchpadConfig.factoryAddress) : text.launch.factoryUnset
                }`
              : text.launch.walletHint}
          </span>
        </div>
        {!onTargetNetwork && wallet.account && (
          <button type="button" onClick={switchNetwork}>
            {text.launch.switchNetwork}
          </button>
        )}
      </section>

      <form className="launch-grid launch-workbench" onSubmit={onSubmit}>
        <aside className="launch-steps" aria-label="Launch sequence">
          <div>
            <span>01</span>
            <strong>{text.launch.section01.replace(/^01\s*/, '')}</strong>
          </div>
          <div>
            <span>02</span>
            <strong>{text.launch.section02.replace(/^02\s*/, '')}</strong>
          </div>
          <div>
            <span>03</span>
            <strong>{text.launch.section03.replace(/^03\s*/, '')}</strong>
          </div>
          <div>
            <span>04</span>
            <strong>{text.launch.section04.replace(/^04\s*/, '')}</strong>
          </div>
          <div>
            <span>05</span>
            <strong>{text.launch.section05.replace(/^05\s*/, '')}</strong>
          </div>
          <div>
            <span>06</span>
            <strong>{text.launch.section06.replace(/^06\s*/, '')}</strong>
          </div>
        </aside>

        <div className="launch-form">
          <section className="form-section">
            <div className="section-head">
              <div>
                <p>{text.launch.section01}</p>
                <h1>{text.launch.title}</h1>
                <span>{text.launch.intro}</span>
              </div>
              <strong>{text.launch.feeBadge}</strong>
            </div>

            <div className="fields two">
              <InputField
                label={text.launch.tokenName}
                placeholder={text.launch.tokenNamePlaceholder}
                value={form.tokenName}
                onChange={(value) => updateForm('tokenName', value)}
              />
              <InputField
                label={text.launch.tokenSymbol}
                placeholder={text.launch.tokenSymbolPlaceholder}
                value={form.symbol}
                onChange={(value) => updateForm('symbol', value)}
              />
            </div>
            <div className="avatar-upload">
              <span>{text.launch.avatar}</span>
              <label className={avatar ? 'avatar-drop has-avatar' : 'avatar-drop'}>
                <input
                  className="sr-only"
                  type="file"
                  accept={avatarAccept}
                  onChange={(event) => {
                    void handleAvatarFile(event.target.files?.[0])
                    event.target.value = ''
                  }}
                />
                <span className="avatar-preview">
                  {avatar ? <img src={avatar} alt="" /> : <Plus size={30} />}
                </span>
                <span className="avatar-copy">
                  <strong>{avatar ? text.launch.avatarReady : text.launch.avatarTitle}</strong>
                  <em>{text.launch.avatarHint}</em>
                </span>
              </label>
              {avatar && (
                <div className="avatar-actions">
                  <label>
                    <ImagePlus size={15} />
                    {text.launch.avatarChange}
                    <input
                      className="sr-only"
                      type="file"
                      accept={avatarAccept}
                      onChange={(event) => {
                        void handleAvatarFile(event.target.files?.[0])
                        event.target.value = ''
                      }}
                    />
                  </label>
                  <button type="button" onClick={() => setAvatar('')}>
                    <Trash2 size={15} />
                    {text.launch.avatarRemove}
                  </button>
                </div>
              )}
              {avatarError && <p className="avatar-error">{avatarError}</p>}
            </div>
            <label className="field">
              <span>{text.launch.description}</span>
              <textarea
                placeholder={text.launch.descriptionPlaceholder}
                value={form.description}
                onChange={(event) => updateForm('description', event.target.value)}
              />
            </label>
          </section>

          <section className="form-section">
            <div className="section-head compact">
              <div>
                <p>{text.launch.section02}</p>
                <h2>{text.launch.templateTitle}</h2>
              </div>
              <strong>{selectedTemplateText.tag}</strong>
            </div>
            <div className="template-grid">
              {templates.map((item) => {
                const itemText = translateTemplate(item, language)

                return (
                  <button
                    className={item.id === templateId ? 'template-card active' : 'template-card'}
                    key={item.id}
                    type="button"
                    onClick={() => setTemplateId(item.id)}
                  >
                    <span>{itemText.tag}</span>
                    <strong>{itemText.name}</strong>
                    <em>{itemText.summary}</em>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="form-section">
            <div className="section-head compact">
              <div>
                <p>{text.launch.section03}</p>
                <h2>{text.launch.mintTitle}</h2>
              </div>
              <strong>{selectedPayment.label}</strong>
            </div>
            <div className="payment-grid">
              {paymentTokens.map((token) => (
                <button
                  className={token.address === form.paymentToken ? 'payment-token active' : 'payment-token'}
                  key={token.address}
                  type="button"
                  onClick={() => updateForm('paymentToken', token.address)}
                >
                  <strong>{token.symbol}</strong>
                  <span>{paymentTokenNotes[language][token.symbol] ?? token.note}</span>
                </button>
              ))}
            </div>
            <div className="fields two">
              <InputField label={text.launch.supply} value={form.supply} onChange={(value) => updateForm('supply', value)} />
              <InputField
                label={text.launch.publicMintCount}
                value={form.publicMintCount}
                onChange={(value) => updateForm('publicMintCount', value)}
              />
              <InputField
                label={text.launch.whitelistMintCount}
                value={form.whitelistMintCount}
                onChange={(value) => {
                  updateForm('whitelistMintCount', value)
                  setWhitelistEnabled(Number(value) > 0)
                }}
              />
              <InputField
                label={text.launch.maxMintPerWallet}
                placeholder={language === 'zh' ? '0 表示不限制' : '0 for unlimited'}
                value={form.maxMintPerWallet}
                onChange={(value) => updateForm('maxMintPerWallet', value)}
              />
              <InputField label={text.launch.mintPrice} value={form.mintPrice} onChange={(value) => updateForm('mintPrice', value)} />
              <div className="slider-field liquidity-slider">
                <label>
                  <span>{text.launch.liquidityTokenPercent}</span>
                  <strong>{liquidityTokenPercent}%</strong>
                </label>
                <input
                  type="range"
                  min="10"
                  max="90"
                  step="5"
                  value={liquidityTokenPercent}
                  onChange={(event) => setLiquidityTokenPercent(event.target.value)}
                />
                <small>{text.launch.liquidityTokenHint}</small>
              </div>
            </div>
            <div className="quota-summary">
              <span>{text.launch.mintCount}</span>
              <strong>{Number.isFinite(totalMintCount) ? totalMintCount.toLocaleString() : 0}</strong>
            </div>
            {whitelistEnabled && Number(form.whitelistMintCount || 0) > 0 && Number(form.publicMintCount || 0) <= 0 && (
              <div className="launch-warning">
                {language === 'zh'
                  ? '当前是纯白名单池：未加白钱包不能 Mint，白名单打满前公开不会开放。'
                  : 'This is a whitelist-only pool: unlisted wallets cannot mint, and public mint will not open before whitelist fills.'}
              </div>
            )}
            {Number(form.maxMintPerWallet || 0) > 0 && (
              <div className="launch-warning soft">
                {language === 'zh'
                  ? `单钱包最多 ${form.maxMintPerWallet} 份；转账即 Mint 也会受这个限制。`
                  : `Each wallet can mint up to ${form.maxMintPerWallet}; transfer-to-mint follows the same limit.`}
              </div>
            )}
            <label className="switch-row">
              <input
                checked={whitelistEnabled}
                type="checkbox"
                onChange={(event) => {
                  const checked = event.target.checked
                  setWhitelistEnabled(checked)
                  if (!checked) {
                    updateForm('whitelistMintCount', '0')
                  } else if (Number(form.whitelistMintCount) <= 0) {
                    updateForm('whitelistMintCount', '200')
                  }
                }}
              />
              <span>
                <strong>{text.launch.whitelistTitle}</strong>
                <em>{text.launch.whitelistDesc}</em>
              </span>
            </label>
          </section>

          <section className="form-section">
            <div className="section-head compact">
              <div>
                <p>{text.launch.section04}</p>
                <h2>{text.launch.taxTitle}</h2>
              </div>
              <strong>{text.launch.total(allocationTotal)}</strong>
            </div>
            <div className="tax-box">
              <SliderField label={text.launch.buyTax} value={buyTax} max={25} onChange={setBuyTax} />
              <SliderField label={text.launch.sellTax} value={sellTax} max={25} onChange={setSellTax} />
              <div className="advanced-tax-panel">
                <strong>{advancedTaxCopy.title}</strong>
                <div className="fields two">
                  <SliderField
                    label={advancedTaxCopy.transferTax}
                    value={advancedTax.transferTax}
                    max={25}
                    onChange={(value) => updateAdvancedTax('transferTax', value)}
                  />
                  <SliderField
                    label={advancedTaxCopy.addLiquidityTax}
                    value={advancedTax.addLiquidityTax}
                    max={25}
                    onChange={(value) => updateAdvancedTax('addLiquidityTax', value)}
                  />
                  <SliderField
                    label={advancedTaxCopy.removeLiquidityTax}
                    value={advancedTax.removeLiquidityTax}
                    max={25}
                    onChange={(value) => updateAdvancedTax('removeLiquidityTax', value)}
                  />
                  <SliderField
                    label={advancedTaxCopy.launchProtectionTax}
                    value={advancedTax.launchProtectionTax}
                    max={25}
                    onChange={(value) => updateAdvancedTax('launchProtectionTax', value)}
                  />
                  <InputField
                    label={advancedTaxCopy.launchProtectionBlocks}
                    helper={guardDurationHint}
                    value={advancedTax.launchProtectionBlocks}
                    onChange={(value) => updateAdvancedTax('launchProtectionBlocks', value)}
                  />
                  <InputField
                    label={advancedTaxCopy.claimWait}
                    value={advancedTax.claimWaitSeconds}
                    onChange={(value) => updateAdvancedTax('claimWaitSeconds', value)}
                  />
                </div>
              </div>
              <div className="tax-split">
                <TaxRing allocation={allocation} language={language} totalLabel={text.launch.totalAllocation} />
                <div className="fixed-tokenomics">
                  <div>
                    <span>Marketing route</span>
                    <strong>20%</strong>
                    <em>BNB routes to the project receiver wallet.</em>
                  </div>
                  <div>
                    <span>Auto buyback burn</span>
                    <strong>56%</strong>
                    <em>BNB buys back ROCKET and sends tokens to the dead address.</em>
                  </div>
                  <div>
                    <span>Holder dividends</span>
                    <strong>24%</strong>
                    <em>BNB routes into reward-token buys and deposits to the dividend pool.</em>
                  </div>
                  <div>
                    <span>Auto cycle</span>
                    <strong>10% / 60s</strong>
                    <em>Each cycle processes 10% of available pending BNB after the 0.02 BNB floor.</em>
                  </div>
                  <p className={allocationTotal > 100 ? 'tax-warning' : 'tax-note'}>
                    Fixed project route: 20% marketing, 56% buyback burn, 24% holder rewards, 0% LP route.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="form-section">
            <div className="section-head compact">
              <div>
                <p>{text.launch.section05}</p>
                <h2>{text.launch.receiverTitle}</h2>
              </div>
              <strong>{text.launch.onchain}</strong>
            </div>
            <div className="fields three">
              <InputField label={text.launch.receiverWallet} value={form.receiverWallet} onChange={(value) => updateForm('receiverWallet', value)} />
              <label className="field">
                <span>{text.launch.rewardToken}</span>
                <input
                  placeholder={text.launch.rewardTokenPlaceholder}
                  value={form.rewardToken}
                  onChange={(event) => updateForm('rewardToken', event.target.value)}
                />
                <em>{text.launch.rewardTokenDefault}</em>
              </label>
              <InputField label={text.launch.rewardThreshold} value={form.rewardThreshold} onChange={(value) => updateForm('rewardThreshold', value)} />
            </div>
          </section>

          <section className="form-section">
            <div className="section-head compact">
              <div>
                <p>{text.launch.section06}</p>
                <h2>{text.launch.linksTitle}</h2>
                <span>{text.launch.linksDesc}</span>
              </div>
              <strong>{text.optional}</strong>
            </div>
            <div className="link-fields">
              <LinkField
                icon={<Send size={18} />}
                label={text.launch.telegram}
                placeholder={text.optional}
                value={form.telegram}
                onChange={(value) => updateForm('telegram', value)}
              />
              <LinkField
                icon={<AtSign size={18} />}
                label={text.launch.x}
                placeholder={text.optional}
                value={form.xLink}
                onChange={(value) => updateForm('xLink', value)}
              />
              <LinkField
                icon={<Globe2 size={18} />}
                label={text.launch.website}
                placeholder={text.optional}
                value={form.website}
                onChange={(value) => updateForm('website', value)}
              />
            </div>
          </section>

          {!isConfigured && (
            <div className="config-warning">
              <AlertCircle size={18} />
              {text.launch.configWarning}
            </div>
          )}

          <button className="submit-button" type="submit" disabled={deployState === 'pending'}>
            <Rocket size={18} />
            {deployState === 'pending'
              ? text.launch.pending
              : !wallet.account
                ? text.wallet.connect
                : !onTargetNetwork
                  ? text.launch.switchNetwork
                  : text.launch.submit}
          </button>
        </div>

        <aside className="launch-side mission-preview">
          <div className="side-orbit">
            <img src="/rocket-logo.jpg" alt="" />
            <strong>ROCKET</strong>
            <span>{text.launch.mode}</span>
          </div>
          <div className="side-card launch-telemetry">
            <p>Mission telemetry</p>
            <div>
              <span>Auto buyback</span>
              <strong>10%</strong>
              <em>Every 60s after 0.02 BNB floor</em>
            </div>
            <div>
              <span>Marketing route</span>
              <strong>20%</strong>
              <em>BNB to receiver wallet</em>
            </div>
            <div>
              <span>Burn route</span>
              <strong>56%</strong>
              <em>BNB to dead address</em>
            </div>
            <div>
              <span>Reward route</span>
              <strong>24%</strong>
              <em>Holder dividend pool</em>
            </div>
          </div>
          <div className="side-card">
            <p>{text.launch.currentTemplate}</p>
            <h3>{selectedTemplate.name}</h3>
            <span>{selectedTemplateText.bestFor}</span>
            <ul>
              {selectedTemplateText.checks.map((check) => (
                <li key={check}>{check}</li>
              ))}
            </ul>
          </div>
          <div className="side-card">
            <p>{text.launch.preview}</p>
            <dl>
              <div>
                <dt>{text.launch.factory}</dt>
                <dd>{isConfigured ? shortAddress(launchpadConfig.factoryAddress) : text.launch.factoryUnset}</dd>
              </div>
              <div>
                <dt>{language === 'zh' ? '新项目尾号' : 'Vanity suffix'}</dt>
                <dd>{launchpadConfig.vanitySuffix ? launchpadConfig.vanitySuffix.toUpperCase() : 'EEEE'}</dd>
              </div>
              <div>
                <dt>{text.launch.deployFee}</dt>
                <dd>0.005 BNB</dd>
              </div>
              <div>
                <dt>{text.launch.paymentToken}</dt>
                <dd>{selectedPayment.symbol}</dd>
              </div>
              <div>
                <dt>{text.launch.mintQuota}</dt>
                <dd>{totalMintCount.toLocaleString()}</dd>
              </div>
              <div>
                <dt>{text.launch.maxMintPerWallet}</dt>
                <dd>{Number(form.maxMintPerWallet || 0) > 0 ? form.maxMintPerWallet : language === 'zh' ? '不限制' : 'Unlimited'}</dd>
              </div>
              <div>
                <dt>{text.launch.liquidityTokenPercent}</dt>
                <dd>{liquidityTokenPercent}%</dd>
              </div>
              <div>
                <dt>{text.launch.whitelist}</dt>
                <dd>{whitelistEnabled ? text.launch.enabled : text.launch.disabled}</dd>
              </div>
              <div>
                <dt>{text.launch.taxRate}</dt>
                <dd>
                  {buyTax}% / {sellTax}%
                </dd>
              </div>
            </dl>
          </div>
        </aside>
      </form>
    </main>
  )
}

async function normalizeAvatarFile(file: File) {
  if (!avatarAcceptedTypes.includes(file.type)) {
    throw new Error('avatar-invalid')
  }

  if (file.size > avatarMaxSourceBytes) {
    throw new Error('avatar-source-large')
  }

  if (file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/webp') {
    const compressed = await compressRasterAvatar(file)
    if (readTextBytes(compressed) > avatarMaxMetadataBytes) {
      throw new Error('avatar-metadata-large')
    }

    return compressed
  }

  const dataUrl = await readFileAsDataUrl(file)
  if (readTextBytes(dataUrl) > avatarMaxMetadataBytes) {
    throw new Error('avatar-metadata-large')
  }

  return dataUrl
}

async function compressRasterAvatar(file: File) {
  const dataUrl = await readFileAsDataUrl(file)
  const image = await loadDataUrlImage(dataUrl)
  const side = Math.min(image.naturalWidth || image.width, image.naturalHeight || image.height)
  const outputSize = Math.max(1, Math.min(avatarCanvasSize, side))
  const canvas = document.createElement('canvas')
  canvas.width = outputSize
  canvas.height = outputSize
  const context = canvas.getContext('2d')

  if (!context) {
    return dataUrl
  }

  const sourceX = ((image.naturalWidth || image.width) - side) / 2
  const sourceY = ((image.naturalHeight || image.height) - side) / 2
  context.drawImage(image, sourceX, sourceY, side, side, 0, 0, outputSize, outputSize)

  return canvas.toDataURL('image/webp', 0.82)
}

function loadDataUrlImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('avatar-invalid'))
    image.src = dataUrl
  })
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('avatar-invalid'))
      }
    }
    reader.onerror = () => reject(reader.error ?? new Error('avatar-invalid'))
    reader.readAsDataURL(file)
  })
}

function readTextBytes(value: string) {
  return new Blob([value]).size
}

function ProjectAvatar({ project, size = 'card' }: { project: LaunchProject; size?: 'card' | 'detail' }) {
  const fallback = project.symbol.slice(0, 1).toUpperCase() || '?'

  return (
    <span className={`project-avatar ${size}`}>
      {project.avatar ? <img src={project.avatar} alt="" loading="lazy" /> : fallback}
    </span>
  )
}

function formatGuardDuration(blocks: string, language: Language) {
  const blockCount = Number(blocks || 0)

  if (!Number.isFinite(blockCount) || blockCount <= 0) {
    return language === 'zh' ? '0 表示不启用开盘保护' : '0 disables launch guard'
  }

  const seconds = Math.round(blockCount * 3)
  if (seconds < 60) {
    return language === 'zh' ? `约 ${seconds} 秒，按 BSC 平均 3 秒/块估算` : `About ${seconds}s at ~3s per BSC block`
  }

  const minutes = seconds / 60
  const formatted = minutes >= 10 ? Math.round(minutes).toString() : minutes.toFixed(1).replace(/\.0$/, '')
  return language === 'zh'
    ? `约 ${formatted} 分钟，按 BSC 平均 3 秒/块估算`
    : `About ${formatted} min at ~3s per BSC block`
}

function InputField({
  helper,
  label,
  onChange,
  placeholder,
  value,
}: {
  helper?: string
  label: string
  onChange: (value: string) => void
  placeholder?: string
  value: string
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
      {helper && <em>{helper}</em>}
    </label>
  )
}

function LinkField({
  icon,
  label,
  onChange,
  placeholder,
  value,
}: {
  icon: ReactNode
  label: string
  onChange: (value: string) => void
  placeholder: string
  value: string
}) {
  return (
    <label className="link-field">
      <span className="link-icon">{icon}</span>
      <strong>{label}</strong>
      <input placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function SliderField({
  label,
  max,
  onChange,
  value,
}: {
  label: string
  max: number
  onChange: (value: number) => void
  value: number
}) {
  return (
    <label className="slider-field">
      <span>
        {label}
        <b>{value}%</b>
      </span>
      <input
        max={max}
        min={0}
        step={1}
        type="range"
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        onInput={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  )
}

function TaxRing({
  allocation,
  language,
  totalLabel,
}: {
  allocation: AllocationState
  language: Language
  totalLabel: string
}) {
  let cursor = 0
  const stops = allocationMeta.map((item) => {
    const start = cursor
    cursor += allocation[item.key]
    return `${item.color} ${start}% ${cursor}%`
  })
  const style = {
    '--tax-ring': `conic-gradient(${stops.join(', ')}, rgba(255,255,255,.1) ${cursor}% 100%)`,
  } as CSSProperties

  return (
    <div className="tax-ring-wrap">
      <div className="tax-ring" style={style}>
        <strong>{cursor}%</strong>
        <span>{totalLabel}</span>
      </div>
      <div className="tax-ring-legend">
        {allocationMeta.map((item) => {
          const itemText = allocationTranslations[language][item.key]

          return (
            <span key={item.key} style={{ '--dot-color': item.color } as CSSProperties}>
              <i />
              {itemText.label}
              <b>{allocation[item.key]}%</b>
            </span>
          )
        })}
      </div>
    </div>
  )
}

function CommunityPage({
  language,
  navigate,
  openFactory,
  projects,
  projectsStatus,
}: {
  language: Language
  navigate: (page: PageKey) => void
  openFactory: () => void
  projects: LaunchProject[]
  projectsStatus: ProjectsStatus
}) {
  const isZh = language === 'zh'
  const activeProjects = projects.filter((project) => project.progress < 100).length
  const finalizedProjects = projects.filter((project) => project.finalized || project.progress >= 100).length

  const facts = [
    {
      label: isZh ? '当前工厂' : 'Factory',
      value: shortAddress(launchpadConfig.factoryAddress),
      text: isZh ? '部署新币、Mint 池、白名单和退款都走这个工厂。' : 'Launches, mint vaults, whitelist, and refunds use this factory.',
    },
    {
      label: isZh ? '尾号规则' : 'Suffix',
      value: launchpadConfig.vanitySuffix ? launchpadConfig.vanitySuffix.toUpperCase() : 'EEEE',
      text: isZh ? '后端自动匹配靓号 Salt，链上工厂会再次校验。' : 'The backend mines a vanity salt and the factory verifies it on-chain.',
    },
    {
      label: isZh ? '链上项目' : 'Projects',
      value: projectsStatus === 'loading' ? '...' : String(projects.length),
      text: isZh ? `${activeProjects} 个进行中，${finalizedProjects} 个已完成。` : `${activeProjects} active, ${finalizedProjects} finalized.`,
    },
  ]

  return (
    <main className="page community-page">
      <section className="community-hero">
        <div>
          <p>{isZh ? 'PEPE 社区入口' : 'Rocket Mission Control'}</p>
          <h1>{isZh ? '一起发新币、看项目、接上链上记录' : 'Launch, track, and trade from one command deck'}</h1>
          <span>
            {isZh
              ? 'QQ群用于同步发射台更新、部署问题、Mint 记录和开盘提醒。页面功能仍然全部连接真实钱包和 BSC 链上合约。'
              : 'Track whitelist launches, deployment status, mint records, buyback mechanics, and market-open activity while staying connected to real BSC contracts.'}
          </span>
          <div className="community-actions">
            <button
              className="primary-button"
              type="button"
              onClick={() => window.open(normalizeExternalUrl(import.meta.env.VITE_TELEGRAM_URL) || 'https://telegram.org/', '_blank', 'noreferrer')}
            >
              <Send size={18} />
              Open Telegram
            </button>
            <button className="ghost-button" type="button" onClick={() => navigate('launch')}>
              <Rocket size={18} />
              {isZh ? '部署新币' : 'Launch token'}
            </button>
          </div>
        </div>
        <div className="community-badge" aria-label="Rocket community badge">
          <strong>ROCKET</strong>
          <span>20 marketing | 56 burn | 24 rewards | BSC</span>
        </div>
      </section>

      <section className="community-grid">
        {facts.map((fact) => (
          <article className="community-card" key={fact.label}>
            <p>{fact.label}</p>
            <h2>{fact.value}</h2>
            <span>{fact.text}</span>
          </article>
        ))}
      </section>

      <section className="community-panel">
        <div className="section-head compact">
          <div>
            <p>{isZh ? '常用入口' : 'Quick links'}</p>
            <h2>{isZh ? '社区里最常用的三件事' : 'The three useful places'}</h2>
          </div>
        </div>
        <div className="community-links">
          <button type="button" onClick={() => navigate('launch')}>
            <Rocket size={18} />
            <span>
              <b>{isZh ? '部署新币' : 'Launch token'}</b>
              <em>{isZh ? '填写参数后拉起真实钱包交易。' : 'Fill params and submit a real wallet transaction.'}</em>
            </span>
          </button>
          <button type="button" onClick={() => navigate('swap')}>
            <ArrowUpDown size={18} />
            <span>
              <b>{isZh ? '交易入口' : 'Swap'}</b>
              <em>{isZh ? '开盘后的项目可以跳转 Pancake 交易。' : 'Finalized projects can trade through PancakeSwap.'}</em>
            </span>
          </button>
          <button type="button" onClick={openFactory}>
            <FileCode2 size={18} />
            <span>
              <b>{isZh ? '查看工厂合约' : 'Factory source'}</b>
              <em>{isZh ? '直接打开 BscScan 验证源码页面。' : 'Open the verified BscScan source page.'}</em>
            </span>
          </button>
        </div>
      </section>
    </main>
  )
}

function SimplePanel({
  button,
  icon,
  onClick,
  subtitle,
  title,
}: {
  button: string
  icon: ReactNode
  onClick: () => void
  subtitle: string
  title: string
}) {
  return (
    <main className="page narrow">
      <section className="simple-panel">
        <div className="simple-icon">{icon}</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
        <button className="submit-button" type="button" onClick={onClick}>
          <ExternalLink size={18} />
          {button}
        </button>
      </section>
    </main>
  )
}

function translateTemplate(template: LaunchTemplate, language: Language) {
  const translation = templateTranslations[language][template.id]

  return {
    ...template,
    ...translation,
  }
}

function readProjectEmptyMessage(projectCount: number, query: string, language: Language) {
  if (!isLaunchpadConfigured) {
    return language === 'zh'
      ? '前端源码已内置当前 Factory 地址；如果这里没有读取到项目，请检查默认地址或链上网络。'
      : 'The current Factory address is built into the frontend source. If projects do not load, check the default address or chain network.'
  }

  if (projectCount > 0 && query) {
    return language === 'zh'
      ? '没有找到匹配的项目，可以换一个名称、符号或合约地址。'
      : 'No matching project found. Try another name, symbol, or contract address.'
  }

  if (projectCount > 0) {
    return language === 'zh' ? '当前筛选条件下没有项目。' : 'No projects match the current filter.'
  }

  return language === 'zh'
    ? '暂无链上项目。有人完成发布并确认交易后，会自动出现在这里。'
    : 'No on-chain projects yet. Once someone launches and the transaction confirms, it will appear here automatically.'
}

function readLanguagePreference(): Language {
  return 'en'
}

function readPageFromHash(): PageKey {
  const rawPage = window.location.hash.replace(/^#\/?/, '').split('?')[0]
  return pages.includes(rawPage as PageKey) ? (rawPage as PageKey) : 'home'
}

function readDetailTokenFromHash() {
  const query = window.location.hash.split('?')[1] ?? ''
  return new URLSearchParams(query).get('token') ?? ''
}

function readRefundStatusText(
  project: LaunchProject,
  wallet: WalletState,
  progress: number,
  language: Language,
  text: (typeof copy)[Language],
) {
  if (project.canRefund && project.userRefundAmount) {
    return text.projects.refundAvailable(project.userRefundAmount)
  }

  if (project.finalized || progress >= 100) {
    return text.projects.refundFinalized
  }

  if (!wallet.account) {
    return text.projects.refundConnectWallet
  }

  if (readBigInt(project.refundTokenAmount) <= 0n) {
    return text.projects.refundNoPosition
  }

  const refundAt = Number(project.refundDeadline || 0) * 1000
  if (refundAt > Date.now()) {
    return text.projects.refundOpensIn(formatRefundCountdown(refundAt - Date.now(), language))
  }

  return text.projects.refundNoPosition
}

function readBigInt(value: string | number | bigint | undefined) {
  try {
    return BigInt(value ?? 0)
  } catch {
    return 0n
  }
}

function formatRefundCountdown(milliseconds: number, language: Language) {
  const minutes = Math.max(1, Math.ceil(milliseconds / 60_000))
  const days = Math.floor(minutes / 1_440)
  const hours = Math.floor((minutes % 1_440) / 60)
  const mins = minutes % 60

  if (language === 'zh') {
    if (days > 0) {
      return `${days} 天 ${hours} 小时`
    }
    if (hours > 0) {
      return `${hours} 小时 ${mins} 分钟`
    }
    return `${mins} 分钟`
  }

  if (days > 0) {
    return `${days}d ${hours}h`
  }
  if (hours > 0) {
    return `${hours}h ${mins}m`
  }
  return `${mins}m`
}

function normalizeMintInput(value: string) {
  const digits = value.replace(/\D/g, '').replace(/^0+(?=\d)/, '')

  return digits || '1'
}

function formatQuotaText(project: LaunchProject, text: (typeof copy)[Language], language: Language) {
  if (!project.whitelistEnabled || Number(project.whitelistMintCount) <= 0) {
    return language === 'zh'
      ? `公开 ${project.publicMintedCount}/${project.publicMintCount}`
      : `Public ${project.publicMintedCount}/${project.publicMintCount}`
  }

  return text.projects.quota(
    project.whitelistMintedCount,
    project.whitelistMintCount,
    project.publicMintedCount,
    project.publicMintCount,
  )
}

function collectWhitelistAccounts(value: string) {
  const matches = value.match(/(?:0x)?[a-fA-F0-9]{40}/g) ?? []
  const uniqueAccounts = new Map<string, string>()

  matches.forEach((rawAccount) => {
    const account = rawAccount.toLowerCase().startsWith('0x') ? `0x${rawAccount.slice(2)}` : `0x${rawAccount}`
    if (isAddress(account)) {
      uniqueAccounts.set(account.toLowerCase(), account)
    }
  })

  return [...uniqueAccounts.values()]
}

function parseWhitelistBatch(
  value: string,
  language: Language,
): WhitelistAllowanceEntry[] {
  const accounts = collectWhitelistAccounts(value)

  if (accounts.length === 0) {
    throw new Error(language === 'zh' ? '请至少粘贴一个有效的钱包地址。' : 'Paste at least one valid wallet address.')
  }
  if (accounts.length > 200) {
    throw new Error(language === 'zh' ? '单次最多提交 200 个白名单地址。' : 'Submit no more than 200 whitelist addresses at once.')
  }

  return accounts.map((account) => ({
    account,
    allowance: '1',
  }))
}

function getMintCostWei(project: LaunchProject, quantity: string) {
  const mintQuantity = /^\d+$/.test(quantity.trim()) ? BigInt(quantity.trim()) : 1n

  return BigInt(project.mintPriceWei || '0') * mintQuantity
}

function formatMintCost(project: LaunchProject, quantity: string) {
  return `${formatWeiAmount(getMintCostWei(project, quantity))} ${project.paymentSymbol}`
}

function formatWeiAmount(value: bigint) {
  const unit = 1_000_000_000_000_000_000n
  const whole = value / unit
  const fraction = (value % unit).toString().padStart(18, '0').replace(/0+$/, '').slice(0, 6)

  return fraction ? `${whole}.${fraction}` : whole.toString()
}

function formatBps(value: number) {
  const percent = Number(value || 0) / 100
  const fixed = percent % 1 === 0 ? percent.toFixed(0) : percent.toFixed(2)
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed

  return `${trimmed}%`
}

function formatTaxPortionBps(value: number) {
  const percent = Number(value || 0) / 100

  if (!Number.isFinite(percent) || percent <= 0) {
    return '0%'
  }

  return `${percent.toFixed(2)}%`
}

function formatDisplayAmount(value: string) {
  const rawValue = String(value || '0')
  const [whole = '0', fraction = ''] = rawValue.split('.')
  const cleanFraction = fraction.replace(/0+$/, '').slice(0, 4)
  const cleanWhole = whole.replace(/^0+(?=\d)/, '') || '0'
  const groupedWhole = cleanWhole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

  return cleanFraction ? `${groupedWhole}.${cleanFraction}` : groupedWhole
}

function shortHash(hash: string) {
  return hash ? `${hash.slice(0, 10)}...${hash.slice(-8)}` : ''
}

function normalizeAllocation(allocation: AllocationState) {
  const next = { ...allocation }
  let overflow = Object.values(next).reduce((sum, value) => sum + value, 0) - 100

  for (const key of ['burn', 'rewards', 'liquidity', 'marketing'] as AllocationKey[]) {
    if (overflow <= 0) {
      break
    }

    const reduction = Math.min(next[key], overflow)
    next[key] -= reduction
    overflow -= reduction
  }

  return next
}

function normalizeExternalUrl(value: unknown) {
  const rawValue = String(value ?? '').trim()

  if (!rawValue) {
    return ''
  }

  return /^https?:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`
}

function normalizeReportUrl(value: string) {
  const rawValue = value.trim()

  if (/^ipfs:\/\//i.test(rawValue)) {
    return `https://ipfs.io/ipfs/${rawValue.replace(/^ipfs:\/\//i, '')}`
  }

  return normalizeExternalUrl(rawValue)
}

function formatAuditDate(value: number) {
  if (!value) {
    return '-'
  }

  const locale = document.documentElement.lang === 'en' ? 'en-US' : 'zh-CN'

  return new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value * 1000)
}

async function copyTextToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

export default App
