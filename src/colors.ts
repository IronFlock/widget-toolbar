/**
 * Colour helpers for the parts of the toolbar that need a real colour rather
 * than a var() chain: the opaque surface of the menu and the confirmation
 * dialog (the tile behind them is usually translucent), and the text colour
 * on an accent-coloured button. Taken from widget-filter-dropdown.
 */

let colorContext: CanvasRenderingContext2D | null | undefined

// A colour as [r, g, b, alpha] in sRGB (channels 0-255), parsed by the browser
// itself through a canvas's fillStyle, so names, hsl(), hex with alpha,
// color-mix() and the like all work. A value the browser rejects comes back
// fully transparent. Only the normalised string is read, never pixels: with
// Firefox's resistFingerprinting on, getImageData() answers with random colours.
export const parseColor = (value: string): number[] => {
    colorContext ??= document.createElement('canvas').getContext('2d')
    if (!colorContext) return [0, 0, 0, 0]
    // Chromium hands oklch(), lab(), color() and the like back as written;
    // mixed into srgb they come back as color(srgb r g b / alpha).
    for (const candidate of [value, `color-mix(in srgb, ${value} 100%, transparent)`]) {
        // A rejected value leaves the previous fillStyle in place, so set it
        // after two different placeholders: only an accepted one reads the same.
        colorContext.fillStyle = '#000'
        colorContext.fillStyle = candidate
        const color = String(colorContext.fillStyle)
        colorContext.fillStyle = '#fff'
        colorContext.fillStyle = candidate
        if (String(colorContext.fillStyle) !== color) continue
        let match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/.exec(color)
        if (match) return [...match.slice(1).map((hex) => parseInt(hex, 16)), 1]
        match = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(color)
        if (match) return match.slice(1).map(Number)
        match = /^color\(srgb (\S+) (\S+) (\S+)(?: \/ (\S+))?\)$/.exec(color)
        if (match) {
            const [r, g, b] = match.slice(1, 4).map((v) => Math.min(Math.max(Number(v) || 0, 0), 1) * 255)
            return [r, g, b, Number(match[4] ?? 1) || 0]
        }
    }
    return [0, 0, 0, 0]
}

const surfaceCache = new Map<string, string>()

/**
 * Paint the given colours, bottom first, over white, as the screen composites
 * a translucent background over what is behind it, and return the opaque
 * result as #rrggbb.
 */
export const opaqueSurface = (layers: string[]): string => {
    const key = JSON.stringify(layers)
    const cached = surfaceCache.get(key)
    if (cached !== undefined) return cached

    let surface = [255, 255, 255]
    for (const layer of layers) {
        const [r, g, b, alpha] = parseColor(layer)
        surface = [r, g, b].map((channel, i) => channel * alpha + surface[i] * (1 - alpha))
    }
    const hex = '#' + surface.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')
    if (surfaceCache.size > 200) surfaceCache.clear()
    surfaceCache.set(key, hex)
    return hex
}

// WCAG relative luminance of an opaque #rrggbb colour (0 black, 1 white).
const luminance = (hex: string): number => {
    const [r, g, b] = [1, 3, 5].map((i) => {
        const channel = parseInt(hex.slice(i, i + 2), 16) / 255
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio of two opaque #rrggbb colours, from 1 to 21. */
export const contrast = (a: string, b: string): number => {
    const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (lighter + 0.05) / (darker + 0.05)
}

// WCAG's minimum contrast for a control against its surroundings.
const ACCENT_CONTRAST = 3

const isColor = (color: unknown): color is string =>
    typeof color === 'string' && color.trim() !== '' && parseColor(color)[3] > 0

/**
 * The accent: a configured colour as written; otherwise the theme's first
 * palette colour when it stands out from the surface; otherwise the text
 * colour, which is picked to read on the tile.
 */
export const accentColor = (configured: unknown, themeColor: unknown, surface: string, textColor: string): string => {
    if (isColor(configured)) return configured.trim()
    if (isColor(themeColor) && contrast(opaqueSurface([surface, themeColor]), surface) >= ACCENT_CONTRAST)
        return themeColor
    return textColor
}

/** Black or white, whichever reads better on the accent painted over the surface. */
export const onColor = (accent: string, surface: string): string => {
    const painted = opaqueSurface([surface, accent])
    return contrast(painted, '#ffffff') >= contrast(painted, '#000000') ? '#ffffff' : '#000000'
}
