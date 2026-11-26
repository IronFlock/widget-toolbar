import { test } from 'node:test'
import assert from 'node:assert/strict'
import { place } from '../src/layout.ts'

const tool = (full, compact = full, cross = 36) => ({
    kind: 'tool',
    full: { main: full, cross },
    compact: { main: compact, cross }
})
const separator = { kind: 'separator', full: { main: 1, cross: 25 }, compact: { main: 1, cross: 25 } }
const spacer = { kind: 'spacer', full: { main: 0, cross: 0 }, compact: { main: 0, cross: 0 } }
const more = { main: 36, cross: 36 }

const layout = (items, main, extra = {}) =>
    place({ items, available: { main, cross: 40 }, gap: 8, more, checkCross: false, ...extra })

test('everything fits at full density', () => {
    const result = layout([tool(100), tool(100)], 208)
    assert.deepEqual(result, { visible: [0, 1], compact: [], overflow: [] })
})

test('only as many tools go compact as needed', () => {
    // 100 + 8 + 100 = 208 > 150; compacting the first gives 36 + 8 + 100 = 144.
    assert.deepEqual(layout([tool(100, 36), tool(100, 36)], 150), { visible: [0, 1], compact: [0], overflow: [] })
    assert.deepEqual(layout([tool(100, 36), tool(100, 36)], 90), { visible: [0, 1], compact: [0, 1], overflow: [] })
})

test('the tools that save most go compact first; the rest keep their labels', () => {
    // Full 100 + 8 + 200 + 8 + 100 = 416. Compacting the middle one (saves 160)
    // gives 256, which fits 300.
    const result = layout([tool(100, 40), tool(200, 40), tool(100, 40)], 300)
    assert.deepEqual(result, { visible: [0, 1, 2], compact: [1], overflow: [] })
})

test('the rest goes to the menu, in order, once one tool does not fit', () => {
    // Compact needs 4 × 60 + 3 × 8 = 264 > 200. The budget is 200 - 36 - 8 =
    // 156: 60 + 8 + 60 = 128 fits, + 8 + 60 does not, and the small fourth
    // tool, which would still fit, follows the third into the menu.
    const result = layout([tool(100, 60), tool(100, 60), tool(100, 60), tool(100, 10)], 200)
    assert.deepEqual(result, { visible: [0, 1], compact: [0, 1], overflow: [2, 3] })
})

test('separators are dropped at the ends and doubled ones collapse', () => {
    const result = layout([separator, tool(50), separator, separator, tool(50), separator], 400)
    assert.deepEqual(result.visible, [1, 2, 4])
})

test('a separator before a spacer keeps its place', () => {
    assert.deepEqual(layout([tool(50), separator, spacer, tool(50)], 400).visible, [0, 1, 2, 3])
    // Before a spacer that ends the bar it has no tool after it.
    assert.deepEqual(layout([tool(50), separator, spacer], 400).visible, [0, 2])
})

test('spacers stay in the bar but never go into the menu', () => {
    const result = layout([tool(80, 80), spacer, tool(80, 80), tool(80, 80)], 150)
    assert.deepEqual(result.visible, [0, 1])
    assert.deepEqual(result.overflow, [2, 3])
})

test('a menu holding only separators is no menu', () => {
    const items = [tool(50), separator]
    const result = layout(items, 50)
    assert.deepEqual(result.overflow, [])
})

test('a vertical strip sends tools wider than the strip to the menu', () => {
    const items = [tool(36, 36, 36), tool(36, 36, 120), tool(36, 36, 36)]
    const fits = place({ items, available: { main: 400, cross: 60 }, gap: 8, more, checkCross: true })
    assert.deepEqual(fits.visible, [0, 2])
    assert.deepEqual(fits.overflow, [1])
    const ignores = place({ items, available: { main: 400, cross: 60 }, gap: 8, more, checkCross: false })
    assert.deepEqual(ignores.overflow, [])
})

test('a vertical strip keeps labels on the tools that fit across', () => {
    const wideFull = { kind: 'tool', full: { main: 30, cross: 200 }, compact: { main: 30, cross: 50 } }
    const result = place({ items: [tool(36, 36, 100), wideFull], available: { main: 400, cross: 120 }, gap: 8, more, checkCross: true })
    assert.deepEqual(result, { visible: [0, 1], compact: [1], overflow: [] })
})

test('labels are kept when going compact would show no more tools', () => {
    // Neither density fits all three; with ⋮ the budget is 108 - 36 - 8 = 64,
    // which holds one tool either way (60, or 40 + 8 + 40 = 88 > 64): a tie.
    const result = layout([tool(60, 40), tool(60, 40), tool(60, 40)], 108)
    assert.deepEqual(result, { visible: [0], compact: [], overflow: [1, 2] })
})

test('a bar too small for anything puts every tool in the menu', () => {
    const result = layout([tool(50), tool(50)], 20)
    assert.deepEqual(result.visible, [])
    assert.deepEqual(result.overflow, [0, 1])
})
