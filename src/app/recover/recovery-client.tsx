"use client";

import { useEffect, useRef, useState } from "react";

export default function RecoveryClient() {
  const started = useRef(false);
  const [message, setMessage] = useState("Verifying your private audit link…");

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const sessionId = params.get("session_id");

    // Remove the bearer credential from the visible address immediately.
    window.history.replaceState(null, "", "/recover");

    if (!sessionId) {
      setMessage("This recovery link is incomplete. Contact support@billguarded.com.");
      return;
    }

    void (async () => {
      try {
        const response = await fetch("/api/recover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
          credentials: "same-origin",
          cache: "no-store",
        });
        const body = (await response.json().catch(() => null)) as
          | { target?: string }
          | null;

        if (!response.ok || !body?.target?.startsWith("/success?request=")) {
          throw new Error("recovery_unavailable");
        }

        window.location.replace(body.target);
      } catch {
        setMessage(
          "This private recovery link could not be verified. Contact support@billguarded.com and do not pay again.",
        );
      }
    })();
  }, []);

  return <p className="muted" aria-live="polite">{message}</p>;
}
