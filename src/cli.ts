/**
 * Command-line entry point.
 *
 * The CLI is a thin shell around the same two functions the library exports:
 * read bytes, parse, analyze, print. It adds argument handling, colour and an
 * exit code that CI can use as an asset budget.
 */

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { analyze, formatBytes, type Report, type Warning, type WarningSeverity } from './analyze'
import { GLBError } from './errors'
import { parseGLB } from './glb'

export interface CliIo {
  stdout(text: string): void
  stderr(text: string): void
  /** Whether ANSI colours may be emitted. */
  color: boolean
  /** Terminal width used for wrapping; defaults to 100. */
  columns?: number
}

type FailLevel = 'none' | WarningSeverity

interface CliOptions {
  json: boolean
  quiet: boolean
  failOn: FailLevel
}

const SEVERITY_RANK: Record<WarningSeverity, number> = { info: 0, warning: 1, critical: 2 }
const FAIL_LEVELS: FailLevel[] = ['none', 'info', 'warning', 'critical']

const USAGE = `glb-doctor — diagnose glTF/GLB files

Usage
  glb-doctor <file.glb> [more.glb…]
  cat model.glb | glb-doctor -

Options
  --json              print the raw report as JSON
  --quiet             hide informational notes
  --fail-on <level>   exit 2 when a finding reaches this severity
                      (info | warning | critical), default: none
  --no-color          disable ANSI colours
  -h, --help          show this help
  -v, --version       print the version

Exit codes
  0  nothing to report at the requested level
  1  a file could not be read or parsed
  2  findings reached the --fail-on level
`

/** Run the CLI and resolve to its exit code. Exported for tests. */
export async function run(argv: string[], io: CliIo): Promise<number> {
  const noColor = argv.includes('--no-color')
  const options = parseCliOptions(argv.filter((argument) => argument !== '--no-color'))

  if (options.error) {
    io.stderr(`glb-doctor: ${options.error}\n\n${USAGE}`)
    return 1
  }

  const { values, positionals } = options.parsed

  if (values.help) {
    io.stdout(USAGE)
    return 0
  }
  if (values.version) {
    io.stdout(`${version()}\n`)
    return 0
  }
  if (positionals.length === 0) {
    io.stderr(`${USAGE}`)
    return 1
  }

  const failOn = (values['fail-on'] as string | undefined) ?? 'none'
  if (!FAIL_LEVELS.includes(failOn as FailLevel)) {
    io.stderr(`glb-doctor: --fail-on expects one of ${FAIL_LEVELS.join(', ')}\n`)
    return 1
  }

  const config: CliOptions = {
    json: Boolean(values.json),
    quiet: Boolean(values.quiet),
    failOn: failOn as FailLevel,
  }

  const palette = createPalette(io.color && !noColor && !config.json)
  const width = Math.max(60, Math.min(io.columns ?? 100, 120))

  const reports: Array<{ name: string; report: Report }> = []
  const failures: Array<{ name: string; message: string }> = []

  for (const file of positionals) {
    const name = file === '-' ? '<stdin>' : file

    try {
      const bytes = file === '-' ? await readStdin() : await readFile(file)
      reports.push({ name, report: analyze(parseGLB(bytes)) })
    } catch (error) {
      failures.push({ name, message: describeFailure(error) })
    }
  }

  if (config.json) {
    if (reports.length > 0) {
      const payload = reports.length === 1 ? reports[0]?.report : reports.map((entry) => entry.report)
      io.stdout(`${JSON.stringify(payload, null, 2)}\n`)
    }
  } else {
    const blocks = reports.map((entry) =>
      renderFile(entry.name, entry.report, config, palette, width),
    )
    if (blocks.length > 0) io.stdout(`${blocks.join('\n')}\n`)
  }

  for (const failure of failures) {
    io.stderr(`${palette.red('✖')} ${palette.bold(failure.name)}\n  ${failure.message}\n`)
  }

  if (!config.json && positionals.length > 1 && failures.length > 0) {
    io.stderr(`\n${positionals.length} files · ${reports.length} ok · ${failures.length} failed\n`)
  }

  if (failures.length > 0) return 1
  if (config.failOn !== 'none') {
    const threshold = SEVERITY_RANK[config.failOn]
    const breached = reports.some((entry) =>
      entry.report.warnings.some((warning) => SEVERITY_RANK[warning.severity] >= threshold),
    )
    if (breached) return 2
  }

  return 0
}

interface ParsedCli {
  values: Record<string, string | boolean | undefined>
  positionals: string[]
}

interface ParsedCliResult {
  parsed: ParsedCli
  error?: string
}

function parseCliOptions(argv: string[]): ParsedCliResult {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        json: { type: 'boolean', default: false },
        quiet: { type: 'boolean', default: false },
        'fail-on': { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    })

    return { parsed: { values: values as Record<string, string | boolean | undefined>, positionals } }
  } catch (error) {
    return {
      parsed: { values: {}, positionals: [] },
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

function describeFailure(error: unknown): string {
  if (error instanceof GLBError) return `${error.code}: ${error.message}`

  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (code === 'ENOENT') return 'file not found'
  if (code === 'EACCES') return 'permission denied'
  if (code === 'EISDIR') return 'that path is a directory'

  return error instanceof Error ? error.message : String(error)
}

function version(): string {
  try {
    const require = createRequire(import.meta.url)
    const pkg = require('../package.json') as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/* ------------------------------------------------------------------ output */

interface Palette {
  bold(text: string): string
  dim(text: string): string
  red(text: string): string
  green(text: string): string
  yellow(text: string): string
  blue(text: string): string
}

function createPalette(enabled: boolean): Palette {
  const paint = (code: string) => (text: string) =>
    enabled ? `\u001b[${code}m${text}\u001b[0m` : text

  return {
    bold: paint('1'),
    dim: paint('2'),
    red: paint('31'),
    green: paint('32'),
    yellow: paint('33'),
    blue: paint('34'),
  }
}

function renderFile(
  name: string,
  report: Report,
  options: CliOptions,
  palette: Palette,
  width: number,
): string {
  const lines: string[] = []
  const { bold, dim } = palette

  const meta = [
    formatBytes(report.file.bytes),
    `glTF ${report.file.gltfVersion}`,
    report.file.generator,
    report.file.extensionsUsed.length > 0
      ? `${report.file.extensionsUsed.length} extension${report.file.extensionsUsed.length === 1 ? '' : 's'}`
      : null,
  ].filter((part): part is string => Boolean(part))

  lines.push(`${bold(name)}  ${dim(meta.join(' · '))}`)
  lines.push('')

  lines.push(...healthLines(report, palette, width))
  lines.push('')
  lines.push(...sceneLines(report, palette))
  lines.push('')
  lines.push(...sizeLines(report, palette))

  const findings = options.quiet
    ? report.warnings.filter((warning) => warning.severity !== 'info')
    : report.warnings

  lines.push('')
  lines.push(...findingLines(findings, report, palette, width))

  return lines.join('\n')
}

function healthLines(report: Report, palette: Palette, width: number): string[] {
  const grade = report.health.grade
  const color =
    grade === 'A' || grade === 'B'
      ? palette.green
      : grade === 'C'
        ? palette.yellow
        : palette.red

  const label =
    grade === 'A'
      ? 'Clean file'
      : grade === 'B'
        ? 'Mostly clean'
        : grade === 'C'
          ? 'A few things to fix'
          : grade === 'D'
            ? 'Heavy and unoptimized'
            : 'Needs serious work'

  const barWidth = Math.max(10, Math.min(20, width - 55))
  const bar = progressBar(report.health.score / 100, barWidth)

  return [
    `  ${palette.dim('Health')}  ${palette.bold(`${report.health.score}/100`.padEnd(7))} ${color(grade)}  ${color(bar)}  ${label}`,
  ]
}

function sceneLines(report: Report, palette: Palette): string[] {
  const { scene } = report
  const number = (value: number): string => value.toLocaleString('en-US')

  return [
    `  ${palette.dim('Scene')}   ${number(scene.triangles)} triangles · ${number(scene.vertices)} vertices · ${number(scene.primitives)} draw calls`,
    `          ${number(scene.materials)} materials · ${number(scene.textures)} textures · ${number(scene.nodes)} nodes`,
  ]
}

function sizeLines(report: Report, palette: Palette): string[] {
  const { cost } = report
  const total = cost.total || 1
  const rows: Array<[string, number]> = [
    ['geometry', cost.geometry],
    ['textures', cost.textures],
    ['animation', cost.animation],
    ['other', cost.other],
  ]

  const visible = rows.filter(([, bytes]) => bytes > 0)

  return visible.map(([label, bytes], index) => {
    const prefix = index === 0 ? `  ${palette.dim('Size')}    ` : '          '
    const bar = progressBar(bytes / total, 20)
    const share = `${Math.round((bytes / total) * 100)}%`.padStart(4)

    return `${prefix}${label.padEnd(9)} ${formatBytes(bytes).padStart(8)}  ${palette.dim(bar)} ${palette.dim(share)}`
  })
}

function findingLines(
  warnings: Warning[],
  report: Report,
  palette: Palette,
  width: number,
): string[] {
  if (warnings.length === 0) {
    const message =
      report.warnings.length > 0 ? 'Nothing above the note level.' : 'Nothing to report. Clean file.'
    return [`  ${palette.green('✓')} ${palette.dim(message)}`]
  }

  const counts = {
    critical: warnings.filter((warning) => warning.severity === 'critical').length,
    warning: warnings.filter((warning) => warning.severity === 'warning').length,
    info: warnings.filter((warning) => warning.severity === 'info').length,
  }

  const summary = [
    counts.critical > 0 ? `${counts.critical} critical` : '',
    counts.warning > 0 ? `${counts.warning} warning${counts.warning === 1 ? '' : 's'}` : '',
    counts.info > 0 ? `${counts.info} note${counts.info === 1 ? '' : 's'}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  const lines: string[] = [`  ${palette.bold(summary)}`]

  const ordered = [...warnings].sort(
    (left, right) => SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity],
  )

  for (const warning of ordered) {
    const symbol =
      warning.severity === 'critical'
        ? palette.red('✖')
        : warning.severity === 'warning'
          ? palette.yellow('!')
          : palette.blue('i')

    lines.push(`    ${symbol}  ${warning.title}`)
    for (const line of wrap(warning.detail, width - 7)) {
      lines.push(`       ${palette.dim(line)}`)
    }
  }

  return lines
}

function progressBar(ratio: number, size: number): string {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0))
  const filled = Math.round(clamped * size)
  return `${'█'.repeat(filled)}${'░'.repeat(size - filled)}`
}

function wrap(text: string, width: number): string[] {
  const limit = Math.max(20, width)
  const lines: string[] = []
  let current = ''

  for (const word of text.split(/\s+/)) {
    if (current.length === 0) {
      current = word
    } else if (current.length + 1 + word.length <= limit) {
      current += ` ${word}`
    } else {
      lines.push(current)
      current = word
    }
  }

  if (current.length > 0) lines.push(current)
  return lines
}

/* -------------------------------------------------------------------- main */

export function createProcessIo(): CliIo {
  const color =
    Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && process.env.TERM !== 'dumb'

  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    color,
    columns: process.stdout.columns,
  }
}

const isMain =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  void run(process.argv.slice(2), createProcessIo()).then((code) => {
    process.exitCode = code
  })
}
