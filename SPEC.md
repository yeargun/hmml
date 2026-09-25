# HMML Binary Format Specification — v2.0

HMML stores a complete HTML/CSS/SVG blueprint followed by arbitrary binary assets.
The blueprint MUST be the first chunk. Assets may include SVG, GIF, raster images,
video, audio, fonts, PDFs, or any other MIME-typed bytes. A reader can present the
blueprint before requesting any media. Browser support for a media codec is separate
from the container's ability to carry it.

This is a **breaking revision**. Version 1 files are not accepted. There is no
legacy parser or automatic version fallback.

All integers are little-endian. Strings are valid UTF-8. There is no base64 and no
mandatory compression library, DOM dependency, footer index, or whole-file allocation.

## 1. Framing

```
Header (12 bytes)
MARK                         required, exactly once, first
META                         optional, at most once
RSRC → DATA* → REND           zero or more resources, in delivery priority order
ENDF                         required, empty
```

META may also occur between resources. It cannot interrupt a resource. Resources
are contiguous and cannot interleave. Place critical CSS/SVG in MARK; order small
critical fonts/images before bulk audio/video. A large first resource delays later
resources, so priority order matters.

### Header

| Field | Bytes | Value |
| --- | ---: | --- |
| Signature | 9 | `89 48 4D 4D 4C 0D 0A 1A 0A` (`\x89HMML\r\n\x1a\n`) |
| Major | 1 | `2` |
| Minor | 1 | `0` |
| Codec | 1 | Codec used by compressed MARK/META chunks |

Readers implementing this revision reject other versions. The signature detects
several common text-mode transfer corruptions; it does not prevent terminal output.

### Chunk

| Field | Bytes | Meaning |
| --- | ---: | --- |
| Type | 4 | ASCII tag |
| Flags | 1 | Bit 0 = compressed; bit 1 = CRC present; other bits MUST be zero |
| Length | 4 | Payload byte length, excluding header and CRC |
| Payload | Length | Chunk-specific bytes |
| CRC32 | 4, optional | IEEE CRC32 of Type + Flags + Length + Payload |

Unknown types, flags, invalid order, duplicate MARK/META, and duplicate resource IDs
are errors. A decoder stops at ENDF, the logical end of this document. Trailing
transport bytes are not part of HMML and are not verified by the parser.

## 2. Blueprint and metadata

MARK is UTF-8 HTML/CSS/SVG. Resource URLs use `hmml:<id>` in attributes, CSS `url()`,
SVG references, etc. Exactly one MARK MUST occur immediately after the file header.
No media inventory or asset data needs to be read before delivering it.

META is one UTF-8 JSON object (not an array, scalar, or null). Both MARK and META can
be compressed using the header codec. A writer SHOULD keep the original payload if
compression does not make it smaller. The compression flag is per chunk: a nonzero
codec ID does not imply that any particular chunk is compressed.

MARK is delivered after its complete text payload and optional CRC are available.
This revision streams media, not partially parsed HTML tokens. Keep the blueprint
compact; put noncritical content in resources when appropriate.

## 3. Resources of arbitrary size

### RSRC: descriptor only

| Field | Bytes | Meaning |
| --- | ---: | --- |
| idLen | 2 | UTF-8 ID length |
| id | idLen | Nonempty `[A-Za-z0-9_.\-/]+`, unique in the document |
| mimeLen | 2 | UTF-8 MIME length |
| mime | mimeLen | Nonempty media type, e.g. `video/mp4` or `image/svg+xml` |
| byteLength | 8 | Total raw asset size; `0xffffffffffffffff` means unknown |

No resource data is included in RSRC. Its length is exactly `12 + idLen + mimeLen`.
The JavaScript implementation supports known sizes up to `Number.MAX_SAFE_INTEGER`
and rejects larger sizes rather than silently rounding them. The on-disk u64 field
has room for larger implementations.

### DATA: bounded raw bytes

Each DATA payload contains **1 to 1,048,576 bytes** of the current resource. Writers
normally use 65,536-byte payloads. The asset is the byte-for-byte concatenation of
its DATA payloads. Chunk boundaries need not match media frame boundaries.

DATA is never container-compressed. PNG/JPEG/WebP/AVIF, GIF, encoded audio/video,
and WOFF2 normally already have their own compression. SVG and other textual assets
benefit from HTTP compression of the whole response. Resource bytes stay unchanged.

A resource is not limited by the u32 chunk length. It can have any number of DATA
chunks, including zero for an empty asset. An unknown-length producer can start
writing immediately; no seek, length backpatch, or resource buffering is required.

### REND: resource completion

An empty REND is required after each resource. If RSRC declared a byteLength, the
sum of DATA lengths MUST match it. A reader MUST reject overflow, early REND, EOF
inside a resource, a new RSRC inside a resource, or ENDF before REND.

A DATA chunk with a CRC MUST pass verification before its bytes are delivered.
The asset remains incomplete until REND. Consumers writing durable files should
commit the asset only after resource completion; bytes already consumed cannot be
retracted after later transfer failure.

## 4. Completion and integrity

ENDF has an empty payload and MUST occur outside any resource. EOF before ENDF is
an error, even at a chunk boundary. A consumer can intentionally cancel at any point,
including immediately after MARK; cancellation is not successful full validation.

CRC32 uses reflected polynomial `0xEDB88320`, initial/final XOR `0xFFFFFFFF`, written
as u32 LE. It is optional per chunk. The reference encoder's `crc: true` puts it on
all chunks. It detects accidental corruption; it does not authenticate content.

The container overhead is 30 bytes for an empty blueprint and no assets. Each
resource adds `30 + idLen + mimeLen` bytes for RSRC/REND, plus 9 bytes per DATA chunk,
plus optional CRCs (4 bytes per chunk). At 64 KiB DATA size, data framing adds about
0.014% without CRC or 0.020% with CRC, excluding the small per-resource descriptor.

## 5. Compression and HTTP transport

| Codec | Meaning |
| ---: | --- |
| 0 | Store (MARK/META compression flag must be unset) |
| 1 | Raw DEFLATE |
| 2 | gzip |
| 3 | zlib-wrapped DEFLATE |
| 4–15 | Reserved |
| 16–255 | Application-defined; requires a matching custom codec |

Internal compression is optional and applies only to MARK/META. HTTP `Content-Encoding`
is an independent transport layer applied by a server/CDN. Browser fetch removes
HTTP gzip before exposing `response.body`; feed those bytes directly to HMML. Do not
apply a second HTTP decompressor in JavaScript. Internal gzip, if selected, remains
inside HMML and is inflated separately using native DecompressionStream.

CDN gzip reduces transfer bytes, not the size of an uncompressed origin object.
For stored files rich in markup, internal text compression can be worthwhile. For
CDN delivery, store mode avoids that extra decode stage. Measure both; compressed
media should not be converted to base64. HTTP gzip can recover much of base64's raw
expansion, so raw-size savings are not a prediction of wire-size savings.

Gzip streaming is subject to the CDN's buffering/flush policy. Chunk boundaries in
HMML do not force the CDN to flush. Verify time to the markup event through the
actual CDN. Logical offsets in HMML are not byte-range offsets in a gzipped HTTP
representation.

## 6. Reader contract and memory

The JavaScript streaming API emits header, markup, optional metadata, and for each
asset resource-start, resource-data events, resource-end, then a final end event.
It pulls only when the consumer asks for another event and never collects assets.
Resource buffers are owned and can be transferred to a worker/main thread.

Parser memory is bounded by one upstream input chunk, one DATA payload (at most
1 MiB) and its owned output copies, the markup/metadata limit, and resource IDs.
A source that hands over the entire file in a single chunk has already buffered that
file. A caller that collects every resource into Blobs also retains those resources.
Use bounded source chunks and an incremental sink for large media.

Default text limit is 16 MiB for both stored and expanded text, per chunk. Native
inflation aborts above the limit. Custom codecs must enforce their own allocation
limits internally; their returned output is checked. Resource count defaults to
100,000, adjustable. `maxResourceBytes` is an application quota; by default the
JavaScript implementation permits safe integer sizes. The format itself always
limits DATA payloads to 1 MiB.

The JavaScript convenience readers default to one reusable worker in browser windows
(`worker: "auto"`), with `true`/`false` overrides and explicit `createDecoder()`
ownership. Direct-only imports contain no worker machinery. Use a worker for
parsing, encoding, CRC work and file decompression. Keep DOM work
on the main thread. Use a pull/acknowledgment protocol so postMessage queues cannot
grow with the file. A worker improves responsiveness, not necessarily elapsed time.

Incremental delivery of video/audio bytes does not itself guarantee early playback.
Use MediaSource with a supported codec/container layout (for example appropriately
fragmented MP4), or an appropriate streaming sink. A Blob object URL normally needs
the completed asset. Seeking, resource interleaving, and random-access indexes are
outside v2.0; use separately addressable media when those are required.

## 7. Minimal example

`<b>hi</b>`, store mode, no resources or CRC:

```
89 48 4D 4D 4C 0D 0A 1A 0A  02 00 00   signature, version 2.0, store
4D 41 52 4B  00  09 00 00 00             MARK, flags, length
3C 62 3E 68 69 3C 2F 62 3E                <b>hi</b>
45 4E 44 46  00  00 00 00 00             ENDF
```
