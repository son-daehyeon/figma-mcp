"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));

  // plugin/ops.ts
  var CREATORS = {
    FRAME: () => figma.createFrame(),
    TEXT: () => figma.createText(),
    RECTANGLE: () => figma.createRectangle(),
    ELLIPSE: () => figma.createEllipse(),
    LINE: () => figma.createLine(),
    COMPONENT: () => figma.createComponent(),
    SECTION: () => figma.createSection()
  };
  async function find(id) {
    const node = await figma.getNodeByIdAsync(String(id));
    if (!node) throw new Error(`node ${String(id)} not found`);
    return node;
  }
  async function container(id) {
    const node = id ? await find(id) : figma.currentPage;
    if (!("children" in node) || node.type === "DOCUMENT") {
      throw new Error(`node ${String(id)} cannot hold scene nodes`);
    }
    if (node.type === "PAGE") await node.loadAsync();
    return node;
  }
  var brief = (node) => ({ id: node.id, name: node.name, type: node.type });
  function describe(node, depth) {
    const box = "x" in node ? { x: node.x, y: node.y, width: node.width, height: node.height } : {};
    const children = depth > 0 && "children" in node ? node.children.map((child) => describe(child, depth - 1)) : void 0;
    return __spreadProps(__spreadValues(__spreadValues({}, brief(node)), box), { children });
  }
  async function setText(node, characters) {
    if (node.type !== "TEXT") throw new Error(`node ${node.id} is not a text node`);
    const fonts = node.characters.length > 0 ? node.getRangeAllFontNames(0, node.characters.length) : [node.fontName];
    await Promise.all(fonts.map((font) => figma.loadFontAsync(font)));
    node.characters = String(characters);
  }
  async function assign(node, props) {
    for (const [key, value] of Object.entries(props != null ? props : {})) {
      if (key === "characters") await setText(node, value);
      else node[key] = value;
    }
  }
  async function run(op) {
    var _a2, _b, _c, _d, _e;
    switch (op.op) {
      case "tree":
        return describe(op.id ? await find(op.id) : figma.currentPage, Number((_a2 = op.depth) != null ? _a2 : 2));
      case "find": {
        const root = await container(op.rootId);
        const matches = root.findAll(
          (node) => (!op.name || node.name === op.name) && (!op.type || node.type === op.type)
        );
        return matches.slice(0, Number((_b = op.limit) != null ? _b : 100)).map(brief);
      }
      case "get": {
        const node = await find(op.id);
        return Object.fromEntries(op.props.map((key) => [key, node[key]]));
      }
      case "set": {
        const node = await find(op.id);
        await assign(node, op.props);
        return brief(node);
      }
      case "create": {
        const create = CREATORS[String(op.type)];
        if (!create) throw new Error(`cannot create ${String(op.type)}`);
        const node = create();
        if (node.type === "TEXT") await figma.loadFontAsync(node.fontName);
        (await container(op.parentId)).appendChild(node);
        await assign(node, op.props);
        return brief(node);
      }
      case "instance": {
        const component = await find(op.componentId);
        if (component.type !== "COMPONENT") throw new Error(`node ${component.id} is not a component`);
        const instance = component.createInstance();
        (await container(op.parentId)).appendChild(instance);
        await assign(instance, op.props);
        return brief(instance);
      }
      case "clone": {
        const node = await find(op.id);
        if (!("clone" in node)) throw new Error(`node ${node.id} cannot be cloned`);
        const copy = node.clone();
        if (op.parentId) (await container(op.parentId)).appendChild(copy);
        return brief(copy);
      }
      case "move": {
        const node = await find(op.id);
        const parent = await container(op.parentId);
        parent.insertChild(Number((_c = op.index) != null ? _c : parent.children.length), node);
        return brief(node);
      }
      case "resize": {
        const node = await find(op.id);
        if (!("resize" in node)) throw new Error(`node ${node.id} cannot be resized`);
        node.resize(Number(op.width), Number(op.height));
        return brief(node);
      }
      case "delete": {
        const node = await find(op.id);
        node.remove();
        return { id: node.id, removed: true };
      }
      case "setText": {
        const node = await find(op.id);
        await setText(node, op.characters);
        return brief(node);
      }
      case "bindVariable": {
        const node = await find(op.id);
        const variable = await figma.variables.getVariableByIdAsync(String(op.variableId));
        if (!variable) throw new Error(`variable ${String(op.variableId)} not found`);
        if (op.field === "fills" || op.field === "strokes") {
          const field = op.field;
          const paints = [...(_d = node[field]) != null ? _d : []];
          const index = Number((_e = op.index) != null ? _e : 0);
          paints[index] = figma.variables.setBoundVariableForPaint(
            paints[index],
            "color",
            variable
          );
          node[field] = paints;
        } else {
          node.setBoundVariable(op.field, variable);
        }
        return brief(node);
      }
      case "setMode": {
        const node = await find(op.id);
        const collection = await figma.variables.getVariableCollectionByIdAsync(
          String(op.collectionId)
        );
        if (!collection) throw new Error(`collection ${String(op.collectionId)} not found`);
        node.setExplicitVariableModeForCollection(collection, String(op.modeId));
        return brief(node);
      }
      default:
        throw new Error(`unknown op ${op.op}`);
    }
  }
  async function runOps(ops) {
    const results = [];
    for (const op of ops) results.push(await run(op));
    return results;
  }

  // plugin/variables.ts
  var TOKEN_TYPES = {
    COLOR: "color",
    FLOAT: "number",
    STRING: "string",
    BOOLEAN: "boolean"
  };
  var channel = (value) => Math.round(value * 255).toString(16).padStart(2, "0");
  function toValue(value, names) {
    if (typeof value !== "object") return value;
    if ("type" in value && value.type === "VARIABLE_ALIAS") {
      const name = names.get(value.id);
      return name ? `{${name.split("/").join(".")}}` : { alias: value.id };
    }
    if ("r" in value) {
      const alpha = "a" in value && value.a < 1 ? channel(value.a) : "";
      return `#${channel(value.r)}${channel(value.g)}${channel(value.b)}${alpha}`;
    }
    return value;
  }
  async function exportVariables() {
    var _a2, _b;
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const variables = await figma.variables.getLocalVariablesAsync();
    const byId = new Map(variables.map((variable) => [variable.id, variable]));
    const names = new Map(variables.map((variable) => [variable.id, variable.name]));
    const result = {};
    for (const collection of collections) {
      const tree = { $modes: collection.modes.map((mode) => mode.name) };
      for (const id of collection.variableIds) {
        const variable = byId.get(id);
        if (!variable) continue;
        const segments = variable.name.split("/");
        let group = tree;
        for (const segment of segments.slice(0, -1)) {
          (_a2 = group[segment]) != null ? _a2 : group[segment] = {};
          group = group[segment];
        }
        group[segments[segments.length - 1]] = {
          $type: (_b = TOKEN_TYPES[variable.resolvedType]) != null ? _b : variable.resolvedType.toLowerCase(),
          $value: Object.fromEntries(
            collection.modes.map((mode) => [
              mode.name,
              toValue(variable.valuesByMode[mode.modeId], names)
            ])
          )
        };
      }
      result[collection.name] = tree;
    }
    return result;
  }

  // plugin/code.ts
  var AsyncFunction = Object.getPrototypeOf(async () => {
  }).constructor;
  var canEval = (() => {
    try {
      return new Function("return 1")() === 1;
    } catch (e) {
      return false;
    }
  })();
  var _a;
  var hello = {
    kind: "hello",
    capabilities: { eval: canEval, ops: true },
    file: { name: figma.root.name, key: (_a = figma.fileKey) != null ? _a : null }
  };
  function toJson(value) {
    const text = JSON.stringify(value != null ? value : null, (_key, item) => {
      if (item === figma.mixed) return "mixed";
      if (item instanceof Uint8Array) return { bytes: item.length };
      if (item && typeof item === "object" && typeof item.id === "string" && typeof item.type === "string") {
        return "parent" in item ? brief(item) : item;
      }
      return item;
    });
    return JSON.parse(text);
  }
  function withTimeout(work, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`plugin timed out after ${timeoutMs} ms`)),
        timeoutMs
      );
      work.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }
  async function exportNode(command) {
    var _a2, _b;
    const node = await figma.getNodeByIdAsync(command.nodeId);
    if (!node || !("exportAsync" in node))
      throw new Error(`node ${command.nodeId} cannot be exported`);
    const format = (_a2 = command.format) != null ? _a2 : "PNG";
    const scale = (_b = command.scale) != null ? _b : 2;
    const bytes = format === "SVG" ? await node.exportAsync({ format: "SVG" }) : await node.exportAsync({ format, constraint: { type: "SCALE", value: scale } });
    return { format, scale, name: node.name, base64: figma.base64Encode(bytes) };
  }
  function info() {
    return __spreadProps(__spreadValues({}, hello.file), {
      capabilities: hello.capabilities,
      pages: figma.root.children.map((page) => ({ id: page.id, name: page.name })),
      currentPage: { id: figma.currentPage.id, name: figma.currentPage.name },
      selection: figma.currentPage.selection.map(brief)
    });
  }
  function handle(command) {
    switch (command.kind) {
      case "info":
        return Promise.resolve(info());
      case "exec":
        if (!canEval) throw new Error('dynamic evaluation is blocked in this sandbox; use kind "ops"');
        return new AsyncFunction("figma", command.script)(figma);
      case "ops":
        return runOps(command.ops);
      case "export":
        return exportNode(command);
      case "vars":
        return exportVariables();
    }
  }
  figma.showUI(__html__, { width: 300, height: 128, themeColors: true });
  figma.ui.postMessage(hello);
  figma.ui.onmessage = async (message) => {
    var _a2;
    if (message.kind === "ready") {
      figma.ui.postMessage(hello);
      return;
    }
    const { id } = message;
    try {
      const result = await withTimeout(
        Promise.resolve().then(() => handle(message)),
        (_a2 = message.timeoutMs) != null ? _a2 : 6e4
      );
      figma.ui.postMessage({ id, ok: true, result: toJson(result) });
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      figma.ui.postMessage({ id, ok: false, error: failure.message, stack: failure.stack });
    }
  };
})();
