import type { Codec } from "./types";

/** No compression. The zero-dependency default. */
export const storeCodec: Codec = {
  id: 0,
  deflate: (b) => b,
  inflate: (b) => b,
};

function assertStreams(): void {
  if (typeof CompressionStream === "undefined" || typeof DecompressionStream === "undefined") {
    throw new Error(
      "HMML stream codec requires the platform CompressionStream API (Node 18+, modern browsers). " +
        "Pass a custom `codec` (e.g. backed by fflate) for older environments.",
    );
  }
}

async function pump(transform: CompressionStream | DecompressionStream, input: Uint8Array): Promise<Uint8Array> {
  // Pipe through the platform stream so writer/read failures have one owner.
  // A rejected write must never be left as an unhandled parallel promise.
  const body = new Blob([input as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

function streamCodec(id: number, format: "gzip" | "deflate" | "deflate-raw"): Codec {
  return {
    id,
    deflate: async (b) => {
      assertStreams();
      return pump(new CompressionStream(format as any), b);
    },
    inflate: async (b) => {
      assertStreams();
      return pump(new DecompressionStream(format as any), b);
    },
  };
}

/** Raw DEFLATE (RFC 1951), smallest framing. */
export const deflateRawCodec: Codec = /* @__PURE__ */ streamCodec(1, "deflate-raw");
/** gzip (RFC 1952). */
export const gzipCodec: Codec = /* @__PURE__ */ streamCodec(2, "gzip");
/** zlib/DEFLATE (RFC 1950). */
export const deflateCodec: Codec = /* @__PURE__ */ streamCodec(3, "deflate");

/** Resolve a built-in codec from a file-header id, for automatic decode. */
export function builtinCodec(id: number): Codec | undefined {
  switch (id) {
    case 0:
      return storeCodec;
    case 1:
      return deflateRawCodec;
    case 2:
      return gzipCodec;
    case 3:
      return deflateCodec;
    default:
      return undefined;
  }
}
