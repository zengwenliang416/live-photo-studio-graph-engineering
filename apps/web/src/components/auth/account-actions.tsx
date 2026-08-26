"use client";

import { useMemo, useState } from "react";
import {
  ApiProblemError,
  WorkflowApiClient,
} from "../../lib/api-client.js";
import { clearUserScopedBrowserState } from "../../lib/auth-session.js";
import { useAuthenticatedUser } from "./auth-gate.js";
import styles from "./account-actions.module.css";

export function AccountActions(): React.JSX.Element {
  const user = useAuthenticatedUser();
  const client = useMemo(() => new WorkflowApiClient(), []);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signOut = async (): Promise<void> => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    setError(null);
    try {
      await client.logout();
      clearUserScopedBrowserState();
      window.location.replace("/login");
    } catch (caught) {
      if (caught instanceof ApiProblemError && caught.status === 401) {
        clearUserScopedBrowserState();
        window.location.replace("/login");
        return;
      }
      setError("退出失败，请重试。");
      setIsSigningOut(false);
    }
  };

  return (
    <div className={styles.account}>
      {user !== null && (
        <span className={styles.identity} title={user.email}>
          {user.displayName}
        </span>
      )}
      <button
        className={styles.signOut}
        type="button"
        disabled={isSigningOut}
        onClick={() => void signOut()}
      >
        {isSigningOut ? "退出中…" : "退出登录"}
      </button>
      {error !== null && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
