export enum ContractName {
  AthToken = "AthToken",
}

export enum DeploymentKey {
  AthToken = "AthToken",
}

export interface Deployment {
  contract: ContractName;
  address: string;
}

export interface Contracts {
  [DeploymentKey.AthToken]: Deployment | null;
}

export const contractNamesByDeploymentKey: Record<DeploymentKey, ContractName> =
  {
    [DeploymentKey.AthToken]: ContractName.AthToken,
  };
