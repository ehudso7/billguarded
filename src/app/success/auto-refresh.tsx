"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;

    let refreshes = 0;
    const interval = window.setInterval(() => {
      refreshes += 1;
      router.refresh();
      if (refreshes >= 24) window.clearInterval(interval);
    }, 5000);

    return () => window.clearInterval(interval);
  }, [active, router]);

  return null;
}
