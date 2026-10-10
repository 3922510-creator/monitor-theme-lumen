import { useEffect, useMemo, useState } from "react"
import { Maximize2, X } from "lucide-react"

import { Flag } from "@/components/Flag"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import type { Node } from "@/lib/api"
import { cn } from "@/lib/utils"
import { COUNTRY_POINT, WORLD_PATH, WORLD_VIEWBOX } from "@/lib/world"

type Health = "ok" | "warn" | "off"
type Place = { code: string; name: string; total: number; online: number }

const DOT: Record<Health, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  off: "bg-destructive",
}
const TEXT: Record<Health, string> = {
  ok: "正常",
  warn: "需关注",
  off: "离线",
}

/**
 * CLDR names these two in full ("中国香港特别行政区"), which is too long for a
 * chip next to 6 others.
 */
const SHORT: Record<string, string> = { HK: "香港", MO: "澳门" }

const NAMES = (() => {
  try {
    return new Intl.DisplayNames(["zh-CN"], { type: "region" })
  } catch {
    // No Intl.DisplayNames: the two-letter code stands in.
    return null
  }
})()

function countryName(code: string) {
  if (SHORT[code]) return SHORT[code]
  try {
    return NAMES?.of(code) ?? code
  } catch {
    return code
  }
}

function health(place: Place): Health {
  if (place.online === place.total) return "ok"
  return place.online === 0 ? "off" : "warn"
}

/**
 * One mark per country rather than per node: nodes pile up on the same handful of
 * cities, and the count says more at this size than a second overlapping pin
 * would. Countries the hub has not located yet are left off entirely.
 */
function toPlaces(nodes: Node[]): Place[] {
  const by = new Map<string, Place>()
  for (const node of nodes) {
    const code = node.country.trim().toUpperCase()
    if (!code || !COUNTRY_POINT[code]) continue
    const place = by.get(code) ?? { code, name: countryName(code), total: 0, online: 0 }
    place.total += 1
    if (node.online) place.online += 1
    by.set(code, place)
  }
  return [...by.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "zh"))
}

/**
 * Markers are a fixed 20-24 pixels across while the frame spans 360 units, so
 * countries a few degrees apart -- 香港 and 台湾 are seven -- would draw as one
 * blob. Each marker is pushed off the ones already placed by up to a dozen
 * units: invisible on a world map, enough to keep both readable.
 */
const MIN_GAP = 12

function spread(places: Place[]): [number, number][] {
  const placed: [number, number][] = []
  for (const place of places) {
    const [x0, y0] = COUNTRY_POINT[place.code]
    let x = x0
    let y = y0
    for (const [px, py] of placed) {
      const dx = x - px
      const dy = y - py
      const gap = Math.hypot(dx, dy)
      if (gap >= MIN_GAP) continue
      // Straight down when two markers land on exactly the same spot.
      const ux = gap < 0.01 ? 0 : dx / gap
      const uy = gap < 0.01 ? 1 : dy / gap
      x += ux * (MIN_GAP - gap)
      y += uy * (MIN_GAP - gap)
    }
    // Never far from the country it marks, then clear of the frame's edge: a
    // marker is wider than the few pixels between it and the border, and the
    // countries that touch the border sit on the 180th meridian, where either
    // edge is the same place.
    x = Math.min(x0 + MIN_GAP, Math.max(x0 - MIN_GAP, x))
    y = Math.min(y0 + MIN_GAP, Math.max(y0 - MIN_GAP, y))
    placed.push([Math.min(356, Math.max(4, x)), Math.min(174, Math.max(4, y))])
  }
  return placed
}

function Pins({ places }: { places: Place[] }) {
  const marks = useMemo(() => spread(places), [places])
  return (
    <>
      {places.map((place, i) => {
        const [x, y] = marks[i]
        const state = health(place)
        const left = (x / 360) * 100
        const top = (y / 180) * 100
        return (
          <div
            key={place.code}
            title={`${place.name} · ${place.total} 台（${TEXT[state]}）`}
            className={cn(
              "absolute grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full",
              "text-[10px] font-semibold tabular-nums text-white shadow-sm ring-2 ring-background/60",
              "sm:size-6 sm:text-[11px]",
              DOT[state],
            )}
            style={{
              left: `${left}%`,
              top: `${top}%`,
            }}
          >
            {place.total}
          </div>
        )
      })}
    </>
  )
}

function WorldMap({ places, className }: { places: Place[]; className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-lg bg-muted/40", className)}>
      <svg
        viewBox={WORLD_VIEWBOX}
        className="block h-auto w-full"
        role="img"
        aria-label={`节点分布在 ${places.length} 个国家和地区`}
      >
        <path d={WORLD_PATH} className="fill-muted-foreground/25 dark:fill-muted-foreground/20" />
      </svg>
      <div className="absolute inset-0">
        <Pins places={places} />
      </div>
    </div>
  )
}

function Chips({ places }: { places: Place[] }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-0.5">
      {places.map((place) => (
        <div
          key={place.code}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-xs"
        >
          <Flag code={place.code} />
          <span className="whitespace-nowrap">{place.name}</span>
          <span className="tnum font-semibold text-muted-foreground">{place.total}</span>
        </div>
      ))}
    </div>
  )
}

function Legend() {
  return (
    <div className="flex items-center gap-2.5 text-[11px] text-muted-foreground sm:text-xs">
      {(["ok", "warn", "off"] as const).map((state) => (
        <span key={state} className="flex items-center gap-1">
          <span className={cn("size-2 rounded-full", DOT[state])} />
          {TEXT[state]}
        </span>
      ))}
    </div>
  )
}

/**
 * Where the nodes are, above the live figures: the world map answers "how spread
 * out is this" at a glance, which a table of country names does not. A country
 * of one marks the node as 正常/需关注/离线 with the same three colours the
 * cards below use.
 */
export function NodeMap({ nodes }: { nodes: Node[] }) {
  const places = useMemo(() => toPlaces(nodes), [nodes])
  const [zoomed, setZoomed] = useState(false)

  useEffect(() => {
    if (!zoomed) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoomed(false)
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  }, [zoomed])

  // Nothing located yet: a card with an empty map says less than no card.
  if (places.length === 0) return null

  const total = places.reduce((sum, place) => sum + place.total, 0)
  // The hub leaves `country` empty until its lookup answers, so the map can cover
  // fewer nodes than the list below it does.
  const unlocated = nodes.length - total

  return (
    <Card className="gap-3 p-4 sm:p-5">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h2 className="text-sm font-semibold">全球节点分布</h2>
          <div className="ml-auto flex items-center gap-2">
            <Legend />
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              onClick={() => setZoomed(true)}
              title="放大查看"
              aria-label="放大查看"
            >
              <Maximize2 />
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {places.length} 个国家和地区 · {total} 台
          {unlocated > 0 && `（另 ${unlocated} 台未定位）`}
        </p>
      </div>

      <WorldMap places={places} />
      <Chips places={places} />

      {/* The map is 320 pixels wide on a phone, which is where the counts stop
          being readable; this is the same map with room around it. */}
      {zoomed && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="全球节点分布"
          className="fixed inset-0 z-50 flex flex-col justify-center bg-background/95 p-4 backdrop-blur-sm"
          onClick={() => setZoomed(false)}
        >
          <div className="mx-auto w-full max-w-5xl space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold">全球节点分布</h2>
              <span className="text-xs text-muted-foreground">{total} 台</span>
              <Button
                variant="ghost"
                size="icon-sm"
                className="ml-auto"
                onClick={() => setZoomed(false)}
                title="关闭"
                aria-label="关闭"
              >
                <X />
              </Button>
            </div>
            {/* Wider than the screen on a phone, and scrolled sideways: the
                marker text is the same size, so the extra width is what
                separates the countries that touch each other in the card. */}
            <div className="overflow-x-auto">
              <WorldMap places={places} className="min-w-[170%] sm:min-w-0" />
            </div>
            <Chips places={places} />
          </div>
        </div>
      )}
    </Card>
  )
}
