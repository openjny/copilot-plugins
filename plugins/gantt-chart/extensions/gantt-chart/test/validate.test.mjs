import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validate } from '../lib/validate.mjs';

const schema = {
  type: 'object',
  required: ['kind'],
  additionalProperties: false,
  properties: {
    kind: { enum: ['a', 'b'] },
    n: { $ref: '#/$defs/count', description: 'siblings of $ref are kept' },
    list: { type: 'array', minItems: 1, maxItems: 2, uniqueItems: true, items: { type: 'string', pattern: '^x' } },
    id: { type: 'string' },
    inner: { type: 'object', required: ['v'], properties: { v: { type: 'integer' } } },
  },
  if: { required: ['n'] },
  then: { required: ['list'] },
  else: { not_supported_keyword_is_ignored: true },
  $defs: { count: { type: 'integer', minimum: 1, maximum: 3 } },
};
const errorsOf = (value) => validate(schema, value).errors.map((error) => `${error.path || '.'}:${error.keyword}`);

test('a valid value has no errors', () => {
  assert.deepEqual(errorsOf({ kind: 'a', n: 2, list: ['x1'] }), []);
});

test('errors say where and why', () => {
  assert.deepEqual(errorsOf({}), ['.:required']);
  assert.deepEqual(errorsOf({ kind: 'c', extra: 1 }), ['kind:enum', 'extra:additionalProperties']);
  assert.deepEqual(errorsOf({ kind: 'a', n: 4.5, list: ['x', 'x'] }), ['n:type', 'list:uniqueItems']);
  assert.deepEqual(errorsOf({ kind: 'a', n: 9, list: ['y'] }), ['n:maximum', 'list[0]:pattern']);
  assert.deepEqual(errorsOf({ kind: 'a', list: [] }), ['list:minItems']);
  assert.deepEqual(errorsOf({ kind: 'a', inner: { v: 'no' } }), ['inner.v:type']);
});

test('if / then applies the branch only when the condition holds', () => {
  assert.deepEqual(errorsOf({ kind: 'a', n: 1 }), ['.:required']);
  assert.deepEqual(errorsOf({ kind: 'a' }), []);
});

test('the nearest object with an id is named as the owner', () => {
  const nested = { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, v: { type: 'integer' } } } } } };
  const [error] = validate(nested, { items: [{ id: 'q', v: 'x' }] }).errors;
  assert.deepEqual([error.path, error.owner], ['items[0].v', 'q']);
});

test('the number of errors is capped', () => {
  const result = validate({ type: 'array', items: { type: 'integer' } }, Array(50).fill('x'), { maxErrors: 5 });
  assert.equal(result.errors.length, 5);
  assert.equal(result.truncated, true);
});
