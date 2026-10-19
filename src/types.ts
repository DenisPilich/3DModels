/**
 * Public data model of a parsed glTF binary container.
 *
 * These are structural subsets of the glTF 2.0 specification: every field the
 * analyzer reads is typed, the rest of the document stays accessible through
 * the index signature on {@link GLTFJson}.
 */

/** One chunk of a GLB file, as laid out in the binary container. */
export interface GLBChunk {
  type: 'JSON' | 'BIN' | 'UNKNOWN'
  /** Payload length in bytes, excluding the 8-byte chunk header. */
  byteLength: number
  /** Offset of the payload from the start of the file. */
  offset: number
}

/** A validated, parsed GLB file. */
export interface GLTFContainer {
  /** Parsed glTF JSON document. */
  json: GLTFJson
  /** The BIN chunk, or `null` when the container has no binary payload. */
  bin: Uint8Array | null
  /** GLB container version. Only version 2 is supported. */
  version: number
  /** Size of the container in bytes. */
  byteLength: number
  /** Chunks in file order. */
  chunks: GLBChunk[]
}

export interface GLTFAsset {
  version?: string
  minVersion?: string
  generator?: string
  copyright?: string
}

export interface GLTFBuffer {
  uri?: string
  byteLength: number
  name?: string
}

export interface GLTFBufferView {
  buffer: number
  byteOffset?: number
  byteLength: number
  byteStride?: number
  target?: number
  name?: string
}

export interface GLTFAccessor {
  bufferView?: number
  byteOffset?: number
  componentType: number
  normalized?: boolean
  count: number
  /** `SCALAR`, `VEC2`, `VEC3`, `VEC4`, `MAT2`, `MAT3` or `MAT4`. */
  type: string
  max?: number[]
  min?: number[]
  sparse?: { count: number }
  name?: string
}

export interface GLTFPrimitive {
  attributes: Record<string, number>
  indices?: number
  material?: number
  /** Primitive topology, defaults to 4 (`TRIANGLES`). */
  mode?: number
  targets?: Array<Record<string, number>>
  extensions?: Record<string, unknown>
}

export interface GLTFMesh {
  primitives: GLTFPrimitive[]
  name?: string
  weights?: number[]
}

export interface GLTFTextureInfo {
  index: number
  texCoord?: number
  extensions?: Record<string, unknown>
}

export interface GLTFPbrMetallicRoughness {
  baseColorFactor?: number[]
  baseColorTexture?: GLTFTextureInfo
  metallicFactor?: number
  roughnessFactor?: number
  metallicRoughnessTexture?: GLTFTextureInfo
}

export interface GLTFMaterial {
  name?: string
  pbrMetallicRoughness?: GLTFPbrMetallicRoughness
  normalTexture?: GLTFTextureInfo
  occlusionTexture?: GLTFTextureInfo
  emissiveTexture?: GLTFTextureInfo
  emissiveFactor?: number[]
  alphaMode?: string
  doubleSided?: boolean
  extensions?: Record<string, unknown>
}

export interface GLTFTexture {
  sampler?: number
  source?: number
  name?: string
  extensions?: Record<string, unknown>
}

export interface GLTFImage {
  uri?: string
  mimeType?: string
  bufferView?: number
  name?: string
}

export interface GLTFNode {
  mesh?: number
  children?: number[]
  name?: string
  skin?: number
  camera?: number
  matrix?: number[]
  translation?: number[]
  rotation?: number[]
  scale?: number[]
}

export interface GLTFScene {
  nodes?: number[]
  name?: string
}

export interface GLTFAnimation {
  channels: Array<{ sampler: number; target: { node?: number; path: string } }>
  samplers: Array<{ input: number; output: number; interpolation?: string }>
  name?: string
}

export interface GLTFSkin {
  joints: number[]
  inverseBindMatrices?: number
  skeleton?: number
}

export interface GLTFCamera {
  type: string
  name?: string
}

/** A glTF 2.0 JSON document. Unknown top-level keys are preserved. */
export interface GLTFJson {
  asset?: GLTFAsset
  scene?: number
  scenes?: GLTFScene[]
  nodes?: GLTFNode[]
  meshes?: GLTFMesh[]
  accessors?: GLTFAccessor[]
  bufferViews?: GLTFBufferView[]
  buffers?: GLTFBuffer[]
  materials?: GLTFMaterial[]
  textures?: GLTFTexture[]
  images?: GLTFImage[]
  samplers?: unknown[]
  animations?: GLTFAnimation[]
  skins?: GLTFSkin[]
  cameras?: GLTFCamera[]
  extensionsUsed?: string[]
  extensionsRequired?: string[]
  [key: string]: unknown
}
