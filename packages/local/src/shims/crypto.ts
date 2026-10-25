import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";

/** Only the sha256 hex digest the api uses; synchronous, which WebCrypto's `subtle.digest` is not. */
export function createHash(algorithm: string) {
  if (algorithm !== "sha256") throw new Error(`createHash(${algorithm}) is not supported in the browser build`);
  const h = sha256.create();
  const api = {
    update(data: string | Uint8Array) {
      h.update(typeof data === "string" ? new TextEncoder().encode(data) : data);
      return api;
    },
    digest(_enc: "hex") {
      return bytesToHex(h.digest());
    },
  };
  return api;
}

export const randomUUID = () => crypto.randomUUID();
