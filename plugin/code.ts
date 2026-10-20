import type { Command, ExportPayload, Hello } from '../protocol.ts'
import { brief, runOps } from './ops.ts'
import { exportVariables } from './variables.ts'

type Incoming = (Command & { id: string }) | { kind: 'ready' }
type Script = (api: PluginAPI) => Promise<unknown>

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...parameters: string[]
) => Script

const canEval = (() => {
  try {
    return new Function('return 1')() === 1
  } catch {
    return false
  }
})()

const hello: Hello = {
  kind: 'hello',
  capabilities: { eval: canEval, ops: true },
  file: { name: figma.root.name, key: figma.fileKey ?? null },
}

function toJson(value: unknown): unknown {
  const text = JSON.stringify(value ?? null, (_key, item) => {
    if (item === figma.mixed) return 'mixed'
    if (item instanceof Uint8Array) return { bytes: item.length }
    if (
      item &&
      typeof item === 'object' &&
      typeof item.id === 'string' &&
      typeof item.type === 'string'
    ) {
      return 'parent' in item ? brief(item as BaseNode) : item
    }
    return item
  })
  return JSON.parse(text)
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`plugin timed out after ${timeoutMs} ms`)),
      timeoutMs,
    )
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

async function exportNode(command: Extract<Command, { kind: 'export' }>): Promise<ExportPayload> {
  const node = await figma.getNodeByIdAsync(command.nodeId)
  if (!node || !('exportAsync' in node))
    throw new Error(`node ${command.nodeId} cannot be exported`)
  const format = command.format ?? 'PNG'
  const scale = command.scale ?? 2
  const bytes =
    format === 'SVG'
      ? await node.exportAsync({ format: 'SVG' })
      : await node.exportAsync({ format, constraint: { type: 'SCALE', value: scale } })
  return { format, scale, name: node.name, base64: figma.base64Encode(bytes) }
}

function info() {
  return {
    ...hello.file,
    capabilities: hello.capabilities,
    pages: figma.root.children.map((page) => ({ id: page.id, name: page.name })),
    currentPage: { id: figma.currentPage.id, name: figma.currentPage.name },
    selection: figma.currentPage.selection.map(brief),
  }
}

function handle(command: Command): Promise<unknown> {
  switch (command.kind) {
    case 'info':
      return Promise.resolve(info())
    case 'exec':
      if (!canEval) throw new Error('dynamic evaluation is blocked in this sandbox; use kind "ops"')
      return new AsyncFunction('figma', command.script)(figma)
    case 'ops':
      return runOps(command.ops)
    case 'export':
      return exportNode(command)
    case 'vars':
      return exportVariables()
  }
}

figma.showUI(__html__, { width: 300, height: 128, themeColors: true })
figma.ui.postMessage(hello)

figma.ui.onmessage = async (message: Incoming) => {
  if (message.kind === 'ready') {
    figma.ui.postMessage(hello)
    return
  }
  const { id } = message
  try {
    const result = await withTimeout(
      Promise.resolve().then(() => handle(message)),
      message.timeoutMs ?? 60_000,
    )
    figma.ui.postMessage({ id, ok: true, result: toJson(result) })
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error))
    figma.ui.postMessage({ id, ok: false, error: failure.message, stack: failure.stack })
  }
}
