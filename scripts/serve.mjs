/**
 * Minimal static server for the built demo (`dist-demo`).
 *
 * Exists so the site can be checked without Vite's dev server, which needs to
 * spawn helper processes on Windows.
 */

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../dist-demo', import.meta.url))
const port = Number(process.env.PORT ?? 4173)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const pathname = decodeURIComponent(url.pathname) || '/'
    const filePath = normalize(join(root, pathname === '/' ? 'index.html' : pathname))

    if (!filePath.startsWith(root + sep) && filePath !== join(root, 'index.html')) {
      response.writeHead(403).end('Forbidden')
      return
    }

    const data = await readFile(filePath)
    response.writeHead(200, {
      'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    })
    response.end(data)
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found')
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`demo: http://127.0.0.1:${port}`)
})
