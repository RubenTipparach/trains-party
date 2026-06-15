/**
 * Discord sign-in state for the lobby. Holds the server's enabled flags and the
 * signed-in profile (resolved from the bearer token in localStorage). The /auth
 * route adopts a freshly minted token, then calls init().
 */

import * as api from '$lib/api/client';

class Auth {
  enabled = $state<{ signIn: boolean; autoJoin: boolean; anon: boolean } | null>(null);
  profile = $state<api.Profile | null>(null);
  loading = $state(true);
  private started = false;

  get signedIn(): boolean {
    return !!this.profile;
  }
  get canSignIn(): boolean {
    return api.apiConfigured() && !!this.enabled?.signIn;
  }

  /** Resolve enabled flags + current profile. Safe to call repeatedly. */
  async init(): Promise<void> {
    if (!api.apiConfigured()) {
      this.loading = false;
      return;
    }
    this.loading = true;
    try {
      this.enabled = await api.authEnabled();
    } catch {
      this.enabled = { signIn: false, autoJoin: false, anon: true };
    }
    if (api.getToken()) {
      try {
        this.profile = await api.me();
      } catch {
        api.setToken(null);
        this.profile = null;
      }
    }
    this.loading = false;
    this.started = true;
  }

  async ensure(): Promise<void> {
    if (!this.started) await this.init();
  }

  loginUrl(redirect: string): string {
    return api.loginUrl(redirect);
  }

  /** Sign in as a guest (no Discord). */
  async signInAnon(name: string): Promise<void> {
    const r = await api.anonLogin(name);
    api.setToken(r.token);
    this.profile = r.profile;
  }

  /** A guest profile has a non-snowflake id (so no Discord features). */
  get isGuest(): boolean {
    return !!this.profile && !/^\d+$/.test(this.profile.discordId);
  }

  async signOut(): Promise<void> {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    api.setToken(null);
    this.profile = null;
  }
}

export const auth = new Auth();
