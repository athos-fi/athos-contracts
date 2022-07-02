// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.6.12 <0.9.0;

interface IUniswapTwapOracle {
    struct PriceWithTime {
        uint192 price;
        uint64 timestamp;
    }

    function getLatestPrice() external view returns (PriceWithTime memory);
}
