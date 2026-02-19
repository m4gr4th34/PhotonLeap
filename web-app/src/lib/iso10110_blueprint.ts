/**
 * ISO 10110 optical drawing generator.
 * Produces a technical blueprint: cross-section with dimensions, data table, title block.
 */

import type { SystemState } from '../types/system'

/** Compute cumulative Z positions (mm) */
function computeCumulativeZ(surfaces: { thickness: number }[]): number[] {
  const z: number[] = []
  let cum = 0
  for (let i = 0; i < surfaces.length; i++) {
    z.push(cum)
    cum += surfaces[i].thickness ?? 0
  }
  return z
}

/** Generate 2D profile path points for a surface (z, y in mm) */
function surfaceProfilePoints(
  zPos: number,
  radius: number,
  semiD: number,
  nPts = 24
): [number, number][] {
  const pts: [number, number][] = []
  if (Math.abs(radius) < 0.1) {
    pts.push([zPos, -semiD], [zPos, semiD])
  } else {
    const R = radius
    for (let i = 0; i <= nPts; i++) {
      const t = i / nPts
      const y = (t - 0.5) * 2 * semiD
      const radicand = Math.max(0, R * R - y * y)
      const zLocal = R - Math.sign(R) * Math.sqrt(radicand)
      pts.push([zPos + zLocal, y])
    }
  }
  return pts
}

export type BlueprintOptions = {
  projectName: string
  date: string
  drawnBy?: string
  width?: number
  height?: number
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen - 1) + '…'
}

/** Generate high-resolution SVG blueprint (ISO 10110 style) */
export function generateIso10110Svg(
  state: SystemState,
  options: BlueprintOptions
): string {
  const { projectName, date, drawnBy = 'MacOptics', width = 1400, height = 1000 } = options
  const surfaces = state.surfaces
  const epd = state.entrancePupilDiameter ?? 10

  const zPositions = computeCumulativeZ(surfaces)
  const totalLength = zPositions.length
    ? zPositions[zPositions.length - 1] + (surfaces[surfaces.length - 1]?.thickness ?? 0)
    : 0

  const dMax = surfaces.length
    ? Math.max(epd, ...surfaces.map((s) => s.diameter ?? epd))
    : epd
  const yExtent = dMax / 2 + 8

  const margin = 50
  const gap = 50
  const leftW = (width - margin * 2 - gap) / 2
  const drawHeight = height - margin * 2 - 120

  const zRange = Math.max(totalLength + 50, 60)
  const scaleX = (leftW - 80) / zRange
  const scaleY = drawHeight / (2 * yExtent + 30)
  const scale = Math.min(scaleX, scaleY, 10)

  const ox = margin + 60
  const oy = margin + 50 + drawHeight / 2

  const toSvg = (z: number, y: number) =>
    `${(ox + z * scale).toFixed(2)},${(oy - y * scale).toFixed(2)}`

  const pts: string[] = []
  for (let i = 0; i < surfaces.length; i++) {
    const s = surfaces[i]
    const z = zPositions[i] ?? 0
    const semi = (s.diameter ?? epd) / 2
    const surfPts = surfaceProfilePoints(z, s.radius, semi)
    if (surfPts.length >= 2) {
      pts.push(`M ${toSvg(surfPts[0][0], surfPts[0][1])}`)
      for (let j = 1; j < surfPts.length; j++) {
        pts.push(`L ${toSvg(surfPts[j][0], surfPts[j][1])}`)
      }
    }
  }
  const surfacePaths = pts.join(' ')

  // Glass fills (closed paths)
  const glassPaths: string[] = []
  for (let i = 0; i < surfaces.length - 1; i++) {
    const s = surfaces[i]
    const next = surfaces[i + 1]
    if ((s.refractiveIndex ?? 1) <= 1.01) continue
    const z = zPositions[i] ?? 0
    const zNext = zPositions[i + 1] ?? z + s.thickness
    const semi = (s.diameter ?? epd) / 2
    const frontPts = surfaceProfilePoints(z, s.radius, semi)
    const backPts = surfaceProfilePoints(zNext, next.radius, (next.diameter ?? epd) / 2).reverse()
    const all = [...frontPts, ...backPts]
    if (all.length >= 3) {
      const path =
        'M ' +
        all.map(([z_, y]) => toSvg(z_, y)).join(' L ') +
        ' Z'
      glassPaths.push(path)
    }
  }

  // Dimension lines — stagger labels above/below to prevent overlap
  const dimElements: string[] = []
  const dimLabels: { x: number; y: number; text: string }[] = []
  const tickLen = 4
  const yDimAbove = oy - yExtent * scale - 22
  const yDimBelow = oy + yExtent * scale + 32

  for (let i = 0; i < surfaces.length - 1; i++) {
    const s = surfaces[i]
    const z = zPositions[i] ?? 0
    const zNext = zPositions[i + 1] ?? z + s.thickness
    const ct = s.thickness ?? 0
    const x1 = ox + z * scale
    const x2 = ox + zNext * scale
    const useAbove = i % 2 === 0
    const yLine = useAbove ? yDimAbove + 14 : yDimBelow - 14
    const yLabel = useAbove ? yDimAbove : yDimBelow + 12

    dimElements.push(
      `M ${x1.toFixed(2)} ${oy} L ${x1.toFixed(2)} ${yLine}`,
      `M ${x2.toFixed(2)} ${oy} L ${x2.toFixed(2)} ${yLine}`,
      `M ${x1.toFixed(2)} ${yLine} L ${x2.toFixed(2)} ${yLine}`,
      `M ${x1.toFixed(2)} ${(yLine - tickLen).toFixed(2)} L ${x1.toFixed(2)} ${(yLine + tickLen).toFixed(2)}`,
      `M ${x2.toFixed(2)} ${(yLine - tickLen).toFixed(2)} L ${x2.toFixed(2)} ${(yLine + tickLen).toFixed(2)}`
    )
    dimLabels.push({ x: (x1 + x2) / 2, y: yLabel, text: `CT ${ct.toFixed(2)} mm` })
  }
  const yTot = oy + yExtent * scale + 45
  const x0 = ox
  const xEnd = ox + totalLength * scale
  dimElements.push(
    `M ${x0.toFixed(2)} ${oy} L ${x0.toFixed(2)} ${yTot}`,
    `M ${xEnd.toFixed(2)} ${oy} L ${xEnd.toFixed(2)} ${yTot}`,
    `M ${x0.toFixed(2)} ${yTot} L ${xEnd.toFixed(2)} ${yTot}`,
    `M ${x0.toFixed(2)} ${(yTot - tickLen).toFixed(2)} L ${x0.toFixed(2)} ${(yTot + tickLen).toFixed(2)}`,
    `M ${xEnd.toFixed(2)} ${(yTot - tickLen).toFixed(2)} L ${xEnd.toFixed(2)} ${(yTot + tickLen).toFixed(2)}`
  )
  dimLabels.push({
    x: (x0 + xEnd) / 2,
    y: yTot + 14,
    text: `TOTAL ${totalLength.toFixed(2)} mm`,
  })

  // Data table — grid with individual bordered cells
  const tableX = margin + leftW + gap + 10
  const tableY = margin + 24
  const rowH = 26
  const colW = [44, 56, 100, 72]
  const tableWidth = colW.reduce((a, b) => a + b, 0)
  const headers = ['Surf', 'S/D 3/2', 'Material', 'CT (mm)']

  let tableSvg = ''
  for (let r = 0; r <= surfaces.length; r++) {
    const y = tableY + r * rowH
    let x = tableX
    for (let c = 0; c < colW.length; c++) {
      const cw = colW[c]
      tableSvg += `<rect x="${x}" y="${y}" width="${cw}" height="${rowH}" fill="${r === 0 ? 'rgba(30,41,59,0.95)' : 'rgba(15,23,42,0.95)'}" stroke="#475569" stroke-width="0.8"/>`
      const cx = x + cw / 2
      const cy = y + rowH / 2 + 4
      if (r === 0) {
        tableSvg += `<text x="${cx}" y="${cy}" font-size="11" font-weight="bold" fill="#94a3b8" text-anchor="middle">${escapeXml(headers[c])}</text>`
      } else {
        const s = surfaces[r - 1]
        const ct = r > 1 ? (surfaces[r - 2]?.thickness ?? 0) : null
        const sd = s.surfaceQuality ?? '3/2'
        const mat = truncate(s.material || (s.type === 'Air' ? 'Air' : '—'), 14)
        const val = c === 0 ? String(r) : c === 1 ? sd : c === 2 ? mat : ct != null ? ct.toFixed(2) : '—'
        tableSvg += `<text x="${cx}" y="${cy}" font-size="10" fill="#e2e8f0" text-anchor="middle">${escapeXml(val)}</text>`
      }
      x += cw
    }
  }
  const tableHeight = (surfaces.length + 1) * rowH

  // Title block — labeled fields
  const tbX = tableX
  const tbY = tableY + tableHeight + 20
  const tbW = tableWidth
  const tbH = 90
  const fieldH = 26
  const labelW = 88

  const titleFields = [
    { label: 'Project Name:', value: projectName || '' },
    { label: 'Date:', value: date },
    { label: 'Drawn By:', value: drawnBy },
  ]

  let titleSvg = `<rect x="${tbX}" y="${tbY}" width="${tbW}" height="${tbH}" fill="rgba(30,41,59,0.95)" stroke="#475569" stroke-width="1" rx="4"/>`
  titleFields.forEach((f, i) => {
    const fy = tbY + 14 + i * (fieldH + 6)
    titleSvg += `<text x="${tbX + 10}" y="${fy + 16}" font-size="10" fill="#64748b">${escapeXml(f.label)}</text>`
    titleSvg += `<rect x="${tbX + labelW}" y="${fy}" width="${tbW - labelW - 12}" height="${fieldH}" fill="rgba(15,23,42,0.8)" stroke="#334155" stroke-width="0.6" rx="2"/>`
    titleSvg += `<text x="${tbX + labelW + 8}" y="${fy + 16}" font-size="10" fill="#e2e8f0">${escapeXml(f.value)}</text>`
  })

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <style>.dim-line { stroke: #64748b; stroke-width: 0.8; fill: none; }</style>
  </defs>
  <rect width="100%" height="100%" fill="#0f172a"/>
  <text x="${margin}" y="${margin + 12}" font-size="14" font-weight="bold" fill="#22D3EE">ISO 10110 Optical Drawing</text>

  <!-- Cross-section (left) -->
  <path d="${surfacePaths}" fill="none" stroke="#22D3EE" stroke-width="1.5"/>
  ${glassPaths.map((p) => `<path d="${p}" fill="rgba(34,211,238,0.15)" stroke="#22D3EE" stroke-width="1"/>`).join('\n  ')}

  <!-- Dimension lines -->
  ${dimElements.map((d) => `<path d="${d}" class="dim-line"/>`).join('\n  ')}
  ${dimLabels.map((l) => `<text x="${l.x}" y="${l.y}" font-size="10" fill="#94a3b8" text-anchor="middle">${l.text}</text>`).join('\n  ')}

  <!-- Surface Quality annotation (points to first optical surface) -->
  <text x="${ox - 12}" y="${oy - yExtent * scale - 8}" font-size="9" fill="#64748b" text-anchor="end">Surface Quality (Scratch/Dig)</text>
  <line x1="${ox}" y1="${oy - yExtent * scale * 0.6}" x2="${ox + totalLength * scale * 0.2}" y2="${oy}" stroke="#64748b" stroke-width="0.5" stroke-dasharray="4 2"/>

  <!-- Data table (right) -->
  ${tableSvg}

  <!-- Title block -->
  ${titleSvg}
</svg>`
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
