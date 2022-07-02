// SPDX-License-Identifier: MIT
pragma solidity =0.8.15;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./interfaces/IUniswapCheckpoints.sol";
import "./interfaces/IUniswapV2Factory.sol";
import "./interfaces/IUniswapV2Pair.sol";
import "./libraries/FixedPoint.sol";

contract UniswapCheckpoints is IUniswapCheckpoints, OwnableUpgradeable {
    event CheckpointerUpdated(address oldCheckpointer, address newCheckpointer);
    event NewCheckpoint(
        address baseToken,
        address quoteToken,
        uint256 priceCumulative,
        uint256 timestamp
    );

    IUniswapV2Factory public uniswapFactory;
    address public checkpointer;

    // Base Currency -> Quote Currency -> Checkpoint Interval
    mapping(address => mapping(address => uint256)) public
        minCheckpointIntervals;

    // Base Currency -> Quote Currency -> Checkpoint Counts
    mapping(address => mapping(address => uint256)) public checkpointCounts;

    // Base Currency -> Quote Currency -> (Wrapped) Buffer Index -> Checkpoint
    mapping(address => mapping(address => mapping(uint256 => Checkpoint)))
        public checkpoints;

    uint256 public constant RING_BUFFER_SIZE = 128;
    uint256 public constant DEFAULT_MIN_CHECKPOINT_INTERVAL = 60;

    modifier onlyCheckpointer() {
        require(
            msg.sender == checkpointer, "UniswapCheckpoints: not checkpointer"
        );
        _;
    }

    function getCurrentCumulativePrice(address baseToken, address quoteToken)
        external
        view
        returns (uint256 priceCumulative)
    {
        priceCumulative = _getCurrentCumulativePrice(baseToken, quoteToken);
    }

    function getLatestCheckpointOlderThan(
        address baseToken,
        address quoteToken,
        uint256 minAge
    )
        external
        view
        returns (Checkpoint memory checkpoint)
    {
        checkpoint =
            _getLatestCheckpointOlderThan(baseToken, quoteToken, minAge);
    }

    function __UniswapCheckpoints_init(IUniswapV2Factory _uniswapFactory)
        public
        initializer
    {
        __Ownable_init();

        require(
            address(_uniswapFactory) != address(0),
            "UniswapCheckpoints: zero address"
        );

        uniswapFactory = _uniswapFactory;
    }

    function setCheckpointer(address newCheckpointer) external onlyOwner {
        address oldCheckpointer = checkpointer;
        checkpointer = newCheckpointer;
        emit CheckpointerUpdated(oldCheckpointer, newCheckpointer);
    }

    function makeCheckpoint(address baseToken, address quoteToken)
        external
        onlyCheckpointer
    {
        uint256 checkpointCount = checkpointCounts[baseToken][quoteToken];
        if (checkpointCount > 0) {
            // Check if min interval has passed
            uint256 minInterval =
                getMinCheckpointInterval(baseToken, quoteToken);
            Checkpoint memory lastCheckpoint =
                getCheckpointAt(baseToken, quoteToken, checkpointCount - 1);
            require(
                block.timestamp - lastCheckpoint.timestamp >= minInterval,
                "UniswapCheckpoints: checkpointing too frequent"
            );
        }

        uint256 priceCumulative =
            _getCurrentCumulativePrice(baseToken, quoteToken);

        // Insert new checkpoint into ring buffer
        checkpointCounts[baseToken][quoteToken] = checkpointCount + 1;
        checkpoints[baseToken][quoteToken][checkpointCount % RING_BUFFER_SIZE] =
        Checkpoint({
            priceCumulative: priceCumulative,
            timestamp: block.timestamp
        });

        // Emit event for off-chain tracking
        emit NewCheckpoint(
            baseToken, quoteToken, priceCumulative, block.timestamp
            );
    }

    function getMinCheckpointInterval(address baseToken, address quoteToken)
        private
        view
        returns (uint256 minInterval)
    {
        minInterval = minCheckpointIntervals[baseToken][quoteToken];
        if (minInterval == 0) {
            minInterval = DEFAULT_MIN_CHECKPOINT_INTERVAL;
        }
    }

    function getCheckpointAt(
        address baseToken,
        address quoteToken,
        uint256 index
    )
        private
        view
        returns (Checkpoint memory checkpoint)
    {
        checkpoint =
            checkpoints[baseToken][quoteToken][index % RING_BUFFER_SIZE];
    }

    // Adapted from: https://github.com/compound-finance/open-oracle/blob/0e148fdb0e8cbe4d412548490609679621ab2325/contracts/Uniswap/UniswapLib.sol#L42
    function _getCurrentCumulativePrice(address baseToken, address quoteToken)
        private
        view
        returns (uint256 priceCumulative)
    {
        IUniswapV2Pair pair =
            IUniswapV2Pair(uniswapFactory.getPair(baseToken, quoteToken));
        require(
            address(pair) != address(0), "UniswapCheckpoints: pair not found"
        );

        uint32 blockTimestamp = currentBlockTimestamp();

        if (uint160(baseToken) < uint160(quoteToken)) {
            // Base token is token0
            priceCumulative = pair.price0CumulativeLast();
        } else {
            // Base token is token1
            priceCumulative = pair.price1CumulativeLast();
        }

        // if time has elapsed since the last update on the pair, mock the accumulated price values
        (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast) =
            pair.getReserves();
        if (blockTimestampLast != blockTimestamp) {
            unchecked {
                // subtraction overflow is desired
                uint32 timeElapsed = blockTimestamp - blockTimestampLast;
                // addition overflow is desired
                if (uint160(baseToken) < uint160(quoteToken)) {
                    // Base token is token0
                    // counterfactual
                    priceCumulative +=
                        uint256(
                            FixedPoint.fraction(reserve1, reserve0)._x
                        )
                        * timeElapsed;
                } else {
                    // Base token is token1
                    // counterfactual
                    priceCumulative +=
                        uint256(
                            FixedPoint.fraction(reserve0, reserve1)._x
                        )
                        * timeElapsed;
                }
            }
        }
    }

    function _getLatestCheckpointOlderThan(
        address baseToken,
        address quoteToken,
        uint256 minAge
    )
        private
        view
        returns (Checkpoint memory checkpoint)
    {
        uint256 checkpointCount = checkpointCounts[baseToken][quoteToken];
        require(checkpointCount > 0, "UniswapCheckpoints: no checkpoint found");

        // Expensive loop. Cost limited by setting min checkpoint interval to reduce iterations
        uint256 indCheckpoint = checkpointCount - 1;
        while (true) {
            Checkpoint memory currentCheckpoint =
                getCheckpointAt(baseToken, quoteToken, indCheckpoint);
            if (block.timestamp - currentCheckpoint.timestamp >= minAge) {
                return currentCheckpoint;
            }

            // All items checked?
            require(
                indCheckpoint
                    > 0
                    && checkpointCount
                    - indCheckpoint
                    < RING_BUFFER_SIZE,
                "UniswapCheckpoints: no valid checkpoint"
            );

            indCheckpoint -= 1;
        }
    }

    // Taken from: https://github.com/compound-finance/open-oracle/blob/0e148fdb0e8cbe4d412548490609679621ab2325/contracts/Uniswap/UniswapLib.sol#L37
    function currentBlockTimestamp() private view returns (uint32) {
        return uint32(block.timestamp % 2 ** 32);
    }
}
