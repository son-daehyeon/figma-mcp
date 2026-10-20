import { DEFAULT_PORT, type Hello } from '../protocol.ts'

const RELAY_URL = `ws://localhost:${DEFAULT_PORT}/plugin`
const element = (id: string) => document.getElementById(id) as HTMLElement

let socket: WebSocket | undefined
let hello: Hello | undefined
let retryMs = 500

function show(state: 'connected' | 'reconnecting') {
  element('dot').dataset.state = state
  element('state').textContent =
    state === 'connected' ? 'Connected to relay' : 'Relay offline — retrying'
  if (hello) {
    element('file').textContent = `File: ${hello.file.name}`
    element('mode').textContent = hello.capabilities.eval ? 'Mode: exec + ops' : 'Mode: ops only'
  }
}

function forward(message: unknown) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}

function connect() {
  socket = new WebSocket(RELAY_URL)
  socket.onopen = () => {
    retryMs = 500
    show('connected')
    parent.postMessage({ pluginMessage: { kind: 'ready' } }, '*')
  }
  socket.onmessage = (event) => {
    const command = JSON.parse(String(event.data))
    element('last').textContent = `Last: ${command.kind} #${command.id}`
    parent.postMessage({ pluginMessage: command }, '*')
  }
  socket.onclose = () => {
    show('reconnecting')
    setTimeout(connect, retryMs)
    retryMs = Math.min(retryMs * 2, 10_000)
  }
}

window.onmessage = (event: MessageEvent) => {
  const message = event.data?.pluginMessage
  if (!message) return
  if (message.kind === 'hello') {
    hello = message
    show(socket?.readyState === WebSocket.OPEN ? 'connected' : 'reconnecting')
  }
  forward(message)
}

connect()
