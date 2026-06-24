// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20Lite} from "../interfaces/IERC20Lite.sol";
import {IPancakeFactory, IPancakeRouter02} from "../interfaces/IPancake.sol";

contract FairMintPool {
    address public constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    IERC20Lite public token;
    IPancakeRouter02 public pancakeRouter;
    address public owner;

    bool public start;
    bool public startWhitelist;
    bool public liquidityCreated;
    bool public failed;

    uint256 public price;
    uint256 public amountPerMint;
    uint256 public mintLimit;
    uint256 public minted;
    uint256 public whiteLimit;
    uint256 public accMintLimit;
    uint256 public accEachLimit;
    uint256 public liquidityTokenAmount;
    uint256 public liquidityTokenSpent;
    uint256 public liquidityBnbBps;
    uint256 public liquidityTokenBps;
    uint256 public refundDeadline;
    address public pair;

    bool private initialized;
    bool private locked;

    mapping(address => bool) public whitelist;
    mapping(address => uint256) public accMint;
    mapping(address => uint256) public refundableBnb;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Minted(address indexed account, uint256 units, uint256 tokenAmount, uint256 paid);
    event Refunded(address indexed account, uint256 value);
    event WhitelistUpdated(address indexed account, bool enabled);
    event Started(bool whitelistMode, bool publicMode);
    event DeadLiquidityCreated(address indexed pair, uint256 tokenAmount, uint256 bnbAmount, uint256 liquidity);
    event InstantLiquidityCreated(address indexed account, address indexed pair, uint256 tokenAmount, uint256 bnbAmount, uint256 liquidity);
    event Failed(uint256 minted, uint256 mintLimit);
    event UnsoldSentToDead(uint256 amount);
    event DustBnbSentToDead(uint256 amount);

    struct MintParams {
        uint256 price;
        uint256 amountPerMint;
        uint256 mintLimit;
        uint256 whiteLimit;
        uint256 accMintLimit;
        uint256 accEachLimit;
        uint256 liquidityTokenAmount;
        uint256 liquidityBnbBps;
        uint256 liquidityTokenBps;
        uint256 refundDeadline;
        bool startWhitelist;
        bool startPublic;
        bool renounceOwnerAfterCreate;
    }

    constructor() {
        initialized = true;
    }

    modifier onlyOwner() {
        require(msg.sender == owner);
        _;
    }

    modifier nonReentrant() {
        require(!locked);
        locked = true;
        _;
        locked = false;
    }

    function initialize(
        address owner_,
        address token_,
        address router_,
        MintParams calldata params,
        address[] calldata initialWhitelist
    ) external {
        require(!initialized);
        require(owner_ != address(0));
        require(token_ != address(0));
        require(router_ != address(0));
        require(params.price > 0);
        require(params.amountPerMint > 0);
        require(params.mintLimit > 0);
        require(params.liquidityBnbBps <= 10000);
        require(params.liquidityTokenBps <= 10000);

        initialized = true;
        owner = owner_;
        token = IERC20Lite(token_);
        pancakeRouter = IPancakeRouter02(router_);
        price = params.price;
        amountPerMint = params.amountPerMint;
        mintLimit = params.mintLimit;
        whiteLimit = params.whiteLimit;
        accMintLimit = params.accMintLimit;
        accEachLimit = params.accEachLimit == 0 ? 1 : params.accEachLimit;
        liquidityTokenAmount = params.liquidityTokenAmount;
        liquidityBnbBps = params.liquidityBnbBps;
        liquidityTokenBps = params.liquidityTokenBps;
        refundDeadline = params.refundDeadline;
        startWhitelist = params.startWhitelist;
        start = params.startPublic;

        for (uint256 i = 0; i < initialWhitelist.length; i++) {
            whitelist[initialWhitelist[i]] = true;
            emit WhitelistUpdated(initialWhitelist[i], true);
        }

        emit OwnershipTransferred(address(0), owner_);
        emit Started(startWhitelist, start);

        if (params.renounceOwnerAfterCreate) {
            _renounceOwnership();
        }
    }

    receive() external payable {
        mint();
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0));
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function renounceOwnership() external onlyOwner {
        _renounceOwnership();
    }

    function mint() public payable nonReentrant {
        require(!failed);
        bool whitelistMint = startWhitelist && whitelist[msg.sender];
        require(start || whitelistMint);
        require(msg.sender == tx.origin);
        require(msg.value >= price);

        uint256 units = msg.value / price;
        if (units > accEachLimit) units = accEachLimit;
        require(units > 0);

        uint256 paid = units * price;
        uint256 extraRefund = msg.value - paid;
        uint256 nextAccountMint = accMint[msg.sender] + units;

        require(minted + units <= mintLimit);
        if (!start && whiteLimit > 0) require(minted + units <= whiteLimit);
        if (accMintLimit > 0) require(nextAccountMint <= accMintLimit);

        minted += units;
        accMint[msg.sender] = nextAccountMint;

        uint256 tokenAmount = units * amountPerMint;
        uint256 bnbForLiquidity = (paid * liquidityBnbBps) / 10000;
        uint256 tokenForLiquidity = (tokenAmount * liquidityTokenBps) / 10000;
        if (bnbForLiquidity == 0 || tokenForLiquidity == 0) {
            bnbForLiquidity = 0;
            tokenForLiquidity = 0;
        }
        if (tokenForLiquidity > 0) {
            require(liquidityTokenSpent + tokenForLiquidity <= liquidityTokenAmount);
        }

        require(token.transfer(msg.sender, tokenAmount));

        emit Minted(msg.sender, units, tokenAmount, paid);

        uint256 refundable = paid - bnbForLiquidity;
        if (refundable > 0) refundableBnb[msg.sender] += refundable;

        if (bnbForLiquidity > 0 && tokenForLiquidity > 0) {
            _addInstantDeadLiquidity(msg.sender, tokenForLiquidity, bnbForLiquidity, 0, 0, block.timestamp);
        }

        if (extraRefund > 0) {
            _sendValue(payable(msg.sender), extraRefund);
            emit Refunded(msg.sender, extraRefund);
        }

        if (minted == mintLimit && !liquidityCreated && liquidityTokenAmount > liquidityTokenSpent && address(this).balance > 0) {
            _createDeadLiquidity(0, 0, block.timestamp);
        }
    }

    function refund() external nonReentrant {
        if (!failed) {
            require(!liquidityCreated);
            require(refundDeadline > 0 && block.timestamp >= refundDeadline && minted < mintLimit);
            failed = true;
            emit Failed(minted, mintLimit);
        }
        uint256 amount = refundableBnb[msg.sender];
        require(amount > 0);
        refundableBnb[msg.sender] = 0;
        _sendValue(payable(msg.sender), amount);
        emit Refunded(msg.sender, amount);
    }

    function setWhitelist(address[] calldata accounts, bool enabled) external onlyOwner {
        _setWhitelist(accounts, enabled);
    }

    function excludeMultipleAccountsFromFees(address[] calldata accounts, bool excluded) external onlyOwner {
        _setWhitelist(accounts, excluded);
    }

    function isExcludedFromFee(address account) external view returns (bool) {
        return whitelist[account];
    }

    function tokenAddr() external view returns (address) {
        return address(token);
    }

    function amountPerUnits() external view returns (uint256) {
        return amountPerMint;
    }

    function fundAddress() external view returns (address) {
        return owner;
    }

    function launchWhitelist() external onlyOwner {
        _startWhitelistMint();
    }

    function launch() external onlyOwner {
        _startPublicMint();
    }

    function startWhitelistMint() external onlyOwner {
        _startWhitelistMint();
    }

    function startPublicMint() external onlyOwner {
        _startPublicMint();
    }

    function setMintParams(
        uint256 price_,
        uint256 amountPerMint_,
        uint256 mintLimit_,
        uint256 whiteLimit_,
        uint256 accMintLimit_,
        uint256 accEachLimit_
    ) external onlyOwner {
        require(!start && !startWhitelist);
        require(price_ > 0);
        require(amountPerMint_ > 0);
        require(mintLimit_ >= minted);
        price = price_;
        amountPerMint = amountPerMint_;
        mintLimit = mintLimit_;
        whiteLimit = whiteLimit_;
        accMintLimit = accMintLimit_;
        accEachLimit = accEachLimit_ == 0 ? 1 : accEachLimit_;
    }

    function setLiquidityBps(uint256 bnbBps, uint256 tokenBps) external onlyOwner {
        require(!start && !startWhitelist);
        require(bnbBps <= 10000 && tokenBps <= 10000);
        liquidityBnbBps = bnbBps;
        liquidityTokenBps = tokenBps;
    }

    function setRefundDeadline(uint256 newDeadline) external onlyOwner {
        require(!start && !startWhitelist);
        refundDeadline = newDeadline;
    }

    function setWhiteLimit(uint256 newValue) external onlyOwner {
        require(!start && !startWhitelist);
        whiteLimit = newValue;
    }

    function setMintLimit(uint256 newValue) external onlyOwner {
        require(!start && !startWhitelist);
        require(newValue >= minted);
        mintLimit = newValue;
    }

    function setAccEachLimit(uint256 newValue) external onlyOwner {
        require(!start && !startWhitelist);
        accEachLimit = newValue == 0 ? 1 : newValue;
    }

    function setAccMintLimit(uint256 newValue) external onlyOwner {
        require(!start && !startWhitelist);
        accMintLimit = newValue;
    }

    function setPrice(uint256 newValue) external onlyOwner {
        require(!start && !startWhitelist);
        require(newValue > 0);
        price = newValue;
    }

    function setAmountPerUnits(uint256 newValue) external onlyOwner {
        require(!start && !startWhitelist);
        require(newValue > 0);
        amountPerMint = newValue;
    }

    function setFundAddress(address) external view onlyOwner {
        revert("fund disabled");
    }

    function graduateToDeadLiquidity(uint256 amountTokenMin, uint256 amountBnbMin, uint256 deadline) external onlyOwner nonReentrant {
        _createDeadLiquidity(amountTokenMin, amountBnbMin, deadline);
    }

    function markFailed() external {
        require(!failed);
        require(!liquidityCreated);
        require(refundDeadline > 0 && block.timestamp >= refundDeadline);
        require(minted < mintLimit);
        failed = true;
        emit Failed(minted, mintLimit);
    }

    function sendUnsoldToDead(uint256 amount) external onlyOwner {
        require(amount > 0);
        require(token.transfer(DEAD_ADDRESS, amount));
        emit UnsoldSentToDead(amount);
    }

    function _setWhitelist(address[] calldata accounts, bool enabled) internal {
        for (uint256 i = 0; i < accounts.length; i++) {
            whitelist[accounts[i]] = enabled;
            emit WhitelistUpdated(accounts[i], enabled);
        }
    }

    function _startWhitelistMint() internal {
        require(!startWhitelist);
        startWhitelist = true;
        emit Started(startWhitelist, start);
    }

    function _startPublicMint() internal {
        require(!start);
        start = true;
        emit Started(startWhitelist, start);
    }

    function _createDeadLiquidity(uint256 amountTokenMin, uint256 amountBnbMin, uint256 deadline) internal {
        require(!liquidityCreated);
        require(!failed);
        uint256 tokenAmount = liquidityTokenAmount - liquidityTokenSpent;
        uint256 bnbAmount = address(this).balance;
        require(tokenAmount > 0);
        require(bnbAmount > 0);
        require(token.balanceOf(address(this)) >= tokenAmount);

        liquidityCreated = true;
        require(token.approve(address(pancakeRouter), tokenAmount));
        (uint256 usedToken, uint256 usedBnb, uint256 liquidity) = pancakeRouter.addLiquidityETH{value: bnbAmount}(
            address(token),
            tokenAmount,
            amountTokenMin,
            amountBnbMin,
            DEAD_ADDRESS,
            deadline == 0 ? block.timestamp : deadline
        );
        pair = IPancakeFactory(pancakeRouter.factory()).getPair(address(token), pancakeRouter.WETH());
        liquidityTokenSpent += usedToken;
        emit DeadLiquidityCreated(pair, usedToken, usedBnb, liquidity);

        uint256 remainingToken = token.balanceOf(address(this));
        if (remainingToken > 0) {
            require(token.transfer(DEAD_ADDRESS, remainingToken));
            emit UnsoldSentToDead(remainingToken);
        }

        uint256 remainingBnb = address(this).balance;
        if (remainingBnb > 0) {
            _sendValue(payable(DEAD_ADDRESS), remainingBnb);
            emit DustBnbSentToDead(remainingBnb);
        }
    }

    function _addInstantDeadLiquidity(
        address account,
        uint256 tokenAmount,
        uint256 bnbAmount,
        uint256 amountTokenMin,
        uint256 amountBnbMin,
        uint256 deadline
    ) internal {
        require(token.balanceOf(address(this)) >= tokenAmount);
        require(token.approve(address(pancakeRouter), tokenAmount));
        (uint256 usedToken, uint256 usedBnb, uint256 liquidity) = pancakeRouter.addLiquidityETH{value: bnbAmount}(
            address(token),
            tokenAmount,
            amountTokenMin,
            amountBnbMin,
            DEAD_ADDRESS,
            deadline == 0 ? block.timestamp : deadline
        );
        pair = IPancakeFactory(pancakeRouter.factory()).getPair(address(token), pancakeRouter.WETH());
        liquidityTokenSpent += usedToken;
        emit InstantLiquidityCreated(account, pair, usedToken, usedBnb, liquidity);

        uint256 remainingBnb = bnbAmount - usedBnb;
        if (remainingBnb > 0) refundableBnb[account] += remainingBnb;
    }

    function _renounceOwnership() internal {
        emit OwnershipTransferred(owner, address(0));
        owner = address(0);
    }

    function _sendValue(address payable to, uint256 value) internal {
        (bool sent, ) = to.call{value: value}("");
        require(sent);
    }
}
