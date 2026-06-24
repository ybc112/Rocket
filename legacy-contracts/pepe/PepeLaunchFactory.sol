// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20Lite} from "./interfaces/IERC20Lite.sol";
import {IPancakeFactory, IPancakeRouter02} from "./interfaces/IPancake.sol";
import {ClonesLite} from "./lib/ClonesLite.sol";
import {OwnableLite} from "./lib/OwnableLite.sol";
import {DividendMemeToken} from "./templates/DividendMemeToken.sol";
import {FairMintPool} from "./templates/FairMintPool.sol";
import {PepeMemeToken} from "./templates/PepeMemeToken.sol";

contract PepeLaunchFactory is OwnableLite {
    address public constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    uint8 public constant TEMPLATE_KIND_FIXED = 1;
    uint8 public constant TEMPLATE_KIND_DIVIDEND = 2;
    uint8 public constant TEMPLATE_KIND_APPROVED_CODE = 3;
    uint8 public constant TEMPLATE_KIND_FAIR_MINT = 4;

    IPancakeRouter02 public immutable pancakeRouter;
    address public fairMintPoolImplementation;
    address public dividendTokenImplementation;
    address payable public feeReceiver;
    address public defaultRewardToken;
    uint256 public creationFee;
    uint256 public whitelistCreationFee;

    struct TokenParams {
        string name;
        string symbol;
        uint256 totalSupply;
        address receiver;
    }

    struct LiquidityParams {
        uint256 tokenAmount;
        uint256 bnbAmount;
        uint256 minTokenAmount;
        uint256 minBnbAmount;
        uint256 deadline;
        bool enabled;
    }

    struct DividendParams {
        address rewardToken;
        address feeReceiver;
        uint16 buyFeeBps;
        uint16 sellFeeBps;
        bool renounceOwnerAfterCreate;
        uint256 rewardSwapThreshold;
        uint256 autoClaimThreshold;
        uint256 autoClaimGasLimit;
    }

    struct DeployOptions {
        uint8 templateId;
        bytes32 salt;
        uint160 requiredSuffix;
        uint8 suffixLength;
        bool enforceSuffix;
    }

    struct GenericDeployOptions {
        uint8 templateId;
        address receiver;
        uint160 requiredSuffix;
        uint8 suffixLength;
        bool enforceSuffix;
    }

    struct TemplateInfo {
        uint8 templateId;
        uint8 kind;
        bool enabled;
        bool requiresLiquidity;
        bool supportsDividends;
        bytes32 label;
    }

    struct DeploymentInfo {
        address creator;
        address token;
        address pair;
        address pool;
        uint8 templateId;
        bytes32 salt;
        uint256 valuePaid;
        uint256 liquidity;
        uint64 blockNumber;
        uint64 createdAt;
        bytes32 metadataHash;
    }

    mapping(uint8 => TemplateInfo) private templateById;
    uint8[] private templateIds;
    mapping(bytes32 => bool) public approvedTokenCodeHash;
    DeploymentInfo[] private deployments;
    address[] private launchedTokens;
    mapping(address => address[]) private creatorTokens;
    mapping(uint8 => address[]) private templateTokens;
    mapping(address => DeploymentInfo) private deploymentByToken;

    event FeeReceiverUpdated(address indexed feeReceiver);
    event DefaultRewardTokenUpdated(address indexed defaultRewardToken);
    event FairMintPoolImplementationUpdated(address indexed implementation);
    event DividendTokenImplementationUpdated(address indexed implementation);
    event CreationFeeUpdated(uint256 creationFee);
    event WhitelistCreationFeeUpdated(uint256 whitelistCreationFee);
    event TemplateUpdated(uint8 indexed templateId, uint8 kind, bool enabled, bool requiresLiquidity, bool supportsDividends, bytes32 label);
    event TokenCodeHashApprovalUpdated(bytes32 indexed codeHash, bool approved);
    event TokenDeployed(
        address indexed creator,
        address indexed token,
        address indexed pair,
        uint8 templateId,
        bytes32 salt,
        uint256 valuePaid,
        uint256 liquidity,
        bytes32 metadataHash
    );
    event FairMintLaunchDeployed(
        address indexed creator,
        address indexed token,
        address indexed pool,
        uint8 templateId,
        bytes32 salt,
        uint256 valuePaid,
        bytes32 metadataHash
    );
    event DeadLiquidityCreated(address indexed token, address indexed pair, uint256 tokenAmount, uint256 bnbAmount, uint256 liquidity);

    constructor(
        address payable feeReceiver_,
        uint256 creationFee_,
        address router_,
        address defaultRewardToken_,
        address fairMintPoolImplementation_,
        address dividendTokenImplementation_
    ) OwnableLite(msg.sender) {
        require(feeReceiver_ != address(0));
        require(router_ != address(0));
        require(defaultRewardToken_ != address(0));
        require(fairMintPoolImplementation_ != address(0));
        require(dividendTokenImplementation_ != address(0));
        feeReceiver = feeReceiver_;
        creationFee = creationFee_;
        whitelistCreationFee = creationFee_ * 2;
        pancakeRouter = IPancakeRouter02(router_);
        defaultRewardToken = defaultRewardToken_;
        fairMintPoolImplementation = fairMintPoolImplementation_;
        dividendTokenImplementation = dividendTokenImplementation_;

        _setTemplate(1, TEMPLATE_KIND_FIXED, true, true, false, bytes32("Standard BEP20"));
        _setTemplate(2, TEMPLATE_KIND_FIXED, true, true, false, bytes32("Zero Tax"));
        _setTemplate(3, TEMPLATE_KIND_FIXED, true, true, false, bytes32("Blackhole LP"));
        _setTemplate(4, TEMPLATE_KIND_FIXED, true, true, false, bytes32("No Owner"));
        _setTemplate(10, TEMPLATE_KIND_DIVIDEND, true, true, true, bytes32("Platform Dividend"));
        _setTemplate(20, TEMPLATE_KIND_FAIR_MINT, true, true, false, bytes32("Whitelist Mint"));
        _setTemplate(50, TEMPLATE_KIND_APPROVED_CODE, true, true, false, bytes32("Approved Bytecode"));
    }

    receive() external payable {}

    function deployFromTemplate(
        TokenParams calldata tokenParams,
        LiquidityParams calldata liquidityParams,
        DividendParams calldata dividendParams,
        DeployOptions calldata options,
        bytes32 metadataHash
    ) external payable returns (address token, address pair, uint256 liquidity) {
        TemplateInfo storage template = _enabledTemplate(options.templateId);
        _requireDeadLiquidity(liquidityParams);

        if (template.kind == TEMPLATE_KIND_FIXED) {
            (token, pair, liquidity) = _deployFixedTemplate(tokenParams, liquidityParams, options, metadataHash);
        } else if (template.kind == TEMPLATE_KIND_DIVIDEND) {
            require(dividendParams.renounceOwnerAfterCreate);
            (token, pair, liquidity) = _deployDividendTemplate(tokenParams, liquidityParams, dividendParams, options, metadataHash);
        } else {
            revert();
        }
    }

    function deployToken(
        bytes32 salt,
        bytes calldata tokenCreationCode,
        LiquidityParams calldata liquidityParams,
        GenericDeployOptions calldata options,
        bytes32 metadataHash
    ) external payable returns (address token, address pair, uint256 liquidity) {
        _enabledTemplate(options.templateId);
        _requireDeadLiquidity(liquidityParams);
        require(approvedTokenCodeHash[keccak256(tokenCreationCode)]);

        uint256 usableValue = _collectFee(liquidityParams.bnbAmount);
        bytes32 create2Salt = _saltFor(msg.sender, salt);
        bytes32 initCodeHash = keccak256(tokenCreationCode);
        address predicted = _predictCreate2(create2Salt, initCodeHash);
        _checkSuffix(predicted, options.requiredSuffix, options.suffixLength, options.enforceSuffix);

        token = _deployCreate2(create2Salt, tokenCreationCode);
        require(IERC20Lite(token).balanceOf(address(this)) >= liquidityParams.tokenAmount);
        uint256 usedBnb;
        (pair, liquidity, usedBnb) = _addDeadLiquidity(token, liquidityParams);
        usableValue -= usedBnb;

        address receiver = options.receiver == address(0) ? msg.sender : options.receiver;
        uint256 remainingToken = IERC20Lite(token).balanceOf(address(this));
        if (remainingToken > 0) require(IERC20Lite(token).transfer(receiver, remainingToken));
        if (usableValue > 0) _sendValue(payable(msg.sender), usableValue);

        _recordDeployment(msg.sender, token, pair, address(0), options.templateId, salt, msg.value, liquidity, metadataHash);
    }

    function deployFairMintLaunch(
        TokenParams calldata tokenParams,
        FairMintPool.MintParams calldata mintParams,
        address[] calldata initialWhitelist,
        DeployOptions calldata options,
        bytes32 metadataHash
    ) external payable returns (address token, address pool) {
        TemplateInfo storage template = _enabledTemplate(options.templateId);
        require(template.kind == TEMPLATE_KIND_FAIR_MINT);
        require(mintParams.price > 0);
        require(mintParams.amountPerMint > 0);
        require(mintParams.mintLimit > 0);
        require(mintParams.liquidityTokenAmount > 0);
        require(mintParams.liquidityBnbBps <= 10000 && mintParams.liquidityTokenBps <= 10000);
        if (mintParams.startWhitelist) require(initialWhitelist.length > 0);

        uint256 saleSupply = mintParams.amountPerMint * mintParams.mintLimit;
        uint256 requiredLiquiditySupply = (saleSupply * mintParams.liquidityTokenBps) / 10000;
        require(mintParams.liquidityTokenAmount >= requiredLiquiditySupply);
        uint256 requiredSupply = saleSupply + mintParams.liquidityTokenAmount;
        require(tokenParams.totalSupply >= requiredSupply);

        uint256 usableValue = _collectFee(0, _fairMintCreationFee(mintParams, initialWhitelist));
        bytes32 create2Salt = _saltFor(msg.sender, options.salt);
        bytes memory tokenInitCode = _fixedInitCode(tokenParams);
        address predicted = _predictCreate2(create2Salt, keccak256(tokenInitCode));
        _checkSuffix(predicted, options.requiredSuffix, options.suffixLength, options.enforceSuffix);

        token = _deployCreate2(create2Salt, tokenInitCode);
        bytes32 poolSalt = keccak256(abi.encodePacked(create2Salt, "FAIR_MINT_POOL"));
        address launchOwner = tokenParams.receiver == address(0) ? msg.sender : tokenParams.receiver;
        pool = ClonesLite.cloneDeterministic(fairMintPoolImplementation, poolSalt);
        FairMintPool(payable(pool)).initialize(launchOwner, token, address(pancakeRouter), mintParams, initialWhitelist);

        require(IERC20Lite(token).transfer(pool, requiredSupply));
        uint256 remaining = IERC20Lite(token).balanceOf(address(this));
        if (remaining > 0) {
            require(IERC20Lite(token).transfer(launchOwner, remaining));
        }
        if (usableValue > 0) _sendValue(payable(msg.sender), usableValue);

        _recordDeployment(msg.sender, token, address(0), pool, options.templateId, options.salt, msg.value, 0, metadataHash);
        emit FairMintLaunchDeployed(msg.sender, token, pool, options.templateId, options.salt, msg.value, metadataHash);
    }

    function predictTokenAddress(bytes32 salt, bytes32 tokenCreationCodeHash, address creator) public view returns (address) {
        return _predictCreate2(_saltFor(creator, salt), tokenCreationCodeHash);
    }

    function predictTemplateTokenAddress(
        uint8 templateId,
        bytes32 salt,
        TokenParams calldata tokenParams,
        LiquidityParams calldata liquidityParams,
        DividendParams calldata dividendParams,
        address creator
    ) external view returns (address) {
        return _predictCreate2(_saltFor(creator, salt), _templateInitCodeHash(templateId, tokenParams, liquidityParams, dividendParams));
    }

    function predictFairMintPoolAddress(
        uint8 templateId,
        bytes32 salt,
        TokenParams calldata tokenParams,
        FairMintPool.MintParams calldata mintParams,
        address[] calldata initialWhitelist,
        address creator
    ) external view returns (address) {
        TemplateInfo storage template = _enabledTemplate(templateId);
        require(template.kind == TEMPLATE_KIND_FAIR_MINT);
        bytes32 create2Salt = _saltFor(creator, salt);
        bytes32 poolSalt = keccak256(abi.encodePacked(create2Salt, "FAIR_MINT_POOL"));
        tokenParams;
        mintParams;
        initialWhitelist;
        return ClonesLite.predictDeterministicAddress(fairMintPoolImplementation, poolSalt, address(this));
    }

    function templateInitCodeHash(
        uint8 templateId,
        TokenParams calldata tokenParams,
        LiquidityParams calldata liquidityParams,
        DividendParams calldata dividendParams
    ) external view returns (bytes32) {
        return _templateInitCodeHash(templateId, tokenParams, liquidityParams, dividendParams);
    }

    function getDeployments(uint256 offset, uint256 limit) external view returns (DeploymentInfo[] memory items) {
        uint256 end = _pageEnd(deployments.length, offset, limit);
        if (end <= offset) return new DeploymentInfo[](0);
        items = new DeploymentInfo[](end - offset);
        for (uint256 i = offset; i < end; i++) items[i - offset] = deployments[i];
    }

    function getCreatorTokens(address creator, uint256 offset, uint256 limit) external view returns (address[] memory items) {
        address[] storage source = creatorTokens[creator];
        uint256 end = _pageEnd(source.length, offset, limit);
        if (end <= offset) return new address[](0);
        items = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) items[i - offset] = source[i];
    }

    function getLaunchedTokens(uint256 offset, uint256 limit) external view returns (address[] memory items) {
        uint256 end = _pageEnd(launchedTokens.length, offset, limit);
        if (end <= offset) return new address[](0);
        items = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) items[i - offset] = launchedTokens[i];
    }

    function getTemplateTokens(uint8 templateId, uint256 offset, uint256 limit) external view returns (address[] memory items) {
        address[] storage source = templateTokens[templateId];
        uint256 end = _pageEnd(source.length, offset, limit);
        if (end <= offset) return new address[](0);
        items = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) items[i - offset] = source[i];
    }

    function getTemplateDeployments(uint8 templateId, uint256 offset, uint256 limit) external view returns (DeploymentInfo[] memory items) {
        address[] storage source = templateTokens[templateId];
        uint256 end = _pageEnd(source.length, offset, limit);
        if (end <= offset) return new DeploymentInfo[](0);
        items = new DeploymentInfo[](end - offset);
        for (uint256 i = offset; i < end; i++) items[i - offset] = deploymentByToken[source[i]];
    }

    function getTemplates(uint256 offset, uint256 limit) external view returns (TemplateInfo[] memory items) {
        uint256 end = _pageEnd(templateIds.length, offset, limit);
        if (end <= offset) return new TemplateInfo[](0);
        items = new TemplateInfo[](end - offset);
        for (uint256 i = offset; i < end; i++) items[i - offset] = templateById[templateIds[i]];
    }

    function getDeployment(address token) external view returns (DeploymentInfo memory) {
        return deploymentByToken[token];
    }

    function getDeploymentsCount() external view returns (uint256) {
        return deployments.length;
    }

    function getCreatorTokensCount(address creator) external view returns (uint256) {
        return creatorTokens[creator].length;
    }

    function getLaunchedTokensCount() external view returns (uint256) {
        return launchedTokens.length;
    }

    function getTemplateTokensCount(uint8 templateId) external view returns (uint256) {
        return templateTokens[templateId].length;
    }

    function getTemplatesCount() external view returns (uint256) {
        return templateIds.length;
    }

    function getTemplate(uint8 templateId) external view returns (TemplateInfo memory) {
        return templateById[templateId];
    }

    function setTemplate(
        uint8 templateId,
        uint8 kind,
        bool enabled,
        bool requiresLiquidity,
        bool supportsDividends,
        bytes32 label
    ) external onlyOwner {
        require(kind == TEMPLATE_KIND_FIXED || kind == TEMPLATE_KIND_DIVIDEND || kind == TEMPLATE_KIND_APPROVED_CODE || kind == TEMPLATE_KIND_FAIR_MINT);
        if (enabled) require(requiresLiquidity);
        _setTemplate(templateId, kind, enabled, requiresLiquidity, supportsDividends, label);
    }

    function setApprovedTokenCodeHash(bytes32 codeHash, bool approved) external onlyOwner {
        approvedTokenCodeHash[codeHash] = approved;
        emit TokenCodeHashApprovalUpdated(codeHash, approved);
    }

    function setFeeReceiver(address payable feeReceiver_) external onlyOwner {
        require(feeReceiver_ != address(0));
        feeReceiver = feeReceiver_;
        emit FeeReceiverUpdated(feeReceiver_);
    }

    function setDefaultRewardToken(address defaultRewardToken_) external onlyOwner {
        require(defaultRewardToken_ != address(0));
        defaultRewardToken = defaultRewardToken_;
        emit DefaultRewardTokenUpdated(defaultRewardToken_);
    }

    function setFairMintPoolImplementation(address implementation) external onlyOwner {
        require(implementation != address(0));
        fairMintPoolImplementation = implementation;
        emit FairMintPoolImplementationUpdated(implementation);
    }

    function setDividendTokenImplementation(address implementation) external onlyOwner {
        require(implementation != address(0));
        dividendTokenImplementation = implementation;
        emit DividendTokenImplementationUpdated(implementation);
    }

    function setCreationFee(uint256 creationFee_) external onlyOwner {
        creationFee = creationFee_;
        emit CreationFeeUpdated(creationFee_);
    }

    function setWhitelistCreationFee(uint256 whitelistCreationFee_) external onlyOwner {
        whitelistCreationFee = whitelistCreationFee_;
        emit WhitelistCreationFeeUpdated(whitelistCreationFee_);
    }

    function _deployFixedTemplate(
        TokenParams calldata tokenParams,
        LiquidityParams calldata liquidityParams,
        DeployOptions memory options,
        bytes32 metadataHash
    ) internal returns (address token, address pair, uint256 liquidity) {
        uint256 usableValue = _collectFee(liquidityParams.bnbAmount);
        address receiver = tokenParams.receiver == address(0) ? msg.sender : tokenParams.receiver;
        bytes32 create2Salt = _saltFor(msg.sender, options.salt);
        bytes memory initCode = _fixedInitCode(tokenParams);
        address predicted = _predictCreate2(create2Salt, keccak256(initCode));
        _checkSuffix(predicted, options.requiredSuffix, options.suffixLength, options.enforceSuffix);

        token = _deployCreate2(create2Salt, initCode);
        require(IERC20Lite(token).balanceOf(address(this)) >= liquidityParams.tokenAmount);
        uint256 usedBnb;
        (pair, liquidity, usedBnb) = _addDeadLiquidity(token, liquidityParams);
        usableValue -= usedBnb;

        uint256 remainingToken = IERC20Lite(token).balanceOf(address(this));
        if (remainingToken > 0) require(IERC20Lite(token).transfer(receiver, remainingToken));
        if (usableValue > 0) _sendValue(payable(msg.sender), usableValue);
        _recordDeployment(msg.sender, token, pair, address(0), options.templateId, options.salt, msg.value, liquidity, metadataHash);
    }

    function _deployDividendTemplate(
        TokenParams calldata tokenParams,
        LiquidityParams calldata liquidityParams,
        DividendParams calldata dividendParams,
        DeployOptions memory options,
        bytes32 metadataHash
    ) internal returns (address token, address pair, uint256 liquidity) {
        uint256 usableValue = _collectFee(liquidityParams.bnbAmount);
        address receiver = tokenParams.receiver == address(0) ? msg.sender : tokenParams.receiver;
        bytes32 create2Salt = _saltFor(msg.sender, options.salt);
        address predicted = ClonesLite.predictDeterministicAddress(dividendTokenImplementation, create2Salt, address(this));
        _checkSuffix(predicted, options.requiredSuffix, options.suffixLength, options.enforceSuffix);

        token = ClonesLite.cloneDeterministic(dividendTokenImplementation, create2Salt);
        _initializeDividendToken(token, tokenParams, dividendParams);
        require(IERC20Lite(token).balanceOf(address(this)) >= liquidityParams.tokenAmount);
        uint256 usedBnb;
        (pair, liquidity, usedBnb) = _addDeadLiquidity(token, liquidityParams);
        usableValue -= usedBnb;

        DividendMemeToken(token).setPair(pair);
        uint256 remainingToken = IERC20Lite(token).balanceOf(address(this));
        if (remainingToken > 0) require(IERC20Lite(token).transfer(receiver, remainingToken));
        DividendMemeToken(token).renounceOwnership();
        if (usableValue > 0) _sendValue(payable(msg.sender), usableValue);
        _recordDeployment(msg.sender, token, pair, address(0), options.templateId, options.salt, msg.value, liquidity, metadataHash);
    }

    function _initializeDividendToken(
        address token,
        TokenParams calldata tokenParams,
        DividendParams calldata dividendParams
    ) internal {
        address rewardToken = dividendParams.rewardToken == address(0) ? defaultRewardToken : dividendParams.rewardToken;
        address dividendFeeReceiver = dividendParams.feeReceiver == address(0) ? feeReceiver : dividendParams.feeReceiver;
        DividendMemeToken(token).initialize(
            tokenParams.name,
            tokenParams.symbol,
            tokenParams.totalSupply,
            address(this),
            address(this),
            address(pancakeRouter),
            rewardToken,
            dividendFeeReceiver,
            dividendParams.buyFeeBps,
            dividendParams.sellFeeBps
        );
        DividendMemeToken(token).setAutoRewardConfig(
            dividendParams.rewardSwapThreshold == 0 ? tokenParams.totalSupply / 10000 : dividendParams.rewardSwapThreshold,
            dividendParams.autoClaimThreshold == 0 ? 4 ether : dividendParams.autoClaimThreshold,
            dividendParams.autoClaimGasLimit == 0 ? 4 : dividendParams.autoClaimGasLimit
        );
    }

    function _fixedInitCode(TokenParams calldata tokenParams) internal view returns (bytes memory) {
        return abi.encodePacked(type(PepeMemeToken).creationCode, abi.encode(tokenParams.name, tokenParams.symbol, tokenParams.totalSupply, address(this)));
    }

    function _templateInitCodeHash(
        uint8 templateId,
        TokenParams calldata tokenParams,
        LiquidityParams calldata,
        DividendParams calldata
    ) internal view returns (bytes32) {
        TemplateInfo storage template = _enabledTemplate(templateId);
        if (template.kind == TEMPLATE_KIND_FIXED || template.kind == TEMPLATE_KIND_FAIR_MINT) {
            return keccak256(_fixedInitCode(tokenParams));
        }
        if (template.kind == TEMPLATE_KIND_DIVIDEND) {
            tokenParams;
            return ClonesLite.initCodeHash(dividendTokenImplementation);
        }
        revert();
    }

    function _addDeadLiquidity(address token, LiquidityParams calldata liquidityParams)
        internal
        returns (address pair, uint256 liquidity, uint256 usedBnb)
    {
        require(IERC20Lite(token).approve(address(pancakeRouter), liquidityParams.tokenAmount));
        (uint256 usedToken, uint256 amountBnb, uint256 lpAmount) = pancakeRouter.addLiquidityETH{value: liquidityParams.bnbAmount}(
            token,
            liquidityParams.tokenAmount,
            liquidityParams.minTokenAmount,
            liquidityParams.minBnbAmount,
            DEAD_ADDRESS,
            liquidityParams.deadline == 0 ? block.timestamp + 1800 : liquidityParams.deadline
        );
        pair = IPancakeFactory(pancakeRouter.factory()).getPair(token, pancakeRouter.WETH());
        emit DeadLiquidityCreated(token, pair, usedToken, amountBnb, lpAmount);
        return (pair, lpAmount, amountBnb);
    }

    function _recordDeployment(
        address creator,
        address token,
        address pair,
        address pool,
        uint8 templateId,
        bytes32 salt,
        uint256 valuePaid,
        uint256 liquidity,
        bytes32 metadataHash
    ) internal {
        DeploymentInfo memory info = DeploymentInfo({
            creator: creator,
            token: token,
            pair: pair,
            pool: pool,
            templateId: templateId,
            salt: salt,
            valuePaid: valuePaid,
            liquidity: liquidity,
            blockNumber: uint64(block.number),
            createdAt: uint64(block.timestamp),
            metadataHash: metadataHash
        });
        deployments.push(info);
        launchedTokens.push(token);
        creatorTokens[creator].push(token);
        templateTokens[templateId].push(token);
        deploymentByToken[token] = info;
        emit TokenDeployed(creator, token, pair, templateId, salt, valuePaid, liquidity, metadataHash);
    }

    function _setTemplate(
        uint8 templateId,
        uint8 kind,
        bool enabled,
        bool requiresLiquidity,
        bool supportsDividends,
        bytes32 label
    ) internal {
        require(templateId > 0);
        if (enabled) require(requiresLiquidity);
        if (templateById[templateId].label == bytes32(0)) templateIds.push(templateId);
        templateById[templateId] = TemplateInfo(templateId, kind, enabled, requiresLiquidity, supportsDividends, label);
        emit TemplateUpdated(templateId, kind, enabled, requiresLiquidity, supportsDividends, label);
    }

    function _enabledTemplate(uint8 templateId) internal view returns (TemplateInfo storage template) {
        template = templateById[templateId];
        require(template.enabled);
    }

    function _requireDeadLiquidity(LiquidityParams calldata liquidityParams) internal pure {
        require(liquidityParams.enabled);
        require(liquidityParams.tokenAmount > 0);
        require(liquidityParams.bnbAmount > 0);
    }

    function _collectFee(uint256 requiredExtraValue) internal returns (uint256 usableValue) {
        return _collectFee(requiredExtraValue, creationFee);
    }

    function _collectFee(uint256 requiredExtraValue, uint256 feeAmount) internal returns (uint256 usableValue) {
        require(msg.value >= feeAmount + requiredExtraValue);
        if (feeAmount > 0) _sendValue(feeReceiver, feeAmount);
        return msg.value - feeAmount;
    }

    function _fairMintCreationFee(FairMintPool.MintParams calldata mintParams, address[] calldata initialWhitelist) internal view returns (uint256) {
        bool whitelistEnabled = mintParams.startWhitelist || mintParams.whiteLimit > 0 || initialWhitelist.length > 0;
        return whitelistEnabled ? whitelistCreationFee : creationFee;
    }

    function _deployCreate2(bytes32 salt, bytes memory initCode) internal returns (address deployed) {
        require(initCode.length > 0);
        assembly {
            deployed := create2(0, add(initCode, 0x20), mload(initCode), salt)
        }
        require(deployed != address(0));
    }

    function _predictCreate2(bytes32 salt, bytes32 initCodeHash) internal view returns (address) {
        bytes32 digest = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash));
        return address(uint160(uint256(digest)));
    }

    function _saltFor(address creator, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(creator, salt));
    }

    function _checkSuffix(address predicted, uint160 requiredSuffix, uint8 suffixLength, bool enforceSuffix) internal pure {
        require(suffixLength <= 10);
        if (!enforceSuffix || suffixLength == 0) return;
        uint160 mask = uint160((uint256(1) << (uint256(suffixLength) * 4)) - 1);
        require((uint160(predicted) & mask) == (requiredSuffix & mask));
    }

    function _pageEnd(uint256 total, uint256 offset, uint256 limit) internal pure returns (uint256) {
        if (offset >= total) return offset;
        if (limit == 0 || limit > total - offset) return total;
        return offset + limit;
    }

    function _sendValue(address payable to, uint256 value) internal {
        (bool sent, ) = to.call{value: value}("");
        require(sent);
    }
}
