import { readImageSize } from './image'
import type {
  GLTFAccessor,
  GLTFContainer,
  GLTFImage,
  GLTFJson,
  GLTFMaterial,
  GLTFMesh,
  GLTFPrimitive,
  GLTFTexture,
  GLTFTextureInfo,
} from './types'

/** How much a finding should worry the user. */
export type WarningSeverity = 'info' | 'warning' | 'critical'

/** Stable identifier for a finding, useful for filtering and for tests. */
export type WarningId =
  | 'empty-scene'
  | 'legacy-version'
  | 'no-normals'
  | 'unindexed'
  | 'no-uvs'
  | 'wide-index'
  | 'uncompressed'
  | 'sparse-accessor'
  | 'oversized-texture'
  | 'non-power-of-two'
  | 'heavy-texture'
  | 'duplicate-mesh'
  | 'too-many-draw-calls'
  | 'large-file'
  | 'orphan-material'
  | 'orphan-texture'
  | 'orphan-image'

export interface AnalyzeOptions {
  /** Warn when a texture exceeds this size on either axis. @default 2048 */
  maxTextureSize?: number
  /** Warn above this number of draw calls (primitives). @default 100 */
  maxDrawCalls?: number
  /** Warn above this file size, in megabytes. @default 10 */
  maxFileSizeMB?: number
  /** Warn above this size for a single image, in megabytes. @default 2 */
  maxTextureMB?: number
}

export interface FileReport {
  /** Container size in bytes. */
  bytes: number
  glbVersion: number
  gltfVersion: string
  generator: string | null
  extensionsUsed: string[]
  chunks: Array<{ type: string; bytes: number }>
}

export interface SceneStats {
  nodes: number
  meshes: number
  /** Draw calls, roughly: one per primitive. */
  primitives: number
  uniquePrimitives: number
  triangles: number
  vertices: number
  materials: number
  textures: number
  images: number
  animations: number
  skins: number
  cameras: number
}

export interface TextureStat {
  index: number
  name: string | null
  mimeType: string
  width: number | null
  height: number | null
  /** Size of the encoded image inside the container, in bytes. */
  bytes: number
  /** How many material slots reference this texture. */
  uses: number
  /** `true` when the pixels are a relative URI rather than embedded data. */
  external: boolean
}

/** Where the bytes of the file actually go. */
export interface CostReport {
  geometry: number
  textures: number
  animation: number
  other: number
  total: number
}

export interface Warning {
  id: WarningId
  severity: WarningSeverity
  title: string
  detail: string
  /** How many items triggered this finding. */
  count: number
}

export interface Health {
  /** 0–100, where 100 is a clean file. */
  score: number
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
}

export interface Report {
  file: FileReport
  scene: SceneStats
  cost: CostReport
  textures: TextureStat[]
  warnings: Warning[]
  health: Health
}

const DEFAULTS: Required<AnalyzeOptions> = {
  maxTextureSize: 2048,
  maxDrawCalls: 100,
  maxFileSizeMB: 10,
  maxTextureMB: 2,
}

const COMPRESSION_EXTENSIONS = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression']
const MB = 1024 * 1024

/**
 * Inspect a parsed glTF file and explain what is in it and what is wrong.
 *
 * ```ts
 * const report = analyze(parseGLB(buffer))
 * report.health.score        // 82
 * report.warnings[0]?.title  // "2 textures are larger than 2048px"
 * ```
 *
 * Every check is heuristic: warnings describe likely problems, not spec
 * violations, and none of them make the file unloadable.
 */
export function analyze(container: GLTFContainer, options: AnalyzeOptions = {}): Report {
  const config = { ...DEFAULTS, ...options }
  const json = container.json

  const accessors = json.accessors ?? []
  const meshes = json.meshes ?? []
  const materials = json.materials ?? []
  const textures = json.textures ?? []
  const images = json.images ?? []
  const views = json.bufferViews ?? []
  const buffers = resolveBuffers(json, container.bin)

  const scene = collectScene(meshes, accessors, materials)
  const textureUses = countTextureUses(materials)
  const textureStats = collectTextures(textures, images, json, buffers, textureUses)

  const cost = collectCost(container, scene.accessorViews, new Set(
    images.map((image) => image.bufferView).filter((index): index is number => index !== undefined),
  ))

  const warnings: Warning[] = []
  const add = (warning: Warning): void => {
    warnings.push(warning)
  }

  if (scene.primitives === 0) {
    add({
      id: 'empty-scene',
      severity: 'critical',
      title: 'No geometry in the file',
      detail: 'There are no mesh primitives, so there is nothing to render.',
      count: 1,
    })
  }

  const gltfVersion = typeof json.asset?.version === 'string' ? json.asset.version : '0.0'
  if (gltfVersion !== '2.0') {
    add({
      id: 'legacy-version',
      severity: 'warning',
      title: `glTF version is ${gltfVersion}`,
      detail: 'Modern viewers assume glTF 2.0. Older assets often need re-exporting.',
      count: 1,
    })
  }

  if (scene.noNormals > 0) {
    add({
      id: 'no-normals',
      severity: 'warning',
      title: `${plural(scene.noNormals, 'primitive')} without normals`,
      detail:
        'Without a NORMAL attribute the renderer has to guess normals. Smooth shading and PBR materials will look flat or wrong.',
      count: scene.noNormals,
    })
  }

  if (scene.unindexed > 0) {
    add({
      id: 'unindexed',
      severity: 'warning',
      title: `${plural(scene.unindexed, 'primitive')} without an index buffer`,
      detail:
        'Unindexed triangles cannot share vertices, so the same corner is stored several times and the file grows for nothing.',
      count: scene.unindexed,
    })
  }

  if (scene.texturedWithoutUvs > 0) {
    add({
      id: 'no-uvs',
      severity: 'warning',
      title: `${plural(scene.texturedWithoutUvs, 'textured primitive')} without UVs`,
      detail:
        'A material reads a texture, but the geometry has no TEXCOORD_0 attribute, so the texture cannot be mapped onto it.',
      count: scene.texturedWithoutUvs,
    })
  }

  if (scene.wideIndices > 0) {
    add({
      id: 'wide-index',
      severity: 'info',
      title: `${plural(scene.wideIndices, 'primitive')} using 32-bit indices`,
      detail:
        'These meshes have fewer than 65,536 vertices, so 16-bit indices would be enough and would halve the index memory.',
      count: scene.wideIndices,
    })
  }

  const extensions = Array.isArray(json.extensionsUsed) ? json.extensionsUsed : []
  const compressed = COMPRESSION_EXTENSIONS.some((name) => extensions.includes(name))
  if (!compressed) {
    add({
      id: 'uncompressed',
      severity: 'info',
      title: 'Geometry is not compressed',
      detail:
        'Draco or meshopt can shrink vertex data by 50–90% on typical models. Usually applied at export time.',
      count: 1,
    })
  }

  const sparse = accessors.filter((accessor) => accessor.sparse !== undefined).length
  if (sparse > 0) {
    add({
      id: 'sparse-accessor',
      severity: 'info',
      title: `${plural(sparse, 'sparse accessor')}`,
      detail:
        'Sparse accessors are counted as full-size here, so the reported triangle and vertex totals (and the size breakdown) can be higher than reality.',
      count: sparse,
    })
  }

  const oversized = textureStats.filter(
    (texture) => Math.max(texture.width ?? 0, texture.height ?? 0) > config.maxTextureSize,
  )
  if (oversized.length > 0) {
    add({
      id: 'oversized-texture',
      severity: 'warning',
      title: `${plural(oversized.length, 'texture')} larger than ${config.maxTextureSize}px`,
      detail: `${listSizes(oversized)}. Most of that detail is invisible at typical viewing distance; 1024–2048px is usually enough.`,
      count: oversized.length,
    })
  }

  const npot = textureStats.filter(
    (texture) =>
      isFiniteSize(texture.width) && isFiniteSize(texture.height) &&
      (!isPowerOfTwo(texture.width) || !isPowerOfTwo(texture.height)),
  )
  if (npot.length > 0) {
    add({
      id: 'non-power-of-two',
      severity: 'info',
      title: `${plural(npot.length, 'texture')} with non-power-of-two sizes`,
      detail:
        'NPOT textures can limit mipmapping and wrapping on older WebGL 1 devices. Power-of-two sizes cost nothing to produce.',
      count: npot.length,
    })
  }

  const heavy = textureStats.filter((texture) => texture.bytes > config.maxTextureMB * MB)
  if (heavy.length > 0) {
    add({
      id: 'heavy-texture',
      severity: 'warning',
      title: `${plural(heavy.length, 'texture')} above ${config.maxTextureMB} MB`,
      detail: `${listBytes(heavy)} of image data. Re-encoding or downscaling these is usually the cheapest win in the file.`,
      count: heavy.length,
    })
  }

  if (scene.duplicates > 0) {
    add({
      id: 'duplicate-mesh',
      severity: 'warning',
      title: `${plural(scene.duplicates, 'duplicated primitive')}`,
      detail:
        'Several primitives carry identical vertex layouts and counts. If they are instanced copies, sharing one mesh with node transforms removes the duplicate data.',
      count: scene.duplicates,
    })
  }

  if (scene.primitives > config.maxDrawCalls) {
    add({
      id: 'too-many-draw-calls',
      severity: 'warning',
      title: `${scene.primitives} draw calls`,
      detail: `Above the ${config.maxDrawCalls} threshold, each frame pays for a separate GPU submission. Merge by material where possible.`,
      count: scene.primitives,
    })
  }

  if (container.byteLength > config.maxFileSizeMB * MB) {
    add({
      id: 'large-file',
      severity: 'warning',
      title: `File is ${formatBytes(container.byteLength)}`,
      detail: `Above the ${config.maxFileSizeMB} MB threshold, this is a slow first load on mobile connections.`,
      count: 1,
    })
  }

  const usedMaterials = scene.usedMaterials
  const orphanMaterials = materials
    .map((material, index) => ({ material, index }))
    .filter(({ index }) => !usedMaterials.has(index))
  if (orphanMaterials.length > 0) {
    add({
      id: 'orphan-material',
      severity: 'info',
      title: `${plural(orphanMaterials.length, 'unused material')}`,
      detail: 'These materials are defined but never assigned to a primitive. They still ship with the file.',
      count: orphanMaterials.length,
    })
  }

  const orphanTextures = textureStats.filter((texture) => texture.uses === 0)
  if (orphanTextures.length > 0) {
    add({
      id: 'orphan-texture',
      severity: 'info',
      title: `${plural(orphanTextures.length, 'unused texture')}`,
      detail: `${listBytes(orphanTextures)} of pixels that no material reads. Removing them is free.`,
      count: orphanTextures.length,
    })
  }

  const referencedImages = new Set(
    textures
      .map((texture) => texture.source)
      .filter((source): source is number => source !== undefined),
  )
  const orphanImages = images.filter((_image, index) => !referencedImages.has(index)).length
  if (orphanImages > 0) {
    add({
      id: 'orphan-image',
      severity: 'info',
      title: `${plural(orphanImages, 'unused image')}`,
      detail: 'Image payloads are stored in the file but no texture points at them.',
      count: orphanImages,
    })
  }

  const health = scoreWarnings(warnings)

  return {
    file: {
      bytes: container.byteLength,
      glbVersion: container.version,
      gltfVersion,
      generator: typeof json.asset?.generator === 'string' ? json.asset.generator : null,
      extensionsUsed: extensions,
      chunks: container.chunks.map((chunk) => ({ type: chunk.type, bytes: chunk.byteLength })),
    },
    scene: {
      nodes: json.nodes?.length ?? 0,
      meshes: meshes.length,
      primitives: scene.primitives,
      uniquePrimitives: scene.uniquePrimitives,
      triangles: scene.triangles,
      vertices: scene.vertices,
      materials: materials.length,
      textures: textures.length,
      images: images.length,
      animations: json.animations?.length ?? 0,
      skins: json.skins?.length ?? 0,
      cameras: json.cameras?.length ?? 0,
    },
    cost,
    textures: textureStats,
    warnings,
    health,
  }
}

interface SceneSummary {
  primitives: number
  uniquePrimitives: number
  duplicates: number
  triangles: number
  vertices: number
  unindexed: number
  noNormals: number
  texturedWithoutUvs: number
  wideIndices: number
  usedMaterials: Set<number>
  accessorViews: Set<number>
}

function collectScene(
  meshes: GLTFMesh[],
  accessors: GLTFAccessor[],
  materials: GLTFMaterial[],
): SceneSummary {
  const summary: SceneSummary = {
    primitives: 0,
    uniquePrimitives: 0,
    duplicates: 0,
    triangles: 0,
    vertices: 0,
    unindexed: 0,
    noNormals: 0,
    texturedWithoutUvs: 0,
    wideIndices: 0,
    usedMaterials: new Set(),
    accessorViews: new Set(),
  }

  const signatures = new Set<string>()

  for (const mesh of meshes) {
    for (const primitive of mesh.primitives ?? []) {
      summary.primitives += 1

      const position = accessors[primitive.attributes.POSITION]
      const indices = primitive.indices !== undefined ? accessors[primitive.indices] : undefined
      const vertexCount = position?.count ?? 0
      const elementCount = indices?.count ?? vertexCount
      const mode = primitive.mode ?? 4

      summary.vertices += vertexCount
      summary.triangles += triangleCount(mode, elementCount)

      if (indices === undefined) summary.unindexed += 1
      if (isTriangleMode(mode) && primitive.attributes.NORMAL === undefined) summary.noNormals += 1
      if (indices?.componentType === 5125 && vertexCount > 0 && vertexCount <= 0xffff) {
        summary.wideIndices += 1
      }

      const material = primitive.material !== undefined ? materials[primitive.material] : undefined
      if (material) {
        summary.usedMaterials.add(primitive.material as number)
        if (materialTextures(material).length > 0) {
          const hasUvs = Object.keys(primitive.attributes).some((name) => name.startsWith('TEXCOORD'))
          if (!hasUvs) summary.texturedWithoutUvs += 1
        }
      }

      for (const accessorIndex of primitiveAccessors(primitive)) {
        const view = accessors[accessorIndex]?.bufferView
        if (view !== undefined) summary.accessorViews.add(view)
      }

      const signature = primitiveSignature(primitive, accessors)
      if (signatures.has(signature)) {
        summary.duplicates += 1
      } else {
        signatures.add(signature)
        summary.uniquePrimitives += 1
      }
    }
  }

  return summary
}

function primitiveAccessors(primitive: GLTFPrimitive): number[] {
  const result = Object.values(primitive.attributes)
  if (primitive.indices !== undefined) result.push(primitive.indices)
  for (const target of primitive.targets ?? []) result.push(...Object.values(target))
  return result
}

function primitiveSignature(primitive: GLTFPrimitive, accessors: GLTFAccessor[]): string {
  const attributes = Object.keys(primitive.attributes)
    .sort()
    .map((name) => `${name}:${describeAccessor(accessors[primitive.attributes[name]])}`)
    .join(',')
  const indices =
    primitive.indices !== undefined
      ? `i${accessors[primitive.indices]?.componentType ?? 0}:${accessors[primitive.indices]?.count ?? 0}`
      : 'inone'
  return `${primitive.mode ?? 4}|${attributes}|${indices}`
}

function describeAccessor(accessor: GLTFAccessor | undefined): string {
  return accessor ? `${accessor.componentType}:${accessor.type}:${accessor.count}` : 'missing'
}

function triangleCount(mode: number, elementCount: number): number {
  if (mode === 4) return Math.floor(elementCount / 3)
  // TRIANGLE_STRIP and TRIANGLE_FAN both turn N vertices into N - 2 triangles.
  if (mode === 5 || mode === 6) return Math.max(0, elementCount - 2)
  return 0
}

function isTriangleMode(mode: number): boolean {
  return mode === 4 || mode === 5 || mode === 6
}

function materialTextures(material: GLTFMaterial): GLTFTextureInfo[] {
  const pbr = material.pbrMetallicRoughness
  return [
    pbr?.baseColorTexture,
    pbr?.metallicRoughnessTexture,
    material.normalTexture,
    material.occlusionTexture,
    material.emissiveTexture,
  ].filter((info): info is GLTFTextureInfo => info !== undefined)
}

function countTextureUses(materials: GLTFMaterial[]): Map<number, number> {
  const uses = new Map<number, number>()
  for (const material of materials) {
    for (const info of materialTextures(material)) {
      uses.set(info.index, (uses.get(info.index) ?? 0) + 1)
    }
  }
  return uses
}

function collectTextures(
  textures: GLTFTexture[],
  images: GLTFImage[],
  json: GLTFJson,
  buffers: Map<number, Uint8Array | null>,
  uses: Map<number, number>,
): TextureStat[] {
  return textures.map((texture, index) => {
    const image = texture.source !== undefined ? images[texture.source] : undefined

    if (!image) {
      return {
        index,
        name: texture.name ?? null,
        mimeType: 'application/octet-stream',
        width: null,
        height: null,
        bytes: 0,
        uses: uses.get(index) ?? 0,
        external: false,
      }
    }

    const payload = imagePayload(image, json, buffers)
    const info = payload.bytes ? readImageSize(payload.bytes) : null

    return {
      index,
      name: texture.name ?? image.name ?? null,
      mimeType: image.mimeType ?? info?.mimeType ?? 'application/octet-stream',
      width: info?.width ?? null,
      height: info?.height ?? null,
      bytes: payload.bytes?.byteLength ?? 0,
      uses: uses.get(index) ?? 0,
      external: payload.external,
    }
  })
}

interface ImagePayload {
  bytes: Uint8Array | null
  external: boolean
}

function imagePayload(
  image: GLTFImage,
  json: GLTFJson,
  buffers: Map<number, Uint8Array | null>,
): ImagePayload {
  if (image.bufferView !== undefined) {
    const bytes = readBufferView(json, buffers, image.bufferView)
    return { bytes, external: false }
  }

  if (typeof image.uri === 'string' && image.uri.startsWith('data:')) {
    return { bytes: decodeDataUri(image.uri), external: false }
  }

  return { bytes: null, external: typeof image.uri === 'string' }
}

function readBufferView(
  json: GLTFJson,
  buffers: Map<number, Uint8Array | null>,
  index: number,
): Uint8Array | null {
  const view = json.bufferViews?.[index]
  if (!view) return null

  const buffer = buffers.get(view.buffer)
  if (!buffer) return null

  const start = view.byteOffset ?? 0
  const end = start + view.byteLength
  if (start < 0 || end > buffer.byteLength) return null

  return buffer.subarray(start, end)
}

function resolveBuffers(json: GLTFJson, bin: Uint8Array | null): Map<number, Uint8Array | null> {
  const buffers = new Map<number, Uint8Array | null>()

  ;(json.buffers ?? []).forEach((buffer, index) => {
    if (buffer.uri === undefined) {
      // The first buffer with no URI is the GLB binary chunk by definition.
      buffers.set(index, index === 0 ? bin : null)
      return
    }
    if (buffer.uri.startsWith('data:')) {
      buffers.set(index, decodeDataUri(buffer.uri))
      return
    }
    buffers.set(index, null)
  })

  return buffers
}

function decodeDataUri(uri: string): Uint8Array | null {
  const comma = uri.indexOf(',')
  if (comma === -1) return null

  const meta = uri.slice(0, comma)
  const payload = uri.slice(comma + 1)

  if (!meta.includes(';base64')) {
    try {
      return new TextEncoder().encode(decodeURIComponent(payload))
    } catch {
      return null
    }
  }

  try {
    const binary = atob(payload)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return bytes
  } catch {
    return null
  }
}

function collectCost(
  container: GLTFContainer,
  geometryViews: Set<number>,
  textureViews: Set<number>,
): CostReport {
  const views = container.json.bufferViews ?? []
  const animationViews = new Set<number>()

  for (const animation of container.json.animations ?? []) {
    for (const sampler of animation.samplers) {
      for (const accessorIndex of [sampler.input, sampler.output]) {
        const view = container.json.accessors?.[accessorIndex]?.bufferView
        if (view !== undefined) animationViews.add(view)
      }
    }
  }

  for (const skin of container.json.skins ?? []) {
    if (skin.inverseBindMatrices !== undefined) {
      const view = container.json.accessors?.[skin.inverseBindMatrices]?.bufferView
      if (view !== undefined) animationViews.add(view)
    }
  }

  const counted = new Set<number>()
  const sum = (indices: Set<number>): number => {
    let total = 0
    for (const index of indices) {
      if (counted.has(index)) continue
      counted.add(index)
      total += views[index]?.byteLength ?? 0
    }
    return total
  }

  const geometry = sum(geometryViews)
  const textures = sum(textureViews)
  const animation = sum(animationViews)

  return {
    geometry,
    textures,
    animation,
    other: Math.max(0, container.byteLength - geometry - textures - animation),
    total: container.byteLength,
  }
}

function scoreWarnings(warnings: Warning[]): Health {
  let score = 100
  for (const warning of warnings) {
    score -= warning.severity === 'critical' ? 30 : warning.severity === 'warning' ? 8 : 3
  }
  score = Math.max(0, Math.min(100, score))

  const grade: Health['grade'] =
    score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 45 ? 'D' : 'F'

  return { score, grade }
}

function isPowerOfTwo(value: number): boolean {
  return (value & (value - 1)) === 0
}

function isFiniteSize(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function listSizes(textures: TextureStat[]): string {
  return textures
    .slice(0, 3)
    .map((texture) => `${texture.width}×${texture.height}${texture.name ? ` (${texture.name})` : ''}`)
    .join(', ') + (textures.length > 3 ? ` and ${textures.length - 3} more` : '')
}

function listBytes(textures: TextureStat[]): string {
  const total = textures.reduce((sum, texture) => sum + texture.bytes, 0)
  return formatBytes(total)
}

/**
 * Format a byte count for humans: `1.4 MB`, `820 KB`, `12 B`.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`

  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }

  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}
