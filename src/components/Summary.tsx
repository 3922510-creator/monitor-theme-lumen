import { useEffect, useState } from "react"
import { Activity, ArrowDown, ArrowDownUp, ArrowUp, Gauge, Server } from "lucide-react"

import { speedHistory, type Node } from "@/lib/api"
import { bytes, rate } from "@/lib/format"
import { cn } from "@/lib/utils"

type Stat = {
  icon: React.ReactNode
  label: string
  right: React.ReactNode
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

  const stats: Stat[] = [
    {
      icon: <Gauge className="size-4 text-muted-foreground" />,
      label: "实时网速",
      right: (
        <span className="tnum flex items-center gap-3 text-sm font-semibold">
          <span className="flex items-center gap-1 text-sky-600 dark:text-sky-400">
            <ArrowDown className="size-3.5" />{rate(now.rx)}
          </span>
          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <ArrowUp className="size-3.5" />{rate(now.tx)}
          </span>
        </span>
      ),
    },
    {
      icon: <Server className="size-4 text-muted-foreground" />,
      label: "节点",
      right: (
        <span className="tnum text-sm font-semibold">
          {online.length} / {nodes.length}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {offline > 0 ? `${offline} 离线` : "全部在线"}
          </span>
        </span>
      ),
    },
    {
      icon: <Activity className="size-4 text-muted-foreground" />,
      label: "最忙节点",
      right: (
        <span className="tnum text-sm font-semibold">
          {cpu.toFixed(1)}%
          {busiest && <span className="ml-2 truncate text-xs font-normal text-muted-foreground">{busiest.name}</span>}
        </span>
      ),
    },
    {
      icon: <ArrowDownUp className="size-4 text-muted-foreground" />,
      label: "总流量",
      right: (
        <span className="tnum flex items-center gap-3 text-sm font-semibold">
          <span className="flex items-center gap-1 text-sky-600 dark:text-sky-400">
            <ArrowDown className="size-3.5" />{bytes(totalRx)}
          </span>
          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <ArrowUp className="size-3.5" />{bytes(totalTx)}
          </span>
        </span>
      ),
    },
  ]

  const StatCard = ({ s, className }: { s: Stat; className?: string }) => (
    <div className={cn("flex items-center gap-3 rounded-xl border bg-card px-4 py-3", className)}>
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/50">
        {s.icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{s.label}</div>
      </div>
      <div className="shrink-0">{s.right}</div>
    </div>
  )

  // One tile at a time on a phone, cycled: four stat rows stacked would push the
  // node list below the fold before it began.
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % stats.length), 3000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div>
      <div className="hidden grid-cols-2 gap-3 md:grid">
        {stats.map((s, i) => <StatCard key={i} s={s} />)}
      </div>

      <div className="relative h-[60px] select-none md:hidden" style={{ touchAction: "none" }}>
        {stats.map((s, i) => (
          <div
            key={i}
            className={cn(
              "absolute inset-0 transition-opacity duration-500",
              i === idx ? "opacity-100" : "opacity-0",
            )}
          >
            <StatCard s={s} className="h-full rounded-xl border-0" />
          </div>
        ))}
      </div>
    </div>
  )
}
