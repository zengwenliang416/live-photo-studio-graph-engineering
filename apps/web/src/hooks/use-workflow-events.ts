"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  WorkflowApiClient,
  type ApiClientOptions,
} from "../lib/api-client.js";

/**
 * Subscribes to the run's SSE stream and invalidates queries on real state
 * changes. SSE payloads are hints only; the projection endpoint stays the
 * single source of truth.
 */
export function useWorkflowEvents(
  workflowRunId: string,
  onChanged: () => void,
  options: ApiClientOptions = {},
): void {
  const client = useMemo(() => new WorkflowApiClient(options), [options]);
  const callbackRef = useRef(onChanged);
  callbackRef.current = onChanged;

  useEffect(() => {
    if (!workflowRunId) return;
    let source: EventSource | null = null;
    let closed = false;
    try {
      source = new EventSource(client.eventsUrl(workflowRunId), {
        withCredentials: true,
      });
      source.onmessage = () => {
        if (!closed) callbackRef.current();
      };
      source.onerror = () => {
        // EventSource auto-reconnects; nothing to do here.
      };
    } catch {
      // Streaming unavailable (e.g., older runtime): polling interval in
      // useWorkflow keeps the UI correct.
    }
    return () => {
      closed = true;
      source?.close();
    };
  }, [workflowRunId, client]);
}
