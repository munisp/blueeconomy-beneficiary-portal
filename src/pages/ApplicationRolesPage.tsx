import { useCallback, useState } from "react";
import type { SessionContext } from "../App";
import type { Route } from "../router";
import { ApiError } from "../api/client";
import {
  assignApplicationRoles,
  validateRoleAssignments,
  CHAIN_ROLES,
  type AssignRolesResponse,
  type ChainRole,
  type RoleAssignments,
} from "../api/officer";
import { ErrorNotice } from "../components/feedback";

const ROLE_LABELS: Record<ChainRole, string> = {
  UNDERWRITER_PRIMARY: "Primary underwriter (PLI tier 1)",
  UNDERWRITER_SECONDARY: "Secondary underwriter (PLI tier 2)",
  UNDERWRITER_TERTIARY: "Tertiary underwriter (PLI tier 3)",
  NIMASA_APPROVER: "NIMASA approver",
  RECEIVING_BANK: "Receiving bank",
  BENEFICIARY: "Beneficiary",
};

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string }
  | { kind: "done"; response: AssignRolesResponse };

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.status > 0 ? `HTTP ${error.status}: ${error.message}` : error.message;
  }
  return error instanceof Error ? error.message : "The role assignments could not be recorded.";
}

/**
 * Officer screen for PUT /v1/cvff/admin/applications/{id}/roles. Binds the
 * six four-party chain roles to distinct principals; the write is idempotent
 * server-side (identical replay succeeds, divergence returns 409) and the
 * PBAC layer enforces segregation of duties.
 */
export function ApplicationRolesPage({
  session,
  applicationId,
  navigate,
}: {
  session: SessionContext;
  applicationId: string;
  navigate: (route: Route) => void;
}) {
  const [assignments, setAssignments] = useState<RoleAssignments>(() =>
    Object.fromEntries(CHAIN_ROLES.map((role) => [role, ""])) as RoleAssignments,
  );
  const [state, setState] = useState<SubmitState>({ kind: "idle" });

  const submit = useCallback(async () => {
    const problem = validateRoleAssignments(assignments);
    if (problem !== null) {
      setState({ kind: "error", message: problem });
      return;
    }
    const client = await session.getClient();
    if (client === null) {
      return; // session expired; App renders the sign-in gate
    }
    setState({ kind: "submitting" });
    try {
      const trimmed = Object.fromEntries(CHAIN_ROLES.map((role) => [role, assignments[role].trim()])) as RoleAssignments;
      const response = await assignApplicationRoles(client, applicationId, trimmed);
      setState({ kind: "done", response });
    } catch (error) {
      setState({ kind: "error", message: describeError(error) });
    }
  }, [session, applicationId, assignments]);

  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow">Officer administration</p>
        <h2 className="mt-1 text-lg font-semibold text-slate-800">Assign four-party roles</h2>
        <p className="mt-1 text-sm text-slate-600">
          Application <code className="text-xs">{applicationId}</code>. Each chain role must be bound to a distinct
          principal; the assigning officer is never a party. Re-submitting the identical binding is safe (idempotent);
          a divergent binding is rejected with 409.
        </p>
      </div>

      <section className="card">
        <div className="grid gap-4 sm:grid-cols-2">
          {CHAIN_ROLES.map((role) => (
            <label key={role} className="block">
              <span className="field-label">{ROLE_LABELS[role]}</span>
              <input
                className="field-input font-mono text-xs"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="principal subject identifier"
                value={assignments[role]}
                onChange={(event) => setAssignments({ ...assignments, [role]: event.target.value })}
              />
            </label>
          ))}
        </div>
        <button className="button mt-4" onClick={() => void submit()} disabled={state.kind === "submitting"}>
          {state.kind === "submitting" ? "Recording…" : "Record role assignments"}
        </button>
      </section>

      {state.kind === "error" && <ErrorNotice message={state.message} onRetry={() => void submit()} />}

      {state.kind === "done" && (
        <section className="card border-l-4 border-l-emerald-700" aria-live="polite">
          <p className="eyebrow">Assignments recorded</p>
          <dl className="mt-2 space-y-1 text-sm">
            {CHAIN_ROLES.map((role) => (
              <div key={role} className="flex flex-wrap gap-2">
                <dt className="w-56 font-medium text-slate-700">{ROLE_LABELS[role]}</dt>
                <dd className="font-mono text-xs text-slate-900">{state.response.assignments[role]}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <button className="button button--quiet" onClick={() => navigate({ name: "dashboard" })}>
        ← Back to dashboard
      </button>
    </div>
  );
}
