import nacl from "tweetnacl";

function normalizeAlgorithmName(algorithm: AlgorithmIdentifier): string {
  if (typeof algorithm === "string") return algorithm.toUpperCase();
  return algorithm.name.toUpperCase();
}

async function digest(
  algorithm: AlgorithmIdentifier,
  data: BufferSource,
): Promise<ArrayBuffer> {
  const name = normalizeAlgorithmName(algorithm);
  if (name !== "SHA-512") {
    throw new Error(
      `${name} is not supported by the lightweight WebCrypto polyfill`,
    );
  }

  const bytes =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const hash = nacl.hash(bytes);
  const result = new Uint8Array(hash.byteLength);
  result.set(hash);
  return result.buffer;
}

export function ensureWebCryptoSubtle(): void {
  if (typeof window === "undefined") return;

  const crypto = window.crypto;
  if (!crypto || crypto.subtle) return;

  Object.defineProperty(crypto, "subtle", {
    configurable: true,
    value: { digest },
  });
}
