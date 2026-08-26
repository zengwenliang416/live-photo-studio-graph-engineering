// Keep the import list exhaustive for ad-hoc single-process API fixture runs.
// The package test command lists real test files explicitly and does not
// discover this aggregation harness, avoiding duplicate collection.
import "./auth/application/auth-service.test.ts";
import "./auth/auth.controller.test.ts";
import "./auth/password-hasher.test.ts";
import "./config.test.ts";
import "./exports/application/export-package-service.test.ts";
import "./exports/export-packages.controller.test.ts";
import "./exports/infrastructure/object-storage-signed-download-port.test.ts";
import "./workflow-operations.test.ts";
import "./workflow-service.test.ts";
import "./workflows.controller.test.ts";
import "./workflows/infrastructure/outbox-dispatcher.test.ts";
import "./workflows/infrastructure/pg-workflow-operations.integration.test.ts";
