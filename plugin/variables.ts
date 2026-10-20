type Token = { $type: string; $value: Record<string, unknown> }
type Group = { [key: string]: Group | Token | string[] }

const TOKEN_TYPES: Partial<Record<VariableResolvedDataType, string>> = {
  COLOR: 'color',
  FLOAT: 'number',
  STRING: 'string',
  BOOLEAN: 'boolean',
}

const channel = (value: number) =>
  Math.round(value * 255)
    .toString(16)
    .padStart(2, '0')

function toValue(value: VariableValue, names: Map<string, string>): unknown {
  if (typeof value !== 'object') return value
  if ('type' in value && value.type === 'VARIABLE_ALIAS') {
    const name = names.get(value.id)
    return name ? `{${name.split('/').join('.')}}` : { alias: value.id }
  }
  if ('r' in value) {
    const alpha = 'a' in value && value.a < 1 ? channel(value.a) : ''
    return `#${channel(value.r)}${channel(value.g)}${channel(value.b)}${alpha}`
  }
  return value
}

export async function exportVariables(): Promise<Record<string, Group>> {
  const collections = await figma.variables.getLocalVariableCollectionsAsync()
  const variables = await figma.variables.getLocalVariablesAsync()
  const byId = new Map(variables.map((variable) => [variable.id, variable]))
  const names = new Map(variables.map((variable) => [variable.id, variable.name]))
  const result: Record<string, Group> = {}
  for (const collection of collections) {
    const tree: Group = { $modes: collection.modes.map((mode) => mode.name) }
    for (const id of collection.variableIds) {
      const variable = byId.get(id)
      if (!variable) continue
      const segments = variable.name.split('/')
      let group = tree
      for (const segment of segments.slice(0, -1)) {
        group[segment] ??= {}
        group = group[segment] as Group
      }
      group[segments[segments.length - 1]] = {
        $type: TOKEN_TYPES[variable.resolvedType] ?? variable.resolvedType.toLowerCase(),
        $value: Object.fromEntries(
          collection.modes.map((mode) => [
            mode.name,
            toValue(variable.valuesByMode[mode.modeId], names),
          ]),
        ),
      }
    }
    result[collection.name] = tree
  }
  return result
}
