import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'
import type { Command, Reply } from '../protocol.ts'
import { type Relay, startRelay } from './server.ts'

type Incoming = Command & { id: string }
type Handler = (command: Incoming) => Omit<Reply, 'id'> | Promise<Omit<Reply, 'id'>> | null

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

async function relay(): Promise<Relay & { outDir: string }> {
  const dir = mkdtempSync(path.join(tmpdir(), 'figma-bridge-'))
  const outDir = path.join(dir, 'out')
  const started = await startRelay({
    port: 0,
    tokenFile: path.join(dir, 'token'),
    outDir,
    log: () => {},
  })
  cleanups.push(started.close)
  return { ...started, outDir }
}

async function fakePlugin(target: Relay, handler: Handler): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${target.port}/plugin`)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })
  socket.send(
    JSON.stringify({
      kind: 'hello',
      capabilities: { eval: true, ops: true },
      file: { name: 'Fake', key: null },
    }),
  )
  socket.onmessage = async (event) => {
    const command: Incoming = JSON.parse(String(event.data))
    const reply = await handler(command)
    if (reply) socket.send(JSON.stringify({ id: command.id, ...reply }))
  }
  cleanups.push(() => socket.close())
  return socket
}

async function call(target: Relay, command: Command, token = target.token) {
  const response = await fetch(`http://127.0.0.1:${target.port}/command`, {
    method: 'POST',
    headers: { 'x-bridge-token': token },
    body: JSON.stringify(command),
  })
  return { status: response.status, body: await response.json() }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

test('exec returns the plugin result', async () => {
  const target = await relay()
  await fakePlugin(target, (command) => ({ ok: true, result: command.kind === 'exec' ? 42 : null }))
  await settle()
  const { status, body } = await call(target, { kind: 'exec', script: 'return 42' })
  assert.equal(status, 200)
  assert.deepEqual({ ok: body.ok, result: body.result }, { ok: true, result: 42 })
})

test('exec errors come back as ok false', async () => {
  const target = await relay()
  await fakePlugin(target, () => ({ ok: false, error: 'boom' }))
  await settle()
  const { body } = await call(target, { kind: 'exec', script: 'throw new Error("boom")' })
  assert.equal(body.ok, false)
  assert.equal(body.error, 'boom')
})

test('a command without a reply times out', async () => {
  const target = await relay()
  await fakePlugin(target, () => null)
  await settle()
  const { body } = await call(target, { kind: 'info', timeoutMs: 100 })
  assert.equal(body.ok, false)
  assert.match(body.error, /timed out/)
})

test('export writes the image and reports its size', async () => {
  const target = await relay()
  const png = Buffer.alloc(33)
  png.writeUInt32BE(0x89504e47, 0)
  png.writeUInt32BE(640, 16)
  png.writeUInt32BE(318, 20)
  await fakePlugin(target, () => ({
    ok: true,
    result: { format: 'PNG', scale: 2, name: 'Matrix', base64: png.toString('base64') },
  }))
  await settle()
  const { body } = await call(target, { kind: 'export', nodeId: '1:23', scale: 2 })
  assert.equal(body.ok, true)
  assert.equal(body.result.path, path.join(target.outDir, '1-23-2x.png'))
  assert.deepEqual([body.result.width, body.result.height], [640, 318])
  assert.ok(existsSync(body.result.path))
  assert.deepEqual(readFileSync(body.result.path), png)
})

test('a wrong token is rejected', async () => {
  const target = await relay()
  const { status } = await call(target, { kind: 'info' }, 'nope')
  assert.equal(status, 401)
})

test('commands run one at a time in order', async () => {
  const target = await relay()
  const events: string[] = []
  await fakePlugin(target, async (command) => {
    const label = command.kind === 'exec' ? command.script : command.kind
    events.push(`start ${label}`)
    if (label === 'first') await new Promise((resolve) => setTimeout(resolve, 100))
    events.push(`end ${label}`)
    return { ok: true, result: label }
  })
  await settle()
  const [first, second] = await Promise.all([
    call(target, { kind: 'exec', script: 'first' }),
    call(target, { kind: 'exec', script: 'second' }),
  ])
  assert.deepEqual([first.body.result, second.body.result], ['first', 'second'])
  assert.deepEqual(events, ['start first', 'end first', 'start second', 'end second'])
})

test('commands fail fast when no plugin is connected', async () => {
  const target = await relay()
  const { body } = await call(target, { kind: 'info' })
  assert.equal(body.ok, false)
  assert.match(body.error, /not connected/)
})
