export function resolveSafeNext(raw: string | null | undefined): string {
  if (
    raw === null ||
    raw === undefined ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    raw.includes("\\")
  ) {
    return "/projects";
  }
  try {
    const url = new URL(raw, "http://local.invalid");
    if (
      url.origin !== "http://local.invalid" ||
      !url.pathname.startsWith("/") ||
      url.pathname.startsWith("//") ||
      url.pathname.includes("\\")
    ) {
      return "/projects";
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/projects";
  }
}

export function currentProtectedPath(): string {
  if (typeof window === "undefined") return "/projects";
  return resolveSafeNext(
    `${window.location.pathname}${window.location.search}${window.location.hash}`,
  );
}

export function clearUserScopedBrowserState(): void {
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (
        key?.startsWith("workflow-run:") ||
        key?.startsWith("workflow-idempotency:")
      ) {
        keys.push(key);
      }
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // Restricted storage must not block sign-out.
  }
}
