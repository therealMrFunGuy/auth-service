import { distanceMeters } from "@/lib/geo";

type Pt = { lat: number; lng: number };
type Stop = { priority: number; lat: number | null; lng: number | null };

const mapped = <T extends Stop>(s: T): s is T & Pt => s.lat != null && s.lng != null;

/** Nearest-neighbor tour from `from`, then 2-opt until no swap shortens it. Open path: no return leg. */
function tour<T extends Pt>(stops: T[], from: Pt | null): T[] {
  if (stops.length <= 1) return stops;
  const left = [...stops];
  let here: Pt;
  if (from) here = from;
  else {
    // No yard: start at the stop farthest from the middle, so the route sweeps across instead of zig-zagging out.
    const mid = { lat: left.reduce((a, s) => a + s.lat, 0) / left.length, lng: left.reduce((a, s) => a + s.lng, 0) / left.length };
    let far = 0;
    left.forEach((s, i) => { if (distanceMeters(mid, s) > distanceMeters(mid, left[far])) far = i; });
    here = left[far];
  }
  const path: T[] = [];
  while (left.length) {
    let best = 0;
    for (let i = 1; i < left.length; i++) if (distanceMeters(here, left[i]) < distanceMeters(here, left[best])) best = i;
    here = left[best];
    path.push(...left.splice(best, 1));
  }

  // 2-opt on [from?, ...path]. Index 0 is fixed when there's a yard.
  const p: Pt[] = from ? [from, ...path] : path;
  const first = from ? 1 : 0;
  const d = (a: Pt | undefined, b: Pt | undefined) => (a && b ? distanceMeters(a, b) : 0);
  for (let pass = 0, improved = true; improved && pass < 50; pass++) {
    improved = false;
    for (let i = first; i < p.length - 1; i++) {
      for (let j = i + 1; j < p.length; j++) {
        const before = d(p[i - 1], p[i]) + d(p[j], p[j + 1]);
        const after = d(p[i - 1], p[j]) + d(p[i], p[j + 1]);
        if (after + 0.5 < before) {
          p.splice(i, j - i + 1, ...p.slice(i, j + 1).reverse());
          improved = true;
        }
      }
    }
  }
  return (from ? p.slice(1) : p) as T[];
}

/**
 * Driving order for a route: priority 1 first, then 2, then 3. Within each priority the stops are
 * ordered by distance, starting from the yard (or where the previous group ended).
 * Stops not on the map keep their incoming order at the end of their group.
 */
export function orderRoute<T extends Stop>(stops: T[], yard: Pt | null): T[] {
  const priorities = [...new Set(stops.map((s) => s.priority))].sort((a, b) => a - b);
  const out: T[] = [];
  let here = yard;
  for (const pr of priorities) {
    const group = stops.filter((s) => s.priority === pr);
    const onMap = tour(group.filter(mapped), here);
    if (onMap.length) here = onMap[onMap.length - 1];
    out.push(...onMap, ...group.filter((s) => !mapped(s)));
  }
  return out;
}

/** Total driving-line distance in meters (straight lines between stops), for tests and display. */
export function routeLength(stops: Stop[], yard: Pt | null) {
  const pts = [...(yard ? [yard] : []), ...stops.filter(mapped)] as Pt[];
  let m = 0;
  for (let i = 1; i < pts.length; i++) m += distanceMeters(pts[i - 1], pts[i]);
  return m;
}
