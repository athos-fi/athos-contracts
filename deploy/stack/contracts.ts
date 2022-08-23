export enum ContractName {
  AthToken = "AthToken",
  AccessController = "AccessController",
  RewardLocker = "RewardLocker",
  AirdropDistributor = "AirdropDistributor",
  Config = "Config",
  Asset = "Asset",
  OracleRouter = "OracleRouter",
  AssetRegistry = "AssetRegistry",
  DebtSystem = "DebtSystem",
  BuildBurnSystem = "BuildBurnSystem",
  CollateralSystem = "CollateralSystem",
  RewardSystem = "RewardSystem",
  Liquidation = "Liquidation",
  ExchangeSystem = "ExchangeSystem",
  PerpPositionToken = "PerpPositionToken",
  Perpetual = "Perpetual",
  PerpExchange = "PerpExchange",
  UniswapCheckpoints = "UniswapCheckpoints",
  UniswapCheckpointer = "UniswapCheckpointer",
  UniswapTwapOracle = "UniswapTwapOracle",
  TokenEscrow = "TokenEscrow",
}

export enum DeploymentKey {
  AthToken = "AthToken",
  AccessController = "AccessController",
  RewardLocker = "RewardLocker",
  AirdropDistributor1 = "AirdropDistributor1",
  AirdropDistributor2 = "AirdropDistributor2",
  AirdropDistributor3 = "AirdropDistributor3",
  AirdropDistributor4 = "AirdropDistributor4",
  AirdropDistributor5 = "AirdropDistributor5",
  Config = "Config",
  AthusdToken = "AthusdToken",
  OracleRouter = "OracleRouter",
  AssetRegistry = "AssetRegistry",
  DebtSystem = "DebtSystem",
  BuildBurnSystem = "BuildBurnSystem",
  CollateralSystem = "CollateralSystem",
  RewardSystem = "RewardSystem",
  Liquidation = "Liquidation",
  ExchangeSystem = "ExchangeSystem",
  PerpPositionToken = "PerpPositionToken",
  PerpExchange = "PerpExchange",
  UniswapCheckpoints = "UniswapCheckpoints",
  UniswapCheckpointer = "UniswapCheckpointer",
  AthbtcToken = "AthbtcToken",
  AthbtcPerp = "AthbtcPerp",
  AthethToken = "AthethToken",
  AthethPerp = "AthethPerp",
  AthglmrToken = "AthglmrToken",
  AthglmrPerp = "AthglmrPerp",
  AthatomToken = "AthatomToken",
  AthbnbToken = "AthbnbToken",
  AthdotToken = "AthdotToken",
  AthlinkToken = "AthlinkToken",
  AthTwapOracle = "AthTwapOracle",
}

export interface Deployment {
  contract: ContractName;
  address: string;
}

export interface Contracts {
  [DeploymentKey.AthToken]: Deployment | null;
  [DeploymentKey.AccessController]: Deployment | null;
  [DeploymentKey.RewardLocker]: Deployment | null;
  [DeploymentKey.AirdropDistributor1]: Deployment | null;
  [DeploymentKey.AirdropDistributor2]: Deployment | null;
  [DeploymentKey.AirdropDistributor3]: Deployment | null;
  [DeploymentKey.AirdropDistributor4]: Deployment | null;
  [DeploymentKey.AirdropDistributor5]: Deployment | null;
  [DeploymentKey.Config]: Deployment | null;
  [DeploymentKey.AthusdToken]: Deployment | null;
  [DeploymentKey.OracleRouter]: Deployment | null;
  [DeploymentKey.AssetRegistry]: Deployment | null;
  [DeploymentKey.DebtSystem]: Deployment | null;
  [DeploymentKey.BuildBurnSystem]: Deployment | null;
  [DeploymentKey.CollateralSystem]: Deployment | null;
  [DeploymentKey.RewardSystem]: Deployment | null;
  [DeploymentKey.Liquidation]: Deployment | null;
  [DeploymentKey.ExchangeSystem]: Deployment | null;
  [DeploymentKey.PerpPositionToken]: Deployment | null;
  [DeploymentKey.PerpExchange]: Deployment | null;
  [DeploymentKey.UniswapCheckpoints]: Deployment | null;
  [DeploymentKey.UniswapCheckpointer]: Deployment | null;
  [DeploymentKey.AthbtcToken]: Deployment | null;
  [DeploymentKey.AthbtcPerp]: Deployment | null;
  [DeploymentKey.AthethToken]: Deployment | null;
  [DeploymentKey.AthethPerp]: Deployment | null;
  [DeploymentKey.AthglmrToken]: Deployment | null;
  [DeploymentKey.AthglmrPerp]: Deployment | null;
  [DeploymentKey.AthatomToken]: Deployment | null;
  [DeploymentKey.AthbnbToken]: Deployment | null;
  [DeploymentKey.AthdotToken]: Deployment | null;
  [DeploymentKey.AthlinkToken]: Deployment | null;
  [DeploymentKey.AthTwapOracle]: Deployment | null;
}

export const contractNamesByDeploymentKey: Record<DeploymentKey, ContractName> =
  {
    [DeploymentKey.AthToken]: ContractName.AthToken,
    [DeploymentKey.AccessController]: ContractName.AccessController,
    [DeploymentKey.RewardLocker]: ContractName.RewardLocker,
    [DeploymentKey.AirdropDistributor1]: ContractName.AirdropDistributor,
    [DeploymentKey.AirdropDistributor2]: ContractName.AirdropDistributor,
    [DeploymentKey.AirdropDistributor3]: ContractName.AirdropDistributor,
    [DeploymentKey.AirdropDistributor4]: ContractName.AirdropDistributor,
    [DeploymentKey.AirdropDistributor5]: ContractName.AirdropDistributor,
    [DeploymentKey.Config]: ContractName.Config,
    [DeploymentKey.AthusdToken]: ContractName.Asset,
    [DeploymentKey.OracleRouter]: ContractName.OracleRouter,
    [DeploymentKey.AssetRegistry]: ContractName.AssetRegistry,
    [DeploymentKey.DebtSystem]: ContractName.DebtSystem,
    [DeploymentKey.BuildBurnSystem]: ContractName.BuildBurnSystem,
    [DeploymentKey.CollateralSystem]: ContractName.CollateralSystem,
    [DeploymentKey.RewardSystem]: ContractName.RewardSystem,
    [DeploymentKey.Liquidation]: ContractName.Liquidation,
    [DeploymentKey.ExchangeSystem]: ContractName.ExchangeSystem,
    [DeploymentKey.PerpPositionToken]: ContractName.PerpPositionToken,
    [DeploymentKey.PerpExchange]: ContractName.PerpExchange,
    [DeploymentKey.UniswapCheckpoints]: ContractName.UniswapCheckpoints,
    [DeploymentKey.UniswapCheckpointer]: ContractName.UniswapCheckpointer,
    [DeploymentKey.AthbtcToken]: ContractName.Asset,
    [DeploymentKey.AthbtcPerp]: ContractName.Perpetual,
    [DeploymentKey.AthethToken]: ContractName.Asset,
    [DeploymentKey.AthethPerp]: ContractName.Perpetual,
    [DeploymentKey.AthglmrToken]: ContractName.Asset,
    [DeploymentKey.AthglmrPerp]: ContractName.Perpetual,
    [DeploymentKey.AthatomToken]: ContractName.Asset,
    [DeploymentKey.AthbnbToken]: ContractName.Asset,
    [DeploymentKey.AthdotToken]: ContractName.Asset,
    [DeploymentKey.AthlinkToken]: ContractName.Asset,
    [DeploymentKey.AthTwapOracle]: ContractName.UniswapTwapOracle,
  };
