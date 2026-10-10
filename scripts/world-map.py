#!/usr/bin/env python3
"""Generate `src/lib/world.ts` from Natural Earth data.

Run by hand, not by the build: the output is committed, so a build needs no
network and no geo dependency.

    python3 scripts/world-map.py --atlas countries-110m.json --pins countries-50m.json --out src/lib/world.ts

Both files come from world-atlas (Natural Earth, public domain). `--atlas` draws
the backdrop and `--pins` places the markers: the 110m coastline is a fifth of
the size, while the 50m set is the coarsest one that still carries small
territories, Hong Kong and Singapore among them, which the stricter filter of the
110m set drops. Pins are computed here rather than taken from a coordinate
table, so the whole file derives from the one public-domain source.

Coordinates are emitted in an equirectangular frame -- viewBox 0 0 360 180, one
unit per degree -- and rounded to a tenth of a degree, which is about three
pixels across at the size the map is drawn.
"""
import argparse
import json
from pathlib import Path

# Natural Earth identifies countries by ISO 3166-1 numeric; the hub reports
# alpha-2. Facts of the standard, listed here so no coordinate database is
# needed to translate between them.
NUMERIC_TO_ALPHA2 = {
    "004": "AF", "008": "AL", "012": "DZ", "020": "AD", "024": "AO", "028": "AG", "032": "AR",
    "036": "AU", "040": "AT", "044": "BS", "048": "BH", "050": "BD", "051": "AM", "052": "BB",
    "056": "BE", "060": "BM", "064": "BT", "068": "BO", "070": "BA", "072": "BW", "076": "BR",
    "084": "BZ", "090": "SB", "096": "BN", "100": "BG", "104": "MM", "108": "BI", "112": "BY",
    "116": "KH", "120": "CM", "124": "CA", "140": "CF", "144": "LK", "148": "TD", "152": "CL",
    "156": "CN", "158": "TW", "170": "CO", "178": "CG", "180": "CD", "188": "CR", "191": "HR",
    "192": "CU", "196": "CY", "203": "CZ", "204": "BJ", "208": "DK", "214": "DO", "218": "EC",
    "222": "SV", "226": "GQ", "231": "ET", "232": "ER", "233": "EE", "242": "FJ", "246": "FI",
    "250": "FR", "260": "TF", "262": "DJ", "268": "GE", "270": "GM", "275": "PS", "276": "DE",
    "288": "GH", "300": "GR", "304": "GL", "320": "GT", "324": "GN", "328": "GY", "332": "HT",
    "340": "HN", "344": "HK", "348": "HU", "352": "IS", "356": "IN", "360": "ID", "364": "IR",
    "368": "IQ", "372": "IE", "376": "IL", "380": "IT", "384": "CI", "388": "JM", "392": "JP",
    "398": "KZ", "400": "JO", "404": "KE", "408": "KP", "410": "KR", "414": "KW", "417": "KG",
    "418": "LA", "422": "LB", "426": "LS", "428": "LV", "430": "LR", "434": "LY", "440": "LT",
    "442": "LU", "446": "MO", "450": "MG", "454": "MW", "458": "MY", "466": "ML", "478": "MR",
    "484": "MX", "496": "MN", "498": "MD", "499": "ME", "504": "MA", "508": "MZ", "512": "OM",
    "516": "NA", "524": "NP", "528": "NL", "540": "NC", "548": "VU", "554": "NZ", "558": "NI",
    "562": "NE", "566": "NG", "578": "NO", "586": "PK", "591": "PA", "598": "PG", "600": "PY",
    "604": "PE", "608": "PH", "616": "PL", "620": "PT", "624": "GW", "626": "TL", "630": "PR",
    "634": "QA", "642": "RO", "643": "RU", "646": "RW", "662": "LC", "666": "PM", "670": "VC",
    "682": "SA", "686": "SN", "688": "RS", "694": "SL", "702": "SG", "703": "SK", "704": "VN",
    "705": "SI", "706": "SO", "710": "ZA", "716": "ZW", "724": "ES", "728": "SS", "729": "SD",
    "732": "EH", "740": "SR", "748": "SZ", "752": "SE", "756": "CH", "760": "SY", "762": "TJ",
    "764": "TH", "768": "TG", "780": "TT", "784": "AE", "788": "TN", "792": "TR", "795": "TM",
    "800": "UG", "804": "UA", "807": "MK", "818": "EG", "826": "GB", "834": "TZ", "840": "US",
    "854": "BF", "858": "UY", "860": "UZ", "862": "VE", "882": "WS", "887": "YE", "894": "ZM",
}


def decode_arcs(topo):
    """Topojson arcs are quantised integer deltas; this returns degrees."""
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]
    arcs = []
    for arc in topo["arcs"]:
        x = y = 0
        points = []
        for dx, dy in arc:
            x += dx
            y += dy
            points.append((x * sx + tx, y * sy + ty))
        arcs.append(points)
    return arcs


def ring_of(arcs, arc_ids):
    ring = []
    for i in arc_ids:
        part = arcs[i] if i >= 0 else list(reversed(arcs[~i]))
        if ring and ring[-1] == part[0]:
            part = part[1:]
        ring.extend(part)
    return ring


def polygons_of(geometry, arcs):
    """Every ring of every polygon, whatever the geometry's type."""
    kind = geometry["type"]
    if kind == "GeometryCollection":
        groups = []
        for inner in geometry["geometries"]:
            groups.extend(polygons_of(inner, arcs))
        return groups
    if kind == "Polygon":
        groups = [geometry["arcs"]]
    elif kind == "MultiPolygon":
        groups = geometry["arcs"]
    else:
        raise SystemExit(f"unexpected geometry: {kind}")
    return [[ring_of(arcs, ring_ids) for ring_ids in group] for group in groups]


def unwrap_ring(ring):
    """Longitudes arrive in -180..180, so a ring crossing the antimeridian carries a
    360-degree step. Walking it into a continuous run moves that join to where the
    ring actually is; the result may lean past either side of the frame."""
    out = []
    offset = 0.0
    for lon, lat in ring:
        if out:
            while lon + offset - out[-1][0] > 180:
                offset -= 360
            while lon + offset - out[-1][0] < -180:
                offset += 360
        out.append((lon + offset, lat))
    return out


def frame_copies(ring):
    """The ring, plus a copy for every side of the frame it leans past: the part
    beyond 180 lands at the left edge once shifted back by a turn."""
    lons = [lon for lon, _ in ring]
    copies = [ring]
    if max(lons) > 180:
        copies.append([(lon - 360, lat) for lon, lat in ring])
    if min(lons) < -180:
        copies.append([(lon + 360, lat) for lon, lat in ring])
    return copies


def area(ring):
    total = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        total += x1 * y2 - x2 * y1
    return total / 2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--atlas", required=True, help="110m topojson: the coastline")
    ap.add_argument("--pins", help="topojson whose country shapes place the pins (defaults to --atlas)")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    topo = json.loads(Path(args.atlas).read_text())
    arcs = decode_arcs(topo)

    # One path for the coastline: `land` is the same shapes drawn as one
    # outline, which is what the backdrop wants -- borders between countries
    # would be noise at this size.
    land = [ring for group in polygons_of(topo["objects"]["land"], arcs) for ring in group]
    parts = []
    points = 0
    for ring in land:
        if len(ring) < 3:
            continue
        for piece in frame_copies(unwrap_ring(ring)):
            # A tenth of a degree at a time; repeated grid cells carry nothing.
            cells = []
            for lon, lat in piece:
                cell = (round(lon + 180, 1), round(90 - lat, 1))
                if not cells or cells[-1] != cell:
                    cells.append(cell)
            if len(cells) < 3:
                continue
            points += len(cells)
            for i, (x, y) in enumerate(cells):
                parts.append(f"{'M' if i == 0 else 'L'}{x} {y}")
            parts.append("Z")
    world_path = "".join(parts)

    # One pin per country, placed at the centre of its largest polygon: Alaska
    # and Hawaii must not drag the marker for the United States off the
    # mainland.
    pin_topo = json.loads(Path(args.pins or args.atlas).read_text())
    pin_arcs = decode_arcs(pin_topo)
    points_out = {}
    for geometry in pin_topo["objects"]["countries"]["geometries"]:
        alpha2 = NUMERIC_TO_ALPHA2.get(str(geometry.get("id", "")).zfill(3))
        if not alpha2:
            continue
        groups = polygons_of(geometry, pin_arcs)
        mainland = max(groups, key=lambda rings: abs(area(rings[0])) if rings else 0)
        ring = max(mainland, key=lambda r: abs(area(r)))
        # Unwrapped for the same reason as the coastline: a country crossing the
        # antimeridian would otherwise average out to the middle of the map.
        ring = unwrap_ring(ring)
        sx = sum(p[0] for p in ring)
        sy = sum(p[1] for p in ring)
        lon, lat = sx / len(ring), sy / len(ring)
        # Longitudes are reported in -180..180; the frame runs 0..360. A place on
        # the antimeridian lands at one edge or the other, the same meridian
        # either way.
        lon = (lon + 180) % 360 - 180
        points_out[alpha2] = (round(lon + 180, 1), round(90 - lat, 1))

    body = [
        "// Generated by scripts/world-map.py -- do not edit by hand.",
        "//",
        "// Geometry: Natural Earth via world-atlas' countries-110m.json (public",
        "// domain). Pins sit at the centre of each country's largest polygon, in an",
        "// equirectangular frame of one unit per degree.",
        "",
        'export const WORLD_VIEWBOX = "0 0 360 180"',
        "",
        "/** Coastline of every landmass, as one path. */",
        "export const WORLD_PATH =",
        f'  "{world_path}"',
        "",
        "/** Where to stand the marker for a country, by ISO 3166-1 alpha-2. */",
        "export const COUNTRY_POINT: Record<string, readonly [number, number]> = {",
    ]
    for code in sorted(points_out):
        x, y = points_out[code]
        body.append(f'  {code}: [{x}, {y}],')
    body.append("}")
    body.append("")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(body))
    print(f"{out}: {out.stat().st_size / 1024:.0f} KiB, {points} land points, {len(points_out)} countries")


if __name__ == "__main__":
    main()
