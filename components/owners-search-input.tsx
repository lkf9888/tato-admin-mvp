"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function OwnersSearchInput({
  initialValue,
  placeholder,
}: {
  initialValue: string;
  placeholder: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialValue);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const nextQuery = query.trim();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (nextQuery) params.set("q", nextQuery);
      startTransition(() => {
        router.replace(params.toString() ? `/owners?${params}` : "/owners");
      });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [query, router, startTransition]);

  return (
    <input
      type="search"
      value={query}
      onChange={(event) => setQuery(event.target.value)}
      placeholder={placeholder}
      className="input h-10"
    />
  );
}
