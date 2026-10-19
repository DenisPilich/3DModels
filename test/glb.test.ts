import { describe, expect, it } from 'vitest'
import { GLBError, parseGLB } from '../src/index'
import { buildGLB, cubeGLB } from './fixtures'

function expectGLBError(input: ArrayBuffer | ArrayBufferView): GLBError {
  try {
    parseGLB(input)
  } catch (error) {
    expect(error).toBeInstanceOf(GLBError)
    return error as GLBError
  }
  throw new Error('parseGLB should have thrown')
}

describe('parseGLB', () => {
  it('reads a valid container', () => {
    const { buffer, json } = cubeGLB()
    const file = parseGLB(buffer)

    expect(file.version).toBe(2)
    expect(file.json).toEqual(json)
    expect(file.chunks.map((chunk) => chunk.type)).toEqual(['JSON', 'BIN'])
    expect(file.bin?.byteLength).toBeGreaterThan(0)
    expect(file.byteLength).toBe(buffer.byteLength)
  })

  it('accepts a typed array view', () => {
    const { buffer } = cubeGLB()
    expect(parseGLB(new Uint8Array(buffer)).json.asset?.version).toBe('2.0')
  })

  it('reports an empty input', () => {
    expect(expectGLBError(new ArrayBuffer(0)).code).toBe('EMPTY')
  })

  it('reports a file shorter than a header', () => {
    expect(expectGLBError(new Uint8Array([0x67, 0x6c, 0x54])).code).toBe('TRUNCATED')
  })

  it('rejects files without glTF magic bytes', () => {
    const buffer = new ArrayBuffer(12)
    expect(expectGLBError(buffer).code).toBe('NOT_GLB')
  })

  it('rejects another container version', () => {
    const { buffer } = cubeGLB()
    new DataView(buffer).setUint32(4, 1, true)
    expect(expectGLBError(buffer).code).toBe('UNSUPPORTED_VERSION')
  })

  it('rejects a file shorter than its declared length', () => {
    const { buffer } = cubeGLB()
    new DataView(buffer).setUint32(8, buffer.byteLength + 64, true)
    expect(expectGLBError(buffer).code).toBe('TRUNCATED')
  })

  it('rejects a chunk running past the end of the file', () => {
    const { buffer } = cubeGLB()
    new DataView(buffer).setUint32(12, 1_000_000, true)
    expect(expectGLBError(buffer).code).toBe('TRUNCATED')
  })

  it('rejects malformed JSON', () => {
    const json = new TextEncoder().encode('{ "asset": ')
    const padded = new Uint8Array(Math.ceil(json.length / 4) * 4 + 4).fill(0x20)
    padded.set(json)

    const total = 12 + 8 + padded.length
    const buffer = new ArrayBuffer(total)
    const view = new DataView(buffer)
    view.setUint32(0, 0x46546c67, true)
    view.setUint32(4, 2, true)
    view.setUint32(8, total, true)
    view.setUint32(12, padded.length, true)
    view.setUint32(16, 0x4e4f534a, true)
    new Uint8Array(buffer).set(padded, 20)

    expect(expectGLBError(buffer).code).toBe('INVALID_JSON')
  })

  it('rejects a non-object JSON document', () => {
    expect(expectGLBError(buildGLB([1, 2, 3])).code).toBe('INVALID_JSON')
  })

  it('rejects a first chunk that is not JSON', () => {
    const total = 12 + 8 + 4
    const buffer = new ArrayBuffer(total)
    const view = new DataView(buffer)
    view.setUint32(0, 0x46546c67, true)
    view.setUint32(4, 2, true)
    view.setUint32(8, total, true)
    view.setUint32(12, 4, true)
    view.setUint32(16, 0x004e4942, true)

    expect(expectGLBError(buffer).code).toBe('CORRUPT_CHUNK')
  })
})
