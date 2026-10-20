import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'

const dir = `${homedir()}/Desktop/figma-bridge`
const ping = () => {
  try {
    return JSON.parse(execFileSync('node', [`${dir}/cli.ts`, 'ping'], { encoding: 'utf8' }))
  } catch {
    return { ok: false }
  }
}

let last = null
let down = 0
for (;;) {
  const p = ping()
  const state = !p.ok ? 'relay-down' : p.plugin ? `connected:${p.file?.name}` : 'plugin-down'
  if (state !== last) console.log(`${new Date().toISOString()} ${state}`)
  last = state
  down = state.startsWith('connected') ? 0 : down + 1
  if (state === 'plugin-down' && down >= 2 && down % 2 === 0) {
    try {
      execFileSync('osascript', [`${dir}/relaunch.applescript`])
      console.log(`${new Date().toISOString()} relaunch attempted`)
    } catch (e) {
      console.log(`${new Date().toISOString()} relaunch failed ${String(e.message).slice(0, 120)}`)
    }
  }
  await new Promise((r) => setTimeout(r, 30000))
}
