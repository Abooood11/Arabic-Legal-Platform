import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "./use-auth";

function ensureId(key: string) {
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const value = crypto.randomUUID();
  localStorage.setItem(key, value);
  return value;
}

function detectSource() {
  const params = new URLSearchParams(window.location.search);
  return params.get("utm_source") || undefined;
}

export function useAnalytics() {
  const [location] = useLocation();
  const { user } = useAuth();

  useEffect(() => {
    const visitorId = ensureId("alp_visitor_id");
    const sessionId = ensureId("alp_session_id");
    const ageRange = localStorage.getItem("alp_age_range") || undefined;

    fetch("/api/analytics/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        eventType: "pageview",
        path: location,
        visitorId,
        sessionId,
        referrer: document.referrer || undefined,
        source: detectSource(),
        ageRange,
        userId: user?.id,
      }),
    }).catch(() => undefined);

    const timer = window.setInterval(() => {
      fetch("/api/analytics/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          eventType: "heartbeat",
          path: location,
          visitorId,
          sessionId,
          ageRange,
          userId: user?.id,
        }),
      }).catch(() => undefined);
    }, 30000);

    return () => window.clearInterval(timer);
  }, [location, user?.id]);
}
