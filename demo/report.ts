import { formatBytes, type Report, type Warning } from '../src/index'

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character)

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const full = new Intl.NumberFormat('en-US')

const SEVERITY_ORDER: Record<Warning['severity'], number> = { critical: 0, warning: 1, info: 2 }

const GRADE_COLOR: Record<Report['health']['grade'], string> = {
  A: '#34d399',
  B: '#34d399',
  C: '#fbbf24',
  D: '#fb923c',
  F: '#f87171',
}

const GRADE_LABEL: Record<Report['health']['grade'], string> = {
  A: 'Clean file',
  B: 'Mostly clean',
  C: 'A few things to fix',
  D: 'Heavy and unoptimized',
  F: 'Needs serious work',
}

const COST_PARTS = [
  { key: 'geometry', label: 'Geometry', color: '#38bdf8' },
  { key: 'textures', label: 'Textures', color: '#a78bfa' },
  { key: 'animation', label: 'Animation', color: '#f472b6' },
  { key: 'other', label: 'JSON & headers', color: '#3b4658' },
] as const

export function renderEmpty(panel: HTMLElement): void {
  panel.innerHTML = `
    <div class="empty-state">
      <h2>What am I looking at?</h2>
      <p>
        Drop a binary glTF file and glb-doctor explains what is inside it and what it costs to load.
      </p>
      <ul class="checks">
        <li>Counts triangles, draw calls, materials and textures</li>
        <li>Reads texture dimensions from file headers, without decoding a single pixel</li>
        <li>Shows where the megabytes actually go</li>
        <li>Flags the usual suspects: oversized textures, unindexed meshes, duplicated geometry</li>
      </ul>
      <div class="snippet">
        <div class="snippet-head"><span>library</span><span>zero dependencies</span></div>
        <pre><code><span class="tok-key">import</span> { diagnose } <span class="tok-key">from</span> <span class="tok-str">'glb-doctor'</span>

<span class="tok-key">const</span> report = diagnose(<span class="tok-key">await</span> file.arrayBuffer())

report.health.score   <span class="tok-com">// 86</span>
report.warnings[0]    <span class="tok-com">// "2 textures larger than 2048px"</span></code></pre>
      </div>
    </div>
  `
}

export function renderLoading(panel: HTMLElement, fileName: string): void {
  panel.innerHTML = `
    <div class="file-head">
      <div class="file-name">${escapeHtml(fileName)}</div>
    </div>
    <div class="loading" style="margin-top: 20px">
      <span class="spinner"></span>
      <span>Reading the container…</span>
    </div>
  `
}

export function renderError(panel: HTMLElement, code: string, message: string): void {
  panel.innerHTML = `
    <div class="error-box">
      <div class="error-code">${escapeHtml(code)}</div>
      <h2>This file could not be read</h2>
      <p>${escapeHtml(message)}</p>
    </div>
    <p style="color: #5b6375; font-size: 12.5px; line-height: 1.6; margin-top: 14px">
      glb-doctor accepts binary glTF (<code style="font-family: var(--mono)">.glb</code>) only.
      A plain <code style="font-family: var(--mono)">.gltf</code> file is JSON that points at
      external buffers — pack it into a GLB first.
    </p>
  `
}

export function renderReport(panel: HTMLElement, report: Report, fileName: string): void {
  const meta = [
    formatBytes(report.file.bytes),
    `glTF ${escapeHtml(report.file.gltfVersion)}`,
    report.file.generator ? escapeHtml(report.file.generator) : null,
    report.file.extensionsUsed.length > 0
      ? `${report.file.extensionsUsed.length} extension${report.file.extensionsUsed.length === 1 ? '' : 's'}`
      : null,
  ].filter((part): part is string => part !== null)

  panel.innerHTML = `
    <div class="file-head">
      <div class="file-name">${escapeHtml(fileName)}</div>
      <div class="file-meta">${meta.map((part) => `<span>${part}</span>`).join('')}</div>
    </div>
    ${healthSection(report)}
    ${findingsSection(report)}
    ${sceneSection(report)}
    ${costSection(report)}
    ${textureSection(report)}
  `
}

function healthSection(report: Report): string {
  const radius = 38
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - report.health.score / 100)
  const color = GRADE_COLOR[report.health.grade]
  const notes = report.warnings.length

  return `
    <section>
      <div class="health">
        <svg class="gauge" viewBox="0 0 100 100" aria-hidden="true">
          <circle class="track" cx="50" cy="50" r="${radius}" />
          <circle
            class="value"
            cx="50"
            cy="50"
            r="${radius}"
            stroke="${color}"
            stroke-dasharray="${circumference.toFixed(2)}"
            stroke-dashoffset="${offset.toFixed(2)}"
          />
        </svg>
        <div class="health-copy">
          <div class="health-score">${report.health.score}<small>/100</small></div>
          <div class="health-label">${GRADE_LABEL[report.health.grade]}</div>
          <div class="health-grade" style="color: ${color}">
            GRADE ${report.health.grade} · ${notes === 0 ? 'no findings' : `${notes} finding${notes === 1 ? '' : 's'}`}
          </div>
        </div>
      </div>
    </section>
  `
}

function findingsSection(report: Report): string {
  if (report.warnings.length === 0) {
    return `
      <section>
        <h3>Findings</h3>
        <p style="color: #8b93a7; font-size: 13px; margin: 0">
          Nothing to report. Either the file is genuinely tidy, or the heuristics have not met their match yet.
        </p>
      </section>
    `
  }

  const sorted = [...report.warnings].sort(
    (left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity],
  )
  const critical = report.warnings.filter((warning) => warning.severity === 'critical').length
  const warningCount = report.warnings.filter((warning) => warning.severity === 'warning').length
  const notes = report.warnings.length - critical - warningCount

  const summary = [
    critical > 0 ? `${critical} critical` : '',
    warningCount > 0 ? `${warningCount} warning${warningCount === 1 ? '' : 's'}` : '',
    notes > 0 ? `${notes} note${notes === 1 ? '' : 's'}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return `
    <section>
      <h3>
        Findings
        <span class="count">${summary}</span>
      </h3>
      <ul class="findings">
        ${sorted
          .map(
            (warning) => `
          <li class="finding ${warning.severity}">
            <div>
              <div class="finding-title">${escapeHtml(warning.title)}</div>
              <div class="finding-detail">${escapeHtml(warning.detail)}</div>
            </div>
          </li>`,
          )
          .join('')}
      </ul>
    </section>
  `
}

function sceneSection(report: Report): string {
  const { scene } = report
  const stats = [
    { value: compact.format(scene.triangles), label: 'triangles' },
    { value: compact.format(scene.vertices), label: 'vertices' },
    { value: full.format(scene.primitives), label: 'draw calls' },
    { value: full.format(scene.materials), label: 'materials' },
    { value: full.format(scene.textures), label: 'textures' },
    { value: full.format(scene.nodes), label: 'nodes' },
  ]

  return `
    <section>
      <h3>Scene</h3>
      <div class="stats">
        ${stats
          .map(
            (stat) => `
          <div class="stat">
            <span class="stat-value">${stat.value}</span>
            <span class="stat-label">${stat.label}</span>
          </div>`,
          )
          .join('')}
      </div>
    </section>
  `
}

function costSection(report: Report): string {
  const { cost } = report
  const total = cost.total || 1

  const segments = COST_PARTS.filter((part) => cost[part.key] > 0)
    .map(
      (part) =>
        `<span class="bar-segment" style="width: ${((cost[part.key] / total) * 100).toFixed(2)}%; background: ${part.color}"></span>`,
    )
    .join('')

  const legend = COST_PARTS.map(
    (part) => `
      <div class="legend-row">
        <span class="legend-swatch" style="background: ${part.color}"></span>
        <span>${part.label}</span>
        <span>${formatBytes(cost[part.key])}</span>
      </div>`,
  ).join('')

  return `
    <section>
      <h3>Where the bytes go</h3>
      <div class="bar">${segments}</div>
      <div class="legend">${legend}</div>
    </section>
  `
}

function textureSection(report: Report): string {
  if (report.textures.length === 0) {
    return `
      <section>
        <h3>Textures</h3>
        <p style="color: #8b93a7; font-size: 13px; margin: 0">This file has no textures — every material is a solid colour.</p>
      </section>
    `
  }

  const visible = report.textures.slice(0, 10)

  const rows = visible
    .map((texture) => {
      const size =
        texture.width === null || texture.height === null
          ? '—'
          : `${texture.width}×${texture.height}`
      const oversized = Math.max(texture.width ?? 0, texture.height ?? 0) > 2048
      const weight = texture.external ? 'external' : formatBytes(texture.bytes)
      const uses = texture.uses === 0 ? 'unused' : String(texture.uses)
      const name = texture.name ?? `image ${texture.index}`

      return `
        <tr>
          <td><span class="texture-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span></td>
          <td class="mono ${oversized ? 'hot' : 'dim'}">${size}</td>
          <td class="mono ${texture.uses === 0 ? 'hot' : ''}">${weight}</td>
          <td class="mono dim">${uses}</td>
        </tr>`
    })
    .join('')

  const rest =
    report.textures.length > visible.length
      ? `<tr><td colspan="4" class="dim" style="font-size: 12px">+ ${report.textures.length - visible.length} more</td></tr>`
      : ''

  return `
    <section>
      <h3>Textures <span class="count">${report.textures.length}</span></h3>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th class="mono">Pixels</th>
            <th class="mono">Weight</th>
            <th class="mono">Used</th>
          </tr>
        </thead>
        <tbody>${rows}${rest}</tbody>
      </table>
    </section>
  `
}
