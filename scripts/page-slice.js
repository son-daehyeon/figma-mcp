// Temporary page slice for whole-page PNG export. args: { page, pad } creates one and returns its id; { page, remove: id } deletes it.
const page = await figma.getNodeByIdAsync(args.page)
await page.loadAsync()
if (args.remove) { const s = await figma.getNodeByIdAsync(args.remove); s?.remove(); return 'removed' }
const kids = page.children.filter(n => n.type !== 'SLICE')
const x0 = Math.min(...kids.map(n => n.x)), y0 = Math.min(...kids.map(n => n.y))
const x1 = Math.max(...kids.map(n => n.x + n.width)), y1 = Math.max(...kids.map(n => n.y + n.height))
const s = figma.createSlice()
page.appendChild(s)
s.name = 'tmp-export'
s.x = Math.floor(x0) - (args.pad ?? 0); s.y = Math.floor(y0) - (args.pad ?? 0)
s.resize(Math.ceil(x1 - x0) + 2 * (args.pad ?? 0), Math.ceil(y1 - y0) + 2 * (args.pad ?? 0))
return { id: s.id, x: s.x, y: s.y, w: s.width, h: s.height }
