/**
 * Minimal hash-based router. Hash routing keeps the SPA fully static (no
 * server rewrite coupling beyond the nginx fallback) and CSP-friendly.
 */

export type Route =
  | { name: "dashboard" }
  | { name: "new-application" }
  | { name: "application-detail"; applicationId: string }
  | { name: "application-documents"; applicationId: string }
  | { name: "welfare-complaints" }
  | { name: "welfare-complaint-new" }
  | { name: "welfare-referrals" };

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
  // Welfare routes carry no identifiers: complaint/referral references are
  // confidential and stay out of URLs; the views fetch the seafarer's own
  // records from the welfare API.
  if (segments.length === 2 && segments[0] === "welfare" && segments[1] === "complaints") {
    return { name: "welfare-complaints" };
  }
  if (segments.length === 3 && segments[0] === "welfare" && segments[1] === "complaints" && segments[2] === "new") {
    return { name: "welfare-complaint-new" };
  }
  if (segments.length === 2 && segments[0] === "welfare" && segments[1] === "referrals") {
    return { name: "welfare-referrals" };
  }
  return { name: "dashboard" };
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
    case "welfare-complaints":
      return "#/welfare/complaints";
    case "welfare-complaint-new":
      return "#/welfare/complaints/new";
    case "welfare-referrals":
      return "#/welfare/referrals";
  }
}
