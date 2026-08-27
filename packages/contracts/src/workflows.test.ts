import assert from "node:assert/strict";
import test from "node:test";
import { humanTasksResponseSchema } from "./workflows.js";

test("human task response includes signed candidate previews", () => {
  const parsed = humanTasksResponseSchema.parse({
    data: [
      {
        humanTaskId: "5a1f6d2e-4f89-4a0c-9b0c-0305e82c9099",
        taskType: "SELECT_ANCHOR_IMAGE",
        nodeName: "human_select_anchor_v1",
        status: "PENDING",
        allowedActions: ["SELECT"],
        candidateOutputIds: [
          "8e2f6d2e-4f89-4a0c-9b0c-0305e82c1111",
        ],
        candidates: [
          {
            outputId: "8e2f6d2e-4f89-4a0c-9b0c-0305e82c1111",
            previewUrl: "https://storage.example.test/candidate",
            previewExpiresAt: "2026-08-27T09:00:00.000Z",
            width: 1448,
            height: 1086,
          },
        ],
        createdAt: "2026-08-27T08:00:00.000Z",
      },
    ],
  });

  assert.equal(parsed.data[0]?.candidates[0]?.width, 1448);
});
