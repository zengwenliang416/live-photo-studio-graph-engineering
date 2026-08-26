"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AccountActions } from "../auth/account-actions.js";
import styles from "./app-shell.module.css";

type AppSection = "projects" | "settings";

interface AppShellProps {
  readonly children: ReactNode;
  readonly active: AppSection;
  readonly context?: string;
}

function ApertureMark(): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
    >
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 3.5 8.9 8.8M20.5 12h-6.2M12 20.5l3.1-5.3M3.5 12h6.2M12 3.5l3.1 5.3M12 20.5l-3.1-5.3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
      <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function AppShell({
  children,
  active,
  context,
}: AppShellProps): React.JSX.Element {
  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/projects" aria-label="Live Photo Studio 项目库">
          <span className={styles.brandMark}>
            <ApertureMark />
          </span>
          <span className={styles.brandName}>Live Photo Studio</span>
        </Link>
        {context !== undefined && (
          <span className={styles.context} title={context}>
            {context}
          </span>
        )}
        <AccountActions />
      </header>

      <aside className={styles.sidebar} aria-label="工作台导航">
        <nav className={styles.nav}>
          <Link
            className={styles.navItem}
            data-active={active === "projects" || undefined}
            href="/projects"
          >
            <span className={styles.navIcon} aria-hidden="true">
              ◫
            </span>
            <span>
              <strong>项目库</strong>
              <small>素材、风格与工作流</small>
            </span>
          </Link>
          <Link
            className={styles.navItem}
            data-active={active === "settings" || undefined}
            href="/settings"
          >
            <span className={styles.navIcon} aria-hidden="true">
              ⌘
            </span>
            <span>
              <strong>生图设置</strong>
              <small>模型与服务端通道</small>
            </span>
          </Link>
        </nav>

        <div className={styles.boundary}>
          <span className={styles.boundaryDot} aria-hidden="true" />
          <p>Web 导出为 iOS 导入器资源包，不等同于已写入相册。</p>
        </div>
      </aside>

      <div className={styles.content}>{children}</div>
    </div>
  );
}
