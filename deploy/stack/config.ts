export interface Config {
  airdrops: AirdropConfig[];
}

export interface AirdropConfig {
  startTime: string;
  deadline: string;
  firstUnlockTime: string;
  unlockCount: number;
  unlockIntervalSeconds: number;
}
