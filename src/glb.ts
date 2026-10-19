import { GLBError } from './errors'
import type { GLBChunk, GLTFContainer, GLTFJson } from './types'

const GLB_MAGIC = 0x46546c67 // "glTF"
const CHUNK_JSON = 0x4e4f534a // "JSON"
const CHUNK_BIN = 0x004e4942 // "BIN\0"

const HEADER_BYTES = 12
const CHUNK_HEADER_BYTES = 8

/**
 * Parse a binary glTF container.
 *
 * Accepts an `ArrayBuffer`, any typed array or `DataView`; the input is never
 * copied, so the returned `bin` chunk is a view into the same memory.
 *
 * ```ts
 * const file = parseGLB(await blob.arrayBuffer())
 * file.json.meshes?.length // 12
 * ```
 *
 * @throws {GLBError} when the file is empty, not a GLB, a different container
 * version, truncated, or carries malformed JSON.
 */
export function parseGLB(input: ArrayBuffer | ArrayBufferView): GLTFContainer {
  const bytes = toBytes(input)

  if (bytes.byteLength === 0) {
    throw new GLBError('EMPTY', 'Input is empty: a GLB file needs at least a 12-byte header.')
  }
  if (bytes.byteLength < HEADER_BYTES) {
    throw new GLBError(
      'TRUNCATED',
      `File is ${bytes.byteLength} bytes, but a GLB header needs ${HEADER_BYTES}.`,
    )
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const magic = view.getUint32(0, true)
  if (magic !== GLB_MAGIC) {
    throw new GLBError(
      'NOT_GLB',
      'Missing "glTF" magic bytes. A .gltf file is JSON, a .glb file is binary — this looks like neither.',
    )
  }

  const version = view.getUint32(4, true)
  if (version !== 2) {
    throw new GLBError(
      'UNSUPPORTED_VERSION',
      `GLB container version ${version} is not supported; only version 2 exists in practice.`,
    )
  }

  const declaredLength = view.getUint32(8, true)
  if (declaredLength > bytes.byteLength) {
    throw new GLBError(
      'TRUNCATED',
      `Header declares ${declaredLength} bytes, but only ${bytes.byteLength} were read. The download may be incomplete.`,
    )
  }
  if (declaredLength < HEADER_BYTES) {
    throw new GLBError('CORRUPT_CHUNK', `Header declares an impossible length of ${declaredLength} bytes.`)
  }

  const chunks: GLBChunk[] = []
  let json: GLTFJson | null = null
  let bin: Uint8Array | null = null
  let offset = HEADER_BYTES

  while (offset < declaredLength) {
    if (offset + CHUNK_HEADER_BYTES > declaredLength) {
      throw new GLBError('TRUNCATED', `Chunk header at byte ${offset} runs past the end of the file.`)
    }

    const chunkLength = view.getUint32(offset, true)
    const chunkType = view.getUint32(offset + 4, true)
    const dataStart = offset + CHUNK_HEADER_BYTES
    const dataEnd = dataStart + chunkLength

    if (dataEnd > declaredLength) {
      throw new GLBError(
        'TRUNCATED',
        `Chunk at byte ${offset} claims ${chunkLength} bytes, but only ${declaredLength - dataStart} remain.`,
      )
    }
    if (chunks.length === 0 && chunkType !== CHUNK_JSON) {
      throw new GLBError('CORRUPT_CHUNK', 'The first chunk of a GLB file must be the JSON chunk.')
    }

    if (chunkType === CHUNK_JSON) {
      if (json) throw new GLBError('CORRUPT_CHUNK', 'Found more than one JSON chunk.')
      json = parseJson(bytes.subarray(dataStart, dataEnd))
      chunks.push({ type: 'JSON', byteLength: chunkLength, offset: dataStart })
    } else if (chunkType === CHUNK_BIN) {
      if (bin) throw new GLBError('CORRUPT_CHUNK', 'Found more than one BIN chunk.')
      bin = bytes.subarray(dataStart, dataEnd)
      chunks.push({ type: 'BIN', byteLength: chunkLength, offset: dataStart })
    } else {
      chunks.push({ type: 'UNKNOWN', byteLength: chunkLength, offset: dataStart })
    }

    offset = dataEnd
  }

  if (!json) {
    throw new GLBError('CORRUPT_CHUNK', 'The file has no JSON chunk, so there is no scene to read.')
  }

  return { json, bin, version, byteLength: declaredLength, chunks }
}

function toBytes(input: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (input instanceof Uint8Array) return input
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  }
  return new Uint8Array(input)
}

function parseJson(bytes: Uint8Array): GLTFJson {
  let value: unknown

  try {
    value = JSON.parse(new TextDecoder().decode(bytes))
  } catch (error) {
    throw new GLBError(
      'INVALID_JSON',
      `The JSON chunk is not valid JSON: ${(error as Error).message}`,
      { cause: error },
    )
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new GLBError('INVALID_JSON', 'The JSON chunk must contain an object at the top level.')
  }

  return value as GLTFJson
}
