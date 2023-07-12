import { BigNumber, Signer, providers, utils } from "ethers";
import { Provider, TransactionRequest } from "@ethersproject/abstract-provider";
import { Bytes } from "@ethersproject/bytes";
import { Deferrable } from "@ethersproject/properties";

import hid from "@ledgerhq/hw-transport-node-hid";
import Eth from "@ledgerhq/hw-app-eth";

export default class LedgerSigner extends Signer {
  ethPromise: Promise<Eth>;
  path: string;
  verbose: boolean;

  constructor(
    path: string,
    provider?: providers.Provider,
    verbose: boolean = false,
  ) {
    super();

    utils.defineReadOnly(this, "provider", provider || null);

    this.ethPromise = new Promise((resolve, reject) => {
      hid
        .create()
        .then((transport) => {
          resolve(new Eth(transport));
        })
        .catch((reason) => {
          reject(reason);
        });
    });
    this.path = path;
    this.verbose = verbose;
  }

  public async getAddress(): Promise<string> {
    const address = await this.retry((eth) => eth.getAddress(this.path));
    return address.address;
  }

  public async signMessage(message: Bytes | string): Promise<string> {
    if (typeof message === "string") {
      message = utils.toUtf8Bytes(message);
    }

    const messageHex = utils.hexlify(message).substring(2);

    if (this.verbose) {
      console.log("Please confirm message signature on Ledger");
    }

    const sig = await this.retry((eth) =>
      eth.signPersonalMessage(this.path, messageHex),
    );
    sig.r = "0x" + sig.r;
    sig.s = "0x" + sig.s;
    return utils.joinSignature(sig);
  }

  public async signTransaction(
    transaction: Deferrable<TransactionRequest>,
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

    const unsignedTx = utils.serializeTransaction(baseTx).substring(2);

    if (this.verbose) {
      console.log("Please confirm transaction on Ledger");
    }

    const sig = await this.retry((eth) =>
      eth.signTransaction(this.path, unsignedTx),
    );

    return utils.serializeTransaction(baseTx, {
      v: BigNumber.from("0x" + sig.v).toNumber(),
      r: "0x" + sig.r,
      s: "0x" + sig.s,
    });
  }

  public connect(provider: Provider): Signer {
    return new LedgerSigner(this.path, provider);
  }

  async retry<T>(run: (eth: Eth) => Promise<T>): Promise<T> {
    const eth = await this.ethPromise;

    while (true) {
      try {
        return await run(eth);
      } catch (ex) {
        if (this.verbose) {
          console.error(`Ledger error: ${ex}. Retrying in 500ms`);
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }
}
