import { ethers, upgrades } from "hardhat";

import { StackManager } from "../stack";
import { DeploymentKey } from "../stack/contracts";
import { selectSigner } from "../utils";

const runScript = async () => {
  const stackManager = new StackManager();
  const deployer = await selectSigner();

  const RewardSystem = await ethers.getContractFactory(
    "RewardSystem",
    deployer
  );

  await upgrades.upgradeProxy(
    stackManager.getDeploymentChecked(DeploymentKey.RewardSystem).address,
    RewardSystem,
    {
      // Manually checked and it's safe
      unsafeSkipStorageCheck: true,
    }
  );

  const rewardSystem = RewardSystem.attach(
    stackManager.getDeploymentChecked(DeploymentKey.RewardSystem).address
  );
  await rewardSystem
    .connect(deployer)
    .setRewardSigners(stackManager.config.rewardSigners);
};

runScript()
  .then(() => process.exit(0))
  .catch((ex) => {
    console.error(ex);
    process.exit(1);
  });
