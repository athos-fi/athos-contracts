export interface Config {
  foundationFeeHolder: string;
  insurnaceFundHolder: string;
  rewardSigner: string;
  rewardSigners: string[];
  twapUpdater: string;
  firstRewardPeriodStartTime: string;
  uniswapFactory: string;
  weth: string;
  usdc: string;
  chainlinkAggregators: { string: string };
  airdrops: AirdropConfig[];
}

export interface AirdropConfig {
  startTime: string;
  deadline: string;
  firstUnlockTime: string;
  unlockCount: number;
  unlockIntervalSeconds: number;
}
