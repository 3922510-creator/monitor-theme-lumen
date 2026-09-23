import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

type Props = {
  label: ReactNode
  pct: number | null
  foot?: ReactNode
  empty?: ReactNode
  color?: string
  icon?: ReactNode
  noBar?: boolean
}

const BLOCKS = 20

/**
 * One metric as a row of lit blocks: label and percentage on top, twenty
 * segments filling left to right, the raw figures small underneath. The block
 * bar reads at a glance on a dense card and keeps the theme's colour per metric
 * rather than the default theme's single monochrome fill.
 */
export function Meter({ label, pct, foot, empty = "—", color = "bg-primary", icon, noBar = false }: Props) {
  const filled = pct === null ? 0 : Math.min(100, Math.max(0, pct))
  const lit = Math.round((filled / 100) * BLOCKS)
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {icon}
          {label}
        </span>
        <span className="tnum text-xs font-semibold text-foreground">
          {pct === null ? (foot ?? empty) : `${filled < 10 ? filled.toFixed(1) : filled.toFixed(0)}%`}
        </span>
      </div>
      {!noBar && (
        <div className="mt-1.5 flex gap-[3px]">
          {Array.from({ length: BLOCKS }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-2 flex-1 rounded-[2px] transition-colors duration-500",
                i < lit ? color : "bg-muted",
              )}
            />
          ))}
        </div>
      )}
      {foot && pct !== null && (
        <div className="tnum mt-1 text-right text-[10px] text-muted-foreground">{foot}</div>
      )}
    </div>
  )
}
