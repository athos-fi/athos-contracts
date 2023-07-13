import { DateTime } from "luxon";
import { ethers, upgrades } from "hardhat";

import { StackManager } from "../stack";
import { DeploymentKey } from "../stack/contracts";
import { selectSigner } from "../utils";

import {
  AccessController,
  AirdropDistributor,
  RewardLocker,
} from "../../typechain";

const { formatBytes32String } = ethers.utils;

const runScript = async () => {
  const stackManager = new StackManager();
  const deployer = await selectSigner();

  const AccessController = await ethers.getContractFactory(
    "AccessController",
    deployer,
  );
  const AirdropDistributor = await ethers.getContractFactory(
    "AirdropDistributor",
    deployer,
  );
  const RewardLocker = await ethers.getContractFactory(
    "RewardLocker",
    deployer,
  );

  const athToken = stackManager.getDeploymentChecked(DeploymentKey.AthToken);

  const accessController = (await upgrades.deployProxy(AccessController, [], {
    initializer: "__AccessController_init",
  })) as AccessController;
  stackManager.setDeployment(
    DeploymentKey.AccessController,
    accessController.address,
  );

  const rewardLocker = (await upgrades.deployProxy(
    RewardLocker,
    [
      athToken.address, // _linaTokenAddr
      accessController.address, // _accessCtrl
    ],
    {
      initializer: "__RewardLocker_init",
    },
  )) as RewardLocker;
  stackManager.setDeployment(DeploymentKey.RewardLocker, rewardLocker.address);

  for (let indAirdrop = 0; indAirdrop < 5; indAirdrop++) {
    const airdropDistributor = (await upgrades.deployProxy(
      AirdropDistributor,
      [
        DateTime.fromISO(
          stackManager.config.airdrops[indAirdrop].startTime,
        ).toSeconds(), // _startTime
        DateTime.fromISO(
          stackManager.config.airdrops[indAirdrop].deadline,
        ).toSeconds(), // _deadline
        0, // _unlockedPercentage
        DateTime.fromISO(
          stackManager.config.airdrops[indAirdrop].firstUnlockTime,
        ).toSeconds(), // _firstUnlockTime
        stackManager.config.airdrops[indAirdrop].unlockIntervalSeconds, // _unlockInterval
        stackManager.config.airdrops[indAirdrop].unlockCount, // _unlockCount
        rewardLocker.address, // _rewardLocker
        athToken.address, // _token
      ],
      {
        initializer: "__AirdropDistributor_init",
      },
    )) as AirdropDistributor;
    stackManager.setDeployment(
      `AirdropDistributor${indAirdrop + 1}` as DeploymentKey,
      airdropDistributor.address,
    );

    await accessController
      .connect(deployer)
      .grantRole(
        formatBytes32String("LOCK_REWARD"),
        airdropDistributor.address,
      );
  }
};

runScript()
  .then(() => process.exit(0))
  .catch((ex) => {
    console.error(ex);
    process.exit(1);
  });
