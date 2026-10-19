/**
 * Reading image dimensions straight from the file header.
 *
 * The analyzer never decodes pixels: for a 4K texture that would mean hundreds
 * of megabytes and a lot of time just to learn two numbers. Every format below
 * stores its size in a fixed, cheap-to-read header.
 */

export interface ImageInfo {
  /** Best guess at the image MIME type, from the file signature. */
  mimeType: string
  width: number
  height: number
}

/**
 * Read `width`/`height` from a PNG, JPEG, WebP, AVIF or KTX2 header.
 *
 * @returns the size, or `null` for unknown or malformed data.
 */
export function readImageSize(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length >= 24 && isPng(bytes)) return readPng(bytes)
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return readJpeg(bytes)
  if (bytes.length >= 30 && isWebp(bytes)) return readWebp(bytes)
  if (bytes.length >= 32 && isKtx2(bytes)) return readKtx2(bytes)
  if (bytes.length >= 16 && isAvif(bytes)) return readAvif(bytes)
  return null
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const KTX2_SIGNATURE = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]

function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
}

function isKtx2(bytes: Uint8Array): boolean {
  return KTX2_SIGNATURE.every((byte, index) => bytes[index] === byte)
}

function isWebp(bytes: Uint8Array): boolean {
  return (
    ascii(bytes, 0, 4) === 'RIFF' &&
    ascii(bytes, 8, 4) === 'WEBP'
  )
}

function isAvif(bytes: Uint8Array): boolean {
  // ISO base media file format: size(4) + "ftyp" + brand
  return ascii(bytes, 4, 4) === 'ftyp' && ascii(bytes, 8, 4) === 'avif'
}

function readPng(bytes: Uint8Array): ImageInfo | null {
  const view = viewOf(bytes)
  return {
    mimeType: 'image/png',
    width: view.getUint32(16, false),
    height: view.getUint32(20, false),
  }
}

function readJpeg(bytes: Uint8Array): ImageInfo | null {
  const view = viewOf(bytes)
  let offset = 2

  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }

    let marker = bytes[offset + 1]
    // 0xFF bytes may be repeated as padding before the actual marker.
    while (marker === 0xff) {
      offset += 1
      marker = bytes[offset + 1]
    }
    offset += 2

    // Standalone markers carry no length field.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    // Start of scan: the entropy-coded data follows, no size headers after this.
    if (marker === 0xd9 || marker === 0xda) break

    const segmentLength = view.getUint16(offset, false)
    if (segmentLength < 2) return null

    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 && // DHT
      marker !== 0xc8 && // JPG
      marker !== 0xcc // DAC

    if (isStartOfFrame) {
      return {
        mimeType: 'image/jpeg',
        height: view.getUint16(offset + 3, false),
        width: view.getUint16(offset + 5, false),
      }
    }

    offset += segmentLength
  }

  return null
}

function readWebp(bytes: Uint8Array): ImageInfo | null {
  const view = viewOf(bytes)
  const kind = ascii(bytes, 12, 4)

  if (kind === 'VP8X') {
    return {
      mimeType: 'image/webp',
      width: 1 + view.getUint16(24, true) + (bytes[26] << 16),
      height: 1 + view.getUint16(27, true) + (bytes[29] << 16),
    }
  }

  if (kind === 'VP8 ') {
    // Lossy bitstream: 3-byte frame tag, 3-byte start code, then 14-bit sizes.
    return {
      mimeType: 'image/webp',
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    }
  }

  if (kind === 'VP8L' && bytes[20] === 0x2f) {
    const bits = view.getUint32(21, true)
    return {
      mimeType: 'image/webp',
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
    }
  }

  return null
}

function readKtx2(bytes: Uint8Array): ImageInfo | null {
  const view = viewOf(bytes)
  return {
    mimeType: 'image/ktx2',
    width: view.getUint32(20, true),
    height: view.getUint32(24, true),
  }
}

function readAvif(bytes: Uint8Array): ImageInfo | null {
  const view = viewOf(bytes)
  const ispe = findAscii(bytes, 'ispe')

  if (ispe === -1 || ispe + 16 > bytes.length) return null

  return {
    mimeType: 'image/avif',
    width: view.getUint32(ispe + 8, false),
    height: view.getUint32(ispe + 12, false),
  }
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = ''
  for (let index = 0; index < length; index += 1) {
    const code = bytes[offset + index]
    if (code === undefined) return ''
    out += String.fromCharCode(code)
  }
  return out
}

function findAscii(bytes: Uint8Array, needle: string): number {
  const first = needle.charCodeAt(0)
  for (let index = 0; index + needle.length <= bytes.length; index += 1) {
    if (bytes[index] !== first) continue
    if (ascii(bytes, index, needle.length) === needle) return index
  }
  return -1
}
