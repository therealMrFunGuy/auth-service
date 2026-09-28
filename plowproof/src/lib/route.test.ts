import { describe, expect, it } from "vitest";
import { orderRoute, routeLength } from "./route";

const yard = { lat: 44.95, lng: -93.3 };
const stop = (id: string, priority: number, lat: number | null, lng: number | null) => ({ id, priority, lat, lng });

describe("orderRoute", () => {
  it("keeps priority groups in order", () => {
    const stops = [stop("c", 3, 44.95, -93.29), stop("a", 1, 44.99, -93.1), stop("b", 2, 44.951, -93.3)];
    expect(orderRoute(stops, yard).map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("walks a straight street in order from the yard, whatever the input order", () => {
    // Five houses heading east from the yard, shuffled.
    const stops = [3, 1, 4, 0, 2].map((i) => stop(`h${i}`, 2, 44.95, -93.29 + i * 0.01));
    expect(orderRoute(stops, yard).map((s) => s.id)).toEqual(["h0", "h1", "h2", "h3", "h4"]);
  });

  it("starts the next priority group where the previous one ended", () => {
    const stops = [
      stop("p1-far", 1, 44.95, -93.0),
      stop("p2-near-yard", 2, 44.95, -93.29),
      stop("p2-near-p1", 2, 44.95, -93.01),
    ];
    expect(orderRoute(stops, yard).map((s) => s.id)).toEqual(["p1-far", "p2-near-p1", "p2-near-yard"]);
  });

  it("puts stops that aren't on the map at the end of their group, in the original order", () => {
    const stops = [stop("x", 1, null, null), stop("m", 1, 44.96, -93.28), stop("y", 1, null, null), stop("z", 2, 44.9, -93.2)];
    expect(orderRoute(stops, yard).map((s) => s.id)).toEqual(["m", "x", "y", "z"]);
  });

  it("works with no yard and returns every stop once", () => {
    const stops = Array.from({ length: 40 }, (_, i) => stop(`s${i}`, 1 + (i % 3), 44.9 + ((i * 37) % 17) / 100, -93.4 + ((i * 53) % 23) / 100));
    const out = orderRoute(stops, null);
    expect(new Set(out.map((s) => s.id)).size).toBe(40);
    expect(out.map((s) => s.priority)).toEqual([...out.map((s) => s.priority)].sort());
  });

  it("is much shorter than a scrambled order on a grid", () => {
    const grid = [];
    for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) grid.push(stop(`g${r}-${c}`, 2, 44.9 + r * 0.01, -93.3 + c * 0.01));
    const scrambled = [...grid].sort((a, b) => ((a.id.charCodeAt(1) * 7919 + a.id.length * 31) % 97) - ((b.id.charCodeAt(1) * 7919) % 97) || a.id.localeCompare(b.id) * -1);
    const ordered = orderRoute(scrambled, yard);
    // An optimal tour through 36 points 0.01° apart is ~35 hops ≈ 35 × ~0.9 km.
    expect(routeLength(ordered, yard)).toBeLessThan(routeLength(scrambled, yard) * 0.6);
    expect(routeLength(ordered, null)).toBeLessThan(40 * 1_120);
  });
});
