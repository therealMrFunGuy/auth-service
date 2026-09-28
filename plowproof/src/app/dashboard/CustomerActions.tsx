"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteCustomer, retryGeocoding } from "./actions";

export function CustomerRowActions({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn btn-danger"
      disabled={pending}
      onClick={() => {
        if (confirm(`Remove ${name} from your customers?`)) start(() => deleteCustomer(id));
      }}
    >
      Remove
    </button>
  );
}

export function RetryGeocodeButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [queued, setQueued] = useState<number | null>(null);
  return (
    <button
      type="button"
      className="btn btn-quiet"
      disabled={pending || queued !== null}
      onClick={() =>
        start(async () => {
          setQueued(await retryGeocoding());
          setTimeout(() => router.refresh(), 8000);
        })
      }
    >
      {queued !== null ? `Mapping ${queued}…` : "Retry map lookup"}
    </button>
  );
}
