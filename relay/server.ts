import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { type WebSocket, WebSocketServer } from 'ws'
import {
  COMMAND_KINDS,
  type Command,
  DEFAULT_PORT,
  type ExportPayload,
  type Hello,
  type Reply,
} from '../protocol.ts'

const BRIDGE_DIR = path.resolve(import.meta.dirname, '..')
const MAX_BODY_BYTES = 10 * 1024 * 1024

export type RelayOptions = {
  port?: number
  tokenFile?: string
  outDir?: string
  defaultTimeoutMs?: number
  log?: (entry: Record<string, unknown>) => void
}

export type Relay = { port: number; token: string; close: () => Promise<void> }

const jsonLog = (entry: Record<string, unknown>) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }))

export function loadToken(file: string): string {
  if (existsSync(file)) return readFileSync(file, 'utf8').trim()
  const token = randomBytes(24).toString('hex')
  writeFileSync(file, `${token}\n`, { mode: 0o600 })
  return token
}

function sameToken(given: string | undefined, expected: string): boolean {
  if (!given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function pngSize(bytes: Buffer): { width: number; height: number } | null {
  const isPng = bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47
  return isPng ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : null
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        request.destroy()
      } else chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function respond(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

export async function startRelay(options: RelayOptions = {}): Promise<Relay> {
  const log = options.log ?? jsonLog
  const token = loadToken(options.tokenFile ?? path.join(BRIDGE_DIR, '.token'))
  const outDir = options.outDir ?? path.join(BRIDGE_DIR, '.out')
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 60_000
  const pending = new Map<string, (reply: Reply) => void>()
  let plugin: WebSocket | undefined
  let hello: Hello | undefined
  let queue: Promise<unknown> = Promise.resolve()
  let sequence = 0
  let port = options.port ?? DEFAULT_PORT

  const dispatch = (command: Command): Promise<Reply> => {
    const run = () =>
      new Promise<Reply>((resolve) => {
        const id = String(++sequence)
        const socket = plugin
        if (!socket) {
          resolve({ id, ok: false, error: 'figma plugin is not connected' })
          return
        }
        const timeoutMs = command.timeoutMs ?? defaultTimeoutMs
        const started = Date.now()
        const timer = setTimeout(() => {
          pending.delete(id)
          log({ level: 'warn', msg: 'command timed out', id, kind: command.kind, timeoutMs })
          resolve({ id, ok: false, error: `timed out after ${timeoutMs} ms` })
        }, timeoutMs)
        pending.set(id, (reply) => {
          clearTimeout(timer)
          pending.delete(id)
          log({
            level: 'info',
            msg: 'command done',
            id,
            kind: command.kind,
            ok: reply.ok,
            ms: Date.now() - started,
          })
          resolve(reply)
        })
        socket.send(JSON.stringify({ id, ...command }))
      })
    const result = queue.then(run, run)
    queue = result
    return result
  }

  const saveExport = (nodeId: string, payload: ExportPayload) => {
    mkdirSync(outDir, { recursive: true })
    const bytes = Buffer.from(payload.base64, 'base64')
    const extension = payload.format.toLowerCase()
    const file = path.join(
      outDir,
      `${nodeId.replace(/[^a-zA-Z0-9]+/g, '-')}-${payload.scale}x.${extension}`,
    )
    writeFileSync(file, bytes)
    return {
      path: file,
      name: payload.name,
      format: payload.format,
      scale: payload.scale,
      bytes: bytes.length,
      ...pngSize(bytes),
    }
  }

  const handleCommand = async (request: IncomingMessage, response: ServerResponse) => {
    let command: Command
    try {
      command = JSON.parse(await readBody(request))
    } catch (error) {
      respond(response, 400, { ok: false, error: `invalid request: ${(error as Error).message}` })
      return
    }
    if (!command || !COMMAND_KINDS.has(command.kind)) {
      respond(response, 400, { ok: false, error: `unknown kind: ${String(command?.kind)}` })
      return
    }
    const reply = await dispatch(command)
    if (command.kind === 'export' && reply.ok) {
      respond(response, 200, {
        ...reply,
        result: saveExport(command.nodeId, reply.result as ExportPayload),
      })
      return
    }
    respond(response, 200, reply)
  }

  const allowedHost = (host: string | undefined) =>
    host === `127.0.0.1:${port}` || host === `localhost:${port}`

  const server = createServer((request, response) => {
    if (!allowedHost(request.headers.host))
      return respond(response, 403, { ok: false, error: 'forbidden host' })
    if (!sameToken(request.headers['x-bridge-token'] as string | undefined, token)) {
      return respond(response, 401, { ok: false, error: 'invalid token' })
    }
    if (request.method === 'GET' && request.url === '/health') {
      return respond(response, 200, {
        ok: true,
        plugin: Boolean(plugin),
        capabilities: hello?.capabilities ?? null,
        file: hello?.file ?? null,
      })
    }
    if (request.method === 'POST' && request.url === '/command')
      return void handleCommand(request, response)
    respond(response, 404, { ok: false, error: 'not found' })
  })

  const sockets = new WebSocketServer({
    server,
    path: '/plugin',
    verifyClient: ({ origin, req }: { origin: string; req: IncomingMessage }) =>
      allowedHost(req.headers.host) && (!origin || origin === 'null'),
  })

  sockets.on('connection', (socket) => {
    plugin?.close(4000, 'replaced by a newer plugin connection')
    plugin = socket
    log({ level: 'info', msg: 'plugin connected' })
    socket.on('message', (data) => {
      let message: Hello | Reply
      try {
        message = JSON.parse(String(data))
      } catch {
        return
      }
      if ('kind' in message && message.kind === 'hello') {
        hello = message
        log({
          level: 'info',
          msg: 'plugin hello',
          file: message.file.name,
          capabilities: message.capabilities,
        })
        return
      }
      if ('id' in message) pending.get(message.id)?.(message)
    })
    socket.on('close', () => {
      if (plugin !== socket) return
      plugin = undefined
      hello = undefined
      log({ level: 'warn', msg: 'plugin disconnected' })
      for (const [id, settle] of pending)
        settle({ id, ok: false, error: 'figma plugin disconnected' })
    })
  })

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port

  return {
    port,
    token,
    close: () =>
      new Promise((resolve) => {
        for (const client of sockets.clients) client.terminate()
        sockets.close()
        server.close(() => resolve())
      }),
  }
}

if (import.meta.main) {
  const flag = process.argv.indexOf('--port')
  const port = Number(
    flag > -1 ? process.argv[flag + 1] : (process.env.FIGMA_BRIDGE_PORT ?? DEFAULT_PORT),
  )
  const relay = await startRelay({ port })
  jsonLog({
    level: 'info',
    msg: 'relay listening',
    url: `http://127.0.0.1:${relay.port}`,
    tokenFile: path.join(BRIDGE_DIR, '.token'),
  })
}
