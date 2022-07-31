export enum ContractName {
  AthToken = "AthToken",
  AccessController = "AccessController",
  RewardLocker = "RewardLocker",
  AirdropDistributor = "AirdropDistributor",
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
  };
