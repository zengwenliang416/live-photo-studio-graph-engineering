import assert from "node:assert/strict";
import test from "node:test";
import {
  WorkflowApiClient,
  type WorkflowAction,
} from "./api-client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
  } as unknown as Response;
}

type Call = {
  method: string;
  path: string;
  key: string | undefined;
  credentials: RequestCredentials | undefined;
  userIdHeader: string | undefined;
};

function recordingClient() {
  const calls: Call[] = [];
  const keyStore = {
    map: new Map<string, string>(),
    get(actionId: string): string | undefined {
      return this.map.get(actionId);
    },
    set(actionId: string, key: string): void {
      this.map.set(actionId, key);
    },
    remove(actionId: string): void {
      this.map.delete(actionId);
    },
  };
  const client = new WorkflowApiClient({
    fetchImpl: async (_input, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const path = String(_input);
      calls.push({
        method: String(init?.method),
        path,
        key: headers["idempotency-key"],
        credentials: init?.credentials,
        userIdHeader: headers["x-user-id"],
      });
      if (path.includes("/decisions")) {
        return jsonResponse({
          data: { humanTaskId: "00000000-0000-4000-8000-000000000001" },
        });
      }
      return jsonResponse({
        data: { workflowRunId: "00000000-0000-4000-8000-000000000002" },
      });
    },
    baseUrl: "http://test",
    keyStore,
  });
  return { client, calls, keyStore };
}

test("duplicate start clicks reuse the same idempotency key", async () => {
  const { client, calls } = recordingClient();
  await client.startWorkflowRun("p1");
  await client.startWorkflowRun("p1");
  assert.equal(calls.length, 2);
  assert.ok(calls[0]?.key);
  assert.equal(calls[0]?.key, calls[1]?.key);
  assert.match(String(calls[0]?.path), /\/v1\/projects\/p1\/workflow-runs$/u);
});

test("a terminal workflow restart uses a deterministic replacement key", async () => {
  const { client, calls } = recordingClient();
  const failedRunId = "00000000-0000-4000-8000-000000000099";
  await client.startWorkflowRun("p1");
  await client.startWorkflowRun("p1", undefined, {
    restartAfterRunId: failedRunId,
  });
  await client.startWorkflowRun("p1", undefined, {
    restartAfterRunId: failedRunId,
  });

  assert.ok(calls[0]?.key);
  assert.notEqual(calls[0]?.key, calls[1]?.key);
  assert.equal(calls[1]?.key, `workflow-restart:p1:${failedRunId}`);
  assert.equal(calls[1]?.key, calls[2]?.key);
});

test("business requests use cookie credentials and never send x-user-id", async () => {
  const { client, calls } = recordingClient();
  await client.startWorkflowRun("p1");
  assert.equal(calls[0]?.credentials, "include");
  assert.equal(calls[0]?.userIdHeader, undefined);
});

test("decide keys are scoped per task and action", async () => {
  const { client, calls } = recordingClient();
  const body: { action: WorkflowAction; selectedOutputId: string } = {
    action: "SELECT",
    selectedOutputId: "00000000-0000-4000-8000-000000000003",
  };
  await Promise.all([
    client.decide("t1", body),
    client.decide("t1", body),
    client.decide("t2", body),
  ]);
  assert.equal(calls[0]?.key, calls[1]?.key);
  assert.notEqual(calls[0]?.key, calls[2]?.key);
});

test("SELECT decisions carry the task-selected output id", async () => {
  const { client, calls } = recordingClient();
  await client.decide("task-1", {
    action: "SELECT",
    selectedOutputId: "output-1",
  });
  assert.equal(calls.length, 1);
  assert.match(String(calls[0]?.path), /\/v1\/human-tasks\/task-1\/decisions$/u);
});

test("latest export download requests a project-scoped short-lived grant", async () => {
  const projectId = "00000000-0000-4000-8000-000000000010";
  const exportPackageId = "00000000-0000-4000-8000-000000000011";
  const expiresAt = new Date(Date.now() + 300_000).toISOString();
  const calls: string[] = [];
  const client = new WorkflowApiClient({
    fetchImpl: async (input, init) => {
      calls.push(`${String(init?.method)} ${String(input)}`);
      return jsonResponse({
        data: {
          exportPackageId,
          projectId,
          downloadUrl: "https://storage.example.test/signed/package.zip",
          expiresAt,
          sha256: "a".repeat(64),
          durationMs: 1500,
          bytes: 42,
        },
      });
    },
    baseUrl: "http://test",
  });

  const result = await client.getLatestExportDownload(projectId);

  assert.equal(result.data.projectId, projectId);
  assert.equal(result.data.exportPackageId, exportPackageId);
  assert.deepEqual(calls, [
    `GET http://test/v1/projects/${projectId}/export-packages/latest/download`,
  ]);
});

test("style prompt detail requests the compiled prompt for a reference count", async () => {
  const calls: string[] = [];
  const client = new WorkflowApiClient({
    fetchImpl: async (input, init) => {
      calls.push(`${String(init?.method)} ${String(input)}`);
      return jsonResponse({
        data: {
          preset: {
            key: "onepic-case-529",
            name: "云朵气球山脊旅行人像",
            description: "旅行人像视觉蓝图",
            version: "v1",
            category: "自然旅行",
            recommendedFor: "旅行、户外、自然",
            recommendedMotion: "柔光呼吸",
            colorPalette: ["#223431", "#6f9981", "#d8c18a"],
            previewStyle: "onepic-case-529",
            source: {
              project: "onepic-template-studio",
              templateId: "case-529",
              promptHash: "a".repeat(64),
              previewUrl:
                "https://onepic.motion-cover.com/previews/case-529.webp",
            },
          },
          referenceImageCount: 4,
          prompt: "[System / Prompt]\ncompiled",
          promptVersion:
            "onepic-case-529@v1+style-extension.v1",
          promptHash: "b".repeat(64),
        },
      });
    },
    baseUrl: "http://test",
  });

  const result = await client.getStylePresetPrompt("onepic-case-529", 4);

  assert.equal(result.data.referenceImageCount, 4);
  assert.equal(result.data.preset.source?.templateId, "case-529");
  assert.deepEqual(calls, [
    "GET http://test/v1/style-presets/onepic-case-529/prompt?referenceImageCount=4",
  ]);
});

test("problem+json responses raise typed errors", async () => {
  const client = new WorkflowApiClient({
    fetchImpl: async () =>
      ({
        ok: false,
        status: 409,
        headers: new Headers({ "content-type": "application/problem+json" }),
        json: async () => ({ code: "IDEMPOTENCY_KEY_REUSED", title: "reused" }),
      }) as unknown as Response,
    baseUrl: "http://test",
  });
  await assert.rejects(
    client.cancel("r"),
    (error: unknown) =>
      error instanceof Error &&
      (error as Error & { code?: string }).code === "IDEMPOTENCY_KEY_REUSED",
  );
});

type RecordedCall = {
  method: string;
  url: string;
  key: string | undefined;
  body: unknown;
};

function projectRecordingClient(responder: (call: RecordedCall) => unknown) {
  const calls: RecordedCall[] = [];
  const keyStore = {
    map: new Map<string, string>(),
    get(actionId: string): string | undefined {
      return this.map.get(actionId);
    },
    set(actionId: string, key: string): void {
      this.map.set(actionId, key);
    },
    remove(actionId: string): void {
      this.map.delete(actionId);
    },
  };
  const client = new WorkflowApiClient({
    fetchImpl: async (input, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const call: RecordedCall = {
        method: String(init?.method),
        url: String(input),
        key: headers["idempotency-key"],
        body:
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as unknown)
            : undefined,
      };
      calls.push(call);
      return jsonResponse(responder(call), 201);
    },
    baseUrl: "http://test",
    keyStore,
  });
  return { client, calls, keyStore };
}

const PROJECT_ID = "00000000-0000-4000-8000-0000000000a1";
const ASSET_ID = "00000000-0000-4000-8000-0000000000b2";
const CREATED_AT = "2026-01-01T00:00:00.000Z";

test("createProject posts the title and reuses the caller actionId key", async () => {
  const { client, calls } = projectRecordingClient(() => ({
    data: { projectId: PROJECT_ID, title: "旅行", createdAt: CREATED_AT },
  }));
  await client.createProject("旅行", "form-1");
  await client.createProject("旅行", "form-1");
  await client.createProject("旅行", "form-2");
  assert.equal(calls.length, 3);
  assert.equal(calls[0]?.method, "POST");
  assert.equal(calls[0]?.url, "http://test/v1/projects");
  assert.deepEqual(calls[0]?.body, { title: "旅行" });
  assert.ok(calls[0]?.key);
  assert.equal(calls[0]?.key, calls[1]?.key);
  assert.notEqual(calls[0]?.key, calls[2]?.key);
});

test("createProject omits the title field when it is undefined", async () => {
  const { client, calls } = projectRecordingClient(() => ({
    data: { projectId: PROJECT_ID, title: "", createdAt: CREATED_AT },
  }));
  await client.createProject(undefined, "form-3");
  assert.deepEqual(calls[0]?.body, {});
});

test("listProjects builds limit/cursor query params", async () => {
  const { client, calls } = projectRecordingClient(() => ({
    data: {
      items: [
        {
          projectId: PROJECT_ID,
          title: "旅行",
          createdAt: CREATED_AT,
          coverAssetId: null,
        },
      ],
      nextCursor: "next-page",
    },
  }));
  const result = await client.listProjects({ limit: 20, cursor: "abc" });
  assert.equal(calls[0]?.method, "GET");
  assert.equal(calls[0]?.url, "http://test/v1/projects?limit=20&cursor=abc");
  assert.equal(calls[0]?.key, undefined);
  assert.equal(result.data.items.length, 1);
  assert.equal(result.data.nextCursor, "next-page");
});

test("default fetch keeps the browser global receiver", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async function (input): Promise<Response> {
    assert.equal(this, globalThis);
    calls.push(String(input));
    return jsonResponse({ data: { items: [], nextCursor: null } });
  };

  try {
    const client = new WorkflowApiClient({ baseUrl: "" });
    await client.listProjects({ limit: 50 });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(calls, ["/v1/projects?limit=50"]);
});

test("getProject parses the asset list with nullable fields", async () => {
  const { client, calls } = projectRecordingClient(() => ({
    data: {
      projectId: PROJECT_ID,
      title: "旅行",
      createdAt: CREATED_AT,
      coverAssetId: ASSET_ID,
      assets: [
        {
          assetId: ASSET_ID,
          contentType: "image/heic",
          bytes: null,
          status: "READY",
          createdAt: CREATED_AT,
          previewUrl: "https://storage.example.test/signed-preview",
          previewExpiresAt: CREATED_AT,
          previewStatus: "READY",
        },
      ],
      livePhotoPairs: [
        {
          livePhotoPairId: "00000000-0000-4000-8000-0000000000c3",
          photoAssetId: ASSET_ID,
          videoAssetId: "00000000-0000-4000-8000-0000000000d4",
          status: "PAIRED",
          createdAt: CREATED_AT,
        },
      ],
    },
  }));
  const result = await client.getProject(PROJECT_ID);
  assert.equal(calls[0]?.url, `http://test/v1/projects/${PROJECT_ID}`);
  assert.equal(result.data.coverAssetId, ASSET_ID);
  assert.equal(result.data.assets[0]?.status, "READY");
  assert.equal(result.data.assets[0]?.bytes, null);
  assert.equal(
    result.data.assets[0]?.previewUrl,
    "https://storage.example.test/signed-preview",
  );
  assert.equal(result.data.livePhotoPairs[0]?.photoAssetId, ASSET_ID);
});

test("upload intent keys are scoped per project, file name and size", async () => {
  const { client, calls } = projectRecordingClient(() => ({
    data: {
      assetId: ASSET_ID,
      uploadUrl: "https://storage.example.test/signed/put",
      uploadHeaders: { "content-type": "image/jpeg" },
      expiresAt: CREATED_AT,
    },
  }));
  const input = { contentType: "image/jpeg", bytes: 123, fileName: "a.jpg" };
  await client.createUploadIntent(PROJECT_ID, input);
  await client.createUploadIntent(PROJECT_ID, input);
  await client.createUploadIntent(PROJECT_ID, { ...input, fileName: "b.jpg" });
  assert.equal(
    calls[0]?.url,
    `http://test/v1/projects/${PROJECT_ID}/upload-intents`,
  );
  assert.deepEqual(calls[0]?.body, { contentType: "image/jpeg", bytes: 123 });
  assert.equal(calls[0]?.key, calls[1]?.key);
  assert.notEqual(calls[0]?.key, calls[2]?.key);
  assert.ok(calls.every((call) => call.key !== undefined));
});

test("confirmAsset reuses the per-asset idempotency key", async () => {
  const { client, calls } = projectRecordingClient(() => ({
    data: { assetId: ASSET_ID, status: "READY" },
  }));
  const body = { bytes: 123, sha256: "a".repeat(64) };
  const first = await client.confirmAsset(ASSET_ID, body);
  await client.confirmAsset(ASSET_ID, body);
  assert.equal(first.data.status, "READY");
  assert.equal(calls[0]?.url, `http://test/v1/assets/${ASSET_ID}/confirm`);
  assert.deepEqual(calls[0]?.body, body);
  assert.equal(calls[0]?.key, calls[1]?.key);
});

test("setProjectCover posts the asset id with a per-project key", async () => {
  const { client, calls } = projectRecordingClient(() => ({
    data: { projectId: PROJECT_ID, coverAssetId: ASSET_ID },
  }));
  await client.setProjectCover(PROJECT_ID, ASSET_ID);
  await client.setProjectCover(PROJECT_ID, ASSET_ID);
  assert.equal(
    calls[0]?.url,
    `http://test/v1/projects/${PROJECT_ID}/cover`,
  );
  assert.deepEqual(calls[0]?.body, { assetId: ASSET_ID });
  assert.equal(calls[0]?.key, calls[1]?.key);
});

test("createLivePhotoPair posts both assets with a stable pair key", async () => {
  const videoAssetId = "00000000-0000-4000-8000-0000000000d4";
  const pairId = "00000000-0000-4000-8000-0000000000c3";
  const { client, calls } = projectRecordingClient(() => ({
    data: {
      livePhotoPairId: pairId,
      projectId: PROJECT_ID,
      photoAssetId: ASSET_ID,
      videoAssetId,
      status: "PAIRED",
      createdAt: CREATED_AT,
    },
  }));
  await client.createLivePhotoPair(PROJECT_ID, ASSET_ID, videoAssetId);
  await client.createLivePhotoPair(PROJECT_ID, ASSET_ID, videoAssetId);
  assert.equal(
    calls[0]?.url,
    `http://test/v1/projects/${PROJECT_ID}/live-photo-pairs`,
  );
  assert.deepEqual(calls[0]?.body, {
    photoAssetId: ASSET_ID,
    videoAssetId,
  });
  assert.equal(calls[0]?.key, calls[1]?.key);
});

test("uploadToSignedUrl PUTs the blob with only the signed headers", async () => {
  const seen: {
    method: string;
    headers: Record<string, string>;
    size: number;
    credentials: RequestCredentials | undefined;
  }[] = [];
  const client = new WorkflowApiClient({
    fetchImpl: async (_input, init) => {
      seen.push({
        method: String(init?.method),
        headers: (init?.headers ?? {}) as Record<string, string>,
        size: (init?.body as Blob).size,
        credentials: init?.credentials,
      });
      return { ok: true, status: 200 } as unknown as Response;
    },
    baseUrl: "http://test",
  });
  await client.uploadToSignedUrl(
    "https://storage.example.test/signed/put",
    { "content-type": "image/jpeg" },
    new Blob(["abc"], { type: "image/jpeg" }),
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.method, "PUT");
  assert.equal(seen[0]?.size, 3);
  assert.equal(seen[0]?.credentials, "omit");
  assert.deepEqual(seen[0]?.headers, { "content-type": "image/jpeg" });
});

test("auth methods use the shared session contract and credentialed requests", async () => {
  const calls: Array<{
    url: string;
    method: string;
    body: unknown;
    credentials: RequestCredentials | undefined;
  }> = [];
  const client = new WorkflowApiClient({
    baseUrl: "http://test",
    fetchImpl: async (input, init) => {
      calls.push({
        url: String(input),
        method: String(init?.method),
        body:
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as unknown)
            : undefined,
        credentials: init?.credentials,
      });
      if (String(input).endsWith("/logout")) {
        return jsonResponse({ data: { signedOut: true } });
      }
      return jsonResponse({
        data: {
          user: {
            userId: "00000000-0000-4000-8000-000000000001",
            email: "owner@example.com",
            displayName: "Owner",
          },
          expiresAt: "2026-08-25T12:00:00.000Z",
        },
      });
    },
  });
  await client.register({
    email: "owner@example.com",
    password: "correct horse battery staple",
    displayName: "Owner",
  });
  await client.login({
    email: "owner@example.com",
    password: "correct horse battery staple",
  });
  await client.getAuthSession();
  await client.logout();
  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.url}`),
    [
      "POST http://test/v1/auth/register",
      "POST http://test/v1/auth/login",
      "GET http://test/v1/auth/session",
      "POST http://test/v1/auth/logout",
    ],
  );
  assert.ok(calls.every((call) => call.credentials === "include"));
});

test("uploadToSignedUrl maps non-2xx to ApiProblemError", async () => {
  const client = new WorkflowApiClient({
    fetchImpl: async () =>
      ({ ok: false, status: 403 }) as unknown as Response,
    baseUrl: "http://test",
  });
  await assert.rejects(
    client.uploadToSignedUrl("https://storage.example.test/x", {}, new Blob()),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "ApiProblemError" &&
      (error as Error & { code?: string }).code === "HTTP_403",
  );
});

test("startWorkflowRun sends the styleKey inside input when provided", async () => {
  const { client, calls } = projectRecordingClient(() => ({
    data: { workflowRunId: "00000000-0000-4000-8000-0000000000c3" },
  }));
  await client.startWorkflowRun("p1", { styleKey: "film" });
  assert.equal(calls[0]?.method, "POST");
  assert.equal(calls[0]?.url, "http://test/v1/projects/p1/workflow-runs");
  assert.deepEqual(calls[0]?.body, { input: { styleKey: "film" } });
});

test("startWorkflowRun keeps the empty body when no input is given", async () => {
  const { client, calls } = projectRecordingClient(() => ({
    data: { workflowRunId: "00000000-0000-4000-8000-0000000000c3" },
  }));
  await client.startWorkflowRun("p1");
  assert.deepEqual(calls[0]?.body, {});
});

test("getImageProviderSettings reads the configuration without a key", async () => {
  const { client, calls } = projectRecordingClient(() => ({
    data: {
      configured: true,
      baseUrl: "https://api.example.test/v1",
      model: "gpt-image-2",
      enabled: true,
      updatedAt: CREATED_AT,
      keyPreview: "sk-…1234",
    },
  }));
  const result = await client.getImageProviderSettings();
  assert.equal(calls[0]?.method, "GET");
  assert.equal(calls[0]?.url, "http://test/v1/settings/image-provider");
  assert.equal(calls[0]?.key, undefined);
  assert.equal(result.data.configured, true);
  assert.equal(result.data.keyPreview, "sk-…1234");
});

test("putImageProviderSettings sends the full body with the fixed action key", async () => {
  const { client, calls } = projectRecordingClient(() => ({
    data: {
      baseUrl: "https://api.example.test/v1",
      model: "gpt-image-2",
      enabled: true,
      updatedAt: CREATED_AT,
    },
  }));
  const body = {
    baseUrl: "https://api.example.test/v1",
    apiKey: "sk-secret",
    model: "gpt-image-2",
    enabled: true,
  };
  await client.putImageProviderSettings(body);
  assert.equal(calls[0]?.method, "PUT");
  assert.equal(calls[0]?.url, "http://test/v1/settings/image-provider");
  assert.deepEqual(calls[0]?.body, body);
  assert.ok(calls[0]?.key);
});

test("putImageProviderSettings retries reuse the key, success rotates it", async () => {
  const keys: (string | undefined)[] = [];
  const keyStore = {
    map: new Map<string, string>(),
    get(actionId: string): string | undefined {
      return this.map.get(actionId);
    },
    set(actionId: string, key: string): void {
      this.map.set(actionId, key);
    },
    remove(actionId: string): void {
      this.map.delete(actionId);
    },
  };
  let attempt = 0;
  const client = new WorkflowApiClient({
    fetchImpl: async (_input, init) => {
      keys.push(
        ((init?.headers ?? {}) as Record<string, string>)["idempotency-key"],
      );
      attempt += 1;
      if (attempt === 1) {
        return {
          ok: false,
          status: 500,
          headers: new Headers({
            "content-type": "application/problem+json",
          }),
          json: async () => ({ code: "UPSTREAM", title: "boom" }),
        } as unknown as Response;
      }
      return jsonResponse({
        data: {
          baseUrl: "https://api.example.test/v1",
          model: "gpt-image-2",
          enabled: true,
          updatedAt: CREATED_AT,
        },
      });
    },
    baseUrl: "http://test",
    keyStore,
  });
  const body = {
    baseUrl: "https://api.example.test/v1",
    apiKey: "sk-secret",
    model: "gpt-image-2",
  };
  await assert.rejects(client.putImageProviderSettings(body));
  await client.putImageProviderSettings(body);
  assert.equal(keys[0], keys[1]);
  await client.putImageProviderSettings(body);
  assert.notEqual(keys[1], keys[2]);
});

test("deleteImageProviderSettings removes the stored key after success", async () => {
  const { client, calls, keyStore } = projectRecordingClient(() => ({
    data: { configured: false },
  }));
  const result = await client.deleteImageProviderSettings();
  assert.equal(calls[0]?.method, "DELETE");
  assert.equal(calls[0]?.url, "http://test/v1/settings/image-provider");
  assert.equal(calls[0]?.body, undefined);
  assert.ok(calls[0]?.key);
  assert.equal(keyStore.map.has("settings:image-provider:delete"), false);
  assert.equal(result.data.configured, false);
});

test("listStylePresets returns preset items", async () => {
  const { client, calls } = projectRecordingClient(() => ({
    data: {
      items: [
        {
          key: "film",
          name: "胶片日常",
          description: "柔和胶片色调",
          version: "style-extension.v1",
          category: "电影胶片",
          recommendedFor: "人像",
          recommendedMotion: "微距推近",
          colorPalette: ["#111111", "#777777", "#eeeeee"],
          previewStyle: "film",
          source: null,
        },
      ],
    },
  }));
  const result = await client.listStylePresets();
  assert.equal(calls[0]?.method, "GET");
  assert.equal(calls[0]?.url, "http://test/v1/style-presets");
  assert.equal(calls[0]?.key, undefined);
  assert.equal(result.data.items[0]?.key, "film");
  assert.equal(result.data.items[0]?.category, "电影胶片");
});
