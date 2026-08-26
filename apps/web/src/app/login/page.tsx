"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiProblemError, WorkflowApiClient } from "../../lib/api-client.js";
import { resolveSafeNext } from "../../lib/auth-session.js";
import styles from "./login.module.css";

type Mode = "login" | "register";

function nextDestination(): string {
  if (typeof window === "undefined") return "/projects";
  return resolveSafeNext(new URLSearchParams(window.location.search).get("next"));
}

function authErrorMessage(error: unknown): string {
  if (error instanceof ApiProblemError) {
    switch (error.code) {
      case "AUTH_INVALID_CREDENTIALS":
        return "邮箱或密码不正确。";
      case "EMAIL_ALREADY_REGISTERED":
        return "该邮箱已经注册，请直接登录。";
      case "AUTH_LOGIN_RATE_LIMITED":
        return "尝试次数过多，请稍后再试。";
      case "VALIDATION_FAILED":
        return "请检查邮箱、显示名和密码格式。";
      default:
        return "认证失败，请稍后重试。";
    }
  }
  return "无法连接认证服务，请检查网络后重试。";
}

export default function LoginPage(): React.JSX.Element {
  const client = useMemo(() => new WorkflowApiClient(), []);
  const [mode, setMode] = useState<Mode>("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void client
      .getAuthSession()
      .then(() => {
        if (!cancelled) window.location.replace(nextDestination());
      })
      .catch(() => {
        // A 401 is the expected state on the sign-in page.
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const switchMode = (nextMode: Mode): void => {
    setMode(nextMode);
    setError(null);
    setPassword("");
    setPasswordConfirmation("");
  };

  const submit = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    if (isSubmitting) return;
    if (mode === "register" && password !== passwordConfirmation) {
      setError("两次输入的密码不一致。");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      if (mode === "register") {
        await client.register({ email, password, displayName });
      } else {
        await client.login({ email, password });
      }
      window.location.replace(nextDestination());
    } catch (caught) {
      setError(authErrorMessage(caught));
      setIsSubmitting(false);
    }
  };

  return (
    <main className={styles.shell}>
      <section className={styles.stage} aria-labelledby="auth-title">
        <div className={styles.brand} aria-label="Live Photo Studio">
          <span className={styles.brandMark} aria-hidden="true">
            ◌
          </span>
          <span className={styles.brandName}>Live Photo Studio</span>
        </div>

        <div className={styles.copy}>
          <p className={styles.eyebrow}>Private studio access</p>
          <h1 className={styles.title} id="auth-title">
            {mode === "login" ? "回到你的影像工作台。" : "创建你的私人工作台。"}
          </h1>
          <p className={styles.intro}>
            登录后，项目、素材、生成任务和服务端生图设置都会绑定到你的账户。
          </p>
        </div>

        <div className={styles.panel}>
          <div className={styles.modeSwitch} aria-label="认证方式">
            <button
              className={mode === "login" ? styles.modeActive : styles.mode}
              type="button"
              aria-pressed={mode === "login"}
              onClick={() => switchMode("login")}
            >
              登录
            </button>
            <button
              className={mode === "register" ? styles.modeActive : styles.mode}
              type="button"
              aria-pressed={mode === "register"}
              onClick={() => switchMode("register")}
            >
              注册
            </button>
          </div>

          <form className={styles.form} onSubmit={(event) => void submit(event)}>
            {mode === "register" && (
              <label className={styles.field}>
                <span>显示名</span>
                <input
                  name="displayName"
                  type="text"
                  autoComplete="name"
                  minLength={1}
                  maxLength={80}
                  required
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
            )}

            <label className={styles.field}>
              <span>邮箱</span>
              <input
                name="email"
                type="email"
                autoComplete="email"
                maxLength={254}
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>

            <label className={styles.field}>
              <span>密码</span>
              <input
                name="password"
                type="password"
                autoComplete={
                  mode === "register" ? "new-password" : "current-password"
                }
                minLength={mode === "register" ? 12 : 1}
                maxLength={128}
                aria-describedby={
                  mode === "register" ? "password-requirement" : undefined
                }
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>

            {mode === "register" && (
              <>
                <p className={styles.hint} id="password-requirement">
                  使用至少 12 个字符。密码只会以加盐 Scrypt 哈希保存。
                </p>
                <label className={styles.field}>
                  <span>确认密码</span>
                  <input
                    name="passwordConfirmation"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    required
                    value={passwordConfirmation}
                    onChange={(event) =>
                      setPasswordConfirmation(event.target.value)
                    }
                  />
                </label>
              </>
            )}

            <button
              className={styles.submit}
              type="submit"
              disabled={isSubmitting}
              aria-busy={isSubmitting}
            >
              {isSubmitting
                ? mode === "login"
                  ? "登录中…"
                  : "创建账户中…"
                : mode === "login"
                  ? "登录工作台"
                  : "创建账户"}
            </button>
          </form>

          {error !== null && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          <p className={styles.privacy}>
            Session 保存在 HttpOnly Cookie 中，不写入 LocalStorage，也不会发送给图片模型。
          </p>
        </div>
      </section>
    </main>
  );
}
