/**
 * glb-doctor — diagnose glTF/GLB files.
 *
 * Zero dependencies, works in the browser and in Node. The core takes an
 * `ArrayBuffer` and returns plain data; rendering is someone else's job.
 *
 * ```ts
 * import { diagnose } from 'glb-doctor'
 *
 * const report = diagnose(await file.arrayBuffer())
 * console.log(report.health.score, report.warnings)
 * ```
 */

import { analyze, type AnalyzeOptions, type Report } from './analyze'
import { parseGLB } from './glb'

export { GLBError } from './errors'
export type { GLBErrorCode } from './errors'

export { parseGLB } from './glb'
export { analyze, formatBytes } from './analyze'
export { readImageSize } from './image'
export type { ImageInfo } from './image'

export type {
  AnalyzeOptions,
  CostReport,
  FileReport,
  Health,
  Report,
  SceneStats,
  TextureStat,
  Warning,
  WarningId,
  WarningSeverity,
} from './analyze'

export type {
  GLBChunk,
  GLTFAccessor,
  GLTFAnimation,
  GLTFAsset,
  GLTFBuffer,
  GLTFBufferView,
  GLTFCamera,
  GLTFContainer,
  GLTFImage,
  GLTFJson,
  GLTFMaterial,
  GLTFMesh,
  GLTFNode,
  GLTFPrimitive,
  GLTFScene,
  GLTFSkin,
  GLTFTexture,
} from './types'

/**
 * Parse and analyze a file in one call — the shortcut for the common case
 * where you have bytes and want a report.
 *
 * @throws {GLBError} when the input is not a valid GLB container.
 */
export function diagnose(input: ArrayBuffer | ArrayBufferView, options?: AnalyzeOptions): Report {
  return analyze(parseGLB(input), options)
}
