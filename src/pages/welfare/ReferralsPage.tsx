import { useCallback, useEffect, useState } from "react";
import type { SessionContext } from "../../App";
import type { Route } from "../../router";
import { fetchMyReferrals, welfareErrorMessage, type ReferralView } from "../../api/welfare";
import { REFERRAL_STATUS_LABELS, referralStatusTone } from "../../domain/welfare";
import { EmptyState, ErrorNotice, LoadingState } from "../../components/feedback";
import { WelfareUnavailable } from "./WelfareUnavailable";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; referrals: ReferralView[] };

/**
 * Welfare-provider referral visibility for the authenticated seafarer. Every
 * referral carries the mandatory recorded consent timestamp (consent is a
 * hard precondition of the welfare module's referral channel).
 */
export function ReferralsPage({ session, navigate }: { session: SessionContext; navigate: (route: Route) => void }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    const client = await session.getWelfareClient();
    if (client === null) {
      return; // session expired; App renders the sign-in gate
    }
    try {
      const response = await fetchMyReferrals(client);
      setState({ kind: "ready", referrals: response.referrals });
    } catch (error) {
      setState({ kind: "error", message: welfareErrorMessage(error) });
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  if (session.welfare.kind === "unavailable") {
    return <WelfareUnavailable reason={session.welfare.reason} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Seafarer welfare · MLC 2006</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-800">My welfare referrals</h2>
        </div>
        <button className="button button--outline" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {state.kind === "loading" && <LoadingState message="Retrieving your referrals from the welfare service…" />}
      {state.kind === "error" && <ErrorNotice message={state.message} onRetry={() => void load()} />}

      {state.kind === "ready" && state.referrals.length === 0 && (
        <EmptyState title="No referrals on record">
          <p className="mt-1 text-sm text-slate-600">
            No welfare-provider referrals exist for your verified seafarer identity. Referrals are recorded only with
            your consent and appear here with that consent record.
          </p>
        </EmptyState>
      )}

      {state.kind === "ready" && state.referrals.length > 0 && (
        <ul className="space-y-3">
          {state.referrals.map((referral) => (
            <li key={referral.referralId} className="card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-slate-800">Welfare service {referral.serviceId}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Referral reference <span className="font-mono">{referral.referralId}</span> · recorded{" "}
                    {new Date(referral.recordedAt).toLocaleString("en-NG")}
                  </p>
                </div>
                <span className={`badge badge--${referralStatusTone(referral.status)}`}>{REFERRAL_STATUS_LABELS[referral.status]}</span>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
                <p className="text-sm text-slate-700">
                  Consent recorded at <span className="font-semibold">{new Date(referral.consentAt).toLocaleString("en-NG")}</span>
                </p>
                {referral.complaintId !== null && (
                  <button className="button button--outline" onClick={() => navigate({ name: "welfare-complaints" })}>
                    Linked complaint <span className="font-mono">{referral.complaintId}</span>
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
