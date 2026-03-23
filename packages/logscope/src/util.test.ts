import { describe, it } from 'node:test'
import assert from 'node:assert'
import { inspect } from './util.ts'

describe('inspect (browser/default)', () => {
  describe('primitives', () => {
    it('should render strings as-is', () => {
      assert.strictEqual(inspect('hello'), 'hello')
    })

    it('should render numbers', () => {
      assert.strictEqual(inspect(42), '42')
      assert.strictEqual(inspect(3.14), '3.14')
      assert.strictEqual(inspect(NaN), 'NaN')
      assert.strictEqual(inspect(Infinity), 'Infinity')
    })

    it('should render booleans', () => {
      assert.strictEqual(inspect(true), 'true')
      assert.strictEqual(inspect(false), 'false')
    })

    it('should render null', () => {
      assert.strictEqual(inspect(null), 'null')
    })

    it('should render undefined', () => {
      assert.strictEqual(inspect(undefined), 'undefined')
    })

    it('should render bigint with n suffix', () => {
      assert.strictEqual(inspect(BigInt(42)), '42n')
    })

    it('should render symbols', () => {
      assert.strictEqual(inspect(Symbol('test')), 'Symbol(test)')
      assert.strictEqual(inspect(Symbol()), 'Symbol()')
    })
  })

  describe('functions', () => {
    it('should render named functions', () => {
      function myFunc() {}
      assert.strictEqual(inspect(myFunc), '[Function: myFunc]')
    })

    it('should render anonymous functions', () => {
      assert.strictEqual(inspect(() => {}), '[Function: anonymous]')
    })
  })

  describe('objects and arrays', () => {
    it('should render plain objects as JSON', () => {
      const result = inspect({ a: 1, b: 'hello' })
      assert.strictEqual(result, '{"a":1,"b":"hello"}')
    })

    it('should render arrays as JSON', () => {
      const result = inspect([1, 2, 3])
      assert.strictEqual(result, '[1,2,3]')
    })

    it('should render nested objects', () => {
      const result = inspect({ user: { name: 'Alice', age: 30 } })
      assert.strictEqual(result, '{"user":{"name":"Alice","age":30}}')
    })

    it('should handle objects with special value types', () => {
      const result = inspect({ big: BigInt(99), fn: Math.max, sym: Symbol('x') })
      const parsed = JSON.parse(result)
      assert.strictEqual(parsed.big, '99n')
      assert.strictEqual(parsed.fn, '[Function: max]')
      assert.strictEqual(parsed.sym, 'Symbol(x)')
    })

    it('should handle undefined values in objects', () => {
      const result = inspect({ a: 1, b: undefined })
      const parsed = JSON.parse(result)
      assert.strictEqual(parsed.b, '[undefined]')
    })
  })

  describe('Error objects', () => {
    it('should render Error with name and message', () => {
      const err = new Error('something broke')
      const result = inspect(err)
      assert.ok(result.includes('Error: something broke'))
    })

    it('should include the stack trace', () => {
      const err = new Error('with stack')
      const result = inspect(err)
      assert.ok(result.includes('Error: with stack'))
      assert.ok(result.includes('at '))
    })

    it('should render TypeError', () => {
      const err = new TypeError('bad type')
      const result = inspect(err)
      assert.ok(result.includes('TypeError: bad type'))
    })

    it('should render Error with cause', () => {
      const cause = new Error('root cause')
      const err = new Error('wrapper', { cause })
      const result = inspect(err)
      assert.ok(result.includes('Error: wrapper'))
      assert.ok(result.includes('[cause]:'))
      assert.ok(result.includes('Error: root cause'))
    })
  })

  describe('circular references', () => {
    it('should handle circular objects without crashing', () => {
      const obj: Record<string, unknown> = { a: 1 }
      obj.self = obj
      const result = inspect(obj)
      assert.ok(result.includes('"a":1'))
      assert.ok(result.includes('[Circular]'))
    })

    it('should handle circular arrays without crashing', () => {
      const arr: unknown[] = [1, 2]
      arr.push(arr)
      const result = inspect(arr)
      assert.ok(result.includes('[Circular]'))
    })
  })
})
