import { Activity, ArrowDown, ArrowDownUp, ArrowUp, Gauge, Server } from "lucide-react"
import type { ReactNode } from "react"

import { speedHistory, type Node } from "@/lib/api"
import { bytes, rate } from "@/lib/format"
import { cn } from "@/lib/utils"

type Stat = {
  icon: ReactNode
  label: string
  value: ReactNode
}

export function Summary({ nodes, group = null }: { nodes: Node[]; group?: string | null }) {
  const online = nodes.filter((n) => n.online)
  const offline = nodes.length - online.length

  // The busiest node rather than the average: one machine at 95% is what matters,
  // and a fleet of idle ones would average it away.
  const busiest = online.reduce<Node | null>(
    (top, n) => (n.metrics && (!top || n.metrics.cpu > top.metrics!.cpu) ? n : top),
    null,
  )
  const cpu = busiest?.metrics?.cpu ?? 0

  const totalRx = nodes.reduce((s, n) => s + n.total_rx, 0)
  const totalTx = nodes.reduce((s, n) => s + n.total_tx, 0)
  // The key holds that scope's throughput -- null the whole fleet, else the
  // group tab -- and its last point is the sample that arrived with this list.
  const now = speedHistory.get(group)?.at(-1) ?? { rx: 0, tx: 0 }

  // Each value is a row of parts that the two layouts below size and space
  // themselves: the label and the figure are read at a glance, so where the
  // figure sits decides how it is set, not the other way round.
  const down = (v: string) => (
    <span className="flex items-center gap-1 whitespace-nowrap text-sky-600 dark:text-sky-400">
      <ArrowDown className="size-3.5" />
      {v}
    </span>
  )
  const up = (v: string) => (
    <span className="flex items-center gap-1 whitespace-nowrap text-emerald-600 dark:text-emerald-400">
      <ArrowUp className="size-3.5" />
      {v}
    </span>
  )

  const stats: Stat[] = [
    {
      icon: <Gauge className="size-3.5 text-muted-foreground" />,
      label: "实时网速",
      value: (
        <>
          {down(rate(now.rx))}
          {up(rate(now.tx))}
        </>
      ),
    },
    {
      icon: <Server className="size-3.5 text-muted-foreground" />,
      label: "节点",
      value: (
        <>
          <span>
            {online.length} / {nodes.length}
          </span>
          <span className="truncate text-xs font-normal text-muted-foreground">
            {offline > 0 ? `${offline} 离线` : "全部在线"}
          </span>
        </>
      ),
    },
    {
      icon: <Activity className="size-3.5 text-muted-foreground" />,
      label: "最忙节点",
      value: (
        <>
          <span>{cpu.toFixed(1)}%</span>
          {busiest && (
            <span className="truncate text-xs font-normal text-muted-foreground">{busiest.name}</span>
          )}
        </>
      ),
    },
    {
      icon: <ArrowDownUp className="size-3.5 text-muted-foreground" />,
      label: "总流量",
      value: (
        <>
          {down(bytes(totalRx))}
          {up(bytes(totalTx))}
        </>
      ),
    },
  ]

  // Wide: one row per figure, icon and label to the left of it.
  const StatCard = ({ s, className }: { s: Stat; className?: string }) => (
    <div className={cn("flex items-center gap-3 rounded-xl border bg-card px-4 py-3", className)}>
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/50">
        {s.icon}
      </div>
      <div className="min-w-0 flex-1 text-xs text-muted-foreground">{s.label}</div>
      <div className="tnum flex shrink-0 items-center gap-3 text-sm font-semibold">{s.value}</div>
    </div>
  )

  // Phone: all four at once, two per row, label above the figure. Four rows of
  // the wide card would push the node list below the fold, and cycling one at a
  // time hides whichever figure is not on screen -- the two worth a glance being
  // the live speed and the busiest node.
  const StatTile = ({ s }: { s: Stat }) => (
    <div className="min-w-0 rounded-xl border bg-card px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {s.icon}
        <span className="truncate">{s.label}</span>
      </div>
      {/* Wraps as whole figures: a 320-wide phone cannot hold both directions of
          a speed on one line, and letting the digits break inside a figure reads
          as two numbers. */}
      <div className="tnum mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-semibold">
        {s.value}
      </div>
    </div>
  )

  return (
    <div>
      <div className="hidden grid-cols-2 gap-3 md:grid">
        {stats.map((s, i) => <StatCard key={i} s={s} />)}
      </div>

      <div className="grid grid-cols-2 gap-2 md:hidden">
        {stats.map((s, i) => <StatTile key={i} s={s} />)}
      </div>
    </div>
  )
}
