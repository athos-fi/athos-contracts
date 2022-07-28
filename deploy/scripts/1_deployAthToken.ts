import { ethers, upgrades } from "hardhat";

import { StackManager } from "../stack";
import { DeploymentKey } from "../stack/contracts";
import { selectSigner } from "../utils";

const runScript = async () => {
  const stackManager = new StackManager();
  const deployer = await selectSigner();

  const AthToken = await ethers.getContractFactory("AthToken", deployer);

  const athToken = await upgrades.deployProxy(
    AthToken,
    [
      await deployer.getAddress(), // genesis_holder
    ],
    {
      initializer: "__AthToken_init",
    }
  );
  stackManager.setDeployment(DeploymentKey.AthToken, athToken.address);
};

runScript()
  .then(() => process.exit(0))
  .catch((ex) => {
    console.error(ex);
    process.exit(1);
  });
