// Layer cleanup for one page, one step per exec (each under 60 s). args: { page, step, dry, samples }
// steps, in this order: hidden → empty → unwrap → names → wave → order (see AGENTS.md "Layers"). Run every step with dry first.
const page = await figma.getNodeByIdAsync(args.page)
await page.loadAsync()
const DRY = !!args.dry
const paints = p => Array.isArray(p) && p.some(x => x.visible !== false)
const near = (a, b) => Math.abs(a - b) < 0.6
const log = { count: 0, samples: [] }
const note = s => { log.count++; if (log.samples.length < (args.samples ?? 12)) log.samples.push(s) }
const all = []
const walk = n => { all.push(n); if ('children' in n && n.type !== 'INSTANCE') for (const c of n.children) walk(c) }
for (const c of page.children) walk(c)
const inFlow = n => { for (let a = n; a; a = a.parent) if (/^(Flow|Arrow|Backdrop)\//.test(a.name) || a.name === '흐름 지도') return true; return false }
const textOf = n => n.type === 'TEXT' ? n.characters.trim() : ('findOne' in n ? (n.findOne(t => t.type === 'TEXT' && t.visible && t.characters.trim())?.characters.trim() ?? '') : '')
const tail = s => s.split('/').pop()
const step = args.step

if (step === 'hidden') for (const n of all) if (!n.removed && n.visible === false && !n.componentPropertyReferences?.visible && !inFlow(n) && n.parent) {
  note(`${n.id} ${n.name} in ${n.parent.name}`); if (!DRY) n.remove()
}

if (step === 'empty') {
  for (const n of all.filter(n => !n.removed && n.type === 'TEXT' && !n.characters.trim())) {
    const p = n.parent
    note(`${n.id} empty text in ${p.name}`)
    if (DRY) continue
    if (p.layoutMode && p.layoutMode !== 'NONE') { const w = p.width, h = p.height; if (p.layoutSizingHorizontal === 'HUG') p.layoutSizingHorizontal = 'FIXED'; if (p.layoutSizingVertical === 'HUG') p.layoutSizingVertical = 'FIXED'; p.resize(w, h) }
    n.remove()
    if (p.name === 'Cell/' && p.children.length === 0) p.name = 'Cell/empty'
  }
  for (const n of all.filter(n => !n.removed && n.name === 'Title/Actions' && n.children.length === 0 && !paints(n.fills))) {
    const p = n.parent
    note(`${n.id} empty Title/Actions in ${p.name} h=${p.height}`)
    if (DRY) continue
    const w = p.width, h = p.height
    if (p.layoutSizingVertical === 'HUG') p.layoutSizingVertical = 'FIXED'
    if (p.layoutSizingHorizontal === 'HUG') p.layoutSizingHorizontal = 'FIXED'
    p.resize(w, h)
    n.remove()
  }
  for (const n of all.filter(n => !n.removed && n.name === 'Spacing')) { note(`${n.id} Spacing → Spacer`); if (!DRY) n.name = 'Spacer' }
}

if (step === 'names') for (const n of all) {
  if (n.removed || inFlow(n)) continue
  let to = null
  if (n.name === 'Cell/' || n.name === 'Cell/null') { const t = textOf(n); to = 'Cell/' + (t || (n.children?.[0] ? tail(n.children[0].name) : 'empty')) }
  else if (n.name === 'Button/') { const icon = n.findOne?.(c => c.name.startsWith('Icon/')); const t = textOf(n); to = 'Button/' + (t || (icon ? tail(icon.name) : 'icon')) }
  else if (/\/null$|\/undefined$/.test(n.name)) { const t = textOf(n); to = n.name.replace(/\/(null|undefined)$/, '/' + (t || (n.children?.[0] ? tail(n.children[0].name) : 'empty'))) }
  else if (/\/$/.test(n.name)) { const t = textOf(n); to = n.name + (t || (n.children?.[0] ? tail(n.children[0].name) : 'empty')) }
  if (to && to !== n.name) { to = to.slice(0, 60); note(`${n.id} "${n.name}" → "${to}"`); if (!DRY) n.name = to }
}

if (step === 'unwrap') {
  const kinds = {}
  for (const w of all) {
    if (w.removed || inFlow(w) || !(w.type === 'GROUP' || w.type === 'FRAME') || w.children.length !== 1) continue
    const p = w.parent
    if (!p || p.type === 'SECTION' || p.type === 'PAGE' || paints(w.fills) || paints(w.strokes) || w.effects?.length || w.reactions?.length || w.getSharedPluginDataKeys('bridge').length) continue
    const c = w.children[0]
    if (!(near(c.x, 0) && near(c.y, 0) && near(c.width, w.width) && near(c.height, w.height))) continue
    if (c.type === 'INSTANCE' || w.name.startsWith('Track/')) continue
    const kind = w.name.split('/')[0]
    kinds[kind] = (kinds[kind] ?? 0) + 1
    const keepName = /^(Cell)\//.test(w.name) ? w.name : c.name
    note(`${w.id} "${w.name}" > ${c.type} "${c.name}" → "${keepName}"`)
    if (DRY) continue
    const auto = p.layoutMode && p.layoutMode !== 'NONE'
    const s = { h: w.layoutSizingHorizontal, v: w.layoutSizingVertical, grow: w.layoutGrow, align: w.layoutAlign, pos: w.layoutPositioning, x: w.x, y: w.y, W: w.width, H: w.height, constraints: w.constraints }
    p.insertChild(p.children.indexOf(w), c)
    if (auto) {
      if (s.pos === 'ABSOLUTE') { c.layoutPositioning = 'ABSOLUTE'; c.x = s.x; c.y = s.y }
      const set = (axis, v) => {
        const key = axis === 'h' ? 'layoutSizingHorizontal' : 'layoutSizingVertical'
        if (v === 'FILL') c[key] = 'FILL'
        else if (v === 'FIXED') { c[key] = 'FIXED' }
        else if (v === 'HUG' && c[key] !== 'HUG') { c[key] = 'FIXED' }
      }
      set('h', s.h); set('v', s.v)
      if (c.width !== s.W || c.height !== s.H) { if (c.type === 'TEXT' && c.textAutoResize === 'WIDTH_AND_HEIGHT') {} else c.resize(s.W, s.H) }
    } else { c.x = s.x; c.y = s.y; if ('constraints' in c && s.constraints) c.constraints = s.constraints }
    c.name = keepName
    w.remove()
  }
  log.kinds = kinds
}

if (step === 'wave') for (const w of all.filter(n => !n.removed && 'children' in n && n.type !== 'INSTANCE' && n.children.length >= 10)) {
  const bars = w.children
  if (!bars.every(c => (c.type === 'FRAME' || c.type === 'RECTANGLE') && !('children' in c && c.children.length) && c.width <= 4 && c.name === bars[0].name)) continue
  note(`${w.id} "${w.name}" ${bars.length} × "${bars[0].name}"`)
  if (DRY) continue
  const fill = bars[0].fills
  const rects = bars.map(b => { const r = figma.createRectangle(); w.appendChild(r); r.x = b.x; r.y = b.y; r.resize(b.width, b.height); r.cornerRadius = b.cornerRadius || 0; r.fills = b.fills; return r })
  const v = figma.flatten(rects, w)
  for (const b of bars) b.remove()
  v.name = 'Waveform'
  log.bound = (log.bound ?? 0) + (v.fills?.[0]?.boundVariables?.color ? 1 : 0)
  if (!v.fills?.[0]?.boundVariables?.color) v.fills = fill
}

if (step === 'order') {
  const overlap = (a, b) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5
  for (const n of all) {
    if (n.removed || inFlow(n) || n.type === 'SECTION' || n.type === 'PAGE' || !('children' in n)) continue
    if (!(n.type === 'GROUP' || (n.type === 'FRAME' && n.layoutMode === 'NONE')) || n.children.length < 2) continue
    const k = [...n.children]
    let ov = false
    for (let i = 0; i < k.length && !ov; i++) for (let j = i + 1; j < k.length; j++) if (overlap(k[i], k[j])) { ov = true; break }
    if (ov) continue
    const reading = [...k].sort((a, b) => (Math.abs(a.y - b.y) < 8 ? a.x - b.x : a.y - b.y))
    const panel = [...k].reverse()
    if (panel.every((c, i) => c === reading[i])) continue
    note(`${n.id} ${n.type} "${n.name}"`)
    if (!DRY) for (const c of [...reading].reverse()) n.appendChild(c)
  }
}
return log
