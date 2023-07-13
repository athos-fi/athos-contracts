import { ethers, upgrades } from "hardhat";
import { DateTime, Duration } from "luxon";

import { StackManager } from "../stack";
import { DeploymentKey } from "../stack/contracts";
import { selectSigner } from "../utils";
import { expandTo18Decimals, mockAddress } from "../../hh_test/utilities";

import {
  AccessController__factory,
  Asset,
  AssetRegistry,
  BuildBurnSystem,
  CollateralSystem,
  Config,
  DebtSystem,
  ExchangeSystem,
  Liquidation,
  OracleRouter,
  Perpetual,
  PerpExchange,
  PerpPositionToken,
  RewardLocker__factory,
  RewardSystem,
  UniswapCheckpointer,
  UniswapCheckpoints,
  UniswapTwapOracle,
} from "../../typechain";

const { formatBytes32String } = ethers.utils;

const runScript = async () => {
  const stackManager = new StackManager();
  const deployer = await selectSigner();
  const deployerAddress = await deployer.getAddress();

  const Config = await ethers.getContractFactory("Config", deployer);
  const Asset = await ethers.getContractFactory("Asset", deployer);
  const OracleRouter = await ethers.getContractFactory(
    "OracleRouter",
    deployer,
  );
  const AssetRegistry = await ethers.getContractFactory(
    "AssetRegistry",
    deployer,
  );
  const DebtSystem = await ethers.getContractFactory("DebtSystem", deployer);
  const BuildBurnSystem = await ethers.getContractFactory(
    "BuildBurnSystem",
    deployer,
  );
  const CollateralSystem = await ethers.getContractFactory(
    "CollateralSystem",
    deployer,
  );
  const RewardSystem = await ethers.getContractFactory(
    "RewardSystem",
    deployer,
  );
  const Liquidation = await ethers.getContractFactory("Liquidation", deployer);
  const ExchangeSystem = await ethers.getContractFactory(
    "ExchangeSystem",
    deployer,
  );
  const PerpPositionToken = await ethers.getContractFactory(
    "PerpPositionToken",
    deployer,
  );
  const Perpetual = await ethers.getContractFactory("Perpetual", deployer);
  const PerpExchange = await ethers.getContractFactory(
    "PerpExchange",
    deployer,
  );
  const UniswapCheckpoints = await ethers.getContractFactory(
    "UniswapCheckpoints",
    deployer,
  );
  const UniswapCheckpointer = await ethers.getContractFactory(
    "UniswapCheckpointer",
    deployer,
  );
  const UniswapTwapOracle = await ethers.getContractFactory(
    "UniswapTwapOracle",
    deployer,
  );

  const athToken = stackManager.getDeploymentChecked(DeploymentKey.AthToken);
  const accessController = AccessController__factory.connect(
    stackManager.getDeploymentChecked(DeploymentKey.AccessController).address,
    deployer,
  );
  const rewardLocker = RewardLocker__factory.connect(
    stackManager.getDeploymentChecked(DeploymentKey.RewardLocker).address,
    deployer,
  );

  const config = (await upgrades.deployProxy(Config, [], {
    initializer: "__Config_init",
  })) as Config;
  stackManager.setDeployment(DeploymentKey.Config, config.address);

  const athusdToken = (await upgrades.deployProxy(
    Asset,
    [
      formatBytes32String("athUSD"), // _key
      "athUSD", // _name
      "athUSD", // _symbol
      accessController.address, // _accessCtrl
    ],
    {
      initializer: "__Asset_init",
    },
  )) as Asset;
  stackManager.setDeployment(DeploymentKey.AthusdToken, athusdToken.address);

  const oracleRouter = (await upgrades.deployProxy(OracleRouter, [], {
    initializer: "__OracleRouter_init",
  })) as OracleRouter;
  stackManager.setDeployment(DeploymentKey.OracleRouter, oracleRouter.address);

  const assetRegistry = (await upgrades.deployProxy(
    AssetRegistry,
    [
      oracleRouter.address, // _oracleRouter
    ],
    {
      initializer: "__AssetRegistry_init",
    },
  )) as AssetRegistry;
  stackManager.setDeployment(
    DeploymentKey.AssetRegistry,
    assetRegistry.address,
  );

  const debtSystem = (await upgrades.deployProxy(
    DebtSystem,
    [
      accessController.address, // _accessCtrl
      assetRegistry.address, // _assetSys
    ],
    {
      initializer: "__DebtSystem_init",
    },
  )) as DebtSystem;
  stackManager.setDeployment(DeploymentKey.DebtSystem, debtSystem.address);

  const buildBurnSystem = (await upgrades.deployProxy(
    BuildBurnSystem,
    [
      athusdToken.address, // _lUSDToken
      debtSystem.address, // _debtSystem
      oracleRouter.address, // _priceGetter
      mockAddress, // _collaterSys
      config.address, // _mConfig
      mockAddress, // _liquidation
    ],
    {
      initializer: "__BuildBurnSystem_init",
    },
  )) as BuildBurnSystem;
  stackManager.setDeployment(
    DeploymentKey.BuildBurnSystem,
    buildBurnSystem.address,
  );

  const collateralSystem = (await upgrades.deployProxy(
    CollateralSystem,
    [
      oracleRouter.address, // _priceGetter
      debtSystem.address, // _debtSystem
      config.address, // _mConfig
      mockAddress, // _mRewardLocker
      buildBurnSystem.address, // _buildBurnSystem
      mockAddress, // _liquidation
    ],
    {
      initializer: "__CollateralSystem_init",
    },
  )) as CollateralSystem;
  stackManager.setDeployment(
    DeploymentKey.CollateralSystem,
    collateralSystem.address,
  );

  const rewardSystem = (await upgrades.deployProxy(
    RewardSystem,
    [
      DateTime.fromISO(
        stackManager.config.firstRewardPeriodStartTime,
      ).toSeconds(), // _firstPeriodStartTime
      mockAddress, // _rewardSigner
      athusdToken.address, // _lusdAddress
      collateralSystem.address, // _collateralSystemAddress
      rewardLocker.address, // _rewardLockerAddress
    ],
    {
      initializer: "__RewardSystem_init",
    },
  )) as RewardSystem;
  stackManager.setDeployment(DeploymentKey.RewardSystem, rewardSystem.address);

  const liquidation = (await upgrades.deployProxy(
    Liquidation,
    [
      buildBurnSystem.address, // _buildBurnSystem
      collateralSystem.address, // _collateralSystem
      config.address, // _config
      debtSystem.address, // _debtSystem
      oracleRouter.address, // _oracleRouter
      rewardLocker.address, // _rewardLocker
    ],
    {
      initializer: "__Liquidation_init",
    },
  )) as Liquidation;
  stackManager.setDeployment(DeploymentKey.Liquidation, liquidation.address);

  const exchangeSystem = (await upgrades.deployProxy(
    ExchangeSystem,
    [
      assetRegistry.address, // _mAssets
      oracleRouter.address, // _mPrices
      config.address, // _mConfig
      rewardSystem.address, // _mRewardSys
    ],
    {
      initializer: "__ExchangeSystem_init",
    },
  )) as ExchangeSystem;
  stackManager.setDeployment(
    DeploymentKey.ExchangeSystem,
    exchangeSystem.address,
  );

  const perpPositionToken = (await upgrades.deployProxy(PerpPositionToken, [], {
    initializer: "__PerpPositionToken_init",
  })) as PerpPositionToken;
  stackManager.setDeployment(
    DeploymentKey.PerpPositionToken,
    perpPositionToken.address,
  );

  const perpExchange = (await upgrades.deployProxy(
    PerpExchange,
    [
      assetRegistry.address, // _lnAssetSystem
      config.address, // _lnConfig
      perpPositionToken.address, // _positionToken
      athusdToken.address, // _lusdToken
      stackManager.config.insurnaceFundHolder, // _insuranceFundHolder
    ],
    {
      initializer: "__PerpExchange_init",
    },
  )) as PerpExchange;
  stackManager.setDeployment(DeploymentKey.PerpExchange, perpExchange.address);

  // Fix circular dependencies
  await buildBurnSystem
    .connect(deployer)
    .setCollateralSystemAddress(collateralSystem.address);
  await buildBurnSystem
    .connect(deployer)
    .setLiquidationAddress(liquidation.address);
  await collateralSystem
    .connect(deployer)
    .setRewardLockerAddress(rewardLocker.address);
  await collateralSystem
    .connect(deployer)
    .setLiquidationAddress(liquidation.address);
  await rewardLocker
    .connect(deployer)
    .updateCollateralSystemAddress(collateralSystem.address);

  // System initialization starts here

  /**
   * Set config items:
   *
   * - BuildRatio: 0.2
   * - LiquidationRatio: 0.5
   * - LiquidationMarkerReward: 0.05
   * - LiquidationLiquidatorReward: 0.1
   * - LiquidationDelay: 3 days
   * - TradeSettlementDelay: 125 seconds
   * - TradeRevertDelay: 10 minutes
   * - FoundationFeeSplit: 0.3
   */
  for (const item of [
    {
      key: "BuildRatio",
      value: expandTo18Decimals(0.2),
    },
    {
      key: "LiquidationRatio",
      value: expandTo18Decimals(0.5),
    },
    {
      key: "LiquidationMarkerReward",
      value: expandTo18Decimals(0.05),
    },
    {
      key: "LiquidationLiquidatorReward",
      value: expandTo18Decimals(0.1),
    },
    {
      key: "LiquidationDelay",
      value: Duration.fromObject({ days: 3 }).as("seconds"),
    },
    {
      key: "TradeSettlementDelay",
      value: Duration.fromObject({ seconds: 125 }).as("seconds"),
    },
    {
      key: "TradeRevertDelay",
      value: Duration.fromObject({ minutes: 10 }).as("seconds"),
    },
    {
      key: "FoundationFeeSplit",
      value: expandTo18Decimals(0.3),
    },
  ])
    await config.connect(deployer).setUint(
      formatBytes32String(item.key), // key
      item.value, // value
    );

  /**
   * Assign the following roles to contract `BuildBurnSystem`:
   * - ISSUE_ASSET
   * - BURN_ASSET
   * - UPDATE_DEBT
   */
  await accessController
    .connect(deployer)
    .grantRole(formatBytes32String("ISSUE_ASSET"), buildBurnSystem.address);
  await accessController
    .connect(deployer)
    .grantRole(formatBytes32String("BURN_ASSET"), buildBurnSystem.address);
  await accessController
    .connect(deployer)
    .grantRole(formatBytes32String("UPDATE_DEBT"), buildBurnSystem.address);

  /**
   * Assign the following roles to contract `ExchangeSystem`:
   * - ISSUE_ASSET
   * - BURN_ASSET
   * - MOVE_ASSET
   */
  await accessController
    .connect(deployer)
    .grantRole(formatBytes32String("ISSUE_ASSET"), exchangeSystem.address);
  await accessController
    .connect(deployer)
    .grantRole(formatBytes32String("BURN_ASSET"), exchangeSystem.address);
  await accessController
    .connect(deployer)
    .grantRole(formatBytes32String("MOVE_ASSET"), exchangeSystem.address);

  /**
   * Assign the following role to contract `Liquidation`:
   * - MOVE_REWARD
   */
  await accessController
    .connect(deployer)
    .grantRole(formatBytes32String("MOVE_REWARD"), liquidation.address);

  /**
   * Assign the following role to contract `RewardSystem`:
   * - LOCK_REWARD
   */
  await accessController
    .connect(deployer)
    .grantRole(formatBytes32String("LOCK_REWARD"), rewardSystem.address);

  /**
   * Assign the following role to contract `PerpExchange`:
   * - ISSUE_ASSET
   * - BURN_ASSET
   */
  await accessController
    .connect(deployer)
    .grantRole(formatBytes32String("ISSUE_ASSET"), perpExchange.address);
  await accessController
    .connect(deployer)
    .grantRole(formatBytes32String("BURN_ASSET"), perpExchange.address);

  /**
   * Rewards to be sent out from RewardLocker itself
   */
  await rewardLocker
    .connect(deployer)
    .updateRewarderAddress(rewardLocker.address);

  /**
   * Set RewardSystem reward signer
   */
  await rewardSystem
    .connect(deployer)
    .setRewardSigner(stackManager.config.rewardSigner);

  /**
   * Grant `PerpExchange` to mint and burn perp position tokens
   */
  await perpPositionToken.connect(deployer).setMinter(perpExchange.address);
  await perpPositionToken.connect(deployer).setBurner(perpExchange.address);

  /**
   * Set `PerpExchange` fee holders
   */
  await perpExchange.connect(deployer).setPoolFeeHolder(rewardSystem.address);
  await perpExchange
    .connect(deployer)
    .setFoundationFeeHolder(stackManager.config.foundationFeeHolder);

  /**
   * Register synth assets on `AssetRegistry`
   */
  await assetRegistry.connect(deployer).addAsset(athusdToken.address);

  /**
   * Register ATH on `CollateralSystem`
   */
  await collateralSystem.connect(deployer).UpdateTokenInfo(
    formatBytes32String("ATH"), // _currency
    athToken.address, // _tokenAddr
    expandTo18Decimals(1), // _minCollateral
    false, // _close
  );

  /**
   * Set up oracles
   */
  await oracleRouter.connect(deployer).setGlobalStalePeriod(
    Duration.fromObject({ minutes: 10 }).as("seconds"), // newStalePeriod
  );

  const assetList = [
    {
      symbol: "BTC",
      assetKey: DeploymentKey.AthbtcToken,
      perpKey: DeploymentKey.AthbtcPerp,
    },
    {
      symbol: "ETH",
      assetKey: DeploymentKey.AthethToken,
      perpKey: DeploymentKey.AthethPerp,
    },
    {
      symbol: "GLMR",
      assetKey: DeploymentKey.AthglmrToken,
      perpKey: DeploymentKey.AthglmrPerp,
    },
    {
      symbol: "ATOM",
      assetKey: DeploymentKey.AthatomToken,
      perpKey: undefined,
    },
    {
      symbol: "BNB",
      assetKey: DeploymentKey.AthbnbToken,
      perpKey: undefined,
    },
    {
      symbol: "DOT",
      assetKey: DeploymentKey.AthdotToken,
      perpKey: undefined,
    },
    {
      symbol: "LINK",
      assetKey: DeploymentKey.AthlinkToken,
      perpKey: undefined,
    },
  ];

  for (const asset of assetList) {
    /**
     * Create synthetic asset
     */
    const assetToken = (await upgrades.deployProxy(
      Asset,
      [
        formatBytes32String("ath" + asset.symbol), // _key
        "ath" + asset.symbol, // _name
        "ath" + asset.symbol, // _symbol
        accessController.address, // _accessCtrl
      ],
      {
        initializer: "__Asset_init",
      },
    )) as Asset;
    stackManager.setDeployment(asset.assetKey, assetToken.address);

    /**
     * Register on `AssetRegistry`
     */
    await assetRegistry.connect(deployer).addAsset(assetToken.address);

    /**
     * Create perpetual and register
     */
    if (asset.perpKey) {
      const perpContract = (await upgrades.deployProxy(
        Perpetual,
        [
          perpExchange.address, // _exchange
          perpPositionToken.address, // _positionToken
          athusdToken.address, // _lusdToken
          assetToken.address, // _underlyingToken
          oracleRouter.address, // _lnPrices
          expandTo18Decimals(0.95), // _minInitMargin
          expandTo18Decimals(0.2), // _maintenanceMargin
          expandTo18Decimals(0.0025), // _feeRate
          expandTo18Decimals(0.01), // _liquidatorRewardRatio
          expandTo18Decimals(0.75), // _insuranceFundContributionRatio
        ],
        {
          initializer: "__Perpetual_init",
        },
      )) as Perpetual;
      stackManager.setDeployment(asset.perpKey, perpContract.address);

      await assetRegistry.connect(deployer).addPerp(perpContract.address);
    }

    /**
     * Set token exchange fee rate to 0.25%
     */
    await config.connect(deployer).setUint(
      formatBytes32String("ath" + asset.symbol), // key
      expandTo18Decimals(0.0025), // value
    );

    /**
     * Set up oracle
     */
    await oracleRouter.connect(deployer).addChainlinkOracle(
      formatBytes32String("ath" + asset.symbol), // currencyKey
      stackManager.config.chainlinkAggregators[asset.symbol], // oracleAddress
      false, // removeExisting
    );
  }

  /**
   * ATH oracle
   */
  {
    const uniswapCheckpoints = (await upgrades.deployProxy(
      UniswapCheckpoints,
      [
        stackManager.config.uniswapFactory, // _uniswapFactory
      ],
      {
        initializer: "__UniswapCheckpoints_init",
      },
    )) as UniswapCheckpoints;
    stackManager.setDeployment(
      DeploymentKey.UniswapCheckpoints,
      uniswapCheckpoints.address,
    );

    const uniswapCheckpointer = (await upgrades.deployProxy(
      UniswapCheckpointer,
      [
        uniswapCheckpoints.address, // _checkpoints
      ],
      {
        initializer: "__UniswapCheckpointer_init",
      },
    )) as UniswapCheckpointer;
    stackManager.setDeployment(
      DeploymentKey.UniswapCheckpointer,
      uniswapCheckpointer.address,
    );

    const athTwapOracle = (await upgrades.deployProxy(
      UniswapTwapOracle,
      [
        uniswapCheckpoints.address, // _checkpoints
        [athToken.address, stackManager.config.weth, stackManager.config.usdc], // _priceRoute
        Duration.fromObject({ minutes: 5 }).as("seconds"), // _minInterval
        Duration.fromObject({ minutes: 15 }).as("seconds"), // _maxInterval
        0, // _minPrice
        0, // _maxPrice
      ],
      {
        initializer: "__UniswapTwapOracle_init",
      },
    )) as UniswapTwapOracle;
    stackManager.setDeployment(
      DeploymentKey.AthTwapOracle,
      athTwapOracle.address,
    );

    await oracleRouter
      .connect(deployer)
      .addUniswapTwapOracle(
        formatBytes32String("ATH"),
        athTwapOracle.address,
        false,
      );

    await uniswapCheckpoints
      .connect(deployer)
      .setCheckpointer(uniswapCheckpointer.address);
    await athTwapOracle
      .connect(deployer)
      .grantRole(
        formatBytes32String("UPDATE_PRICE"),
        stackManager.config.twapUpdater,
      );
    await athTwapOracle
      .connect(deployer)
      .grantRole(formatBytes32String("UPDATE_PRICE_RANGE"), deployerAddress);
  }
};

runScript()
  .then(() => process.exit(0))
  .catch((ex) => {
    console.error(ex);
    process.exit(1);
  });
