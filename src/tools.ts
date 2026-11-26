/**
 * What the toolbar draws and writes, derived from the config. Everything here
 * is pure: the config belongs to the host (which shares bound rows with other
 * tiles), so nothing writes to it, and every field is checked rather than
 * trusted, because boards keep configs written by hand or for older versions.
 */
import type { ToolbarConfiguration } from './definition-schema.js'

export type Control = 'button' | 'switch' | 'slider' | 'choice' | 'dropdown' | 'label' | 'separator' | 'spacer'
export type Variant = 'filled' | 'tonal' | 'outlined' | 'text'

const CONTROLS: readonly Control[] = ['button', 'switch', 'slider', 'choice', 'dropdown', 'label', 'separator', 'spacer']
const VARIANTS: readonly Variant[] = ['filled', 'tonal', 'outlined', 'text']

/** Tools that write a value; label, separator and spacer don't. */
export const isInteractive = (control: Control): boolean =>
    control === 'button' || control === 'switch' || control === 'slider' || control === 'choice' || control === 'dropdown'

/** A table column as the targetColumn picker stores it. Studio adds the app's backend key. */
export type ColumnRef = {
    swarm_app_databackend_key: string | number
    tablename: string
    column: string
    dataType?: string
}

/** One column value, as `data-submit` carries it. Studio groups the items into one row per table. */
export type ValueItem = {
    swarm_app_databackend_key: string | number
    table_name: string
    column_name: string
    value: unknown
}

export type Option = { label: string; value: string; icon?: string }

/**
 * The value an operator set, held until the reported value agrees with it.
 * `expected` is what the tool's state source should report once the write
 * has landed. Without a timer (nothing reports the value) it is the state.
 */
export type Request = { expected: unknown; timer?: ReturnType<typeof setTimeout> }

/** Where a tool's shown value comes from. */
export type Source = 'url' | 'data' | 'local'

export type ToolModel = {
    /** Stable per position and type; changing a tool's type starts it afresh. */
    key: string
    index: number
    control: Control
    label: string
    icon?: string
    variant: Variant
    /** The tool's own accent colour, if configured. */
    color?: string
    // Interactive tools
    source: Source
    /** The value the tool shows: reported, or held after a click. */
    state: unknown
    disabled: boolean
    confirmText?: string
    parameterKey?: string
    target?: ColumnRef
    // button
    buttonValue: string
    active: boolean
    // switch
    on: boolean
    // slider
    min: number
    max: number
    step: number
    decimals: number
    unit: string
    sliderValue: number
    // choice, dropdown
    options: Option[]
    selected: number
}

/** What one interaction writes. */
export type Commit = {
    /** URL parameters for `param-submit`, or undefined when the tool sets none. */
    params?: Record<string, string | undefined>
    /** Items for `data-submit`, or undefined when the tool writes no column. */
    items?: ValueItem[]
    /** What the tool's state source should report afterwards. */
    expected: unknown
}

// Written into the URL and into a column for "on" when nothing else is set.
const DEFAULT_ON = 'true'

const text = (value: unknown): string =>
    typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : ''

export const isEmpty = (value: unknown): boolean =>
    value === undefined || value === null || (typeof value === 'string' && value.trim() === '')

export const toNumber = (value: unknown): number | undefined => {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return undefined
    const number = typeof value === 'number' ? value : Number(String(value).trim())
    return Number.isFinite(number) ? number : undefined
}

/** A picked column, or undefined unless it names a backend, a table and a column. */
export function columnRef(target: unknown): ColumnRef | undefined {
    if (!target || typeof target !== 'object') return undefined
    const ref = target as Record<string, unknown>
    const key = ref.swarm_app_databackend_key
    const hasKey = (typeof key === 'number' && Number.isFinite(key)) || (typeof key === 'string' && key.trim() !== '')
    const named = (part: unknown) => typeof part === 'string' && part.trim() !== ''
    if (!hasKey || !named(ref.tablename) || !named(ref.column)) return undefined
    return {
        swarm_app_databackend_key: key as string | number,
        tablename: ref.tablename as string,
        column: ref.column as string,
        dataType: typeof ref.dataType === 'string' ? ref.dataType : undefined
    }
}

const sameTable = (a: ColumnRef, b: ColumnRef): boolean =>
    String(a.swarm_app_databackend_key) === String(b.swarm_app_databackend_key) && a.tablename === b.tablename

/**
 * A value as its column's type wants it. The editor stores constants as text,
 * so '12' or 'true' becomes a number or a boolean for those columns. What
 * does not convert is written as it is, and Studio reports the failed row.
 * (The same conversion as widget-switch's.)
 */
export function columnValue(value: unknown, dataType: unknown): unknown {
    if (value === undefined || value === null) return null
    if (dataType === 'boolean') {
        if (typeof value === 'boolean') return value
        if (typeof value === 'number') return value !== 0
        const t = String(value).trim().toLowerCase()
        if (t === 'true' || t === '1') return true
        if (t === 'false' || t === '0') return false
        return value
    }
    if (dataType === 'numeric' || dataType === 'bigint') {
        if (typeof value === 'boolean') return value ? 1 : 0
        if (typeof value === 'number') return value
        const t = String(value).trim()
        const n = Number(t)
        if (t === '' || !Number.isFinite(n)) return value
        // A bigint id beyond 2^53 would lose digits as a number.
        return dataType === 'bigint' && !Number.isSafeInteger(n) ? t : n
    }
    if (dataType === 'string' && (typeof value === 'boolean' || typeof value === 'number')) return String(value)
    return value
}

// Only used against a boolean, so 1 and 0 count as true and false.
const asBoolean = (value: unknown): boolean | undefined => {
    if (typeof value === 'boolean') return value
    const t = String(value).trim().toLowerCase()
    if (t === 'true' || t === '1') return true
    if (t === 'false' || t === '0') return false
    return undefined
}

/**
 * Whether two values mean the same, after the column's conversion on both
 * sides: true written to a numeric column comes back as 1, '5' as 5. Empty
 * values (missing, null, '') are all the same.
 */
export function sameValue(a: unknown, b: unknown, dataType?: unknown): boolean {
    if (isEmpty(a) || isEmpty(b)) return isEmpty(a) && isEmpty(b)
    const ca = columnValue(a, dataType)
    const cb = columnValue(b, dataType)
    if (typeof ca === 'boolean' || typeof cb === 'boolean') {
        const ba = asBoolean(ca)
        const bb = asBoolean(cb)
        if (ba !== undefined && bb !== undefined) return ba === bb
    }
    if (dataType !== 'string') {
        const na = toNumber(ca)
        const nb = toNumber(cb)
        if (na !== undefined && nb !== undefined) return na === nb
    }
    return String(ca).trim() === String(cb).trim()
}

/** The value the URL holds for a parameter, undefined while it is absent. */
export function paramsOf(route: unknown): URLSearchParams {
    if (typeof route !== 'string') return new URLSearchParams()
    const query = route.indexOf('?')
    return new URLSearchParams(query < 0 ? '' : route.slice(query + 1))
}

type RawTool = Record<string, unknown>

const rawTools = (config: unknown): (RawTool | undefined)[] => {
    const tools = (config as ToolbarConfiguration | undefined)?.tools
    if (!Array.isArray(tools)) return []
    // A null slot (a stray '-' in a board template) keeps its position, so the
    // keys of the tools after it do not shift.
    return tools.map((tool) => (tool && typeof tool === 'object' ? (tool as RawTool) : undefined))
}

const controlOf = (tool: RawTool): Control => {
    const control = tool.control
    return CONTROLS.includes(control as Control) ? (control as Control) : 'button'
}

export const toolKey = (index: number, control: Control): string => `${index}:${control}`

/** The key and the reported value of every interactive tool, for settling held requests. */
export type Report = { key: string; source: Source; reported: unknown; dataType?: string }

/** What each interactive tool's source reports right now. */
export function reports(config: unknown, params: URLSearchParams): Report[] {
    return rawTools(config).flatMap((tool, index): Report[] => {
        if (!tool) return []
        const control = controlOf(tool)
        if (!isInteractive(control)) return []
        const key = toolKey(index, control)
        const parameterKey = text(tool.parameterKey).trim()
        if (parameterKey) {
            return [{ key, source: 'url', reported: params.get(parameterKey) ?? undefined }]
        }
        // A bound value that has delivered nothing yet (null) reports nothing.
        if (tool.value !== undefined && tool.value !== null) {
            return [{ key, source: 'data', reported: tool.value, dataType: columnRef(tool.targetColumn)?.dataType }]
        }
        return [{ key, source: 'local', reported: undefined }]
    })
}

/** Whether a held request can go: its source now reports what it expects, or reports at all without a timer. */
export function settled(report: Report, request: Request): boolean {
    if (report.source === 'local') return false
    if (request.timer === undefined) return true
    return sameValue(report.reported, request.expected, report.source === 'data' ? report.dataType : undefined)
}

const decimalsOf = (step: number): number => {
    const [, fraction = ''] = String(step).split('.')
    return Math.min(fraction.length, 6)
}

const options = (raw: unknown): Option[] => {
    if (!Array.isArray(raw)) return []
    const seen = new Set<string>()
    return raw.flatMap((option) => {
        if (!option || typeof option !== 'object') return []
        const o = option as Record<string, unknown>
        const value = text(o.value)
        // Two options with one value would both be "selected"; the first wins.
        if (seen.has(value)) return []
        seen.add(value)
        const label = text(o.label) || value
        const icon = text(o.icon).trim() || undefined
        if (!label && !icon) return []
        return [{ label, value, icon }]
    })
}

/** Shared columns that go into the same table as `target`. */
function sharedFor(config: unknown, target: ColumnRef): { ref: ColumnRef; value: unknown }[] {
    const shared = (config as ToolbarConfiguration | undefined)?.sharedColumns
    if (!Array.isArray(shared)) return []
    return shared.flatMap((entry) => {
        const ref = columnRef(entry?.targetColumn)
        return ref && sameTable(ref, target) ? [{ ref, value: entry?.value }] : []
    })
}

function extrasOf(tool: RawTool): { ref: ColumnRef; value: unknown }[] {
    if (!Array.isArray(tool.extraColumns)) return []
    return tool.extraColumns.flatMap((extra) => {
        const ref = columnRef((extra as RawTool | null)?.targetColumn)
        return ref ? [{ ref, value: (extra as RawTool).value }] : []
    })
}

const valueItem = (ref: ColumnRef, value: unknown): ValueItem => ({
    swarm_app_databackend_key: ref.swarm_app_databackend_key,
    table_name: ref.tablename,
    column_name: ref.column,
    value: columnValue(value, ref.dataType)
})

/**
 * The row a tool writes with `value` in its own column, or undefined while a
 * key column has no value: a row without its record's key would land nowhere.
 * The tool's own column comes last, so it wins over a shared or extra column
 * naming the same column (Studio keeps the later item).
 */
export function rowItems(config: unknown, tool: RawTool, value: unknown): ValueItem[] | undefined {
    const target = columnRef(tool.targetColumn)
    if (!target) return undefined
    const keys = [...sharedFor(config, target), ...extrasOf(tool)]
    if (keys.some((key) => isEmpty(key.value))) return undefined
    return [...keys.map((key) => valueItem(key.ref, key.value)), valueItem(target, value)]
}

/**
 * The tool models, in configuration order. `requests` holds what the operator
 * set; each request is either still waiting for its source (it has a timer) or
 * stands in for a source that reports nothing.
 */
export function toTools(config: unknown, route: unknown, requests: ReadonlyMap<string, Request>): ToolModel[] {
    const params = paramsOf(route)
    const reported = new Map(reports(config, params).map((report) => [report.key, report]))
    return rawTools(config).flatMap((tool, index) => {
        if (!tool) return []
        const control = controlOf(tool)
        const key = toolKey(index, control)
        const label = text(tool.label).trim()
        const icon = text(tool.icon).trim() || undefined
        const color = typeof tool.color === 'string' && tool.color.trim() ? tool.color.trim() : undefined
        const report = reported.get(key)
        const request = requests.get(key)
        const source: Source = report?.source ?? 'local'
        // A held request wins until its source agrees (the element drops it then).
        const state = request ? request.expected : report?.reported
        const target = columnRef(tool.targetColumn)
        const parameterKey = text(tool.parameterKey).trim() || undefined
        const dataType = source === 'data' ? target?.dataType : undefined

        // A tool that names a column but misses a key value is disabled, even
        // when it also sets a URL parameter: half a write is worse than none.
        const writable = target ? rowItems(config, tool, true) !== undefined : false
        const disabled = isInteractive(control) && (target ? !writable : !parameterKey)

        const buttonValue = text(tool.buttonValue)
        // Compared with what the switch writes for "on": a configured On Value,
        // else true, which a numeric column stores (and reports back) as 1.
        const onValue: unknown = text(tool.onValue).trim() || (source === 'url' ? DEFAULT_ON : true)

        let min = toNumber(tool.min) ?? 0
        let max = toNumber(tool.max) ?? 100
        if (!(max > min)) max = min + 100
        let step = toNumber(tool.step) ?? 1
        if (!(step > 0)) step = 1
        if (step > max - min) step = max - min
        const decimals = decimalsOf(step)
        const number = toNumber(state)
        const sliderValue = number === undefined ? min : Math.min(max, Math.max(min, number))

        const opts = options(tool.options)
        const selected = control === 'choice' || control === 'dropdown'
            ? opts.findIndex((option) => sameValue(state, option.value, dataType))
            : -1

        return [
            {
                key,
                index,
                control,
                label,
                icon,
                variant: VARIANTS.includes(tool.variant as Variant) ? (tool.variant as Variant) : 'filled',
                color,
                source,
                state,
                disabled,
                confirmText: text(tool.confirmText).trim() || undefined,
                parameterKey,
                target,
                buttonValue,
                active: control === 'button' && buttonValue.trim() !== '' && sameValue(state, buttonValue, dataType),
                on: control === 'switch' && sameValue(state, onValue, dataType),
                min,
                max,
                step,
                decimals,
                unit: text(tool.unit),
                sliderValue,
                options: opts,
                selected
            }
        ]
    })
}

/**
 * What an interaction writes. `next` is the new position: a switch's on/off,
 * a slider's number, an option's value; a button ignores it.
 */
export function commitFor(config: unknown, model: ToolModel, next?: unknown): Commit | undefined {
    if (!isInteractive(model.control) || model.disabled) return undefined
    const tool = rawTools(config)[model.index]
    if (!tool) return undefined

    // What goes into the URL (undefined removes the parameter) and into the column.
    let urlValue: string | undefined
    let column: unknown
    switch (model.control) {
        case 'button': {
            const value = model.buttonValue.trim() === '' ? undefined : model.buttonValue
            urlValue = value
            column = value ?? true
            break
        }
        case 'switch': {
            const onValue = text(tool.onValue).trim()
            const offValue = text(tool.offValue).trim()
            if (next) {
                urlValue = onValue || DEFAULT_ON
                column = onValue || true
            } else {
                urlValue = offValue || undefined
                column = offValue || false
            }
            break
        }
        case 'slider': {
            const n = toNumber(next) ?? model.sliderValue
            const value = Number(Math.min(model.max, Math.max(model.min, n)).toFixed(model.decimals))
            urlValue = String(value)
            column = value
            break
        }
        default: {
            const value = text(next)
            urlValue = value.trim() === '' ? undefined : value
            column = value.trim() === '' ? null : value
        }
    }

    const items = model.target ? rowItems(config, tool, column) : undefined
    if (model.target && !items) return undefined
    const params = model.parameterKey ? { [model.parameterKey]: urlValue } : undefined
    const expected = model.parameterKey ? urlValue : model.target ? columnValue(column, model.target.dataType) : column
    return { params, items, expected }
}
