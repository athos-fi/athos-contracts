// SPDX-License-Identifier: MIT
pragma solidity =0.8.15;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/IERC20MetadataUpgradeable.sol";
import "./interfaces/IUniswapCheckpoints.sol";
import "./interfaces/IUniswapTwapOracle.sol";
import "./libraries/FixedPoint.sol";

contract UniswapTwapOracleV2 is IUniswapTwapOracle, AccessControlUpgradeable {
    event PriceRangeUpdated(uint256 minPrice, uint256 maxPrice);
    event PriceUpdated(uint256 price);
    event PriceRouteUpdated(address[] route);

    IUniswapCheckpoints public checkpoints;
    address[] public priceRoute;
    uint8[] public quoteDecimals;
    uint256 public minInterval;
    uint256 public maxInterval;
    uint256 public minPrice;
    uint256 public maxPrice;

    PriceWithTime public latestPrice;

    uint256 private constant PRICE_DECIMALS = 18;
    uint256 private constant PRICE_SCALE = 10 ** PRICE_DECIMALS;

    modifier onlyUpdatePriceRole() {
        require(hasRole("UPDATE_PRICE", msg.sender), "UniswapTwapOracle: not UPDATE_PRICE role");
        _;
    }

    modifier onlyUpdatePriceRangeRole() {
        require(hasRole("UPDATE_PRICE_RANGE", msg.sender), "UniswapTwapOracle: not UPDATE_PRICE_RANGE role");
        _;
    }

    modifier onlyUpdatePriceRouteRole() {
        require(hasRole("UPDATE_PRICE_ROUTE", msg.sender), "UniswapTwapOracle: not UPDATE_PRICE_ROUTE role");
        _;
    }

    function getLatestPrice() external view returns (PriceWithTime memory) {
        return latestPrice;
    }

    function setPriceRange(uint256 _minPrice, uint256 _maxPrice) external onlyUpdatePriceRangeRole {
        require(_maxPrice >= _minPrice, "UniswapTwapOracle: invalid price range");

        minPrice = _minPrice;
        maxPrice = _maxPrice;

        emit PriceRangeUpdated(_minPrice, _maxPrice);
    }

    function setPriceRoute(address[] calldata route) external onlyUpdatePriceRouteRole {
        require(route.length > 1, "UniswapTwapOracle: price route too short");
        require(route.length == priceRoute.length, "UniswapTwapOracle: price route length mis-match");
        priceRoute = route;
        emit PriceRouteUpdated(route);
    }

    function observePrice() external onlyUpdatePriceRole {
        uint256 lastPrice = 0;

        for (uint256 indPair = 0; indPair < priceRoute.length - 1; indPair++) {
            uint256 currentPrice = getPairPrice(priceRoute[indPair], priceRoute[indPair + 1], quoteDecimals[indPair]);
            if (lastPrice == 0) {
                lastPrice = currentPrice;
            } else {
                lastPrice = lastPrice * currentPrice / PRICE_SCALE;
            }
        }

        require(minPrice == 0 || lastPrice >= minPrice, "UniswapTwapOracle: price too low");
        require(maxPrice == 0 || lastPrice <= maxPrice, "UniswapTwapOracle: price too high");

        // Overflow checks
        require(uint192(lastPrice) == lastPrice, "UniswapTwapOracle: price overflow");
        require(uint64(block.timestamp) == block.timestamp, "UniswapTwapOracle: timestamp overflow");

        latestPrice = PriceWithTime({price: uint192(lastPrice), timestamp: uint64(block.timestamp)});

        emit PriceUpdated(lastPrice);
    }

    // Adapted from: https://github.com/compound-finance/open-oracle/blob/0e148fdb0e8cbe4d412548490609679621ab2325/contracts/Uniswap/UniswapAnchoredView.sol#L221
    function getPairPrice(address baseToken, address quoteToken, uint8 quoteDecimal)
        private
        view
        returns (uint256 price)
    {
        uint256 nowCumulativePrice = checkpoints.getCurrentCumulativePrice(baseToken, quoteToken);
        IUniswapCheckpoints.Checkpoint memory oldCheckpoint =
            checkpoints.getLatestCheckpointOlderThan(baseToken, quoteToken, minInterval);

        uint256 timeElapsed = block.timestamp - oldCheckpoint.timestamp;
        require(timeElapsed >= minInterval, "UniswapTwapOracle: time elasped too small");
        require(timeElapsed <= maxInterval, "UniswapTwapOracle: time elasped too large");

        // Calculate uniswap time-weighted average price
        // Underflow is a property of the accumulators: https://uniswap.org/audit.html#orgc9b3190
        FixedPoint.uq112x112 memory priceAverage;
        unchecked {
            priceAverage =
                FixedPoint.uq112x112(uint224((nowCumulativePrice - oldCheckpoint.priceCumulative) / timeElapsed));
        }
        uint256 rawUniswapPriceMantissa = FixedPoint.decode112with18(priceAverage);

        if (quoteDecimal == PRICE_DECIMALS) {
            price = rawUniswapPriceMantissa;
        } else if (quoteDecimal < PRICE_DECIMALS) {
            price = rawUniswapPriceMantissa * 10 ** (PRICE_DECIMALS - quoteDecimal);
        } else {
            price = rawUniswapPriceMantissa / 10 ** (quoteDecimal - PRICE_DECIMALS);
        }
    }
}
