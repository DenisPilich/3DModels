import { describe, expect, it } from 'vitest'
import { analyze, diagnose, formatBytes, parseGLB, type AnalyzeOptions } from '../src/index'
import { buildGLB, cubeGLB, type CubeOptions } from './fixtures'

function report(options: CubeOptions = {}, analyzeOptions?: AnalyzeOptions) {
  return analyze(parseGLB(cubeGLB(options).buffer), analyzeOptions)
}

function warningIds(options: CubeOptions = {}) {
  return report(options).warnings.map((warning) => warning.id)
}

describe('analyze', () => {
  it('counts scene contents', () => {
    const result = report()

    expect(result.scene.primitives).toBe(1)
    expect(result.scene.uniquePrimitives).toBe(1)
    expect(result.scene.triangles).toBe(12)
    expect(result.scene.vertices).toBe(24)
    expect(result.scene.materials).toBe(1)
    expect(result.scene.textures).toBe(1)
    expect(result.file.gltfVersion).toBe('2.0')
    expect(result.file.generator).toBe('glb-doctor test fixtures')
  })

  it('reads texture dimensions from the file header', () => {
    const result = report({ imageSize: 1024 })

    expect(result.textures).toHaveLength(1)
    expect(result.textures[0]).toMatchObject({
      width: 1024,
      height: 1024,
      mimeType: 'image/png',
      uses: 1,
      external: false,
    })
    expect(result.textures[0]?.bytes).toBe(40)
  })

  it('splits the file into geometry, textures and the rest', () => {
    const result = report()

    // 24 positions + 24 normals + 24 uvs + 36 uint16 indices
    expect(result.cost.geometry).toBe(840)
    expect(result.cost.textures).toBe(40)
    expect(
      result.cost.geometry + result.cost.textures + result.cost.animation + result.cost.other,
    ).toBe(result.cost.total)
  })

  it('warns about oversized textures', () => {
    expect(warningIds({ imageSize: 4096 })).toContain('oversized-texture')
    expect(warningIds({ imageSize: 1024 })).not.toContain('oversized-texture')
  })

  it('respects a custom texture size limit', () => {
    const result = report({ imageSize: 2048 }, { maxTextureSize: 1024 })
    expect(result.warnings.map((warning) => warning.id)).toContain('oversized-texture')
  })

  it('warns about unindexed geometry', () => {
    const result = report({ indexed: false })

    expect(result.warnings.map((warning) => warning.id)).toContain('unindexed')
    expect(result.scene.triangles).toBe(8)
  })

  it('warns about 32-bit indices on a small mesh', () => {
    expect(warningIds({ wideIndices: true })).toContain('wide-index')
    expect(warningIds({})).not.toContain('wide-index')
  })

  it('detects duplicated primitives', () => {
    const result = report({ copies: 2 })

    expect(result.scene.primitives).toBe(2)
    expect(result.scene.uniquePrimitives).toBe(1)
    expect(result.warnings.map((warning) => warning.id)).toContain('duplicate-mesh')
  })

  it('flags an empty scene', () => {
    const result = analyze(parseGLB(buildGLB({ asset: { version: '2.0' } })))

    expect(result.scene.primitives).toBe(0)
    expect(result.warnings.map((warning) => warning.id)).toContain('empty-scene')
    expect(result.health.score).toBeLessThan(100)
  })

  it('never reports a score outside 0–100', () => {
    const result = report({ imageSize: 8192, copies: 4, wideIndices: true, indexed: false })
    expect(result.health.score).toBeGreaterThanOrEqual(0)
    expect(result.health.score).toBeLessThanOrEqual(100)
  })

  it('scores a messy file below a clean one', () => {
    const clean = report({ imageSize: 512 })
    const messy = report({ imageSize: 4096, copies: 3, wideIndices: true, indexed: false })

    expect(messy.health.score).toBeLessThan(clean.health.score)
  })

  it('gives every warning a stable id, severity and detail', () => {
    for (const warning of report({ imageSize: 4096, copies: 2 }).warnings) {
      expect(warning.id).toMatch(/^[a-z]+(-[a-z]+)*$/)
      expect(['info', 'warning', 'critical']).toContain(warning.severity)
      expect(warning.detail.length).toBeGreaterThan(0)
      expect(warning.count).toBeGreaterThan(0)
    }
  })
})

describe('diagnose', () => {
  it('parses and analyzes in one call', () => {
    const result = diagnose(cubeGLB({ imageSize: 256 }).buffer)
    expect(result.scene.triangles).toBe(12)
    expect(result.health.score).toBeGreaterThan(0)
  })
})

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [1024 * 1024, '1.0 MB'],
    [10 * 1024 * 1024, '10.0 MB'],
  ])('formats %i as %s', (input, expected) => {
    expect(formatBytes(input)).toBe(expected)
  })
})
