// SPDX-License-Identifier: MIT
pragma solidity =0.8.15;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/IERC20MetadataUpgradeable.sol";
import "./interfaces/IUniswapCheckpoints.sol";
import "./interfaces/IUniswapTwapOracle.sol";
import "./libraries/FixedPoint.sol";

contract UniswapTwapOracle is IUniswapTwapOracle, AccessControlUpgradeable {
    event PriceRangeUpdated(uint256 minPrice, uint256 maxPrice);
    event PriceUpdated(uint256 price);

    IUniswapCheckpoints public checkpoints;
    address[] public priceRoute;
    uint8[] public baseDecimals;
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

    function getLatestPrice() external view returns (PriceWithTime memory) {
        return latestPrice;
    }

    function __UniswapTwapOracle_init(
        IUniswapCheckpoints _checkpoints,
        address[] calldata _priceRoute,
        uint256 _minInterval,
        uint256 _maxInterval,
        uint256 _minPrice,
        uint256 _maxPrice
    ) public initializer {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);

        require(address(_checkpoints) != address(0), "UniswapTwapOracle: zero address");
        require(_priceRoute.length > 1, "UniswapTwapOracle: price route too short");
        require(_maxInterval >= _minInterval, "UniswapTwapOracle: invalid interval range");
        require(_maxPrice >= _minPrice, "UniswapTwapOracle: invalid price range");

        checkpoints = _checkpoints;
        minInterval = _minInterval;
        maxInterval = _maxInterval;
        minPrice = _minPrice;
        maxPrice = _maxPrice;

        for (uint256 indToken = 0; indToken < _priceRoute.length; indToken++) {
            priceRoute.push(_priceRoute[indToken]);
            if (indToken > 0) {
                baseDecimals.push(IERC20MetadataUpgradeable(_priceRoute[indToken]).decimals());
            }
        }

        emit PriceRangeUpdated(_minPrice, _maxPrice);
    }

    function setPriceRange(uint256 _minPrice, uint256 _maxPrice) external onlyUpdatePriceRangeRole {
        require(_maxPrice >= _minPrice, "UniswapTwapOracle: invalid price range");

        minPrice = _minPrice;
        maxPrice = _maxPrice;

        emit PriceRangeUpdated(_minPrice, _maxPrice);
    }

    function observePrice() external onlyUpdatePriceRole {
        uint256 lastPrice = 0;

        for (uint256 indPair = 0; indPair < priceRoute.length - 1; indPair++) {
            uint256 currentPrice = getPairPrice(priceRoute[indPair], priceRoute[indPair + 1], baseDecimals[indPair]);
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
    function getPairPrice(address baseToken, address quoteToken, uint8 baseDecimal)
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

        if (baseDecimal == PRICE_DECIMALS) {
            price = rawUniswapPriceMantissa;
        } else if (baseDecimal < PRICE_DECIMALS) {
            price = rawUniswapPriceMantissa * 10 ** (PRICE_DECIMALS - baseDecimal);
        } else {
            price = rawUniswapPriceMantissa / 10 ** (baseDecimal - PRICE_DECIMALS);
        }
    }
}
