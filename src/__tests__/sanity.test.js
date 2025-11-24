const test = require('node:test')
const assert = require('node:assert/strict')

test('sanity check keeps arithmetic intact', () => {
  assert.equal(2 + 2, 4)
})
