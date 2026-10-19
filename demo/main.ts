import './style.css'
import { diagnose, formatBytes, GLBError, type Report } from '../src/index'
import { renderEmpty, renderError, renderLoading, renderReport } from './report'
import { createViewer, type Viewer } from './viewer'

function must<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`The demo markup is missing ${selector}`)
  return element
}

const panel = must<HTMLElement>('#panel')
const canvas = must<HTMLCanvasElement>('#viewport')
const dropzone = must<HTMLElement>('#dropzone')
const hud = must<HTMLElement>('#hud')
const hudName = must<HTMLElement>('#hud-name')
const hudSize = must<HTMLElement>('#hud-size')
const fileInput = must<HTMLInputElement>('#file-input')
const openButton = must<HTMLButtonElement>('#open-file')
const sampleButton = document.querySelector<HTMLButtonElement>('#load-sample')

let viewer: Viewer | null = null
try {
  viewer = createViewer(canvas)
} catch (error) {
  console.warn('WebGL is unavailable, the preview will stay empty.', error)
}

renderEmpty(panel)

async function inspect(buffer: ArrayBuffer, fileName: string): Promise<void> {
  const name = fileName || 'model.glb'
  renderLoading(panel, name)

  let report: Report
  try {
    report = diagnose(buffer)
  } catch (error) {
    const code = error instanceof GLBError ? error.code : 'UNEXPECTED'
    const message = error instanceof Error ? error.message : String(error)
    renderError(panel, code, message)
    return
  }

  renderReport(panel, report, name)

  hudName.textContent = name
  hudSize.textContent = formatBytes(report.file.bytes)
  hud.hidden = false
  dropzone.hidden = true

  if (!viewer) return

  try {
    await viewer.load(buffer)
  } catch (error) {
    console.warn('Preview failed, the report is still valid.', error)
    hudSize.textContent = `${formatBytes(report.file.bytes)} · preview unavailable`
  }
}

async function handleFile(file: File): Promise<void> {
  if (!file.name.toLowerCase().endsWith('.glb')) {
    renderError(
      panel,
      'NOT_GLB',
      `"${file.name}" is not a .glb file. Binary glTF files end with .glb — a .gltf is plain JSON.`,
    )
    return
  }

  try {
    await inspect(await file.arrayBuffer(), file.name)
  } catch (error) {
    renderError(panel, 'READ_ERROR', error instanceof Error ? error.message : String(error))
  }
}

async function loadSample(): Promise<void> {
  if (!sampleButton) return

  const label = sampleButton.textContent
  sampleButton.disabled = true
  sampleButton.textContent = 'Loading…'

  try {
    const response = await fetch(`${import.meta.env.BASE_URL}sample.glb`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    await inspect(await response.arrayBuffer(), 'sample.glb')
  } catch (error) {
    renderError(
      panel,
      'SAMPLE_UNAVAILABLE',
      `Could not load sample.glb (${error instanceof Error ? error.message : String(error)}). Run "npm run sample" to generate it.`,
    )
  } finally {
    sampleButton.disabled = false
    sampleButton.textContent = label
  }
}

openButton.addEventListener('click', () => fileInput.click())
sampleButton?.addEventListener('click', () => void loadSample())

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  if (file) void handleFile(file)
  fileInput.value = ''
})

let dragDepth = 0

window.addEventListener('dragenter', (event) => {
  event.preventDefault()
  dragDepth += 1
  dropzone.classList.add('armed')
})

window.addEventListener('dragleave', (event) => {
  event.preventDefault()
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dropzone.classList.remove('armed')
})

window.addEventListener('dragover', (event) => event.preventDefault())

window.addEventListener('drop', (event) => {
  event.preventDefault()
  dragDepth = 0
  dropzone.classList.remove('armed')

  const file = event.dataTransfer?.files?.[0]
  if (file) void handleFile(file)
})

window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
    event.preventDefault()
    fileInput.click()
  }
})

// `?sample` opens the bundled model directly — handy for screenshots and for
// linking someone straight to a filled-in report.
if (new URLSearchParams(window.location.search).has('sample')) {
  void loadSample()
}
