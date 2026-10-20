import type { Op } from '../protocol.ts'

type Writable = Record<string, unknown>

const CREATORS: Record<string, () => SceneNode> = {
  FRAME: () => figma.createFrame(),
  TEXT: () => figma.createText(),
  RECTANGLE: () => figma.createRectangle(),
  ELLIPSE: () => figma.createEllipse(),
  LINE: () => figma.createLine(),
  COMPONENT: () => figma.createComponent(),
  SECTION: () => figma.createSection(),
}

async function find(id: unknown): Promise<BaseNode> {
  const node = await figma.getNodeByIdAsync(String(id))
  if (!node) throw new Error(`node ${String(id)} not found`)
  return node
}

async function container(id: unknown): Promise<BaseNode & ChildrenMixin> {
  const node = id ? await find(id) : figma.currentPage
  if (!('children' in node) || node.type === 'DOCUMENT') {
    throw new Error(`node ${String(id)} cannot hold scene nodes`)
  }
  if (node.type === 'PAGE') await node.loadAsync()
  return node as BaseNode & ChildrenMixin
}

export const brief = (node: BaseNode) => ({ id: node.id, name: node.name, type: node.type })

function describe(node: BaseNode, depth: number): Record<string, unknown> {
  const box =
    'x' in node
      ? { x: node.x, y: node.y, width: node.width, height: node.height }
      : ({} as Record<string, number>)
  const children =
    depth > 0 && 'children' in node
      ? node.children.map((child) => describe(child, depth - 1))
      : undefined
  return { ...brief(node), ...box, children }
}

async function setText(node: BaseNode, characters: unknown) {
  if (node.type !== 'TEXT') throw new Error(`node ${node.id} is not a text node`)
  const fonts =
    node.characters.length > 0
      ? node.getRangeAllFontNames(0, node.characters.length)
      : [node.fontName as FontName]
  await Promise.all(fonts.map((font) => figma.loadFontAsync(font)))
  node.characters = String(characters)
}

async function assign(node: BaseNode, props: unknown) {
  for (const [key, value] of Object.entries((props ?? {}) as Writable)) {
    if (key === 'characters') await setText(node, value)
    else (node as unknown as Writable)[key] = value
  }
}

async function run(op: Op): Promise<unknown> {
  switch (op.op) {
    case 'tree':
      return describe(op.id ? await find(op.id) : figma.currentPage, Number(op.depth ?? 2))
    case 'find': {
      const root = await container(op.rootId)
      const matches = root.findAll(
        (node) => (!op.name || node.name === op.name) && (!op.type || node.type === op.type),
      )
      return matches.slice(0, Number(op.limit ?? 100)).map(brief)
    }
    case 'get': {
      const node = (await find(op.id)) as unknown as Writable
      return Object.fromEntries((op.props as string[]).map((key) => [key, node[key]]))
    }
    case 'set': {
      const node = await find(op.id)
      await assign(node, op.props)
      return brief(node)
    }
    case 'create': {
      const create = CREATORS[String(op.type)]
      if (!create) throw new Error(`cannot create ${String(op.type)}`)
      const node = create()
      if (node.type === 'TEXT') await figma.loadFontAsync(node.fontName as FontName)
      ;(await container(op.parentId)).appendChild(node)
      await assign(node, op.props)
      return brief(node)
    }
    case 'instance': {
      const component = await find(op.componentId)
      if (component.type !== 'COMPONENT') throw new Error(`node ${component.id} is not a component`)
      const instance = component.createInstance()
      ;(await container(op.parentId)).appendChild(instance)
      await assign(instance, op.props)
      return brief(instance)
    }
    case 'clone': {
      const node = await find(op.id)
      if (!('clone' in node)) throw new Error(`node ${node.id} cannot be cloned`)
      const copy = node.clone() as SceneNode
      if (op.parentId) (await container(op.parentId)).appendChild(copy)
      return brief(copy)
    }
    case 'move': {
      const node = (await find(op.id)) as SceneNode
      const parent = await container(op.parentId)
      parent.insertChild(Number(op.index ?? parent.children.length), node)
      return brief(node)
    }
    case 'resize': {
      const node = await find(op.id)
      if (!('resize' in node)) throw new Error(`node ${node.id} cannot be resized`)
      node.resize(Number(op.width), Number(op.height))
      return brief(node)
    }
    case 'delete': {
      const node = await find(op.id)
      node.remove()
      return { id: node.id, removed: true }
    }
    case 'setText': {
      const node = await find(op.id)
      await setText(node, op.characters)
      return brief(node)
    }
    case 'bindVariable': {
      const node = (await find(op.id)) as SceneNode
      const variable = await figma.variables.getVariableByIdAsync(String(op.variableId))
      if (!variable) throw new Error(`variable ${String(op.variableId)} not found`)
      if (op.field === 'fills' || op.field === 'strokes') {
        const field = op.field
        const paints = [...((node as unknown as Record<typeof field, Paint[]>)[field] ?? [])]
        const index = Number(op.index ?? 0)
        paints[index] = figma.variables.setBoundVariableForPaint(
          paints[index] as SolidPaint,
          'color',
          variable,
        )
        ;(node as unknown as Writable)[field] = paints
      } else {
        node.setBoundVariable(op.field as VariableBindableNodeField, variable)
      }
      return brief(node)
    }
    case 'setMode': {
      const node = (await find(op.id)) as SceneNode
      const collection = await figma.variables.getVariableCollectionByIdAsync(
        String(op.collectionId),
      )
      if (!collection) throw new Error(`collection ${String(op.collectionId)} not found`)
      node.setExplicitVariableModeForCollection(collection, String(op.modeId))
      return brief(node)
    }
    default:
      throw new Error(`unknown op ${op.op}`)
  }
}

export async function runOps(ops: Op[]): Promise<unknown[]> {
  const results: unknown[] = []
  for (const op of ops) results.push(await run(op))
  return results
}
