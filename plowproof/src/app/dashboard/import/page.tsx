import type { Metadata } from "next";
import { requireDispatcher } from "@/lib/session";
import { ImportFlow } from "./ImportFlow";

export const metadata: Metadata = { title: "Import customers" };

export default async function ImportPage() {
  await requireDispatcher();
  return <ImportFlow />;
}
