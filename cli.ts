import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { type Command, DEFAULT_PORT, type ExportFormat } from './protocol.ts'

const USAGE = `usage: node cli.ts <command> [options]
  ping                              relay and plugin status
  info                              file, pages, current page, selection
  exec <file.js> | exec -e "<code>" run Plugin API code (async body, \`figma\` in scope, return JSON)
  ops <file.json>                   run fallback operations (when exec is not allowed)
  export <nodeId> [--scale 2] [--format PNG|JPG|SVG]
  vars [--out tokens.json]          export local variables with every mode
options: --timeout <ms>  --port <port>`

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    eval: { type: 'string', short: 'e' },
    scale: { type: 'string' },
    format: { type: 'string' },
    timeout: { type: 'string' },
    out: { type: 'string' },
    args: { type: 'string' },
    port: { type: 'string' },
  },
})

const [name, argument] = positionals
const port = Number(values.port ?? process.env.FIGMA_BRIDGE_PORT ?? DEFAULT_PORT)
const tokenFile = path.join(import.meta.dirname, '.token')
const timeoutMs = values.timeout ? Number(values.timeout) : undefined

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function command(): Command | 'ping' {
  switch (name) {
    case 'ping':
      return 'ping'
    case 'info':
    case 'vars':
      return { kind: name, timeoutMs }
    case 'exec': {
      const script = values.eval ?? (argument ? readFileSync(argument, 'utf8') : undefined)
      if (!script) return fail(USAGE)
      const args = values.args === undefined ? '' : `const args = ${JSON.stringify(JSON.parse(values.args))};\n`
      return { kind: 'exec', script: args + script, timeoutMs }
    }
    case 'ops':
      return argument
        ? { kind: 'ops', ops: JSON.parse(readFileSync(argument, 'utf8')), timeoutMs }
        : fail(USAGE)
    case 'export':
      return argument
        ? {
            kind: 'export',
            nodeId: argument,
            scale: Number(values.scale ?? 2),
            format: (values.format ?? 'PNG') as ExportFormat,
            timeoutMs,
          }
        : fail(USAGE)
    default:
      return fail(USAGE)
  }
}

const request = command()
if (!existsSync(tokenFile))
  fail('no .token yet: start the relay first with `pnpm --dir ~/Desktop/figma-bridge relay`')
const headers = { 'x-bridge-token': readFileSync(tokenFile, 'utf8').trim() }
const base = `http://127.0.0.1:${port}`

const response = await fetch(
  request === 'ping' ? `${base}/health` : `${base}/command`,
  request === 'ping' ? { headers } : { method: 'POST', headers, body: JSON.stringify(request) },
).catch(() => fail(`relay is not running on ${base}`))

const body = await response.json()
if (request !== 'ping' && request.kind === 'vars' && values.out && body.ok) {
  writeFileSync(values.out, `${JSON.stringify(body.result, null, 2)}\n`)
  console.log(JSON.stringify({ ok: true, result: { path: path.resolve(values.out) } }, null, 2))
} else {
  console.log(JSON.stringify(body, null, 2))
}
process.exitCode = body.ok ? 0 : 1
