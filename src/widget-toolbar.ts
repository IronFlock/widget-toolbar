import { html, css, nothing, LitElement, PropertyValues, TemplateResult } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { live } from 'lit/directives/live.js'
import { styleMap } from 'lit/directives/style-map.js'
import '@material/web/switch/switch.js'
import '@material/web/icon/icon.js'
import type { MdSwitch } from '@material/web/switch/switch.js'
import type { ToolbarConfiguration } from './definition-schema.js'
import { commitFor, paramsOf, reports, settled, toTools, type Commit, type Request, type ToolModel } from './tools.ts'
import { place, type Density, type Extent, type Item, type Placement } from './layout.ts'
import { accentColor, onColor, opaqueSurface } from './colors.ts'

type Theme = { theme_name: string; theme_object?: any }

type Popup = { kind: 'menu' } | { kind: 'dropdown'; key: string }

// How long a tool keeps the value an operator set before it shows what its
// source reports again: a bound value gets time for the row to travel to the
// table and back, a URL parameter only for Studio to hand over the new route
// (nothing hands one over in the widget editor, where the tool falls back).
const DATA_HOLD_MS = 10000
const URL_HOLD_MS = 2000

const ORIENTATIONS = ['horizontal', 'vertical'] as const
const SIZES = ['small', 'normal', 'big'] as const
const SHAPES = ['round', 'rounded', 'square'] as const
const ALIGNMENTS = { start: 'flex-start', center: 'center', end: 'flex-end' } as const

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback

// Formatted in the viewer's locale; one formatter per number of decimals.
const formatters = new Map<number, Intl.NumberFormat>()
const formatNumber = (value: number, decimals: number): string => {
    let formatter = formatters.get(decimals)
    if (!formatter) {
        formatter = new Intl.NumberFormat(undefined, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        })
        formatters.set(decimals, formatter)
    }
    return formatter.format(value)
}

/** What decides the tools' sizes: a placement measured for another signature is stale. */
const layoutSignature = (tools: ToolModel[], orientation: string, size: string): string =>
    JSON.stringify([
        orientation,
        size,
        tools.map((t) => [
            t.control,
            t.label,
            t.buttonValue,
            t.icon,
            t.variant,
            t.unit,
            t.min,
            t.max,
            t.decimals,
            t.options.map((o) => [o.label, o.icon])
        ])
    ])

@customElement('widget-toolbar-versionplaceholder')
export class WidgetToolbar extends LitElement {
    /** This tile's config, with every data binding already replaced by its data. */
    @property({ type: Object }) inputData?: ToolbarConfiguration

    /** The board's ECharts theme. theme_object is missing on boards without a theme. */
    @property({ type: Object }) theme?: Theme

    /** The page path relative to the board, with its ?query. The URL parameters are read from it. */
    @property({ type: String }) route?: string

    @state() private placement?: { placement: Placement; signature: string }
    @state() private popup?: Popup
    @state() private confirm?: { message: string; accent: string; onAccent: string }
    @state() private dragging?: { key: string; value: number }
    @state() private requestsVersion = 0

    @query('.bar') private bar?: HTMLElement
    @query('.ruler') private ruler?: HTMLElement
    @query('.popup') private popupEl?: HTMLElement
    @query('dialog.confirm') private dialog?: HTMLDialogElement

    version: string = 'versionplaceholder'

    private tools: ToolModel[] = []
    private signature = ''
    private measuredSignature?: string
    // What operators set, by tool key, until the tool's source agrees.
    private requests = new Map<string, Request>()
    private confirmAction?: () => void

    private observer = new ResizeObserver(() => this.scheduleMeasure())
    private observed: Element[] = []
    private measureFrame = 0

    private popupAnchor?: HTMLElement
    private popupFrame = 0
    private popupRect = ''

    // Colours resolved at render (see resolveColors()).
    private surface = '#ffffff'
    private accentDefault = '#5470c6'

    connectedCallback(): void {
        super.connectedCallback()
        if (!this.hasUpdated) return
        // Studio moves a tile by detaching and re-attaching it in one task.
        this.observeLayout(true)
        // A modal <dialog> leaves the top layer when it is detached but keeps
        // its open attribute: close it and show it again (as widget-form does).
        // The close event this queues finds the dialog open again and is ignored.
        const dialog = this.dialog
        if (this.confirm && dialog?.open) {
            dialog.close()
            this.showDialog()
        }
    }

    disconnectedCallback(): void {
        super.disconnectedCallback()
        this.observer.disconnect()
        this.observed = []
        cancelAnimationFrame(this.measureFrame)
        this.measureFrame = 0
        // A menu is fleeting; it does not survive a move.
        this.closePopup()
        // Held requests with a timer would fire into a detached element.
        for (const [key, request] of this.requests) {
            if (request.timer === undefined) continue
            clearTimeout(request.timer)
            this.requests.delete(key)
        }
        // A move re-attaches within this task; anything else ends the question.
        setTimeout(() => {
            if (!this.isConnected && this.confirm) this.endConfirm(false)
        })
    }

    protected willUpdate(changed: PropertyValues): void {
        if (changed.has('inputData') || changed.has('route') || changed.has('requestsVersion')) {
            this.settleRequests()
        }
        this.tools = toTools(this.inputData, this.route, this.requests)
        this.signature = layoutSignature(this.tools, this.orientation, this.size)
    }

    protected updated(): void {
        // md-switch binds its checkbox's checked *attribute*, which a browser
        // stops honouring once the user has clicked it. Without this, a switch
        // moved by a report, a timeout, a cancelled confirmation or the URL
        // keeps its checkbox on the old position, and the next click toggles
        // from there. (widget-switch has the same fix.)
        this.shadowRoot?.querySelectorAll('md-switch').forEach((sw) => {
            const input = sw.shadowRoot?.querySelector('input')
            if (input && input.checked !== sw.selected) input.checked = sw.selected
        })
        this.observeLayout(false)
        if (this.signature !== this.measuredSignature) this.scheduleMeasure()
    }

    private get orientation() {
        return oneOf(this.inputData?.orientation, ORIENTATIONS, 'horizontal')
    }

    private get size() {
        return oneOf(this.inputData?.size, SIZES, 'normal')
    }

    private get shape() {
        return oneOf(this.inputData?.shape, SHAPES, 'round')
    }

    // ---------------------------------------------------------------- state --

    /** Drop the held values whose source now agrees, or whose tool is gone. */
    private settleRequests() {
        if (!this.requests.size) return
        const current = new Map(reports(this.inputData, paramsOf(this.route)).map((r) => [r.key, r]))
        for (const [key, request] of this.requests) {
            const report = current.get(key)
            if (!report || settled(report, request)) {
                clearTimeout(request.timer)
                this.requests.delete(key)
            }
        }
    }

    /** An operator moved a tool to `next`. Writes it, after the confirmation if one is set. */
    private interact(model: ToolModel, next?: unknown) {
        const commit = commitFor(this.inputData, model, next)
        if (!commit) {
            // Nothing to write (a key column lost its value): put the tool back.
            this.requestUpdate()
            return
        }
        if (model.confirmText) {
            this.closePopup()
            const { accent, onAccent } = this.toolColors(model)
            this.confirmAction = () => this.apply(model, commit)
            this.confirm = { message: model.confirmText, accent, onAccent }
            this.updateComplete.then(() => this.showDialog())
            return
        }
        this.apply(model, commit)
    }

    private apply(model: ToolModel, commit: Commit) {
        const { key } = model
        clearTimeout(this.requests.get(key)?.timer)
        this.requests.delete(key)
        // A button with nothing to report back has no state to hold.
        if (!(model.control === 'button' && model.source === 'local')) {
            const hold = model.source === 'url' ? URL_HOLD_MS : model.source === 'data' ? DATA_HOLD_MS : undefined
            const timer =
                hold === undefined
                    ? undefined
                    : setTimeout(() => {
                          this.requests.delete(key)
                          this.requestsVersion++
                      }, hold)
            this.requests.set(key, { expected: commit.expected, timer })
        }
        this.requestsVersion++

        // Studio writes the row into the app's table, grouped per table, with
        // tsp; the stored value comes back through the tool's value binding.
        if (commit.items) {
            this.dispatchEvent(new CustomEvent('data-submit', { detail: commit.items, bubbles: false, composed: false }))
        }
        // Studio merges the parameters into the page URL (undefined removes
        // one) and hands the new route back, which is where the tool reads it.
        if (commit.params) {
            this.dispatchEvent(
                new CustomEvent('param-submit', { detail: { params: commit.params }, bubbles: true, composed: true })
            )
        }
    }

    // ------------------------------------------------------------ confirm --

    private showDialog() {
        const dialog = this.dialog
        if (!dialog || !this.isConnected || dialog.open || !this.confirm) return
        dialog.returnValue = ''
        try {
            dialog.showModal()
        } catch {
            this.endConfirm(false)
        }
    }

    private onDialogClose() {
        const dialog = this.dialog
        // Open again: the close of a re-show after a tile move.
        if (!dialog || dialog.open || !this.confirm) return
        this.endConfirm(dialog.returnValue === 'ok')
    }

    private endConfirm(ok: boolean) {
        const action = this.confirmAction
        this.confirmAction = undefined
        this.confirm = undefined
        if (this.dialog?.open) this.dialog.close()
        if (ok) action?.()
        // A cancelled switch or slider goes back to where it was.
        else this.requestUpdate()
    }

    // ------------------------------------------------------------- layout --

    /** Observe the host and every ruler slot; re-observe when the slots changed. */
    private observeLayout(force: boolean) {
        const slots = this.ruler ? [...this.ruler.children] : []
        if (!force && slots.length === this.observed.length && slots.every((s, i) => s === this.observed[i])) return
        this.observer.disconnect()
        this.observer.observe(this)
        slots.forEach((slot) => this.observer.observe(slot))
        this.observed = slots
        this.scheduleMeasure()
    }

    // A ResizeObserver callback that changes what it observes would loop:
    // measure in the next frame instead.
    private scheduleMeasure() {
        if (this.measureFrame || !this.isConnected) return
        this.measureFrame = requestAnimationFrame(() => {
            this.measureFrame = 0
            this.measure()
        })
    }

    private measure() {
        const bar = this.bar
        const ruler = this.ruler
        if (!bar || !ruler || !this.isConnected) return
        const box = bar.getBoundingClientRect()
        // A hidden page (display: none) or a collapsed tile measures 0: keep
        // what was placed, and measure again once it has a size.
        if (box.width === 0 || box.height === 0) return
        const slots = [...ruler.children]
        const tools = this.tools
        if (slots.length !== tools.length * 2 + 1) return

        const vertical = this.orientation === 'vertical'
        const extent = (el: Element): Extent => {
            const r = el.getBoundingClientRect()
            return vertical ? { main: r.height, cross: r.width } : { main: r.width, cross: r.height }
        }
        const items: Item[] = tools.map((tool, i) => ({
            kind: tool.control === 'separator' ? 'separator' : tool.control === 'spacer' ? 'spacer' : 'tool',
            full: extent(slots[2 * i]),
            compact: extent(slots[2 * i + 1])
        }))
        // Not laid out yet: wait for the ruler's own resize.
        if (items.some((item) => item.kind === 'tool' && item.full.main === 0)) return

        const style = getComputedStyle(bar)
        const px = (value: string) => parseFloat(value) || 0
        const width = box.width - px(style.paddingLeft) - px(style.paddingRight)
        const height = box.height - px(style.paddingTop) - px(style.paddingBottom)
        const placement = place({
            items,
            available: vertical ? { main: height, cross: width } : { main: width, cross: height },
            gap: px(vertical ? style.rowGap : style.columnGap),
            more: extent(slots[slots.length - 1]),
            checkCross: vertical
        })
        this.measuredSignature = this.signature
        const next = { placement, signature: this.signature }
        if (JSON.stringify(next) !== JSON.stringify(this.placement)) this.placement = next
    }

    // -------------------------------------------------------------- popup --

    private async togglePopup(popup: Popup, anchor: HTMLElement) {
        const current = this.popup
        const same =
            current?.kind === popup.kind &&
            (popup.kind === 'menu' || (current.kind === 'dropdown' && current.key === popup.key))
        if (current) this.closePopup()
        if (same) return
        this.popupAnchor = anchor
        this.popup = popup
        await this.updateComplete
        const el = this.popupEl
        if (!el || !this.isConnected || this.popup !== popup) return
        try {
            if (!el.matches(':popover-open')) el.showPopover()
        } catch {
            this.closePopup()
            return
        }
        this.popupRect = ''
        this.trackPopup()
        window.addEventListener('pointerdown', this.onOutsidePointer, true)
        window.addEventListener('keydown', this.onPopupKey, true)
        const first =
            el.querySelector<HTMLElement>('button[data-current]') ??
            el.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), md-switch:not([disabled])')
        first?.focus({ preventScroll: true })
    }

    private closePopup() {
        cancelAnimationFrame(this.popupFrame)
        this.popupFrame = 0
        window.removeEventListener('pointerdown', this.onOutsidePointer, true)
        window.removeEventListener('keydown', this.onPopupKey, true)
        try {
            if (this.popupEl?.matches(':popover-open')) this.popupEl.hidePopover()
        } catch {
            // Already gone with the element.
        }
        this.popup = undefined
        this.popupAnchor = undefined
    }

    private onOutsidePointer = (event: Event) => {
        const path = event.composedPath()
        if ((this.popupEl && path.includes(this.popupEl)) || (this.popupAnchor && path.includes(this.popupAnchor))) return
        this.closePopup()
    }

    private onPopupKey = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return
        const anchor = this.popupAnchor
        this.closePopup()
        anchor?.focus({ preventScroll: true })
    }

    /**
     * Keep the open popup next to its trigger, frame by frame: the board
     * scrolls inside its own element, whose scroll events never reach this
     * one. A trigger that collapsed (a hidden page) or left the page (the
     * layout moved it into the menu) closes the popup.
     */
    private trackPopup = () => {
        const anchor = this.popupAnchor
        const el = this.popupEl
        if (!anchor || !el || !this.popup) return
        const rect = anchor.getBoundingClientRect()
        if (!anchor.isConnected || (rect.width === 0 && rect.height === 0)) {
            this.closePopup()
            return
        }
        const key = [rect.left, rect.top, rect.width, rect.height, innerWidth, innerHeight].join()
        if (key !== this.popupRect) {
            this.popupRect = key
            this.positionPopup(el, rect)
        }
        this.popupFrame = requestAnimationFrame(this.trackPopup)
    }

    private positionPopup(el: HTMLElement, anchor: DOMRect) {
        const margin = 4
        el.style.minWidth = this.popup?.kind === 'dropdown' ? `${anchor.width}px` : ''
        el.style.maxHeight = `${Math.max(0, innerHeight - 2 * margin)}px`
        const width = el.offsetWidth
        const height = el.offsetHeight
        let top = anchor.bottom + margin
        if (top + height > innerHeight - margin && anchor.top - margin - height >= margin) {
            top = anchor.top - margin - height
        }
        top = Math.min(Math.max(top, margin), Math.max(margin, innerHeight - margin - height))
        // The menu hangs from the ⋮ button's end, a dropdown list from its start.
        let left = this.popup?.kind === 'menu' ? anchor.right - width : anchor.left
        left = Math.min(Math.max(left, margin), Math.max(margin, innerWidth - margin - width))
        el.style.top = `${top}px`
        el.style.left = `${left}px`
    }

    // -------------------------------------------------------------- colours --

    /**
     * The colours that have to be real colours, resolved at render and never
     * cached across renders: the opaque surface of the menu and the dialog
     * (the tile is usually translucent), and the accent with the text colour
     * on it. Text itself uses var() chains, which follow a board style edit
     * without a render.
     */
    private resolveColors() {
        const style = getComputedStyle(this)
        const tile = style.getPropertyValue('--re-tile-background-color').trim()
        const board = style.getPropertyValue('--re-background-color').trim()
        const themeBg = String(this.theme?.theme_object?.backgroundColor ?? '')
        this.surface = opaqueSurface(board ? [board, tile || themeBg] : [themeBg, tile])
        const text =
            style.getPropertyValue('--re-text-color').trim() ||
            this.theme?.theme_object?.title?.textStyle?.color ||
            style.color ||
            '#333333'
        this.accentDefault = accentColor(
            this.inputData?.accentColor,
            this.theme?.theme_object?.color?.[0],
            this.surface,
            text
        )
    }

    private toolColors(tool: ToolModel) {
        const accent = accentColor(tool.color, undefined, this.surface, this.accentDefault)
        return { accent, onAccent: onColor(accent, this.surface) }
    }

    private toolStyle(tool: ToolModel) {
        const { accent, onAccent } = this.toolColors(tool)
        return styleMap({ '--accent': accent, '--on-accent': onAccent })
    }

    // -------------------------------------------------------------- render --

    static styles = css`
        :host {
            display: block;
            box-sizing: border-box;
            /* clip, not hidden: the ruler is taller than the tile, and a
               hidden overflow can still be scrolled (focus, scrollIntoView),
               which shifted the bar out of the tile. */
            overflow: clip;
            position: relative;
            font-family: Roboto, 'Helvetica Neue', Arial, sans-serif;
        }

        .root {
            height: 100%;
            width: 100%;
            color: var(--text);
            --h: 36px;
            --font: 14px;
            --icon: 20px;
            --gap: 12px;
            --pad: 6px;
            --slider: 140px;
            --slider-compact: 88px;
            --switch-scale: 0.8;
            /* Corner radius as a share of the control's height, so a shape
               holds at every size: 0.5 makes pill-shaped ends. */
            --round: 0.5;
        }
        .root[data-shape='rounded'] {
            --round: 0.2;
        }
        .root[data-shape='square'] {
            --round: 0;
        }
        .root[data-size='small'] {
            --h: 28px;
            --font: 12px;
            --icon: 18px;
            --gap: 8px;
            --pad: 4px;
            --slider: 110px;
            --slider-compact: 72px;
            --switch-scale: 0.65;
        }
        .root[data-size='big'] {
            --h: 48px;
            --font: 18px;
            --icon: 26px;
            --gap: 16px;
            --pad: 8px;
            --slider: 180px;
            --slider-compact: 110px;
            --switch-scale: 1.1;
        }

        .bar {
            box-sizing: border-box;
            height: 100%;
            width: 100%;
            display: flex;
            align-items: center;
            gap: var(--gap);
            padding: var(--pad) calc(var(--pad) * 2);
            overflow: clip;
        }
        .root[data-orientation='vertical'] .bar {
            flex-direction: column;
            align-items: stretch;
            padding: calc(var(--pad) * 2) var(--pad);
        }
        .bar > * {
            flex: none;
        }
        .bar > .spacer {
            flex: 1 1 0;
        }

        /* A copy of every tool at both densities, measured, never seen. */
        .ruler {
            position: absolute;
            top: 0;
            left: 0;
            width: max-content;
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            visibility: hidden;
            pointer-events: none;
            z-index: -1;
        }
        .slot {
            display: flex;
            width: max-content;
        }

        md-icon {
            --md-icon-size: var(--icon);
            flex: none;
        }

        .text {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            min-width: 0;
        }

        button {
            font: inherit;
            color: inherit;
        }
        button:focus-visible,
        input:focus-visible {
            outline: 2px solid var(--accent, currentColor);
            outline-offset: 2px;
        }

        /* Buttons, and the dropdown trigger and ⋮, which look like them. */
        .button {
            box-sizing: border-box;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 0.4em;
            height: var(--h);
            min-width: var(--h);
            padding: 0 calc(var(--h) * 0.42);
            border: 1px solid transparent;
            border-radius: calc(var(--h) * var(--round));
            font-size: var(--font);
            font-weight: 500;
            line-height: 1;
            white-space: nowrap;
            cursor: pointer;
            background: transparent;
        }
        .button.icon-only {
            padding: 0;
            width: var(--h);
        }
        .button[data-variant='filled'] {
            background-color: var(--accent);
            color: var(--on-accent);
        }
        .button[data-variant='tonal'] {
            background-color: color-mix(in srgb, var(--accent) 22%, transparent);
        }
        .button[data-variant='outlined'] {
            border-color: color-mix(in srgb, currentColor 45%, transparent);
        }
        .button[data-variant='text'] {
            color: var(--accent);
        }
        .button:hover:not(:disabled),
        .segment:hover:not(:disabled),
        .menu-item:hover:not(:disabled) {
            background-image: linear-gradient(
                color-mix(in srgb, currentColor 10%, transparent),
                color-mix(in srgb, currentColor 10%, transparent)
            );
        }
        /* A button whose value is the current one, as in a mode selector. */
        .button[data-active] {
            box-shadow: inset 0 0 0 2px var(--accent);
        }
        .button[data-active]:not([data-variant='filled']) {
            background-color: color-mix(in srgb, var(--accent) 28%, transparent);
        }
        .button[data-active][data-variant='filled'] {
            box-shadow:
                inset 0 0 0 2px var(--accent),
                inset 0 0 0 4px var(--on-accent);
        }

        button:disabled,
        input:disabled,
        [data-disabled] {
            cursor: default;
            opacity: 0.4;
        }

        .tool {
            display: inline-flex;
            align-items: center;
            gap: 0.5em;
            font-size: var(--font);
            white-space: nowrap;
            min-width: 0;
        }
        /* In a strip the label takes the row, so a switch sits at its end.
           A dropdown, choice group or slider takes the rest of the row
           instead. Every basis is the content's own width, never 0: with
           flex: 1 the label and the control split the row in half, and the
           control was cut off below the width the ruler measured. Only the
           label gives way (with an ellipsis) when the row is short. */
        .root[data-orientation='vertical'] .bar > .tool > .text {
            flex: 1 1 auto;
        }
        .root[data-orientation='vertical'] .bar > .tool:is(.dropdown, .choice, .slider) > .text {
            flex: 0 1 auto;
        }

        md-switch {
            --md-switch-track-width: calc(52px * var(--switch-scale));
            --md-switch-track-height: calc(32px * var(--switch-scale));
            --md-switch-handle-width: calc(16px * var(--switch-scale));
            --md-switch-handle-height: calc(16px * var(--switch-scale));
            --md-switch-selected-handle-width: calc(24px * var(--switch-scale));
            --md-switch-selected-handle-height: calc(24px * var(--switch-scale));
            --md-switch-pressed-handle-width: calc(28px * var(--switch-scale));
            --md-switch-pressed-handle-height: calc(28px * var(--switch-scale));
            --md-switch-state-layer-size: calc(40px * var(--switch-scale));
            /* The button shape: the track by its height, the handle by its own size. */
            --md-switch-track-shape: calc(32px * var(--switch-scale) * var(--round));
            --md-switch-handle-shape: calc(var(--round) * 100%);
            --md-switch-selected-handle-color: var(--accent);
            --md-switch-selected-hover-handle-color: var(--accent);
            --md-switch-selected-focus-handle-color: var(--accent);
            --md-switch-selected-pressed-handle-color: var(--accent);
            --md-switch-selected-track-color: color-mix(in srgb, var(--accent) 40%, transparent);
            --md-switch-selected-hover-track-color: color-mix(in srgb, var(--accent) 50%, transparent);
            --md-switch-selected-focus-track-color: color-mix(in srgb, var(--accent) 50%, transparent);
            --md-switch-selected-pressed-track-color: color-mix(in srgb, var(--accent) 50%, transparent);
            /* OFF: Material 2.4.1 names these without "unselected". */
            --switch-off-track: color-mix(in srgb, var(--text) 20%, transparent);
            --md-switch-handle-color: var(--text);
            --md-switch-hover-handle-color: var(--text);
            --md-switch-focus-handle-color: var(--text);
            --md-switch-pressed-handle-color: var(--text);
            --md-switch-track-color: var(--switch-off-track);
            --md-switch-hover-track-color: var(--switch-off-track);
            --md-switch-focus-track-color: var(--switch-off-track);
            --md-switch-pressed-track-color: var(--switch-off-track);
            --md-switch-track-outline-color: var(--text);
            --md-switch-hover-track-outline-color: var(--text);
            --md-switch-focus-track-outline-color: var(--text);
            --md-switch-pressed-track-outline-color: var(--text);
            /* Material's disabled colours are its light scheme's near-black,
               which vanishes on a dark tile. */
            --md-switch-disabled-handle-color: var(--text);
            --md-switch-disabled-track-outline-color: var(--text);
            --md-switch-disabled-selected-track-color: var(--text);
            --md-switch-disabled-selected-handle-color: var(--text);
            flex: none;
        }

        input[type='range'] {
            accent-color: var(--accent);
            width: var(--slider);
            margin: 0;
            min-width: 0;
            cursor: pointer;
        }
        .compact input[type='range'] {
            width: var(--slider-compact);
        }
        .root[data-orientation='vertical'] .bar input[type='range'] {
            flex: 1 0 auto;
        }
        .readout {
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
        }

        /* Several texts in one grid cell, only one visible: the cell is as
           wide as the widest, so a changing value never changes the width. */
        .stack {
            display: inline-grid;
            text-align: end;
        }
        .stack > * {
            grid-area: 1 / 1;
        }
        .stack > :not([data-current]) {
            visibility: hidden;
        }
        /* In a strip the trigger is wider than its text: the text takes the
           room, so it starts after the icon and the arrow stays at the end. */
        .trigger .stack {
            flex: 1 1 auto;
            text-align: start;
        }

        .segments {
            display: inline-flex;
            height: var(--h);
            box-sizing: border-box;
            border: 1px solid color-mix(in srgb, currentColor 40%, transparent);
            border-radius: calc(var(--h) * var(--round));
            overflow: hidden;
        }
        .root[data-orientation='vertical'] .bar .segments {
            flex: 1 0 auto;
        }
        .segment {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 0.35em;
            flex: 1 0 auto;
            padding: 0 0.85em;
            border: none;
            background: transparent;
            font-size: var(--font);
            cursor: pointer;
            white-space: nowrap;
        }
        .segment.icon-only {
            padding: 0 0.5em;
        }
        .segment + .segment {
            border-left: 1px solid color-mix(in srgb, currentColor 40%, transparent);
        }
        .segment[aria-checked='true'] {
            background-color: var(--accent);
            color: var(--on-accent);
        }

        .trigger {
            justify-content: space-between;
            padding: 0 0.3em 0 0.8em;
        }
        .root[data-orientation='vertical'] .bar .trigger {
            flex: 1 0 auto;
        }

        .label {
            opacity: 0.85;
        }

        .separator {
            align-self: center;
            width: 1px;
            height: calc(var(--h) * 0.7);
            background: color-mix(in srgb, currentColor 30%, transparent);
        }
        .root[data-orientation='vertical'] .separator {
            width: auto;
            height: 1px;
            align-self: stretch;
        }
        .spacer {
            min-width: 0;
            min-height: 0;
        }

        /* The menu and dropdown lists live in the top layer: the tile clips. */
        .popup {
            position: fixed;
            inset: auto;
            margin: 0;
            box-sizing: border-box;
            min-width: 180px;
            max-width: min(340px, calc(100vw - 8px));
            padding: 6px 0;
            overflow: auto;
            border: 1px solid color-mix(in srgb, var(--text) 18%, transparent);
            border-radius: 10px;
            background: var(--surface);
            color: var(--text);
            box-shadow: 0 6px 20px rgb(0 0 0 / 0.25);
            font-size: 14px;
            --h: 36px;
            --font: 14px;
            --icon: 20px;
            --switch-scale: 0.8;
        }
        .menu-item {
            box-sizing: border-box;
            display: flex;
            align-items: center;
            gap: 12px;
            width: 100%;
            min-height: 40px;
            padding: 4px 16px;
            border: none;
            background: transparent;
            text-align: start;
            font-size: 14px;
            cursor: pointer;
        }
        .menu-item .text {
            flex: 1;
        }
        .menu-item.column {
            flex-direction: column;
            align-items: stretch;
            gap: 4px;
            cursor: default;
        }
        .menu-item.column > .row {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .menu-item input[type='range'] {
            flex: 1;
            width: auto;
        }
        .menu-item[aria-checked='true'],
        .menu-item[data-active] {
            background-color: color-mix(in srgb, var(--accent) 18%, transparent);
        }
        .menu-heading {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 8px 16px 2px;
            font-size: 12px;
            opacity: 0.75;
        }
        .check {
            visibility: hidden;
            color: var(--accent);
        }
        [aria-checked='true'] > .check {
            visibility: visible;
        }
        .popup hr {
            margin: 6px 0;
            border: none;
            border-top: 1px solid color-mix(in srgb, var(--text) 18%, transparent);
        }

        dialog.confirm {
            box-sizing: border-box;
            max-width: min(380px, calc(100vw - 32px));
            padding: 20px 24px 16px;
            border: none;
            border-radius: 14px;
            background: var(--surface);
            color: var(--text);
            box-shadow: 0 8px 28px rgb(0 0 0 / 0.3);
            font-size: 15px;
            line-height: 1.4;
        }
        dialog.confirm::backdrop {
            background: rgb(0 0 0 / 0.32);
        }
        dialog.confirm p {
            margin: 0;
            overflow-wrap: anywhere;
        }
        dialog.confirm .actions {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            margin-top: 20px;
            --h: 36px;
            --font: 14px;
        }
    `

    render() {
        this.resolveColors()
        const tools = this.tools
        const orientation = this.orientation
        const vertical = orientation === 'vertical'
        const alignment = oneOf(this.inputData?.alignment, ['start', 'center', 'end'] as const, 'start')
        // Until the tools are measured for this config, show them all.
        const placement: Placement =
            this.placement && this.placement.signature === this.signature
                ? this.placement.placement
                : { visible: tools.map((_, i) => i), compact: [], overflow: [] }
        const themeText = this.theme?.theme_object?.title?.textStyle?.color
        // The host's --re-text-color wins; the theme's colour is the fallback.
        const text = `var(--re-text-color, ${typeof themeText === 'string' && themeText ? themeText : 'inherit'})`

        return html`
            <div
                class="root"
                data-orientation=${orientation}
                data-size=${this.size}
                data-shape=${this.shape}
                style=${styleMap({ '--text': text, '--surface': this.surface })}
            >
                <div
                    class="bar"
                    role="toolbar"
                    aria-orientation=${orientation}
                    style=${styleMap({ justifyContent: ALIGNMENTS[alignment] })}
                >
                    ${repeat(
                        placement.visible.filter((i) => tools[i]),
                        (i) => tools[i].key,
                        (i) => this.renderTool(tools[i], placement.compact.includes(i) ? 'compact' : 'full')
                    )}
                    ${placement.overflow.length ? this.renderMore(vertical, this.popup?.kind === 'menu') : nothing}
                </div>
                <div class="ruler" inert aria-hidden="true">
                    ${repeat(
                        tools,
                        (tool) => tool.key,
                        (tool) => html`
                            <div class="slot">${this.renderTool(tool, 'full', true)}</div>
                            <div class="slot">${this.renderTool(tool, 'compact', true)}</div>
                        `
                    )}
                    <div class="slot">${this.renderMore(vertical, false)}</div>
                </div>
                <div class="popup" popover="manual" role=${this.popup?.kind === 'dropdown' ? 'listbox' : nothing}>
                    ${this.renderPopup(placement)}
                </div>
                <dialog
                    class="confirm"
                    @close=${this.onDialogClose}
                    @cancel=${(e: Event) => {
                        // Escape answers "no".
                        e.preventDefault()
                        this.endConfirm(false)
                    }}
                >
                    ${this.confirm
                        ? html`
                              <p>${this.confirm.message}</p>
                              <form method="dialog" class="actions">
                                  <button class="button" value="cancel">Cancel</button>
                                  <button
                                      class="button"
                                      data-variant="filled"
                                      value="ok"
                                      autofocus
                                      style=${styleMap({
                                          '--accent': this.confirm.accent,
                                          '--on-accent': this.confirm.onAccent
                                      })}
                                  >
                                      OK
                                  </button>
                              </form>
                          `
                        : nothing}
                </dialog>
            </div>
        `
    }

    private renderMore(vertical: boolean, open: boolean) {
        return html`
            <button
                class="button icon-only more"
                aria-label="More tools"
                aria-haspopup="true"
                aria-expanded=${open ? 'true' : 'false'}
                @click=${(e: Event) => this.togglePopup({ kind: 'menu' }, e.currentTarget as HTMLElement)}
            >
                <md-icon aria-hidden="true">${vertical ? 'more_horiz' : 'more_vert'}</md-icon>
            </button>
        `
    }

    private icon(name?: string) {
        return name ? html`<md-icon aria-hidden="true">${name}</md-icon>` : nothing
    }

    /** One tool in the bar, or with `ruler` its measured copy. */
    private renderTool(tool: ToolModel, density: Density, ruler = false): TemplateResult {
        const compact = density === 'compact'
        // Compact drops a label only where an icon stands in for it.
        const showLabel = !!tool.label && !(compact && tool.icon)

        switch (tool.control) {
            case 'separator':
                return html`<span class="separator" role="separator"></span>`
            case 'spacer':
                return html`<span class="spacer"></span>`
            case 'label':
                return html`<span class="tool label">${this.icon(tool.icon)}<span class="text">${tool.label}</span></span>`
            case 'button': {
                const label = tool.label || tool.buttonValue
                const iconOnly = !!tool.icon && (!label || compact)
                return html`
                    <button
                        class="button ${iconOnly ? 'icon-only' : ''}"
                        data-variant=${tool.variant}
                        ?data-active=${tool.active}
                        aria-pressed=${tool.buttonValue.trim() ? (tool.active ? 'true' : 'false') : nothing}
                        aria-label=${label || nothing}
                        title=${iconOnly && label ? label : nothing}
                        ?disabled=${tool.disabled}
                        style=${this.toolStyle(tool)}
                        @click=${ruler ? nothing : () => this.interact(tool)}
                    >
                        ${this.icon(tool.icon)}${iconOnly ? nothing : html`<span class="text">${label}</span>`}
                    </button>
                `
            }
            case 'switch':
                return html`
                    <label class="tool switch" ?data-disabled=${tool.disabled} style=${this.toolStyle(tool)}>
                        ${this.icon(tool.icon)}${showLabel ? html`<span class="text">${tool.label}</span>` : nothing}
                        <md-switch
                            aria-label=${tool.label || nothing}
                            .selected=${live(tool.on)}
                            ?disabled=${tool.disabled}
                            @change=${ruler
                                ? nothing
                                : (e: Event) => this.interact(tool, (e.target as MdSwitch).selected)}
                        ></md-switch>
                    </label>
                `
            case 'slider':
                return html`
                    <div
                        class="tool slider ${compact ? 'compact' : ''}"
                        ?data-disabled=${tool.disabled}
                        style=${this.toolStyle(tool)}
                    >
                        ${this.icon(tool.icon)}${showLabel ? html`<span class="text">${tool.label}</span>` : nothing}
                        ${this.renderRange(tool, ruler)}
                    </div>
                `
            case 'choice':
                return html`
                    <div
                        class="tool choice"
                        role="radiogroup"
                        aria-label=${tool.label || nothing}
                        style=${this.toolStyle(tool)}
                    >
                        ${tool.label && !compact ? html`<span class="text">${tool.label}</span>` : nothing}
                        <div class="segments">
                            ${tool.options.map((option, j) => {
                                const iconOnly = compact && !!option.icon
                                return html`
                                    <button
                                        class="segment ${iconOnly ? 'icon-only' : ''}"
                                        role="radio"
                                        aria-checked=${j === tool.selected ? 'true' : 'false'}
                                        aria-label=${option.label || nothing}
                                        title=${iconOnly && option.label ? option.label : nothing}
                                        ?disabled=${tool.disabled}
                                        @click=${ruler ? nothing : () => this.pick(tool, j)}
                                    >
                                        ${this.icon(option.icon)}${iconOnly ? nothing : option.label}
                                    </button>
                                `
                            })}
                        </div>
                    </div>
                `
            case 'dropdown': {
                const open = !ruler && this.popup?.kind === 'dropdown' && this.popup.key === tool.key
                return html`
                    <div class="tool dropdown" style=${this.toolStyle(tool)}>
                        ${tool.label && !compact ? html`<span class="text">${tool.label}</span>` : nothing}
                        <button
                            class="button trigger"
                            data-variant="outlined"
                            aria-haspopup="listbox"
                            aria-expanded=${open ? 'true' : 'false'}
                            aria-label=${tool.label || nothing}
                            ?disabled=${tool.disabled}
                            @click=${ruler
                                ? nothing
                                : (e: Event) =>
                                      this.togglePopup({ kind: 'dropdown', key: tool.key }, e.currentTarget as HTMLElement)}
                        >
                            ${this.icon(tool.icon)}
                            <span class="stack">
                                ${tool.options.map(
                                    (option, j) => html`<span ?data-current=${j === tool.selected}>${option.label}</span>`
                                )}
                                <span ?data-current=${tool.selected < 0}>–</span>
                            </span>
                            <md-icon aria-hidden="true">arrow_drop_down</md-icon>
                        </button>
                    </div>
                `
            }
        }
    }

    /** A slider's range input and its value, in a width that never depends on the value. */
    private renderRange(tool: ToolModel, ruler: boolean) {
        const dragged = !ruler && this.dragging?.key === tool.key ? this.dragging.value : undefined
        const value = dragged ?? tool.sliderValue
        return html`
            <input
                type="range"
                min=${tool.min}
                max=${tool.max}
                step=${tool.step}
                .value=${live(String(value))}
                aria-label=${tool.label || nothing}
                aria-valuetext=${`${formatNumber(value, tool.decimals)}${tool.unit ? ' ' + tool.unit : ''}`}
                ?disabled=${tool.disabled}
                @input=${ruler
                    ? nothing
                    : (e: Event) => {
                          this.dragging = { key: tool.key, value: Number((e.target as HTMLInputElement).value) }
                      }}
                @change=${ruler
                    ? nothing
                    : (e: Event) => {
                          this.dragging = undefined
                          this.interact(tool, Number((e.target as HTMLInputElement).value))
                      }}
            />
            <span class="readout"
                ><span class="stack"
                    ><span>${formatNumber(tool.min, tool.decimals)}</span
                    ><span>${formatNumber(tool.max, tool.decimals)}</span
                    ><span data-current>${formatNumber(value, tool.decimals)}</span></span
                >${tool.unit ? ` ${tool.unit}` : nothing}</span
            >
        `
    }

    private pick(tool: ToolModel, index: number) {
        // Picking what is already picked writes nothing: no duplicate row, no
        // extra step in the browser history.
        if (index === tool.selected) return
        const option = tool.options[index]
        if (option) this.interact(tool, option.value)
    }

    /** The open popup's content: the ⋮ menu's tools, or a dropdown's options. */
    private renderPopup(placement: Placement) {
        const popup = this.popup
        if (!popup) return nothing
        if (popup.kind === 'dropdown') {
            const tool = this.tools.find((t) => t.key === popup.key)
            if (!tool) return nothing
            return html`<div style=${this.toolStyle(tool)}>${this.renderChoices(tool, 'option')}</div>`
        }
        return placement.overflow.map((i) => (this.tools[i] ? this.renderMenuTool(this.tools[i]) : nothing))
    }

    private renderChoices(tool: ToolModel, role: 'option' | 'radio') {
        return tool.options.map(
            (option, j) => html`
                <button
                    class="menu-item"
                    role=${role}
                    aria-checked=${role === 'radio' ? (j === tool.selected ? 'true' : 'false') : nothing}
                    aria-selected=${role === 'option' ? (j === tool.selected ? 'true' : 'false') : nothing}
                    ?data-current=${j === tool.selected}
                    ?disabled=${tool.disabled}
                    @click=${() => {
                        this.closePopup()
                        this.pick(tool, j)
                    }}
                >
                    ${this.icon(option.icon)}<span class="text">${option.label}</span>
                    <md-icon
                        class="check"
                        aria-hidden="true"
                        style=${j === tool.selected ? 'visibility: visible' : nothing}
                        >check</md-icon
                    >
                </button>
            `
        )
    }

    /** A tool as a row of the ⋮ menu. */
    private renderMenuTool(tool: ToolModel): TemplateResult | typeof nothing {
        const style = this.toolStyle(tool)
        switch (tool.control) {
            case 'separator':
                return html`<hr />`
            case 'spacer':
                return nothing
            case 'label':
                return html`<div class="menu-heading">${this.icon(tool.icon)}${tool.label}</div>`
            case 'button': {
                const label = tool.label || tool.buttonValue
                return html`
                    <button
                        class="menu-item"
                        ?data-active=${tool.active}
                        aria-pressed=${tool.buttonValue.trim() ? (tool.active ? 'true' : 'false') : nothing}
                        ?disabled=${tool.disabled}
                        style=${style}
                        @click=${() => {
                            this.closePopup()
                            this.interact(tool)
                        }}
                    >
                        ${this.icon(tool.icon)}<span class="text">${label}</span>
                    </button>
                `
            }
            case 'switch':
                return html`
                    <label class="menu-item" ?data-disabled=${tool.disabled} style=${style}>
                        ${this.icon(tool.icon)}<span class="text">${tool.label}</span>
                        <md-switch
                            aria-label=${tool.label || nothing}
                            .selected=${live(tool.on)}
                            ?disabled=${tool.disabled}
                            @change=${(e: Event) => this.interact(tool, (e.target as MdSwitch).selected)}
                        ></md-switch>
                    </label>
                `
            case 'slider':
                return html`
                    <div class="menu-item column" ?data-disabled=${tool.disabled} style=${style}>
                        <div class="row">${this.icon(tool.icon)}<span class="text">${tool.label}</span></div>
                        <div class="row">${this.renderRange(tool, false)}</div>
                    </div>
                `
            case 'choice':
            case 'dropdown':
                return html`
                    <div role="radiogroup" aria-label=${tool.label || nothing} style=${style}>
                        ${tool.label ? html`<div class="menu-heading">${this.icon(tool.icon)}${tool.label}</div>` : nothing}
                        ${this.renderChoices(tool, 'radio')}
                    </div>
                `
        }
    }
}
