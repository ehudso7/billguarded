"use client";

import { useEffect } from "react";
import {
  captureFunnelEvent,
  markDemoTouch,
} from "@/lib/funnel-client";
import type {
  FunnelEventName,
  PublicAnalyticsPath,
} from "@/lib/funnel-events";

export function FunnelPageView(props: {
  eventName: "landing_view" | "demo_view";
  path: PublicAnalyticsPath;
}) {
  useEffect(() => {
    void captureFunnelEvent(props.eventName, props.path).finally(() => {
      if (props.path === "/demo") markDemoTouch();
    });
  }, [props.eventName, props.path]);
  return null;
}

export function TrackedAnchor(props: {
  className?: string;
  href: string;
  eventName: FunnelEventName;
  path: PublicAnalyticsPath;
  children: React.ReactNode;
}) {
  return (
    <a
      className={props.className}
      href={props.href}
      onClick={() => void captureFunnelEvent(props.eventName, props.path)}
    >
      {props.children}
    </a>
  );
}
