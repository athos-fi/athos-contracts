/**
 * This file is for bootstrapping a testing environment that's as complete as possible.
 * Note that this is intended for integration tests. For unit tests, you are recommended
 * to use mocks etc. to isolate the module under test.
 */

import { Duration } from "luxon";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { expandTo18Decimals, zeroAddress } from ".";

import {
  AccessController,
  Asset,
  AssetRegistry,
  BuildBurnSystem,
  AthToken,
  CollateralSystem,
  Config,
  DebtSystem,
  ExchangeSystem,
  Liquidation,
  MockChainlinkAggregator,
  OracleRouter,
  Perpetual,
  PerpExchange,
  PerpPositionToken,
  RewardLocker,
  RewardSystem,
} from "../../typechain";

const { formatBytes32String } = ethers.utils;

// Mock address to be used until relevant contracts are deployed
const MOCK_ADDRESS: string = "0x0000000000000000000000000000000000000001";

export interface DeployedStack {
  athToken: AthToken;
  accessController: AccessController;
  config: Config;
  ausdToken: Asset;
  abtcToken: Asset;
  abtcPerp: Perpetual;
  oracleRouter: OracleRouter;
  assetRegistry: AssetRegistry;
  debtSystem: DebtSystem;
  buildBurnSystem: BuildBurnSystem;
  collateralSystem: CollateralSystem;
  rewardLocker: RewardLocker;
  rewardSystem: RewardSystem;
  liquidation: Liquidation;
  exchangeSystem: ExchangeSystem;
  perpPositionToken: PerpPositionToken;
  perpExchange: PerpExchange;
  athOracle: MockChainlinkAggregator;
  abtcOracle: MockChainlinkAggregator;
}

export const deployAthosStack = async (
  deployer: SignerWithAddress
): Promise<DeployedStack> => {
  // Load contract factories
  const AthToken = await ethers.getContractFactory("AthToken", deployer);
  const AccessController = await ethers.getContractFactory(
    "AccessController",
    deployer
  );
  const Config = await ethers.getContractFactory("Config", deployer);
  const Asset = await ethers.getContractFactory("Asset", deployer);
  const OracleRouter = await ethers.getContractFactory(
    "OracleRouter",
    deployer
  );
  const AssetRegistry = await ethers.getContractFactory(
    "AssetRegistry",
    deployer
  );
  const DebtSystem = await ethers.getContractFactory("DebtSystem", deployer);
  const BuildBurnSystem = await ethers.getContractFactory(
    "BuildBurnSystem",
    deployer
  );
  const CollateralSystem = await ethers.getContractFactory(
    "CollateralSystem",
    deployer
  );
  const RewardLocker = await ethers.getContractFactory(
    "RewardLocker",
    deployer
  );
  const RewardSystem = await ethers.getContractFactory(
    "RewardSystem",
    deployer
  );
  const Liquidation = await ethers.getContractFactory("Liquidation", deployer);
  const ExchangeSystem = await ethers.getContractFactory(
    "ExchangeSystem",
    deployer
  );
  const PerpPositionToken = await ethers.getContractFactory(
    "PerpPositionToken",
    deployer
  );
  const Perpetual = await ethers.getContractFactory("Perpetual", deployer);
  const PerpExchange = await ethers.getContractFactory(
    "PerpExchange",
    deployer
  );
  const MockChainlinkAggregator = await ethers.getContractFactory(
    "MockChainlinkAggregator",
    deployer
  );

  const athToken: AthToken = (await upgrades.deployProxy(
    AthToken,
    [
      deployer.address, // genesis_holder
    ],
    {
      initializer: "__AthToken_init",
    }
  )) as AthToken;

  const accessController: AccessController = (await upgrades.deployProxy(
    AccessController,
    [],
    {
      initializer: "__AccessController_init",
    }
  )) as AccessController;

  const config: Config = (await upgrades.deployProxy(Config, [], {
    initializer: "__Config_init",
  })) as Config;

  const ausdToken: Asset = (await upgrades.deployProxy(
    Asset,
    [
      formatBytes32String("aUSD"), // _key
      "aUSD", // _name
      "aUSD", // _symbol
      accessController.address, // _accessCtrl
    ],
    {
      initializer: "__Asset_init",
    }
  )) as Asset;

  const oracleRouter: OracleRouter = (await upgrades.deployProxy(
    OracleRouter,
    [],
    {
      initializer: "__OracleRouter_init",
    }
  )) as OracleRouter;

  const assetRegistry: AssetRegistry = (await upgrades.deployProxy(
    AssetRegistry,
    [
      oracleRouter.address, // _oracleRouter
    ],
    {
      initializer: "__AssetRegistry_init",
    }
  )) as AssetRegistry;

  const debtSystem: DebtSystem = (await upgrades.deployProxy(
    DebtSystem,
    [
      accessController.address, // _accessCtrl
      assetRegistry.address, // _assetSys
    ],
    {
      initializer: "__DebtSystem_init",
    }
  )) as DebtSystem;

  const buildBurnSystem: BuildBurnSystem = (await upgrades.deployProxy(
    BuildBurnSystem,
    [
      ausdToken.address, // _lUSDToken
      debtSystem.address, // _debtSystem
      oracleRouter.address, // _priceGetter
      MOCK_ADDRESS, // _collaterSys
      config.address, // _mConfig
      MOCK_ADDRESS, // _liquidation
    ],
    {
      initializer: "__BuildBurnSystem_init",
    }
  )) as BuildBurnSystem;

  const collateralSystem: CollateralSystem = (await upgrades.deployProxy(
    CollateralSystem,
    [
      oracleRouter.address, // _priceGetter
      debtSystem.address, // _debtSystem
      config.address, // _mConfig
      MOCK_ADDRESS, // _mRewardLocker
      buildBurnSystem.address, // _buildBurnSystem
      MOCK_ADDRESS, // _liquidation
    ],
    {
      initializer: "__CollateralSystem_init",
    }
  )) as CollateralSystem;

  const rewardLocker: RewardLocker = (await upgrades.deployProxy(
    RewardLocker,
    [
      athToken.address, // _linaTokenAddr
      accessController.address, // _accessCtrl
    ],
    {
      initializer: "__RewardLocker_init",
    }
  )) as RewardLocker;

  const rewardSystem: RewardSystem = (await upgrades.deployProxy(
    RewardSystem,
    [
      (
        await ethers.provider.getBlock("latest")
      ).timestamp, // _firstPeriodStartTime
      MOCK_ADDRESS, // _rewardSigner
      ausdToken.address, // _lusdAddress
      collateralSystem.address, // _collateralSystemAddress
      rewardLocker.address, // _rewardLockerAddress
    ],
    {
      initializer: "__RewardSystem_init",
    }
  )) as RewardSystem;

  const liquidation: Liquidation = (await upgrades.deployProxy(
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
    }
  )) as Liquidation;

  const exchangeSystem: ExchangeSystem = (await upgrades.deployProxy(
    ExchangeSystem,
    [
      assetRegistry.address, // _mAssets
      oracleRouter.address, // _mPrices
      config.address, // _mConfig
      rewardSystem.address, // _mRewardSys
    ],
    {
      initializer: "__ExchangeSystem_init",
    }
  )) as ExchangeSystem;

  const perpPositionToken: PerpPositionToken = (await upgrades.deployProxy(
    PerpPositionToken,
    [],
    {
      initializer: "__PerpPositionToken_init",
    }
  )) as PerpPositionToken;

  const perpExchange: PerpExchange = (await upgrades.deployProxy(
    PerpExchange,
    [
      assetRegistry.address, // _lnAssetSystem
      config.address, // _lnConfig
      perpPositionToken.address, // _positionToken
      ausdToken.address, // _lusdToken
      zeroAddress, // _insuranceFundHolder
    ],
    {
      initializer: "__PerpExchange_init",
    }
  )) as PerpExchange;

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

  // Peripherals
  const athOracle: MockChainlinkAggregator =
    await MockChainlinkAggregator.deploy();
  const abtcOracle: MockChainlinkAggregator =
    await MockChainlinkAggregator.deploy();

  // System initialization starts here

  /**
   * Set config items:
   *
   * - BuildRatio: 0.2
   * - LiquidationRatio: 0.5
   * - LiquidationMarkerReward: 0.05
   * - LiquidationLiquidatorReward: 0.1
   * - LiquidationDelay: 3 days
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
  ])
    await config.connect(deployer).setUint(
      ethers.utils.formatBytes32String(item.key), // key
      item.value // value
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
   * Grant `PerpExchange` to mint and burn perp position tokens
   */
  await perpPositionToken.connect(deployer).setMinter(perpExchange.address);
  await perpPositionToken.connect(deployer).setBurner(perpExchange.address);

  /**
   * Set `PerpExchange` pool fee holder to `RewardSystem`
   */
  await perpExchange.connect(deployer).setPoolFeeHolder(rewardSystem.address);

  /**
   * Create synthetic asset aBTC
   */
  const abtcToken: Asset = (await upgrades.deployProxy(
    Asset,
    [
      formatBytes32String("aBTC"), // _key
      "aBTC", // _name
      "aBTC", // _symbol
      accessController.address, // _accessCtrl
    ],
    {
      initializer: "__Asset_init",
    }
  )) as Asset;

  /**
   * Create perpetual aBTC
   */
  const abtcPerp: Perpetual = (await upgrades.deployProxy(
    Perpetual,
    [
      perpExchange.address, // _exchange
      perpPositionToken.address, // _positionToken
      ausdToken.address, // _lusdToken
      abtcToken.address, // _underlyingToken
      oracleRouter.address, // _lnPrices
      expandTo18Decimals(0.1), // _minInitMargin
      expandTo18Decimals(0.05), // _maintenanceMargin
      expandTo18Decimals(0.01), // _feeRate
      expandTo18Decimals(0.02), // _liquidatorRewardRatio
      expandTo18Decimals(0.4), // _insuranceFundContributionRatio
    ],
    {
      initializer: "__Perpetual_init",
    }
  )) as Perpetual;

  /**
   * Register synth assets and perps on `AssetRegistry`
   */
  await assetRegistry.connect(deployer).addAsset(ausdToken.address);
  await assetRegistry.connect(deployer).addAsset(abtcToken.address);
  await assetRegistry.connect(deployer).addPerp(abtcPerp.address);

  /**
   * Register ATH on `CollateralSystem`
   */
  await collateralSystem.connect(deployer).UpdateTokenInfo(
    formatBytes32String("ATH"), // _currency
    athToken.address, // _tokenAddr
    expandTo18Decimals(1), // _minCollateral
    false // _close
  );

  /**
   * Set up oracles
   */
  await oracleRouter
    .connect(deployer)
    .setGlobalStalePeriod(Duration.fromObject({ hours: 12 }).as("seconds"));
  await athOracle.connect(deployer).setDecimals(8);
  await oracleRouter
    .connect(deployer)
    .addChainlinkOracle(formatBytes32String("ATH"), athOracle.address, false);
  await abtcOracle.connect(deployer).setDecimals(8);
  await oracleRouter
    .connect(deployer)
    .addChainlinkOracle(formatBytes32String("aBTC"), abtcOracle.address, false);

  return {
    athToken: athToken,
    accessController: accessController,
    config: config,
    ausdToken: ausdToken,
    abtcToken: abtcToken,
    abtcPerp: abtcPerp,
    oracleRouter: oracleRouter,
    assetRegistry: assetRegistry,
    debtSystem: debtSystem,
    buildBurnSystem: buildBurnSystem,
    collateralSystem: collateralSystem,
    rewardLocker: rewardLocker,
    rewardSystem: rewardSystem,
    liquidation: liquidation,
    exchangeSystem: exchangeSystem,
    perpPositionToken: perpPositionToken,
    perpExchange: perpExchange,
    athOracle: athOracle,
    abtcOracle: abtcOracle,
  };
};
