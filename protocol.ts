export const DEFAULT_PORT = 3056

export type ExportFormat = 'PNG' | 'JPG' | 'SVG'

export type Op = { op: string; [key: string]: unknown }

export type Command =
  | { kind: 'info'; timeoutMs?: number }
  | { kind: 'exec'; script: string; timeoutMs?: number }
  | { kind: 'ops'; ops: Op[]; timeoutMs?: number }
  | { kind: 'export'; nodeId: string; scale?: number; format?: ExportFormat; timeoutMs?: number }
  | { kind: 'vars'; timeoutMs?: number }

export const COMMAND_KINDS: ReadonlySet<string> = new Set(['info', 'exec', 'ops', 'export', 'vars'])

export type Reply =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string; stack?: string }

export type Capabilities = { eval: boolean; ops: true }

export type Hello = {
  kind: 'hello'
  capabilities: Capabilities
  file: { name: string; key: string | null }
}

export type ExportPayload = { format: ExportFormat; scale: number; name: string; base64: string }
