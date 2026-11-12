// A small JSON Schema validator: the part of draft 2020-12 that the chart's schema uses (local "$ref" to "#/$defs/...",
// type, const, enum, string / number / array / object limits, required, properties, additionalProperties: false,
// items, if / then / else). It reports where and why a value is wrong; the caller words the messages.

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const TYPE_TESTS = {
  string: (value) => typeof value === 'string',
  number: (value) => typeof value === 'number' && Number.isFinite(value),
  integer: (value) => Number.isInteger(value),
  boolean: (value) => typeof value === 'boolean',
  null: (value) => value === null,
  array: (value) => Array.isArray(value),
  object: isObject,
};

const typeName = (value) => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'number' && Number.isInteger(value) ? 'integer' : typeof value);

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) throw new Error(`unsupported $ref ${ref}`);
  let node = root;
  for (const part of ref.slice(2).split('/')) node = node?.[part.replaceAll('~1', '/').replaceAll('~0', '~')];
  if (node === undefined) throw new Error(`unresolved $ref ${ref}`);
  return node;
}

/**
 * Validates `value` against `schema`. Returns a list of { path, owner, keyword, params }:
 * path is like "tasks[3].children[0].duration", owner the id of the nearest enclosing object that has one.
 * `formats` maps a format name to a function that tells whether a string is valid.
 */
export function validate(schema, value, { formats = {}, maxErrors = 20 } = {}) {
  const errors = [];
  const full = () => errors.length >= maxErrors;

  const check = (node, data, path, owner, out) => {
    if (out.length >= maxErrors) return;
    const fail = (keyword, params = {}) => out.push({ path, owner, keyword, params });
    if (node.$ref !== undefined) check(resolveRef(schema, node.$ref), data, path, owner, out);
    if (node.type !== undefined) {
      const types = [].concat(node.type);
      if (!types.some((type) => TYPE_TESTS[type](data))) return fail('type', { expected: types.join(' | '), actual: typeName(data) });
    }
    if ('const' in node && data !== node.const) fail('const', { value: JSON.stringify(node.const) });
    if (node.enum && !node.enum.includes(data)) fail('enum', { values: node.enum.join(', ') });
    if (typeof data === 'string') {
      if (node.minLength !== undefined && data.length < node.minLength) fail('minLength', { limit: node.minLength });
      if (node.maxLength !== undefined && data.length > node.maxLength) fail('maxLength', { limit: node.maxLength });
      if (node.pattern !== undefined && !new RegExp(node.pattern).test(data)) fail('pattern', { pattern: node.pattern });
      if (node.format !== undefined && formats[node.format] && !formats[node.format](data)) fail('format', { format: node.format });
    }
    if (typeof data === 'number') {
      if (node.minimum !== undefined && data < node.minimum) fail('minimum', { limit: node.minimum });
      if (node.maximum !== undefined && data > node.maximum) fail('maximum', { limit: node.maximum });
    }
    if (Array.isArray(data)) {
      if (node.minItems !== undefined && data.length < node.minItems) fail('minItems', { limit: node.minItems });
      if (node.maxItems !== undefined && data.length > node.maxItems) fail('maxItems', { limit: node.maxItems });
      if (node.uniqueItems && new Set(data.map((item) => JSON.stringify(item))).size !== data.length) fail('uniqueItems');
      if (node.items) data.forEach((item, i) => check(node.items, item, `${path}[${i}]`, owner, out));
    }
    if (isObject(data)) {
      const here = typeof data.id === 'string' ? data.id : owner;
      for (const key of node.required ?? []) if (!(key in data)) out.push({ path, owner: here, keyword: 'required', params: { property: key } });
      const known = node.properties ?? {};
      for (const [key, item] of Object.entries(data)) {
        const where = path ? `${path}.${key}` : key;
        if (key in known) check(known[key], item, where, here, out);
        else if (node.additionalProperties === false) out.push({ path: where, owner: here, keyword: 'additionalProperties', params: { property: key } });
      }
    }
    if (node.if !== undefined) {
      const trial = [];
      check(node.if, data, path, owner, trial);
      const branch = trial.length === 0 ? node.then : node.else;
      if (branch) check(branch, data, path, owner, out);
    }
  };

  check(schema, value, '', null, errors);
  return { errors, truncated: full() };
}
