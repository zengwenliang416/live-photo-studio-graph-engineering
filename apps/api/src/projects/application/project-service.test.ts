import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationProblemError } from "../../http/problem-details.js";
import { type ProjectRow } from "../ports.js";
import { InMemoryProjectStore } from "../testing/in-memory-project-store.js";
import { ProjectService } from "./project-service.js";

const USER = "user-a";
const OTHER_USER = "user-b";

function makeService(): {
  service: ProjectService;
  store: InMemoryProjectStore;
} {
  const store = new InMemoryProjectStore();
  return { service: new ProjectService(store), store };
}

function seedProjects(
  store: InMemoryProjectStore,
  userId: string,
  count: number,
  idOffset = 0,
): ProjectRow[] {
  const rows: ProjectRow[] = [];
  for (let index = 0; index < count; index += 1) {
    const row: ProjectRow = {
      id: `00000000-0000-4000-8000-${String(index + idOffset).padStart(12, "0")}`,
      userId,
      title: `project-${index}`,
      coverAssetId: null,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    };
    store.seedProject(row);
    rows.push(row);
  }
  return rows;
}

function expectProblem(
  error: unknown,
  status: number,
  code: string,
): void {
  if (!(error instanceof ApplicationProblemError)) {
    assert.fail(`expected ApplicationProblemError, got ${String(error)}`);
  }
  assert.equal(error.status, status);
  assert.equal(error.code, code);
}

test("create returns 201 with the new project", async () => {
  const { service, store } = makeService();
  const result = await service.createProject({
    userId: USER,
    idempotencyKey: "key-create-00000001",
    body: { title: "Summer set" },
  });
  assert.equal(result.status, 201);
  const data = (result.body as { data: Record<string, unknown> }).data;
  assert.equal(data["title"], "Summer set");
  assert.ok(typeof data["projectId"] === "string");
  assert.equal(store.projects.size, 1);
});

test("idempotent replay returns the first response without a second insert", async () => {
  const { service, store } = makeService();
  const first = await service.createProject({
    userId: USER,
    idempotencyKey: "key-replay-00000001",
    body: { title: "Replay" },
  });
  const replay = await service.createProject({
    userId: USER,
    idempotencyKey: "key-replay-00000001",
    body: { title: "Replay" },
  });
  assert.deepEqual(replay, first);
  assert.equal(store.projects.size, 1);
});

test("reusing a key with a different body conflicts with 409", async () => {
  const { service } = makeService();
  await service.createProject({
    userId: USER,
    idempotencyKey: "key-conflict-000001",
    body: { title: "First" },
  });
  await assert.rejects(
    service.createProject({
      userId: USER,
      idempotencyKey: "key-conflict-000001",
      body: { title: "Second" },
    }),
    (error: unknown) => {
      expectProblem(error, 409, "IDEMPOTENCY_KEY_REUSED");
      return true;
    },
  );
});

test("list paginates with an opaque cursor across pages and ends cleanly", async () => {
  const { service, store } = makeService();
  seedProjects(store, USER, 5);

  const page1 = await service.listProjects({ userId: USER, limit: 2 });
  const data1 = (page1.body as { data: { items: Array<{ title: string }>; nextCursor: string | null } }).data;
  assert.deepEqual(
    data1.items.map((item) => item.title),
    ["project-4", "project-3"],
  );
  assert.ok(data1.nextCursor !== null);

  const page2 = await service.listProjects({
    userId: USER,
    limit: 2,
    cursor: data1.nextCursor ?? undefined,
  });
  const data2 = (page2.body as { data: { items: Array<{ title: string }>; nextCursor: string | null } }).data;
  assert.deepEqual(
    data2.items.map((item) => item.title),
    ["project-2", "project-1"],
  );
  assert.ok(data2.nextCursor !== null);

  const page3 = await service.listProjects({
    userId: USER,
    limit: 2,
    cursor: data2.nextCursor ?? undefined,
  });
  const data3 = (page3.body as { data: { items: Array<{ title: string }>; nextCursor: string | null } }).data;
  assert.deepEqual(
    data3.items.map((item) => item.title),
    ["project-0"],
  );
  assert.equal(data3.nextCursor, null);
});

test("a page ending exactly on the limit reports no further cursor", async () => {
  const { service, store } = makeService();
  seedProjects(store, USER, 4);

  const page1 = await service.listProjects({ userId: USER, limit: 2 });
  const data1 = (page1.body as { data: { nextCursor: string | null } }).data;
  assert.ok(data1.nextCursor !== null);

  const page2 = await service.listProjects({
    userId: USER,
    limit: 2,
    cursor: data1.nextCursor ?? undefined,
  });
  const data2 = (page2.body as { data: { items: unknown[]; nextCursor: string | null } }).data;
  assert.equal(data2.items.length, 2);
  assert.equal(data2.nextCursor, null);
});

test("list is scoped to the caller and clamps over-large limits to 50", async () => {
  const { service, store } = makeService();
  seedProjects(store, USER, 55);
  seedProjects(store, OTHER_USER, 3, 500);

  const page1 = await service.listProjects({ userId: USER, limit: 100 });
  const data1 = (page1.body as { data: { items: unknown[]; nextCursor: string | null } }).data;
  assert.equal(data1.items.length, 50);
  assert.ok(data1.nextCursor !== null);

  const page2 = await service.listProjects({
    userId: USER,
    limit: 100,
    cursor: data1.nextCursor ?? undefined,
  });
  const data2 = (page2.body as { data: { items: unknown[]; nextCursor: string | null } }).data;
  assert.equal(data2.items.length, 5);
  assert.equal(data2.nextCursor, null);

  const other = await service.listProjects({ userId: OTHER_USER });
  const otherData = (other.body as { data: { items: unknown[] } }).data;
  assert.equal(otherData.items.length, 3);
});

test("a malformed cursor is rejected as a validation problem", async () => {
  const { service } = makeService();
  await assert.rejects(
    service.listProjects({ userId: USER, cursor: "not-a-cursor" }),
    (error: unknown) => {
      expectProblem(error, 422, "VALIDATION_FAILED");
      return true;
    },
  );
});

test("get returns the project with assets in ascending creation order", async () => {
  const { service, store } = makeService();
  const [project] = seedProjects(store, USER, 1);
  assert.ok(project);
  store.seedAsset(project.id, {
    id: "10000000-0000-4000-8000-000000000002",
    contentType: "image/jpeg",
    bytes: 2048,
    status: "READY",
    createdAt: new Date(Date.UTC(2026, 0, 2)).toISOString(),
    previewObjectKey:
      `projects/${project.id}/variants/10000000-0000-4000-8000-000000000002/` +
      "display-preview.v1.jpg",
    previewStatus: "SUCCEEDED",
  });
  store.seedAsset(project.id, {
    id: "10000000-0000-4000-8000-000000000001",
    contentType: "image/heic",
    bytes: null,
    status: "UPLOADING",
    createdAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    previewObjectKey: null,
    previewStatus: null,
  });

  const result = await service.getProject({
    projectId: project.id,
    userId: USER,
  });
  assert.equal(result.status, 200);
  const data = (
    result.body as {
      data: {
        assets: Array<{
          assetId: string;
          bytes: number | null;
          status: string;
          previewStatus: string;
        }>;
      };
    }
  ).data;
  assert.deepEqual(
    data.assets.map((asset) => asset.assetId),
    [
      "10000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000002",
    ],
  );
  assert.equal(data.assets[0]?.bytes, null);
  assert.equal(data.assets[0]?.previewStatus, "UNAVAILABLE");
});

test("get signs only completed display previews", async () => {
  const store = new InMemoryProjectStore();
  const [project] = seedProjects(store, USER, 1);
  assert.ok(project);
  const objectKey =
    `projects/${project.id}/variants/10000000-0000-4000-8000-000000000003/` +
    "display-preview.v1.jpg";
  store.seedAsset(project.id, {
    id: "10000000-0000-4000-8000-000000000003",
    contentType: "image/heic",
    bytes: 4096,
    status: "READY",
    createdAt: new Date(Date.UTC(2026, 0, 3)).toISOString(),
    previewObjectKey: objectKey,
    previewStatus: "SUCCEEDED",
  });
  const service = new ProjectService(store, {
    async sign(requestedKey) {
      assert.equal(requestedKey, objectKey);
      return {
        url: "https://storage.example.test/signed-preview",
        expiresAt: "2026-01-03T00:05:00.000Z",
      };
    },
  });

  const result = await service.getProject({
    projectId: project.id,
    userId: USER,
  });
  const data = (
    result.body as {
      data: {
        assets: Array<{
          previewUrl: string | null;
          previewStatus: string;
        }>;
      };
    }
  ).data;
  assert.equal(
    data.assets[0]?.previewUrl,
    "https://storage.example.test/signed-preview",
  );
  assert.equal(data.assets[0]?.previewStatus, "READY");
});

test("get never leaks existence: foreign and missing projects both 404", async () => {
  const { service, store } = makeService();
  const [foreign] = seedProjects(store, OTHER_USER, 1);
  assert.ok(foreign);

  await assert.rejects(
    service.getProject({ projectId: foreign.id, userId: USER }),
    (error: unknown) => {
      expectProblem(error, 404, "PROJECT_NOT_FOUND");
      return true;
    },
  );
  await assert.rejects(
    service.getProject({
      projectId: "99999999-0000-4000-8000-000000000000",
      userId: USER,
    }),
    (error: unknown) => {
      expectProblem(error, 404, "PROJECT_NOT_FOUND");
      return true;
    },
  );
});
