import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { diagnose } from '../src/index'

const samplePath = fileURLToPath(new URL('../public/sample.glb', import.meta.url))

describe('bundled sample', () => {
  const buffer = readFileSync(samplePath)
  const report = diagnose(buffer)

  it('parses a real GLB from disk', () => {
    expect(report.file.gltfVersion).toBe('2.0')
    expect(report.file.generator).toBe('glb-doctor sample generator')
    expect(report.file.chunks.map((chunk) => chunk.type)).toEqual(['JSON', 'BIN'])
  })

  it('counts the generated geometry', () => {
    expect(report.scene.meshes).toBe(3)
    expect(report.scene.primitives).toBe(3)
    expect(report.scene.triangles).toBe(9228)
    expect(report.scene.nodes).toBe(3)
  })

  it('finds both generated textures', () => {
    expect(report.textures.map((texture) => [texture.width, texture.height])).toEqual([
      [1024, 1024],
      [3000, 1500],
    ])
    expect(report.textures.every((texture) => texture.uses === 1)).toBe(true)
  })

  it('flags the deliberately oversized texture', () => {
    const ids = report.warnings.map((warning) => warning.id)

    expect(ids).toContain('oversized-texture')
    expect(ids).toContain('non-power-of-two')
    expect(report.health.grade).toBe('B')
  })

  it('accounts for every byte of the file', () => {
    const { cost } = report
    expect(cost.geometry + cost.textures + cost.animation + cost.other).toBe(cost.total)
    expect(cost.textures).toBeGreaterThan(cost.geometry)
  })
})
