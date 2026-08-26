"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import type { AuthUser } from "@live-photo-studio/contracts";
import {
  ApiProblemError,
  WorkflowApiClient,
} from "../../lib/api-client.js";
import { currentProtectedPath } from "../../lib/auth-session.js";

const AuthUserContext = createContext<AuthUser | null>(null);

export function useAuthenticatedUser(): AuthUser | null {
  return useContext(AuthUserContext);
}

export function AuthGate({
  children,
}: Readonly<{ children: ReactNode }>): React.JSX.Element {
  const pathname = usePathname();
  const client = useMemo(() => new WorkflowApiClient(), []);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [state, setState] = useState<"checking" | "ready" | "error">(
    pathname === "/login" ? "ready" : "checking",
  );

  useEffect(() => {
    if (pathname === "/login") {
      setState("ready");
      setUser(null);
      return;
    }
    let cancelled = false;
    setState("checking");
    void client
      .getAuthSession()
      .then((session) => {
        if (cancelled) return;
        setUser(session.data.user);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiProblemError && error.status === 401) {
          const next = currentProtectedPath();
          window.location.replace(`/login?next=${encodeURIComponent(next)}`);
          return;
        }
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [client, pathname]);

  if (pathname === "/login") {
    return <>{children}</>;
  }
  if (state === "checking") {
    return (
      <main className="authGateState" role="status" aria-live="polite">
        <span className="authGateMark" aria-hidden="true">
          ◌
        </span>
        <p>正在恢复安全会话…</p>
      </main>
    );
  }
  if (state === "error") {
    return (
      <main className="authGateState" role="alert">
        <p>会话检查失败，请刷新页面重试。</p>
        <button type="button" onClick={() => window.location.reload()}>
          重新检查
        </button>
      </main>
    );
  }
  return (
    <AuthUserContext.Provider value={user}>
      {children}
    </AuthUserContext.Provider>
  );
}
