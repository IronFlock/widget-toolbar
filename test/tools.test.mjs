import { test } from 'node:test'
import assert from 'node:assert/strict'
import { columnValue, commitFor, reports, paramsOf, sameValue, settled, toTools } from '../src/tools.ts'

const column = (name, dataType = 'string', table = 'commands') => ({
    swarm_app_databackend_key: 7,
    tablename: table,
    column: name,
    column_name: name.toUpperCase(),
    dataType
})

const none = new Map()

test('a malformed config yields no tools and never throws', () => {
    for (const config of [undefined, null, {}, { tools: 'x' }, { tools: [null, 3, 'a'] }]) {
        assert.deepEqual(toTools(config, undefined, none), [])
    }
})

test('a null slot keeps the keys of the tools after it', () => {
    const tools = toTools({ tools: [null, { label: 'A' }] }, '', none)
    assert.equal(tools.length, 1)
    assert.equal(tools[0].key, '1:button')
})

test('an unknown control is a button, and a tool without a target is disabled', () => {
    const [tool] = toTools({ tools: [{ label: 'A', control: 'knob' }] }, '', none)
    assert.equal(tool.control, 'button')
    assert.equal(tool.disabled, true)
    const [label] = toTools({ tools: [{ label: 'A', control: 'label' }] }, '', none)
    assert.equal(label.disabled, false)
})

test('a target column needs backend key, table and column', () => {
    const config = { tools: [{ label: 'Go', targetColumn: { tablename: 'commands', column: 'cmd' } }] }
    assert.equal(toTools(config, '', none)[0].disabled, true)
    config.tools[0].targetColumn = 'cmd' // a bare string, as an AI may write it
    assert.equal(toTools(config, '', none)[0].disabled, true)
    config.tools[0].targetColumn = column('cmd')
    assert.equal(toTools(config, '', none)[0].disabled, false)
})

test('columnValue converts by the column type', () => {
    assert.equal(columnValue('12', 'numeric'), 12)
    assert.equal(columnValue(true, 'numeric'), 1)
    assert.equal(columnValue('true', 'boolean'), true)
    assert.equal(columnValue('0', 'boolean'), false)
    assert.equal(columnValue(5, 'string'), '5')
    assert.equal(columnValue('9007199254740993', 'bigint'), '9007199254740993')
    assert.equal(columnValue(undefined, 'string'), null)
})

test('sameValue compares after the column conversion', () => {
    assert.ok(sameValue(1, true, 'numeric'))
    assert.ok(sameValue('5', 5))
    assert.ok(sameValue(true, 'true'))
    assert.ok(sameValue(undefined, ''))
    assert.ok(!sameValue('01', '1', 'string'))
    assert.ok(!sameValue('day', 'week'))
})

test('a button writes its value, the shared and extra columns, own column last', () => {
    const config = {
        sharedColumns: [
            { targetColumn: column('machine_id'), value: 'M1' },
            { targetColumn: column('other', 'string', 'elsewhere'), value: 'x' }
        ],
        tools: [
            {
                label: 'Start',
                buttonValue: 'start',
                targetColumn: column('cmd'),
                extraColumns: [{ targetColumn: column('cmd'), value: 'overridden' }]
            }
        ]
    }
    const [tool] = toTools(config, '', none)
    const commit = commitFor(config, tool)
    assert.deepEqual(commit.items, [
        { swarm_app_databackend_key: 7, table_name: 'commands', column_name: 'machine_id', value: 'M1' },
        { swarm_app_databackend_key: 7, table_name: 'commands', column_name: 'cmd', value: 'overridden' },
        { swarm_app_databackend_key: 7, table_name: 'commands', column_name: 'cmd', value: 'start' }
    ])
    assert.equal(commit.params, undefined)
})

test('a missing key value disables the tool and writes nothing', () => {
    const config = {
        sharedColumns: [{ targetColumn: column('machine_id'), value: null }],
        tools: [{ label: 'Start', targetColumn: column('cmd') }]
    }
    const [tool] = toTools(config, '', none)
    assert.equal(tool.disabled, true)
    assert.equal(commitFor(config, tool), undefined)
})

test('an empty button value writes true and removes the URL parameter', () => {
    const config = { tools: [{ label: 'All', parameterKey: 'period', targetColumn: column('flag', 'boolean') }] }
    const [tool] = toTools(config, '/p?period=day', none)
    const commit = commitFor(config, tool)
    assert.deepEqual(commit.params, { period: undefined })
    assert.equal(commit.items.at(-1).value, true)
    assert.equal(tool.active, false)
})

test('a button is active while its parameter holds its value', () => {
    const config = { tools: [{ label: 'Day', buttonValue: 'day', parameterKey: 'period' }] }
    assert.equal(toTools(config, '/p?period=day', none)[0].active, true)
    assert.equal(toTools(config, '/p?period=week', none)[0].active, false)
})

test('a switch reads and writes the URL; an empty off value removes the parameter', () => {
    const config = { tools: [{ label: 'Live', control: 'switch', parameterKey: 'live' }] }
    const off = toTools(config, '', none)[0]
    assert.equal(off.on, false)
    assert.deepEqual(commitFor(config, off, true).params, { live: 'true' })
    const on = toTools(config, '?live=true', none)[0]
    assert.equal(on.on, true)
    assert.deepEqual(commitFor(config, on, false).params, { live: undefined })
})

test('a switch on a numeric column writes 1/0 and reads 1 as on', () => {
    const config = { tools: [{ label: 'Auto', control: 'switch', targetColumn: column('auto', 'numeric'), value: 1 }] }
    const [tool] = toTools(config, '', none)
    assert.equal(tool.source, 'data')
    assert.equal(tool.on, true)
    assert.equal(commitFor(config, tool, false).items.at(-1).value, 0)
    assert.equal(commitFor(config, tool, true).expected, 1)
})

test('a switch with own on/off values', () => {
    const config = {
        tools: [{ label: 'Mode', control: 'switch', onValue: 'AUTO', offValue: 'MANUAL', targetColumn: column('mode'), value: 'AUTO' }]
    }
    const [tool] = toTools(config, '', none)
    assert.equal(tool.on, true)
    assert.equal(commitFor(config, tool, false).items.at(-1).value, 'MANUAL')
})

test('a slider clamps, rounds to its step decimals and falls back on bad limits', () => {
    const config = { tools: [{ label: 'Speed', control: 'slider', min: 10, max: 5, step: 0.5, parameterKey: 'speed' }] }
    const [tool] = toTools(config, '?speed=999', none)
    assert.equal(tool.min, 10)
    assert.equal(tool.max, 110)
    assert.equal(tool.decimals, 1)
    assert.equal(tool.sliderValue, 110)
    assert.deepEqual(commitFor(config, tool, 12.3456).params, { speed: '12.3' })
    assert.equal(toTools(config, '', none)[0].sliderValue, 10)
})

test('choice options: duplicates collapse, empty value clears', () => {
    const config = {
        tools: [
            {
                label: 'Period',
                control: 'choice',
                parameterKey: 'period',
                targetColumn: column('period'),
                options: [{ label: 'All', value: '' }, { label: 'Day', value: 'day' }, { label: 'Again', value: 'day' }, null]
            }
        ]
    }
    const [tool] = toTools(config, '', none)
    assert.equal(tool.options.length, 2)
    assert.equal(tool.selected, 0)
    const commit = commitFor(config, tool, '')
    assert.deepEqual(commit.params, { period: undefined })
    assert.equal(commit.items.at(-1).value, null)
    assert.equal(toTools(config, '?period=day', none)[0].selected, 1)
})

test('a held request wins until the source agrees', () => {
    const config = { tools: [{ label: 'Auto', control: 'switch', targetColumn: column('auto', 'boolean'), value: false }] }
    const requests = new Map([['0:switch', { expected: true, timer: 1 }]])
    assert.equal(toTools(config, '', requests)[0].on, true)
    const [report] = reports(config, paramsOf(''))
    assert.equal(settled(report, requests.get('0:switch')), false)
    const agreed = { tools: [{ ...config.tools[0], value: true }] }
    assert.equal(settled(reports(agreed, paramsOf(''))[0], requests.get('0:switch')), true)
})

test('a local request without a timer stays; a reporting source replaces it', () => {
    const tool = { label: 'Speed', control: 'slider', targetColumn: column('speed', 'numeric') }
    const request = { expected: 40 }
    const local = reports({ tools: [tool] }, paramsOf(''))[0]
    assert.equal(local.source, 'local')
    assert.equal(settled(local, request), false)
    assert.equal(toTools({ tools: [tool] }, '', new Map([['0:slider', request]]))[0].sliderValue, 40)
    const reporting = reports({ tools: [{ ...tool, value: 70 }] }, paramsOf(''))[0]
    assert.equal(settled(reporting, request), true)
})

test('nothing is written into the config', () => {
    const config = {
        sharedColumns: [{ targetColumn: column('id'), value: 'A' }],
        tools: [{ label: 'Go', control: 'slider', targetColumn: column('v', 'numeric') }]
    }
    const before = JSON.stringify(config)
    const [tool] = toTools(Object.freeze(config), '?x=1', none)
    commitFor(config, tool, 3)
    assert.equal(JSON.stringify(config), before)
})
