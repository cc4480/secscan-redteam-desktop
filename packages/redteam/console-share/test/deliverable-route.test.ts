/**
 * Q-DOC-ACTIONS — the deliverable download path through the share proxy:
 * a browser GET of the document-relative deliverable route reaches the
 * runner console's deliverable route with the bearer attached here and
 * streams the file's exact bytes back (sha256 compared), including its
 * Content-Disposition. This is the transport the chat document card's
 * Copy/Download actions ride.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer, get as httpGet, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { proxyToConsole, type ConsoleTarget } from '../src/proxy.js'
import { deliverableDisplayRoute, deliverableFileRoute, isCopyableDeliverable, isDeliverableFileName } from '../src/shared.js'

const TOKEN = 'test-token-fixture'
const DISPLAY_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox"
const FILE_BYTES = Buffer.from('<!doctype html><title>proxied report</title>\n', 'utf8')
let observedAuthorization: string | undefined
let observedUrl: string | undefined
let consoleServer: Server
let frontServer: Server
let frontPort: number

type ObservedResponse = { status: number; headers: Record<string, unknown>; body: Buffer }

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => { resolve((server.address() as AddressInfo).port) })
  })
}

before(async () => {
  consoleServer = createServer((req, res) => {
    observedAuthorization = req.headers['authorization']
    observedUrl = req.url
    if (req.url === '/api/engagements/eng-1/deliverables/report.html?display=inline') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-disposition': 'inline; filename="report.html"',
        'content-security-policy': DISPLAY_CSP,
        'x-content-type-options': 'nosniff',
      })
      res.end(FILE_BYTES)
      return
    }
    if (req.url === '/api/engagements/eng-1/deliverables/report.html') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-disposition': 'attachment; filename="report.html"',
      })
      res.end(FILE_BYTES)
      return
    }
    res.writeHead(404)
    res.end()
  })
  const consolePort = await listen(consoleServer)
  const target: ConsoleTarget = { baseUrl: `http://127.0.0.1:${consolePort}`, token: TOKEN }
  frontServer = createServer((req, res) => {
    // The plugin strips the share prefix before proxying (index.ts);
    // this front server mirrors that one step.
    proxyToConsole(target, req, res, String(req.url).slice('/redteam-console'.length))
  })
  frontPort = await listen(frontServer)
})

after(async () => {
  await Promise.all([
    new Promise<void>((resolve) => { consoleServer.close(() => { resolve() }) }),
    new Promise<void>((resolve) => { frontServer.close(() => { resolve() }) }),
  ])
})

describe('deliverable route through the share proxy', () => {
  it('streams the exact bytes with the bearer attached and disposition intact', async () => {
    const route = deliverableFileRoute('eng-1', 'report.html')
    assert.equal(route, 'redteam-console/api/engagements/eng-1/deliverables/report.html')
    const { status, headers, body } = await new Promise<ObservedResponse>((resolve, reject) => {
      httpGet(`http://127.0.0.1:${frontPort}/${route}`, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => { chunks.push(chunk) })
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers as Record<string, unknown>, body: Buffer.concat(chunks) })
        })
      }).on('error', reject)
    })
    assert.equal(status, 200)
    assert.equal(headers['content-disposition'], 'attachment; filename="report.html"')
    assert.equal(createHash('sha256').update(body).digest('hex'), createHash('sha256').update(FILE_BYTES).digest('hex'))
    assert.equal(observedAuthorization, `Bearer ${TOKEN}`)
  })

  it('passes the display variant through: the query reaches upstream and the inline headers return verbatim (S6-H4b)', async () => {
    const route = deliverableDisplayRoute('eng-1', 'report.html')
    assert.equal(route, 'redteam-console/api/engagements/eng-1/deliverables/report.html?display=inline')
    const { status, headers, body } = await new Promise<ObservedResponse>((resolve, reject) => {
      httpGet(`http://127.0.0.1:${frontPort}/${route}`, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => { chunks.push(chunk) })
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers as Record<string, unknown>, body: Buffer.concat(chunks) })
        })
      }).on('error', reject)
    })
    assert.equal(status, 200)
    assert.equal(observedUrl, '/api/engagements/eng-1/deliverables/report.html?display=inline')
    assert.equal(headers['content-disposition'], 'inline; filename="report.html"')
    assert.equal(headers['content-security-policy'], DISPLAY_CSP)
    assert.equal(headers['x-content-type-options'], 'nosniff')
    assert.equal(createHash('sha256').update(body).digest('hex'), createHash('sha256').update(FILE_BYTES).digest('hex'))
    assert.equal(observedAuthorization, `Bearer ${TOKEN}`)
  })

  it('classifies the deliverable set: text formats copyable, binary download-only', () => {
    for (const file of ['report.html', 'report.md', 'report.json', 'report.txt', 'findings.csv'] as const) {
      assert.equal(isDeliverableFileName(file), true, file)
      assert.equal(isCopyableDeliverable(file), true, file)
    }
    for (const file of ['report.docx', 'report-package.zip'] as const) {
      assert.equal(isDeliverableFileName(file), true, file)
      assert.equal(isCopyableDeliverable(file), false, file)
    }
    assert.equal(isDeliverableFileName('state.json'), false)
  })
})
