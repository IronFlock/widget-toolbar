/**
 * Which tools the bar shows, at which density, and which move into the ⋮ menu.
 * Pure: it works on sizes the element measured, so it can be tested without a
 * browser.
 *
 * Main axis: along the bar (width when horizontal, height when vertical).
 * Cross axis: across it.
 */

export type Extent = { main: number; cross: number }

export type Item = {
    kind: 'tool' | 'separator' | 'spacer'
    /** The tool drawn with its label. */
    full: Extent
    /** The tool drawn as small as it gets: icon-only buttons and choices, a shorter slider. */
    compact: Extent
}

export type LayoutInput = {
    items: Item[]
    /** The bar's content box. */
    available: Extent
    /** Space between two items on the main axis. */
    gap: number
    /** The ⋮ button. */
    more: Extent
    /**
     * Whether the cross axis limits the tools: true for a vertical strip, where
     * a switch with its label can be wider than the strip. Each tool then gets
     * its labels where it fits across, is compact where only that fits, and
     * goes to the menu where neither does. A horizontal bar centres its tools
     * and lets the tile clip them.
     */
    checkCross: boolean
}

export type Density = 'full' | 'compact'

export type Placement = {
    /** Indexes of the items in the bar, in order. */
    visible: number[]
    /** Indexes of the visible items drawn compact. */
    compact: number[]
    /** Indexes of the items in the menu, in order. Empty: no ⋮ button. */
    overflow: number[]
}

/**
 * Separators only between tools: none at either end, none next to another.
 * Spacers don't count as tools, and in the menu they mean nothing.
 */
function tidy(items: Item[], indexes: number[], keepSpacers: boolean): number[] {
    const kept = indexes.filter((i) => keepSpacers || items[i].kind !== 'spacer')
    const result: number[] = []
    // The last tool or separator kept; spacers sit between them unseen.
    let last: 'none' | 'tool' | 'separator' = 'none'
    kept.forEach((i, n) => {
        const kind = items[i].kind
        if (kind === 'separator') {
            const toolAfter = kept.slice(n + 1).some((j) => items[j].kind === 'tool')
            if (last !== 'tool' || !toolAfter) return
            last = 'separator'
        } else if (kind === 'tool') {
            last = 'tool'
        }
        result.push(i)
    })
    return result
}

export function place(input: LayoutInput): Placement {
    const { items, available, gap, more, checkCross } = input
    const fitsAcross = (extent: Extent) => !checkCross || extent.cross <= available.cross

    // A density per item, or undefined where the item fits across at neither.
    type Choice = (Density | undefined)[]
    const preferred: Choice = items.map((item) =>
        item.kind !== 'tool' || fitsAcross(item.full) ? 'full' : fitsAcross(item.compact) ? 'compact' : undefined
    )
    const allCompact: Choice = items.map((item) =>
        item.kind !== 'tool' || fitsAcross(item.compact) ? 'compact' : undefined
    )

    const done = (choice: Choice, visible: number[], overflow: number[]): Placement => {
        const bar = tidy(items, visible, true)
        const menu = tidy(items, overflow, false)
        // A menu of separators alone is no menu.
        const hasTools = menu.some((i) => items[i].kind === 'tool')
        return {
            visible: bar,
            compact: bar.filter((i) => items[i].kind === 'tool' && choice[i] === 'compact'),
            overflow: hasTools ? menu : []
        }
    }

    const length = (choice: Choice, indexes: number[]): number =>
        indexes.reduce((sum, i, n) => sum + items[i][choice[i] ?? 'compact'].main + (n > 0 ? gap : 0), 0)

    // Everything in the bar: with labels where possible; else compact the
    // tools that save the most first, so the labels go where they cost most
    // and the rest keep theirs.
    if (!preferred.some((density) => density === undefined)) {
        const shown = tidy(items, items.map((_, i) => i), true)
        const choice = [...preferred]
        const savings = shown
            .filter((i) => items[i].kind === 'tool' && choice[i] === 'full')
            .map((i) => ({ i, saving: items[i].full.main - items[i].compact.main }))
            .filter(({ saving }) => saving > 0)
            .sort((a, b) => b.saving - a.saving || a.i - b.i)
        let total = length(choice, shown)
        for (const { i, saving } of savings) {
            if (total <= available.main) break
            choice[i] = 'compact'
            total -= saving
        }
        if (total <= available.main) return done(choice, shown, [])
    }

    // The ⋮ menu: the first tools that fit, then the rest. Once one tool does
    // not fit, every tool after it goes to the menu too, so the bar keeps the
    // configured order. Tools that fit across at neither density go anyway.
    const budget = available.main - more.main - gap
    const fill = (choice: Choice) => {
        const visible: number[] = []
        const overflow: number[] = []
        let used = 0
        let full = false
        items.forEach((item, i) => {
            const density = choice[i]
            if (density === undefined) {
                overflow.push(i)
                return
            }
            const add = (visible.length > 0 ? gap : 0) + item[density].main
            if (!full && used + add <= budget) {
                visible.push(i)
                used += add
            } else {
                full = true
                overflow.push(i)
            }
        })
        return { visible, overflow }
    }
    // Keep the labels when that costs no tool, else go compact.
    const labelled = fill(preferred)
    const small = fill(allCompact)
    const count = (indexes: number[]) => indexes.filter((i) => items[i].kind === 'tool').length
    return count(labelled.visible) >= count(small.visible)
        ? done(preferred, labelled.visible, labelled.overflow)
        : done(allCompact, small.visible, small.overflow)
}
