import { useEffect, useMemo, useRef, useState } from "react"
import {
  Activity, ArrowDown, ArrowDownUp, ArrowUp, Cpu, HardDrive, MemoryStick, RefreshCw,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Meter } from "@/components/Meter"
import { api, nodeSpeedHistory, type Node } from "@/lib/api"
import { bytes, daysUntil, osName, percent, rate, uptime } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * This period's usage as the plan meters it. The hub computes it in `month_used`;
 * the switch serves only a hub from before that field.
 */
function monthUsage(node: Node): number {
  if (typeof node.month_used === "number") return node.month_used
  const { month_rx: rx, month_tx: tx } = node
  switch (node.traffic_mode) {
    case "up":
      return tx
    case "down":
      return rx
    case "max":
      return Math.max(rx, tx)
    default:
      return rx + tx
  }
}

function deployed(node: Node) {
  return node.cpu_cores > 0 || node.mem_total > 0
}

// Country codes come from the hub as ISO 3166-1 alpha-2 values. Display the
// code itself so platforms cannot turn it into a country-flag emoji.
function countryFlag(code: string) {
  const normalized = code.trim().toUpperCase()
  return /^[A-Z]{2}$/.test(normalized) ? normalized : ""
}

// A bare bar sparkline of recent throughput: only the shape matters at this
// size, so a row of scaled blocks stands in for a chart.
function BlockSpark({ values, color, max }: { values: number[]; color: string; max?: number }) {
  if (!values.length) return <div className="flex h-3.5 items-end gap-[2px]" />
  const top = max ?? Math.max(...values, 1)
  return (
    <div className="flex h-3.5 items-end gap-[2px]">
      {values.map((v, i) => (
        <div
          key={i}
          className={cn("w-1 rounded-[1px] transition-all duration-300", color)}
          style={{ height: `${Math.max(15, (Math.min(v, top) / top) * 100)}%` }}
        />
      ))}
    </div>
  )
}

type PingPoint = {
  task_id: number
  ts: number
  latency: number | null
  loss?: number
}
type PingData = { ping: PingPoint[]; probes: Record<string, string>; loss?: Record<string, number> }

function usePing24h(nodeId: number, enabled: boolean) {
  const [data, setData] = useState<PingData | null>(null)
  useEffect(() => {
    if (!enabled) return
    let active = true
    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const load = () => {
      api<PingData>(`/nodes/${nodeId}/metrics?hours=24&points=288&series=ping`)
        .then((d) => { if (active) setData(d) })
        .catch(() => {
          if (!active) return
          if (++attempt < 3) {
            timer = setTimeout(load, 3000)
          } else {
            setData({ ping: [], probes: {} })
          }
        })
    }
    load()
    return () => { active = false; if (timer) clearTimeout(timer) }
  }, [nodeId, enabled])
  return data
}

// -500 in light for legibility on white (yellow/orange especially), -400 in
// dark where the card ground is dark.
function latColor(lat: number | null): string {
  if (lat === null) return "bg-muted"
  if (lat < 80) return "bg-emerald-500 dark:bg-emerald-400"
  if (lat < 150) return "bg-yellow-500 dark:bg-yellow-400"
  if (lat < 250) return "bg-orange-500 dark:bg-orange-400"
  return "bg-red-500 dark:bg-red-400"
}

function lossColor(loss: number | null): string {
  if (loss === null) return "bg-muted"
  if (loss < 1) return "bg-emerald-500 dark:bg-emerald-400"
  if (loss < 5) return "bg-yellow-500 dark:bg-yellow-400"
  if (loss < 10) return "bg-orange-500 dark:bg-orange-400"
  return "bg-red-500 dark:bg-red-400"
}

function latText(lat: number): string {
  if (lat < 80) return "text-emerald-600 dark:text-emerald-400"
  if (lat < 150) return "text-yellow-600 dark:text-yellow-400"
  if (lat < 250) return "text-orange-600 dark:text-orange-400"
  return "text-red-600 dark:text-red-400"
}

function lossText(loss: number): string {
  if (loss < 1) return "text-emerald-600 dark:text-emerald-400"
  if (loss < 5) return "text-yellow-600 dark:text-yellow-400"
  if (loss < 10) return "text-orange-600 dark:text-orange-400"
  return "text-red-600 dark:text-red-400"
}

function buildHourly(probePoints: PingPoint[]) {
  const byHour = new Map<number, { lat: number; latN: number; loss: number; lossN: number }>()
  for (const p of probePoints) {
    const hour = Math.floor(p.ts / 3600) * 3600
    const row = byHour.get(hour) ?? { lat: 0, latN: 0, loss: 0, lossN: 0 }
    if (p.latency !== null) { row.lat += p.latency; row.latN++ }
    row.loss += p.loss ?? 0
    row.lossN++
    byHour.set(hour, row)
  }
  const nowHour = Math.floor(Date.now() / 1000 / 3600) * 3600
  const hours: { ts: number; lat: number | null; loss: number | null }[] = []
  for (let i = 11; i >= 0; i--) {
    const ts = nowHour - i * 3600
    const row = byHour.get(ts)
    hours.push({
      ts,
      lat: row && row.latN > 0 ? row.lat / row.latN : null,
      loss: row && row.lossN > 0 ? row.loss / row.lossN : null,
    })
  }
  const lats = hours.filter((h) => h.lat !== null).map((h) => h.lat!)
  const losses = hours.filter((h) => h.loss !== null).map((h) => h.loss!)
  return {
    hours,
    avgLat: lats.length ? lats.reduce((a, b) => a + b, 0) / lats.length : 0,
    avgLoss: losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0,
  }
}

function ProbeHeatmap({ name, points }: { name: string; points: PingPoint[] }) {
  const h = useMemo(() => buildHourly(points), [points])
  if (!points.length) return null

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium">{name}</span>
        <span className="tnum shrink-0 text-xs text-muted-foreground">
          延迟 <span className={cn("font-semibold", latText(h.avgLat))}>{Math.round(h.avgLat)}ms</span>
          {" · "}
          丢包 <span className={cn("font-semibold", lossText(h.avgLoss))}>{h.avgLoss.toFixed(1)}%</span>
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="w-8 shrink-0 text-xs text-primary">延迟</span>
        <div className="flex flex-1 gap-[2px]">
          {h.hours.slice(0, 12).map((x, i) => (
            <div key={i} className={cn("h-3.5 w-full flex-1 rounded-[1px]", latColor(x.lat))} />
          ))}
        </div>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="w-8 shrink-0 text-xs text-violet-600 dark:text-violet-400">丢包</span>
        <div className="flex flex-1 gap-[2px]">
          {h.hours.slice(0, 12).map((x, i) => (
            <div key={i} className={cn("h-3.5 w-full flex-1 rounded-[1px]", lossColor(x.loss))} />
          ))}
        </div>
      </div>
    </div>
  )
}

function NetworkSection({ node }: { node: Node }) {
  const data = usePing24h(node.id, !!node.metrics)
  const [atBottom, setAtBottom] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const groups = useMemo(() => {
    if (!data?.ping?.length) return [] as { id: number; name: string; points: PingPoint[] }[]
    const byId = new Map<number, PingPoint[]>()
    for (const p of data.ping) {
      const arr = byId.get(p.task_id) ?? []
      arr.push(p)
      byId.set(p.task_id, arr)
    }
    return [...byId.entries()].map(([id, points]) => ({
      id,
      name: data.probes?.[id] ?? `探测 ${id}`,
      points,
    }))
  }, [data])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    setAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 2)
  }

  useEffect(() => { onScroll() }, [groups])

  const m = node.metrics

  return (
    <div className="mt-3 flex-1">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Activity className="size-3.5" />
          线路
          <span className="ml-1 text-[10px] font-normal text-muted-foreground/60">格/1H·TCP</span>
        </span>
        {m && (
          <span className="tnum text-xs text-muted-foreground">在线 {uptime(m.uptime)}</span>
        )}
      </div>
      <div className="relative mt-1.5">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="space-y-2 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ maxHeight: "140px" }}
        >
          {groups.length === 0 ? (
            <div className="py-2 text-center text-xs text-muted-foreground/50">暂无线路探测</div>
          ) : (
            groups.map((g) => <ProbeHeatmap key={g.id} name={g.name} points={g.points} />)
          )}
        </div>
        {groups.length > 2 && !atBottom && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-6 items-end justify-center bg-linear-to-t from-card to-transparent">
            <svg className="size-3 text-muted-foreground/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
        )}
      </div>
    </div>
  )
}

export function NodeCard({ node, onOpen }: { node: Node; onOpen: () => void }) {
  const m = node.metrics
  const hist = nodeSpeedHistory.get(node.id) ?? []
  const rxHist = hist.map((h) => h.rx)
  const txHist = hist.map((h) => h.tx)
  const sparkMax = Math.max(...rxHist, ...txHist, 1)

  const trafficPct = node.traffic_limit > 0 ? percent(monthUsage(node), node.traffic_limit) : null

  return (
    <Card className="flex h-full min-w-0 flex-col gap-0 p-5 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              node.online ? "bg-emerald-500 shadow-[0_0_0_3px] shadow-emerald-500/20" : "bg-muted-foreground/40",
            )}
          />
          {node.country && (
            <span
              className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-sm leading-none"
              title={node.country.toUpperCase()}
              aria-label={`地区 ${node.country.toUpperCase()}`}
            >
              {countryFlag(node.country) || node.country.toUpperCase()}
            </span>
          )}
          <h3
            onClick={onOpen}
            className="cursor-pointer truncate font-semibold transition-colors hover:text-primary"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onOpen()}
          >
            {node.name}
          </h3>
          {node.remark && (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {node.remark}
            </span>
          )}
        </div>
        {(() => {
          const days = node.expires_in !== undefined ? node.expires_in : daysUntil(node.expires_at)
          if (days === null || days === undefined) return null
          return (
            <span
              className={cn(
                "tnum shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold",
                days < 0
                  ? "bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-400"
                  : days <= 30
                    ? "bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400"
                    : "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400",
              )}
            >
              {days < 0 ? `已过期${-days}天` : `${days}天`}
            </span>
          )
        })()}
      </div>

      <p className="mt-1 truncate text-xs text-muted-foreground">
        {node.os ? osName(node.os) : "等待首次上报"}
        {node.arch ? ` · ${node.arch}` : ""}
        {node.virt && node.virt !== "none" ? ` · ${node.virt}` : ""}
      </p>

      {deployed(node) ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
            <Meter
              label={`CPU · ${node.cpu_cores} 核`}
              icon={<Cpu className="size-3" />}
              pct={m ? m.cpu : null}
              foot={m ? `load ${m.load[0].toFixed(2)} / ${m.load[1].toFixed(2)} / ${m.load[2].toFixed(2)}` : undefined}
              color="bg-teal-500 dark:bg-teal-400"
            />
            <Meter
              label="内存"
              icon={<MemoryStick className="size-3" />}
              pct={m ? percent(m.mem_used, m.mem_total) : null}
              foot={m ? `${bytes(m.mem_used)} / ${bytes(m.mem_total)}` : undefined}
              color="bg-sky-500 dark:bg-sky-400"
            />
            <Meter
              label="磁盘"
              icon={<HardDrive className="size-3" />}
              pct={m ? percent(m.disk_used, m.disk_total) : null}
              foot={m ? `${bytes(m.disk_used)} / ${bytes(m.disk_total)}` : undefined}
              color="bg-amber-500 dark:bg-amber-400"
            />
            <Meter
              label="Swap"
              icon={<RefreshCw className="size-3" />}
              pct={m && m.swap_total > 0 ? percent(m.swap_used, m.swap_total) : null}
              foot={m && m.swap_total > 0 ? `${bytes(m.swap_used)} / ${bytes(m.swap_total)}` : undefined}
              empty={m ? "无" : "—"}
              color="bg-violet-500 dark:bg-violet-400"
            />
          </div>

          <div className="mt-3 border-t border-border/60" />

          <div className="mt-3 flex items-center justify-between gap-1.5 text-xs font-medium text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <ArrowDownUp className="size-3.5" />
              网络
            </span>
            <span className="tnum flex items-center gap-2 text-[10px] font-normal text-muted-foreground/70">
              <span className="flex items-center gap-0.5">
                <ArrowUp className="size-2.5 text-emerald-500" />{bytes(node.day_tx)}
              </span>
              <span className="flex items-center gap-0.5">
                <ArrowDown className="size-2.5 text-sky-500" />{bytes(node.day_rx)}
              </span>
              /日
            </span>
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-x-4">
            <div>
              <div className="flex items-baseline gap-1.5">
                <ArrowUp className="size-3 shrink-0 text-emerald-500" />
                <span className="tnum text-sm font-bold text-emerald-600 dark:text-emerald-400">
                  {m ? rate(m.net_tx) : "—"}
                </span>
              </div>
              <div className="mt-1">
                <BlockSpark values={txHist} color="bg-emerald-400/60" max={sparkMax} />
              </div>
            </div>
            <div>
              <div className="flex items-baseline gap-1.5">
                <ArrowDown className="size-3 shrink-0 text-sky-500" />
                <span className="tnum text-sm font-bold text-sky-600 dark:text-sky-400">
                  {m ? rate(m.net_rx) : "—"}
                </span>
              </div>
              <div className="mt-1">
                <BlockSpark values={rxHist} color="bg-sky-400/60" max={sparkMax} />
              </div>
            </div>
          </div>

          <div className="mt-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <ArrowDownUp className="size-3" />
                流量
                <span className="tnum ml-1 text-xs text-muted-foreground/70">
                  {bytes(monthUsage(node))} / {node.traffic_limit > 0 ? bytes(node.traffic_limit) : "∞"}
                </span>
              </span>
              {node.traffic_limit > 0 ? (
                <span className="tnum text-xs font-semibold text-foreground">
                  {trafficPct !== null ? `${trafficPct < 10 ? trafficPct.toFixed(1) : trafficPct.toFixed(0)}%` : "—"}
                </span>
              ) : (
                <span className="tnum text-xs text-muted-foreground">∞</span>
              )}
            </div>
            <div className="mt-1.5 flex gap-[3px]">
              {Array.from({ length: 20 }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "h-2 flex-1 rounded-[2px] transition-colors duration-500",
                    node.traffic_limit <= 0 || i < Math.round((trafficPct ?? 0) / 5)
                      ? "bg-teal-500 dark:bg-teal-400"
                      : "bg-muted",
                  )}
                />
              ))}
            </div>
          </div>

          <div className="mt-3 border-t border-border/60" />

          <NetworkSection node={node} />
        </>
      ) : (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          还没有接入。在后台生成安装命令并执行一次。
        </p>
      )}
    </Card>
  )
}

export function Country({ node }: { node: Node }) {
  if (!node.country) return null
  return (
    <Badge
      variant="outline"
      className="shrink-0 font-normal text-muted-foreground"
      title={node.country.toUpperCase()}
      aria-label={`地区 ${node.country.toUpperCase()}`}
    >
      {countryFlag(node.country) || node.country.toUpperCase()}
    </Badge>
  )
}
