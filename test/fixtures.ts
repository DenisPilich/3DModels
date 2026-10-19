/** Helpers that build GLB files in memory, so tests need no binary fixtures. */

const GLB_MAGIC = 0x46546c67
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942

export function buildGLB(json: unknown, bin: Uint8Array = new Uint8Array()): ArrayBuffer {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json))
  const jsonPadding = (4 - (jsonBytes.length % 4)) % 4
  const jsonLength = jsonBytes.length + jsonPadding

  const hasBin = bin.length > 0
  const binPadding = (4 - (bin.length % 4)) % 4
  const binLength = bin.length + binPadding

  const total = 12 + 8 + jsonLength + (hasBin ? 8 + binLength : 0)
  const buffer = new ArrayBuffer(total)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  view.setUint32(0, GLB_MAGIC, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)

  view.setUint32(12, jsonLength, true)
  view.setUint32(16, CHUNK_JSON, true)
  bytes.set(jsonBytes, 20)
  bytes.fill(0x20, 20 + jsonBytes.length, 20 + jsonLength)

  if (hasBin) {
    const offset = 20 + jsonLength
    view.setUint32(offset, binLength, true)
    view.setUint32(offset + 4, CHUNK_BIN, true)
    bytes.set(bin, offset + 8)
  }

  return buffer
}

/** A PNG header that claims the given size. Bytes after the header are absent. */
export function fakePng(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(40)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  // chunk length + "IHDR"
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8)
  new DataView(bytes.buffer).setUint32(16, width, false)
  new DataView(bytes.buffer).setUint32(20, height, false)
  bytes[24] = 8 // bit depth
  bytes[25] = 6 // colour type: RGBA
  return bytes
}

export function fakeJpeg(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08], 0)
  new DataView(bytes.buffer).setUint16(7, height, false)
  new DataView(bytes.buffer).setUint16(9, width, false)
  return bytes
}

export function fakeWebp(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32)
  bytes.set(new TextEncoder().encode('RIFF'), 0)
  bytes.set(new TextEncoder().encode('WEBP'), 8)
  bytes.set(new TextEncoder().encode('VP8X'), 12)
  const widthMinusOne = width - 1
  const heightMinusOne = height - 1
  bytes[24] = widthMinusOne & 0xff
  bytes[25] = (widthMinusOne >> 8) & 0xff
  bytes[26] = (widthMinusOne >> 16) & 0xff
  bytes[27] = heightMinusOne & 0xff
  bytes[28] = (heightMinusOne >> 8) & 0xff
  bytes[29] = (heightMinusOne >> 16) & 0xff
  return bytes
}

export interface CubeOptions {
  /** Edge length of the PNG the cube's material points at. */
  imageSize?: number
  /** Omit the index buffer to exercise the "unindexed" warning. */
  indexed?: boolean
  /** Emit a 32-bit index buffer. */
  wideIndices?: boolean
  /** Skip texture wiring, leaving materials and images unused. */
  textured?: boolean
  /** Number of identical cubes to declare (exercises duplicate detection). */
  copies?: number
}

export interface CubeFixture {
  buffer: ArrayBuffer
  json: Record<string, unknown>
}

/** A minimal indexed cube: 24 vertices, 36 indices, one PNG-backed material. */
export function cubeGLB(options: CubeOptions = {}): CubeFixture {
  const { imageSize = 512, indexed = true, wideIndices = false, textured = true, copies = 1 } = options

  const vertexCount = 24
  const indexCount = 36
  const positionBytes = vertexCount * 3 * 4
  const normalBytes = vertexCount * 3 * 4
  const uvBytes = vertexCount * 2 * 4
  const indexBytes = indexed ? indexCount * (wideIndices ? 4 : 2) : 0
  const image = fakePng(imageSize, imageSize)

  const views: Array<Record<string, unknown>> = [
    { buffer: 0, byteOffset: 0, byteLength: positionBytes, target: 34962 },
    { buffer: 0, byteOffset: positionBytes, byteLength: normalBytes, target: 34962 },
    { buffer: 0, byteOffset: positionBytes + normalBytes, byteLength: uvBytes, target: 34962 },
  ]

  if (indexed) {
    views.push({
      buffer: 0,
      byteOffset: positionBytes + normalBytes + uvBytes,
      byteLength: indexBytes,
      target: 34963,
    })
  }

  const imageOffset = positionBytes + normalBytes + uvBytes + indexBytes
  views.push({ buffer: 0, byteOffset: imageOffset, byteLength: image.length })

  const accessors: Array<Record<string, unknown>> = [
    { bufferView: 0, componentType: 5126, count: vertexCount, type: 'VEC3', min: [-1, -1, -1], max: [1, 1, 1] },
    { bufferView: 1, componentType: 5126, count: vertexCount, type: 'VEC3' },
    { bufferView: 2, componentType: 5126, count: vertexCount, type: 'VEC2' },
  ]

  if (indexed) {
    accessors.push({ bufferView: 3, componentType: wideIndices ? 5125 : 5123, count: indexCount, type: 'SCALAR' })
  }

  const primitives = Array.from({ length: copies }, () => ({
    attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
    ...(indexed ? { indices: 3 } : {}),
    material: 0,
  }))

  const bin = new Uint8Array(imageOffset + image.length)
  bin.set(image, imageOffset)

  const json: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'glb-doctor test fixtures' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ name: 'Cube', primitives }],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: bin.length }],
    materials: [
      {
        name: 'Cube',
        pbrMetallicRoughness: {
          baseColorFactor: [0.8, 0.8, 0.8, 1],
          ...(textured ? { baseColorTexture: { index: 0 } } : {}),
        },
      },
    ],
    textures: [{ source: 0 }],
    images: [{ bufferView: indexed ? 4 : 3, mimeType: 'image/png' }],
  }

  return { buffer: buildGLB(json, bin), json }
}
