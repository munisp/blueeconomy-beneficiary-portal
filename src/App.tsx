import { useCallback, useEffect, useState } from "react";
import type { User, UserManager } from "oidc-client-ts";
import { completeAuthenticationCallback, createUserManager, usableAccessToken } from "./auth";
import { loadRuntimeConfiguration, type PortalRuntimeConfiguration } from "./runtime-config";
import { initTelemetry } from "./telemetry";
import { CvffApiClient } from "./api/client";
import { parseRoute, routeHref, type Route } from "./router";
import { DashboardPage } from "./pages/DashboardPage";
import { NewApplicationPage } from "./pages/NewApplicationPage";
import { ApplicationDetailPage } from "./pages/ApplicationDetailPage";
import { DocumentsPage } from "./pages/DocumentsPage";

const RUNTIME_CONFIGURATION_URL = "/platform-config.json";

export interface SessionContext {
  configuration: PortalRuntimeConfiguration;
  user: User;
  /** Returns a client with a non-expired token, or null when re-authentication is required. */
  getClient: () => Promise<CvffApiClient | null>;
  signOut: () => Promise<void>;
}

type ApplicationState =
  | { kind: "loading" }
  | { kind: "configuration-error"; error: string }
  | { kind: "ready"; configuration: PortalRuntimeConfiguration; manager: UserManager; user: User | null };

export default function App() {
  const [state, setState] = useState<ApplicationState>({ kind: "loading" });
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));

  useEffect(() => {
    let active = true;
    void bootstrap().then(
      (ready) => {
        if (active) {
          setState(ready);
        }
      },
      (error: unknown) => {
        if (active) {
          setState({ kind: "configuration-error", error: error instanceof Error ? error.message : "portal bootstrap failed" });
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = useCallback((next: Route) => {
    window.location.hash = routeHref(next).slice(1);
    setRoute(next);
  }, []);

  const getClient = useCallback(async (): Promise<CvffApiClient | null> => {
    if (state.kind !== "ready") {
      return null;
    }
    const usable = await usableAccessToken(state.manager, state.user);
    if (usable === null) {
      setState({ ...state, user: null });
      return null;
    }
    if (usable.user !== state.user) {
      setState({ ...state, user: usable.user });
    }
    return new CvffApiClient({ baseUrl: state.configuration.cvff_api.base_url, token: usable.token });
  }, [state]);

  async function startSignIn(): Promise<void> {
    if (state.kind !== "ready") {
      return;
    }
    await state.manager.signinRedirect();
  }

  async function startSignOut(): Promise<void> {
    if (state.kind !== "ready") {
      return;
    }
    await state.manager.signoutRedirect();
  }

  const authenticated = state.kind === "ready" && state.user !== null && !state.user.expired;
  const title = state.kind === "ready" ? state.configuration.application_name : "CVFF Beneficiary Portal";

  return (
    <main className="portal-shell">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4 border-b border-slate-300 pb-6">
        <div>
          <p className="eyebrow">Nigerian Maritime Administration and Safety Agency</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">{title}</h1>
          <p className="mt-1 max-w-xl text-sm text-slate-600">
            Cabotage Vessel Financing Fund applications for eligible vessel operators.
          </p>
        </div>
        <div className="flex items-center gap-3" aria-live="polite">
          <span className={`badge ${authenticated ? "badge--success" : "badge--neutral"}`}>
            {authenticated ? "Authenticated" : "Sign-in required"}
          </span>
          {state.kind === "ready" &&
            (authenticated ? (
              <button className="button button--quiet" onClick={() => void startSignOut()}>
                Sign out
              </button>
            ) : (
              <button className="button" onClick={() => void startSignIn()}>
                Sign in
              </button>
            ))}
        </div>
      </header>

      {state.kind === "loading" && (
        <section className="card" aria-live="polite">
          <p className="eyebrow">Secure bootstrap</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-800">Loading the approved environment configuration</h2>
          <p className="mt-1 text-sm text-slate-600">The portal is waiting for the deployment-provided OIDC and API configuration.</p>
        </section>
      )}

      {state.kind === "configuration-error" && (
        <section className="card border-l-4 border-l-red-800" role="alert">
          <p className="eyebrow">Integration gate active</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-800">Approved environment configuration is required</h2>
          <p className="mt-1 text-sm text-slate-600">
            The portal did not load a valid runtime configuration. No substitute endpoint, mock service or local session has been created.
          </p>
          <pre className="mt-3 overflow-x-auto rounded bg-slate-100 p-3 text-xs text-slate-700">{state.error}</pre>
        </section>
      )}

      {state.kind === "ready" && !authenticated && (
        <section className="card">
          <p className="eyebrow">Beneficiary sign-in</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-800">Authenticate to manage CVFF applications</h2>
          <p className="mt-1 max-w-xl text-sm text-slate-600">
            Sign-in uses the platform identity provider with the OIDC authorization code flow and PKCE. The portal
            never handles your password directly and stores only short-lived session tokens.
          </p>
          <button className="button mt-4" onClick={() => void startSignIn()}>
            Sign in with the platform identity provider
          </button>
        </section>
      )}

      {state.kind === "ready" && authenticated && state.user !== null && (
        <SessionView
          session={{
            configuration: state.configuration,
            user: state.user,
            getClient,
            signOut: startSignOut,
          }}
          route={route}
          navigate={navigate}
        />
      )}
    </main>
  );
}

async function bootstrap(): Promise<Extract<ApplicationState, { kind: "ready" }>> {
  const configuration = await loadRuntimeConfiguration(RUNTIME_CONFIGURATION_URL);
  // RUM (phase-7 OTel): fire-and-forget — async, non-blocking, never in the
  // critical render path. No telemetry.otlp_endpoint in the runtime config =
  // telemetry disabled; init never rejects (sanctioned fail-open).
  void initTelemetry({
    endpoint: configuration.telemetry?.otlp_endpoint,
    sampleRatio: configuration.telemetry?.sample_ratio,
    serviceName: "blueeconomy-beneficiary-portal",
    propagateTo: [configuration.cvff_api.base_url],
  });
  const manager = createUserManager(configuration.oidc);
  const callbackUser = await completeAuthenticationCallback(manager);
  const user = callbackUser ?? (await manager.getUser());
  return { kind: "ready", configuration, manager, user };
}

function SessionView({ session, route, navigate }: { session: SessionContext; route: Route; navigate: (route: Route) => void }) {
  switch (route.name) {
    case "dashboard":
      return <DashboardPage session={session} navigate={navigate} />;
    case "new-application":
      return <NewApplicationPage session={session} navigate={navigate} />;
    case "application-detail":
      return <ApplicationDetailPage session={session} applicationId={route.applicationId} navigate={navigate} />;
    case "application-documents":
      return <DocumentsPage session={session} applicationId={route.applicationId} navigate={navigate} />;
  }
}
