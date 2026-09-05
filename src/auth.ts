import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";
import type { OidcRuntimeConfiguration } from "./runtime-config";

/**
 * OIDC Authorization Code + PKCE client. oidc-client-ts always applies PKCE
 * (S256) for public clients on the code flow.
 */
export function createUserManager(configuration: OidcRuntimeConfiguration): UserManager {
  return new UserManager({
    authority: configuration.authority,
    client_id: configuration.client_id,
    redirect_uri: configuration.redirect_uri,
    post_logout_redirect_uri: configuration.post_logout_redirect_uri,
    response_type: "code",
    scope: configuration.scope,
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
    automaticSilentRenew: false,
    filterProtocolClaims: true,
    loadUserInfo: false,
  });
}

export async function completeAuthenticationCallback(manager: UserManager): Promise<User | null> {
  const hasOidcResponse = new URL(window.location.href).searchParams.has("code");
  if (!hasOidcResponse) {
    return null;
  }
  const user = await manager.signinRedirectCallback();
  // The authorization response has been consumed; remove ?code&state from the
  // address bar so a reload or copy of the URL cannot replay a dead callback.
  cleanCallbackUrl();
  return user;
}

/** Replaces the OIDC callback query string with the plain app root URL. */
export function cleanCallbackUrl(): void {
  const url = new URL(window.location.href);
  url.search = "";
  if (url.hash === "") {
    url.hash = "/";
  }
  window.history.replaceState(null, "", url.toString());
}

/**
 * Classifies a bootstrap failure. OIDC "state" errors mean the sign-in
 * session expired (stale, duplicated or reloaded callback URL) and are
 * recoverable by signing in again; everything else is a genuine
 * configuration/integration failure that must stay fail-closed.
 */
export type BootstrapErrorKind = "session-expired" | "configuration";

export function classifyBootstrapError(error: unknown): BootstrapErrorKind {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes("no matching state") ||
      message.includes("state not found") ||
      message.includes("no state in storage") ||
      (typeof (error as { name?: unknown }).name === "string" &&
        (error as { name: string }).name === "ErrorResponse" &&
        message.includes("state"))
    ) {
      return "session-expired";
    }
  }
  return "configuration";
}

/**
 * Returns a non-expired access token, refreshing silently first when the
 * short-TTL token has expired. Returns null when no usable token exists and
 * the caller must start a new interactive sign-in. Never fabricates a token.
 */
export async function usableAccessToken(manager: UserManager, user: User | null): Promise<{ token: string; user: User } | null> {
  if (user === null) {
    return null;
  }
  if (!user.expired && user.access_token.trim().length > 0) {
    return { token: user.access_token, user };
  }
  try {
    const renewed = await manager.signinSilent();
    if (renewed === null || renewed.expired || renewed.access_token.trim().length === 0) {
      return null;
    }
    return { token: renewed.access_token, user: renewed };
  } catch {
    return null;
  }
}
