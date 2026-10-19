import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { run, type CliIo } from '../src/cli'

const sample = fileURLToPath(new URL('../public/sample.glb', import.meta.url))
const notGlb = fileURLToPath(new URL('../package.json', import.meta.url))

function harness() {
  const out: string[] = []
  const err: string[] = []

  const io: CliIo = {
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    color: false,
    columns: 100,
  }

  return { io, out: () => out.join(''), err: () => err.join('') }
}

describe('cli', () => {
  it('prints a human report', async () => {
    const { io, out } = harness()
    const code = await run([sample], io)

    expect(code).toBe(0)
    expect(out()).toContain('Health')
    expect(out()).toContain('86/100')
    expect(out()).toContain('9,228 triangles')
    expect(out()).toContain('1 texture larger than 2048px')
  })

  it('emits machine-readable JSON', async () => {
    const { io, out } = harness()
    const code = await run(['--json', sample], io)

    expect(code).toBe(0)
    const report = JSON.parse(out())
    expect(report.health).toEqual({ score: 86, grade: 'B' })
    expect(report.scene.triangles).toBe(9228)
  })

  it('hides informational notes with --quiet', async () => {
    const { io, out } = harness()
    await run(['--quiet', sample], io)

    expect(out()).not.toContain('Geometry is not compressed')
    expect(out()).toContain('1 texture larger than 2048px')
  })

  it('treats --fail-on as an asset budget', async () => {
    expect(await run(['--fail-on', 'warning', sample], harness().io)).toBe(2)
    expect(await run(['--fail-on', 'critical', sample], harness().io)).toBe(0)
    expect(await run([sample], harness().io)).toBe(0)
  })

  it('rejects an unknown --fail-on level', async () => {
    const { io, err } = harness()
    const code = await run(['--fail-on', 'sometimes', sample], io)

    expect(code).toBe(1)
    expect(err()).toContain('--fail-on expects one of')
  })

  it('reports a missing file without a stack trace', async () => {
    const { io, err } = harness()
    const code = await run(['does-not-exist.glb'], io)

    expect(code).toBe(1)
    expect(err()).toContain('does-not-exist.glb')
    expect(err()).toContain('file not found')
  })

  it('reports a file that is not a GLB', async () => {
    const { io, err } = harness()
    const code = await run([notGlb], io)

    expect(code).toBe(1)
    expect(err()).toContain('NOT_GLB')
  })

  it('continues after a failing file and summarises', async () => {
    const { io, out, err } = harness()
    const code = await run([sample, 'missing.glb'], io)

    expect(code).toBe(1)
    expect(out()).toContain('9,228 triangles')
    expect(err()).toContain('2 files · 1 ok · 1 failed')
  })

  it('prints usage for --help and exits cleanly', async () => {
    const { io, out } = harness()
    expect(await run(['--help'], io)).toBe(0)
    expect(out()).toContain('Usage')
    expect(out()).toContain('--fail-on')
  })

  it('prints a semver for --version', async () => {
    const { io, out } = harness()
    expect(await run(['--version'], io)).toBe(0)
    expect(out().trim()).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('fails without arguments', async () => {
    const { io, err } = harness()
    expect(await run([], io)).toBe(1)
    expect(err()).toContain('Usage')
  })

  it('rejects unknown options', async () => {
    const { io, err } = harness()
    expect(await run(['--nope', sample], io)).toBe(1)
    expect(err()).toContain('glb-doctor:')
  })
})
