# HMML Binary Format Specification - v1.0

**HMML** (HyperMedia Markup Language) is a binary container that stores HTML/CSS/SVG
markup together with the binary resources it references (images, fonts). Markup is
kept as text and may be compressed; resources are stored as **raw bytes** (no base64)
and referenced from the markup via the `hmml:<id>` URI scheme.

Design goals: smaller than a self-contained HTML file (no base64 inflation), full
layout freedom (the renderer is a browser), streamable, and forward-compatible.

All multi-byte integers are **little-endian**. Strings are **UTF-8**.

---

## 1. File layout

```
┌───────────────────────────────────────────────┐
│ Header                                          │
│   Signature   9 bytes                           │
│   Major       u8                                │
│   Minor       u8                                │
│   Codec       u8                                │
├───────────────────────────────────────────────┤
│ Chunk[0]                                        │
│ Chunk[1]                                        │
│ ...                                             │
│ Chunk[n]  (ENDF, conventionally last)           │
└───────────────────────────────────────────────┘
```

### 1.1 Header

| Field     | Size | Value                                                      |
| --------- | ---- | ---------------------------------------------------------- |
| Signature | 9    | `89 48 4D 4D 4C 0D 0A 1A 0A` (`\x89HMML\r\n\x1a\n`)        |
| Major     | 1    | Major version. This document describes major `1`.          |
| Minor     | 1    | Minor version. `0` here. Minor bumps are backward-readable. |
| Codec     | 1    | Compression codec id used by compressed chunks (see §3).   |

The signature follows PNG's design: the high bit in `0x89` detects 7-bit transfer
corruption; `HMML` is human-readable; `\r\n\x1a\n` catches newline translation and
stops `cat` from dumping the body to a terminal.

---

## 2. Chunks

Every chunk has the same framing:

| Field   | Size | Notes                                                          |
| ------- | ---- | -------------------------------------------------------------- |
| Type    | 4    | Four ASCII bytes identifying the chunk kind.                   |
| Flags   | 1    | Bit field (see below).                                         |
| Length  | 4    | `u32` - byte length of **Payload** (excludes Type/Flags/Length and CRC). |
| Payload | N    | `Length` bytes.                                                |
| CRC32   | 4    | `u32` - present **iff** `FLAG_HAS_CRC` is set. See §4.         |

**Flags**

| Bit  | Name             | Meaning                                              |
| ---- | ---------------- | --------------------------------------------------- |
| 0    | `FLAG_COMPRESSED`| Payload was produced by the file's codec (§3).      |
| 1    | `FLAG_HAS_CRC`   | A 4-byte CRC32 trails the payload.                  |
| 2-7  | reserved         | Must be 0 in v1.                                     |

A decoder **must skip** chunks whose Type it does not recognise (it has the Length,
so it knows how far to advance). This is the forward-compatibility mechanism.

### 2.1 `MARK` - markup

The HTML/CSS/SVG document, UTF-8 encoded. If `FLAG_COMPRESSED` is set, the payload is
the codec output; otherwise it is raw UTF-8. Exactly **one** `MARK` chunk per file.

Resource references inside the markup use the scheme `hmml:<id>`, valid anywhere a URL
is expected - `src`, `srcset`, CSS `url()`, SVG `<image href>`, etc.

### 2.2 `RSRC` - resource

One referenced resource. Stored **uncompressed** (image formats are already
compressed). Payload:

| Field    | Size      | Notes                          |
| -------- | --------- | ------------------------------ |
| idLen    | u16       | Byte length of `id`.           |
| id       | idLen     | UTF-8 resource id (e.g. `r0`). |
| mimeLen  | u16       | Byte length of `mime`.         |
| mime     | mimeLen   | UTF-8 MIME (e.g. `image/webp`).|
| data     | remainder | Raw resource bytes.            |

`data` runs to the end of the payload (its length = `Length − 4 − idLen − mimeLen`).
There may be any number of `RSRC` chunks; ids should be unique.

### 2.3 `META` - metadata (optional)

A single JSON object, UTF-8 encoded, optionally compressed (`FLAG_COMPRESSED`). Used
for title, author, timestamps, app-specific fields, etc. At most one per file.

### 2.4 `ENDF` - end of document

Zero-length payload. Marks the logical end; a decoder stops here. Optional but
recommended (lets a reader detect truncation vs. a clean end).

---

## 3. Compression codecs

The header `Codec` byte names the algorithm used for any `FLAG_COMPRESSED` payload in
the file. One codec per file. Reserved ids:

| Id   | Algorithm                  |
| ---- | -------------------------- |
| 0    | store (no compression)     |
| 1    | DEFLATE raw (RFC 1951)     |
| 2    | gzip (RFC 1952)            |
| 3    | zlib / DEFLATE (RFC 1950)  |
| 4-15 | reserved for future built-ins |
| ≥16  | application-defined        |

A decoder may auto-resolve ids 0-3 from the platform. For custom ids the caller must
supply a matching codec. `RSRC` payloads are never compressed regardless of codec.

---

## 4. CRC32

When `FLAG_HAS_CRC` is set, the trailing `u32` is the IEEE CRC32 (polynomial
`0xEDB88320`, reflected, init/final `0xFFFFFFFF`) computed over the chunk's
**Type + Flags + Length + Payload** bytes - i.e. everything in the chunk except the
CRC field itself. CRC is opt-in per file (set on all chunks or none).

---

## 5. Reference resolution

`hmml:<id>` references are resolved by the reader, not the format. Typical modes:

- **data URI** - replace with `data:<mime>;base64,<…>`. Self-contained; good for
  export, email, SSR.
- **object URL** - replace with `URL.createObjectURL(Blob)`. Cheaper to render in a
  browser; remember to revoke.
- **keep** - leave `hmml:` refs and resolve them yourself (e.g. a service worker that
  serves resource bytes), avoiding any inlining.

---

## 6. Worked example (hex)

A minimal file: markup `<b>hi</b>`, no resources, store codec, no CRC.

```
89 48 4D 4D 4C 0D 0A 1A 0A   signature
01                            major = 1
00                            minor = 0
00                            codec = store
4D 41 52 4B                   "MARK"
00                            flags = 0
09 00 00 00                   length = 9
3C 62 3E 68 69 3C 2F 62 3E    "<b>hi</b>"
45 4E 44 46                   "ENDF"
00                            flags = 0
00 00 00 00                   length = 0
```
