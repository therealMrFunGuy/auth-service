const LABEL: Record<number, string> = { 1: "First out", 2: "Standard", 3: "Last" };

/** Snow-stake style marker: more amber bands = earlier in the route. */
export function PriorityMark({ priority, dark = false }: { priority: number; dark?: boolean }) {
  const bands = 4 - priority; // 1 → 3 bands, 3 → 1 band
  return (
    <span className="inline-flex items-center gap-2" title={LABEL[priority]}>
      <span aria-hidden className="flex flex-col gap-[2px]">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`block h-[4px] w-4 rounded-[1px] ${i < bands ? "bg-beacon" : dark ? "bg-night-line" : "bg-frost"}`}
          />
        ))}
      </span>
      <span className="text-sm">{LABEL[priority]}</span>
    </span>
  );
}
