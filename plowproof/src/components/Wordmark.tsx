export function Wordmark({ tone = "dark" }: { tone?: "dark" | "light" }) {
  return (
    <span className={`sign text-2xl font-bold ${tone === "light" ? "text-salt" : "text-asphalt"}`}>
      PlowProof
    </span>
  );
}
