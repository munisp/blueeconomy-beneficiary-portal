/**
 * Minimal hash-based router. Hash routing keeps the SPA fully static (no
 * server rewrite coupling beyond the nginx fallback) and CSP-friendly.
 */

export type Route =
  | { name: "dashboard" }
  | { name: "new-application" }
  | { name: "application-detail"; applicationId: string }
  | { name: "application-documents"; applicationId: string }
  | { name: "not-found"; path: string };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "");
  const segments = path.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return { name: "dashboard" };
  }
  if (segments.length === 1 && segments[0] === "new") {
    return { name: "new-application" };
  }
  if (segments.length === 2 && segments[0] === "applications") {
    return { name: "application-detail", applicationId: decodeURIComponent(segments[1]) };
  }
  if (segments.length === 3 && segments[0] === "applications" && segments[2] === "documents") {
    return { name: "application-documents", applicationId: decodeURIComponent(segments[1]) };
  }
  return { name: "not-found", path: `/${segments.join("/")}` };
}

export function routeHref(route: Route): string {
  switch (route.name) {
    case "dashboard":
      return "#/";
    case "new-application":
      return "#/new";
    case "application-detail":
      return `#/applications/${encodeURIComponent(route.applicationId)}`;
    case "application-documents":
      return `#/applications/${encodeURIComponent(route.applicationId)}/documents`;
    case "not-found":
      return "#/";
  }
}
