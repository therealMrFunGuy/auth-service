const SUFFIXES: Record<string, string> = {
  street: "st", avenue: "ave", av: "ave", road: "rd", drive: "dr", lane: "ln", court: "ct",
  circle: "cir", boulevard: "blvd", place: "pl", parkway: "pkwy", trail: "trl", terrace: "ter",
  highway: "hwy", way: "way", point: "pt", north: "n", south: "s", east: "e", west: "w",
  northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw", apartment: "apt", suite: "ste",
};

const norm = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => SUFFIXES[w] ?? w)
    .join(" ");

/** Same property typed two ways ("123 Main Street" / "123 main st.") → same key. Zip left out on purpose. */
export function addressKey(a: { street: string; unit?: string | null; city: string; state: string }) {
  return [norm(a.street), norm(a.unit), norm(a.city), norm(a.state)].join("|");
}

export function formatAddress(a: { street: string; unit?: string | null; city: string; state: string; zip?: string | null }) {
  const line1 = a.unit ? `${a.street} ${a.unit}` : a.street;
  return `${line1}, ${a.city}, ${a.state}${a.zip ? ` ${a.zip}` : ""}`;
}

/** Works on both iPhone and Android: opens Google Maps app or web with turn-by-turn. */
export function directionsUrl(a: { lat: number | null; lng: number | null; street: string; unit?: string | null; city: string; state: string; zip?: string | null }) {
  const dest = a.lat != null && a.lng != null ? `${a.lat},${a.lng}` : formatAddress(a);
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=driving`;
}
