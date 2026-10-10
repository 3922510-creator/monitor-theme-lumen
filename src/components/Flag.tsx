import { cn } from "@/lib/utils"

// Emitted as files and fetched on first use, so a page carries only the flags its
// nodes are in rather than all 267. vite.config.ts keeps them from being inlined
// into the bundle as data URLs. The simplified set, because this theme is
// embedded in the hub binary: flag-icons' detailed emblems total 1.95 MiB against
// 174 KiB here, a difference invisible at 18 by 12 pixels.
export const FLAGS = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("/node_modules/country-flag-icons/3x2/*.svg", {
      query: "?url",
      import: "default",
      eager: true,
    }),
  ).map(([path, url]) => [path.match(/([\w-]+)\.svg$/)![1], url]),
)

/** The flag for an ISO 3166-1 alpha-2 code, or nothing when the set has none. */
export function Flag({ code, className }: { code: string; className?: string }) {
  const src = FLAGS[code]
  if (!src) return null
  return (
    <img
      src={src}
      alt={code}
      title={code}
      className={cn("h-3 w-4.5 shrink-0 rounded-[2px] ring-1 ring-foreground/10", className)}
    />
  )
}
