import { describe, expect, it } from "vitest";
import { parseRoute, routeHref } from "../src/router";

describe("officer/auditor routes (Phase 22)", () => {
  it("parses the four-party decision route", () => {
    expect(parseRoute("#/applications/app-1/decision")).toEqual({ name: "application-decision", applicationId: "app-1" });
  });
  it("parses the officer role-assignment route", () => {
    expect(parseRoute("#/admin/applications/app-1/roles")).toEqual({ name: "admin-application-roles", applicationId: "app-1" });
  });
  it("parses the reconciliation route", () => {
    expect(parseRoute("#/admin/applications/app-1/reconciliation")).toEqual({
      name: "admin-application-reconciliation",
      applicationId: "app-1",
    });
  });
  it("parses the auditor dual-ledger route", () => {
    expect(parseRoute("#/audit/dual-ledger")).toEqual({ name: "audit-dual-ledger" });
  });
  it("round-trips hrefs and encodes identifiers", () => {
    expect(routeHref({ name: "admin-application-roles", applicationId: "app 1" })).toBe("#/admin/applications/app%201/roles");
    expect(parseRoute(routeHref({ name: "application-decision", applicationId: "app 1" }))).toEqual({
      name: "application-decision",
      applicationId: "app 1",
    });
  });
  it("keeps existing routes stable", () => {
    expect(parseRoute("#/")).toEqual({ name: "dashboard" });
    expect(parseRoute("#/applications/app-1")).toEqual({ name: "application-detail", applicationId: "app-1" });
    expect(parseRoute("#/unknown")).toEqual({ name: "not-found", path: "/unknown" });
  });
});
