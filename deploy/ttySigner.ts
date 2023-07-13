import * as fs from "fs";
import * as os from "os";
import * as readline from "readline";

import { BigNumber, Signer, providers, utils, Signature } from "ethers";
import { Provider, TransactionRequest } from "@ethersproject/abstract-provider";
import { Bytes } from "@ethersproject/bytes";
import { Deferrable } from "@ethersproject/properties";

export default class TtySigner extends Signer {
  outputFile: string | undefined;

  address?: string;

  constructor(outputFile: string | undefined, provider?: providers.Provider) {
    super();

    utils.defineReadOnly(this, "provider", provider || null);

    this.outputFile = outputFile;
  }

  public async getAddress(): Promise<string> {
    if (this.address) {
      return this.address;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const address: string = await new Promise((r) => {
      rl.question("Enter address: ", (answer) => {
        r(utils.getAddress(answer));
        rl.close();
      });
    });

    this.address = address;

    return address;
  }

  public async signMessage(message: Bytes | string): Promise<string> {
    if (typeof message === "string") {
      message = utils.toUtf8Bytes(message);
    }

    const messageHex = utils.hexlify(message);

    if (this.outputFile) {
      fs.writeFileSync(this.outputFile, messageHex + os.EOL);
      console.log(`Message saved to ${this.outputFile}`);
    } else {
      console.log("Message:");
      console.log(messageHex);
    }

    const sig = await this.requestSignature();
    return utils.joinSignature(sig);
  }

  public async signTransaction(
    transaction: Deferrable<TransactionRequest>
  ): Promise<string> {
    const tx = await utils.resolveProperties(transaction);
    const baseTx: utils.UnsignedTransaction = {
      to: tx.to,
      nonce: tx.nonce ? BigNumber.from(tx.nonce).toNumber() : undefined,
      gasLimit: tx.gasLimit,
      gasPrice: tx.gasPrice,
      data: tx.data,
      value: tx.value,
      chainId: tx.chainId,
      type: tx.type,
    };
    if (tx.type === 2) {
      baseTx.accessList = tx.accessList;
      baseTx.maxPriorityFeePerGas = tx.maxPriorityFeePerGas;
      baseTx.maxFeePerGas = tx.maxFeePerGas;
    }

    const rlpHex = utils.serializeTransaction(baseTx);

    if (this.outputFile) {
      fs.writeFileSync(this.outputFile, rlpHex + os.EOL);
      console.log(`RLP saved to ${this.outputFile}`);
    } else {
      console.log("RLP:");
      console.log(rlpHex);
    }

    const sig = await this.requestSignature();
    return utils.serializeTransaction(baseTx, sig);
  }

  public connect(provider: Provider): Signer {
    return new TtySigner(this.outputFile, provider);
  }

  public async estimateGas(
    transaction: Deferrable<TransactionRequest>
  ): Promise<BigNumber> {
    return BigNumber.from(8_000_000);
  }

  async requestSignature(): Promise<Signature> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const signatureHex: string = await new Promise((r) => {
      rl.question("Enter signature: ", (answer) => {
        r(answer);
        rl.close();
      });
    });

    return utils.splitSignature(signatureHex);
  }
}
