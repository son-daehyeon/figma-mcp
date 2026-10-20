import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'

const dir = import.meta.dirname
const dist = path.join(dir, 'dist')
mkdirSync(dist, { recursive: true })

await build({
  entryPoints: [path.join(dir, 'code.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2017',
  outfile: path.join(dist, 'code.js'),
  logLevel: 'warning',
})

const ui = await build({
  entryPoints: [path.join(dir, 'ui.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  logLevel: 'warning',
})

const template = readFileSync(path.join(dir, 'ui.html'), 'utf8')
writeFileSync(
  path.join(dist, 'ui.html'),
  template.replace('<!-- ui-script -->', `<script>${ui.outputFiles[0].text}</script>`),
)
console.log(`built ${path.relative(process.cwd(), dist)}`)
