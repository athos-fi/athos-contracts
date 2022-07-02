// SPDX-License-Identifier: MIT
pragma solidity >=0.6.12 <0.9.0;

interface IOracleRouter {
    function getPrice(bytes32 currencyKey) external view returns (uint256);

    function exchange(bytes32 sourceKey, uint256 sourceAmount, bytes32 destKey)
        external
        view
        returns (uint256);
}
