// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract OwnableLite {
    address public owner;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor(address initialOwner) {
        require(initialOwner != address(0));
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    modifier onlyOwner() {
        require(msg.sender == owner);
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0));
        _transferOwnership(newOwner);
    }

    function renounceOwnership() external onlyOwner {
        _renounceOwnership();
    }

    function _transferOwnership(address newOwner) internal {
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function _renounceOwnership() internal {
        emit OwnershipTransferred(owner, address(0));
        owner = address(0);
    }
}
