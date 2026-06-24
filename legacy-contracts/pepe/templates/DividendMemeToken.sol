// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20Lite} from "../interfaces/IERC20Lite.sol";
import {IPancakeRouter02} from "../interfaces/IPancake.sol";

contract DividendMemeToken {
    uint256 private constant MAGNITUDE = 2 ** 128;
    uint16 public constant MAX_FEE_BPS = 1000;
    address public constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    address public owner;

    IPancakeRouter02 public pancakeRouter;
    IERC20Lite public rewardToken;
    address public feeReceiver;
    address public pair;

    uint16 public buyFeeBps;
    uint16 public sellFeeBps;
    bool private swapping;
    bool private initialized;

    uint256 public magnifiedDividendPerShare;
    uint256 public totalDividendShares;
    uint256 public totalRewardsDistributed;
    uint256 public swapThreshold;
    uint256 public autoClaimThreshold;
    uint256 public autoClaimGasLimit;
    uint256 public nextAutoClaimIndex;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public excludedFromFees;
    mapping(address => bool) public excludedFromDividends;
    mapping(address => uint256) public dividendShares;
    mapping(address => int256) public magnifiedDividendCorrections;
    mapping(address => uint256) public withdrawnDividends;
    mapping(address => uint256) private dividendHolderIndexPlusOne;
    address[] private dividendHolders;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event FeesUpdated(uint16 buyFeeBps, uint16 sellFeeBps);
    event PairUpdated(address indexed pair);
    event FeeReceiverUpdated(address indexed feeReceiver);
    event ExcludedFromFees(address indexed account, bool excluded);
    event ExcludedFromDividends(address indexed account, bool excluded);
    event RewardsDeposited(address indexed from, uint256 amount);
    event RewardsClaimed(address indexed account, uint256 amount);
    event AutoRewardsConfigured(uint256 swapThreshold, uint256 autoClaimThreshold, uint256 autoClaimGasLimit);
    event AutoClaimsProcessed(uint256 processed, uint256 claims);
    event FeesSwappedToRewards(uint256 tokenAmount, uint256 rewardAmount);

    constructor() {
        initialized = true;
    }

    modifier onlyOwner() {
        require(msg.sender == owner);
        _;
    }

    function initialize(
        string calldata name_,
        string calldata symbol_,
        uint256 totalSupply_,
        address receiver_,
        address owner_,
        address router_,
        address rewardToken_,
        address feeReceiver_,
        uint16 buyFeeBps_,
        uint16 sellFeeBps_
    ) external {
        require(!initialized);
        require(bytes(name_).length > 0);
        require(bytes(symbol_).length > 0);
        require(totalSupply_ > 0);
        require(receiver_ != address(0));
        require(owner_ != address(0));
        require(router_ != address(0));
        require(rewardToken_ != address(0));
        require(feeReceiver_ != address(0));
        require(buyFeeBps_ <= MAX_FEE_BPS && sellFeeBps_ <= MAX_FEE_BPS);

        initialized = true;
        name = name_;
        symbol = symbol_;
        owner = owner_;
        pancakeRouter = IPancakeRouter02(router_);
        rewardToken = IERC20Lite(rewardToken_);
        feeReceiver = feeReceiver_;
        buyFeeBps = buyFeeBps_;
        sellFeeBps = sellFeeBps_;
        swapThreshold = totalSupply_ / 10000;
        autoClaimThreshold = 4 ether;
        autoClaimGasLimit = 4;

        excludedFromFees[owner_] = true;
        excludedFromFees[address(this)] = true;
        excludedFromFees[feeReceiver_] = true;

        _setExcludedFromDividends(address(this), true);
        _setExcludedFromDividends(owner_, true);
        _setExcludedFromDividends(DEAD_ADDRESS, true);
        _setExcludedFromDividends(feeReceiver_, true);

        _mint(receiver_, totalSupply_);
        emit OwnershipTransferred(address(0), owner_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0));
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function renounceOwnership() external onlyOwner {
        emit OwnershipTransferred(owner, address(0));
        owner = address(0);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= value);
            allowance[from][msg.sender] = allowed - value;
            emit Approval(from, msg.sender, allowance[from][msg.sender]);
        }
        _transfer(from, to, value);
        return true;
    }

    function setPair(address pair_) external onlyOwner {
        require(pair_ != address(0));
        pair = pair_;
        _setExcludedFromDividends(pair_, true);
        emit PairUpdated(pair_);
    }

    function setFees(uint16 buyFeeBps_, uint16 sellFeeBps_) external onlyOwner {
        require(buyFeeBps_ <= MAX_FEE_BPS && sellFeeBps_ <= MAX_FEE_BPS);
        buyFeeBps = buyFeeBps_;
        sellFeeBps = sellFeeBps_;
        emit FeesUpdated(buyFeeBps_, sellFeeBps_);
    }

    function setFeeReceiver(address feeReceiver_) external onlyOwner {
        require(feeReceiver_ != address(0));
        feeReceiver = feeReceiver_;
        excludedFromFees[feeReceiver_] = true;
        _setExcludedFromDividends(feeReceiver_, true);
        emit FeeReceiverUpdated(feeReceiver_);
    }

    function setAutoRewardConfig(uint256 swapThreshold_, uint256 autoClaimThreshold_, uint256 autoClaimGasLimit_) external onlyOwner {
        _setAutoRewardConfig(swapThreshold_, autoClaimThreshold_, autoClaimGasLimit_);
    }

    function setExcludedFromFees(address account, bool excluded) external onlyOwner {
        excludedFromFees[account] = excluded;
        emit ExcludedFromFees(account, excluded);
    }

    function setExcludedFromDividends(address account, bool excluded) external onlyOwner {
        _setExcludedFromDividends(account, excluded);
        emit ExcludedFromDividends(account, excluded);
    }

    function depositRewards(uint256 amount) external {
        require(amount > 0);
        uint256 beforeBalance = rewardToken.balanceOf(address(this));
        require(rewardToken.transferFrom(msg.sender, address(this), amount));
        uint256 received = rewardToken.balanceOf(address(this)) - beforeBalance;
        _distributeRewards(received);
        emit RewardsDeposited(msg.sender, received);
    }

    function swapFeesToRewards(uint256 tokenAmount, uint256 amountOutMin, uint256 deadline) external {
        _swapFeesToRewards(tokenAmount, amountOutMin, deadline);
    }

    function claimRewards() external {
        _claimRewards(msg.sender, false);
    }

    function processAutoClaims(uint256 maxAccounts) external returns (uint256 processed, uint256 claims) {
        return _processAutoClaims(maxAccounts);
    }

    function dividendHoldersCount() external view returns (uint256) {
        return dividendHolders.length;
    }

    function withdrawableDividendOf(address account) public view returns (uint256) {
        return accumulativeDividendOf(account) - withdrawnDividends[account];
    }

    function accumulativeDividendOf(address account) public view returns (uint256) {
        int256 corrected = int256(magnifiedDividendPerShare * dividendShares[account]) + magnifiedDividendCorrections[account];
        if (corrected <= 0) return 0;
        return uint256(corrected) / MAGNITUDE;
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(to != address(0));
        require(balanceOf[from] >= value);

        uint256 fee;
        if (!swapping && !excludedFromFees[from] && !excludedFromFees[to] && pair != address(0)) {
            if (from == pair && buyFeeBps > 0) {
                fee = (value * buyFeeBps) / 10000;
            } else if (to == pair && sellFeeBps > 0) {
                fee = (value * sellFeeBps) / 10000;
            }
        }

        uint256 receiveAmount = value - fee;
        unchecked {
            balanceOf[from] -= value;
            balanceOf[to] += receiveAmount;
        }
        emit Transfer(from, to, receiveAmount);

        if (fee > 0) {
            balanceOf[address(this)] += fee;
            emit Transfer(from, address(this), fee);
        }

        _syncDividendShare(from);
        _syncDividendShare(to);
        if (fee > 0) _syncDividendShare(address(this));
        _maybeSwapFeesToRewards();
        _autoClaim(from);
        _autoClaim(to);
        if (autoClaimGasLimit > 0) _processAutoClaims(autoClaimGasLimit);
    }

    function _mint(address to, uint256 value) internal {
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
        _syncDividendShare(to);
    }

    function _distributeRewards(uint256 amount) internal {
        require(amount > 0);
        require(totalDividendShares > 0);
        magnifiedDividendPerShare += (amount * MAGNITUDE) / totalDividendShares;
        totalRewardsDistributed += amount;
    }

    function _setExcludedFromDividends(address account, bool excluded) internal {
        excludedFromDividends[account] = excluded;
        _syncDividendShare(account);
    }

    function _syncDividendShare(address account) internal {
        uint256 nextShare = excludedFromDividends[account] ? 0 : balanceOf[account];
        uint256 currentShare = dividendShares[account];
        if (nextShare == currentShare) return;

        if (nextShare > currentShare) {
            uint256 increase = nextShare - currentShare;
            totalDividendShares += increase;
            magnifiedDividendCorrections[account] -= int256(magnifiedDividendPerShare * increase);
        } else {
            uint256 decrease = currentShare - nextShare;
            totalDividendShares -= decrease;
            magnifiedDividendCorrections[account] += int256(magnifiedDividendPerShare * decrease);
        }
        dividendShares[account] = nextShare;
        _syncDividendHolder(account, nextShare);
    }

    function _setAutoRewardConfig(uint256 swapThreshold_, uint256 autoClaimThreshold_, uint256 autoClaimGasLimit_) internal {
        swapThreshold = swapThreshold_;
        autoClaimThreshold = autoClaimThreshold_;
        autoClaimGasLimit = autoClaimGasLimit_;
        emit AutoRewardsConfigured(swapThreshold_, autoClaimThreshold_, autoClaimGasLimit_);
    }

    function _maybeSwapFeesToRewards() internal {
        if (swapping || pair == address(0) || swapThreshold == 0 || totalDividendShares == 0) return;
        uint256 tokenBalance = balanceOf[address(this)];
        if (tokenBalance < swapThreshold) return;
        _swapFeesToRewards(swapThreshold, 0, block.timestamp + 1800);
    }

    function _swapFeesToRewards(uint256 tokenAmount, uint256 amountOutMin, uint256 deadline) internal {
        require(tokenAmount > 0);
        require(balanceOf[address(this)] >= tokenAmount);
        address reward = address(rewardToken);
        require(reward != address(this));
        require(totalDividendShares > 0);

        address[] memory path = new address[](3);
        path[0] = address(this);
        path[1] = pancakeRouter.WETH();
        path[2] = reward;

        swapping = true;
        allowance[address(this)][address(pancakeRouter)] = tokenAmount;
        emit Approval(address(this), address(pancakeRouter), tokenAmount);
        uint256 beforeBalance = rewardToken.balanceOf(address(this));
        pancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            tokenAmount,
            amountOutMin,
            path,
            address(this),
            deadline == 0 ? block.timestamp + 1800 : deadline
        );
        swapping = false;

        uint256 rewardAmount = rewardToken.balanceOf(address(this)) - beforeBalance;
        if (rewardAmount > 0) _distributeRewards(rewardAmount);
        emit FeesSwappedToRewards(tokenAmount, rewardAmount);
    }

    function _claimRewards(address account, bool automatic) internal returns (bool) {
        uint256 withdrawable = withdrawableDividendOf(account);
        if (withdrawable == 0) return false;
        if (automatic && withdrawable < autoClaimThreshold) return false;
        withdrawnDividends[account] += withdrawable;
        bool transferred;
        try rewardToken.transfer(account, withdrawable) returns (bool success) {
            transferred = success;
        } catch {
            transferred = false;
        }
        if (!transferred) {
            withdrawnDividends[account] -= withdrawable;
            if (automatic) return false;
            require(transferred);
        }
        emit RewardsClaimed(account, withdrawable);
        return true;
    }

    function _autoClaim(address account) internal {
        if (autoClaimThreshold == 0 || account == address(0) || excludedFromDividends[account]) return;
        _claimRewards(account, true);
    }

    function _processAutoClaims(uint256 maxAccounts) internal returns (uint256 processed, uint256 claims) {
        uint256 holders = dividendHolders.length;
        if (holders == 0 || maxAccounts == 0 || autoClaimThreshold == 0) return (0, 0);
        uint256 cursor = nextAutoClaimIndex;
        for (uint256 i = 0; i < maxAccounts; i++) {
            if (cursor >= holders) cursor = 0;
            address account = dividendHolders[cursor];
            if (_claimRewards(account, true)) claims++;
            cursor++;
            processed++;
        }
        nextAutoClaimIndex = cursor >= holders ? 0 : cursor;
        emit AutoClaimsProcessed(processed, claims);
    }

    function _syncDividendHolder(address account, uint256 share) internal {
        bool listed = dividendHolderIndexPlusOne[account] != 0;
        if (share > 0 && !listed) {
            dividendHolders.push(account);
            dividendHolderIndexPlusOne[account] = dividendHolders.length;
        } else if (share == 0 && listed) {
            uint256 index = dividendHolderIndexPlusOne[account] - 1;
            uint256 lastIndex = dividendHolders.length - 1;
            if (index != lastIndex) {
                address moved = dividendHolders[lastIndex];
                dividendHolders[index] = moved;
                dividendHolderIndexPlusOne[moved] = index + 1;
            }
            dividendHolders.pop();
            dividendHolderIndexPlusOne[account] = 0;
            if (nextAutoClaimIndex > dividendHolders.length) nextAutoClaimIndex = 0;
        }
    }
}
