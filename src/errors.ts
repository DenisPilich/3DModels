/** Machine-readable reasons a GLB file was rejected. */
export type GLBErrorCode =
  | 'EMPTY'
  | 'NOT_GLB'
  | 'UNSUPPORTED_VERSION'
  | 'TRUNCATED'
  | 'CORRUPT_CHUNK'
  | 'INVALID_JSON'

/**
 * Thrown by {@link parseGLB} when the input is not a usable GLB container.
 *
 * The message is written for humans; `code` is stable and meant for branching.
 */
export class GLBError extends Error {
  readonly code: GLBErrorCode

  constructor(code: GLBErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'GLBError'
    this.code = code
  }
}
