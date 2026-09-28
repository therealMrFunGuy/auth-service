/** Only allow same-site relative paths as post-sign-in destinations. */
export function safeNext(value: unknown, fallback = "/") {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : fallback;
}
