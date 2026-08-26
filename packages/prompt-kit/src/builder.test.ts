import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PROMPT_TEMPLATE_VERSION,
  STYLE_PRESETS,
  compilePrompt,
  findStylePreset,
} from "./index.js";

const REFERENCE_IMAGE_COUNT = 4;

test("every preset compiles with all required sections", () => {
  for (const preset of STYLE_PRESETS) {
    const { prompt } = compilePrompt({ preset, referenceImageCount: REFERENCE_IMAGE_COUNT });

    assert.ok(prompt.includes("[System / Prompt]"), `${preset.key}: missing system header`);
    assert.ok(prompt.includes("BEGIN VISUAL BLUEPRINT"), `${preset.key}: missing blueprint begin`);
    assert.ok(prompt.includes(preset.visualBlueprint), `${preset.key}: missing blueprint body`);
    assert.ok(prompt.includes("END VISUAL BLUEPRINT"), `${preset.key}: missing blueprint end`);

    for (const rule of preset.preserveRules) {
      assert.ok(prompt.includes(`- ${rule}`), `${preset.key}: missing preserve rule: ${rule}`);
    }
    for (const element of preset.forbiddenElements) {
      assert.ok(prompt.includes(`- ${element}`), `${preset.key}: missing forbidden element: ${element}`);
    }
  }
});

test("prompt hash is stable for identical input", () => {
  const preset = findStylePreset("cinematic-portrait");
  assert.ok(preset);
  const first = compilePrompt({ preset, referenceImageCount: REFERENCE_IMAGE_COUNT });
  const second = compilePrompt({ preset, referenceImageCount: REFERENCE_IMAGE_COUNT });
  assert.equal(first.promptHash, second.promptHash);
  assert.equal(first.prompt, second.prompt);
  assert.match(first.promptHash, /^[0-9a-f]{64}$/);
});

test("different presets produce different hashes", () => {
  const hashes = new Set(
    STYLE_PRESETS.map(
      (preset) => compilePrompt({ preset, referenceImageCount: REFERENCE_IMAGE_COUNT }).promptHash,
    ),
  );
  assert.equal(hashes.size, STYLE_PRESETS.length);
});

test("prompt version combines preset key, preset version and template version", () => {
  for (const preset of STYLE_PRESETS) {
    const { promptVersion } = compilePrompt({ preset, referenceImageCount: REFERENCE_IMAGE_COUNT });
    assert.equal(promptVersion, `${preset.key}@${preset.version}+${PROMPT_TEMPLATE_VERSION}`);
  }
});

test("reference image count appears in the role section", () => {
  const preset = findStylePreset("studio-product");
  assert.ok(preset);
  const single = compilePrompt({ preset, referenceImageCount: 1 });
  assert.ok(single.prompt.includes("You receive 1 reference image(s)."));
  assert.ok(!single.prompt.includes("Images 2 to"));

  const many = compilePrompt({ preset, referenceImageCount: 5 });
  assert.ok(many.prompt.includes("You receive 5 reference image(s)."));
  assert.ok(many.prompt.includes("Images 2 to 5 are additional content references"));
});

test("blueprints contain no placeholder variables", () => {
  for (const preset of STYLE_PRESETS) {
    assert.ok(
      !preset.visualBlueprint.includes("{argument name="),
      `${preset.key}: unresolved argument placeholder`,
    );
    assert.ok(
      !preset.visualBlueprint.includes("REFERENCE_0"),
      `${preset.key}: unresolved legacy image reference`,
    );
  }
});

test("findStylePreset hits and misses", () => {
  for (const preset of STYLE_PRESETS) {
    assert.equal(findStylePreset(preset.key), preset);
  }
  assert.equal(findStylePreset("no-such-style"), undefined);
  assert.equal(findStylePreset(""), undefined);
});

test("every preset keeps the shared identity and typography guarantees", () => {
  for (const preset of STYLE_PRESETS) {
    assert.ok(
      preset.preserveRules.some((rule) => rule.includes("identity")),
      `${preset.key}: missing identity preserve rule`,
    );
    assert.ok(
      preset.preserveRules.some((rule) => rule.includes("number of people")),
      `${preset.key}: missing headcount preserve rule`,
    );
    assert.ok(
      preset.preserveRules.some((rule) => rule.includes("orientation and aspect ratio")),
      `${preset.key}: missing orientation/aspect preserve rule`,
    );
    for (const fragment of ["Text", "Logos", "Watermarks", "Date stamps"]) {
      assert.ok(
        preset.forbiddenElements.some((element) => element.includes(fragment)),
        `${preset.key}: missing forbidden element containing '${fragment}'`,
      );
    }
  }
});

test("every preset exposes complete visual catalog metadata", () => {
  for (const preset of STYLE_PRESETS) {
    assert.ok(preset.category.length > 0, `${preset.key}: missing category`);
    assert.ok(preset.recommendedFor.length > 0, `${preset.key}: missing recommendation`);
    assert.ok(preset.recommendedMotion.length > 0, `${preset.key}: missing motion`);
    assert.equal(preset.colorPalette.length, 3, `${preset.key}: palette must contain 3 colors`);
    assert.match(preset.previewStyle, /^[a-z0-9-]+$/u, `${preset.key}: invalid preview token`);
  }
});

test("catalog includes all 80 provenance-bound OnePic photography templates", () => {
  const imported = STYLE_PRESETS.filter(
    (preset) => preset.source?.project === "onepic-template-studio",
  );
  assert.equal(imported.length, 80);
  assert.equal(STYLE_PRESETS.length, 95);
  assert.equal(
    new Set(STYLE_PRESETS.map((preset) => preset.key)).size,
    STYLE_PRESETS.length,
  );
  assert.equal(
    new Set(imported.map((preset) => preset.source?.templateId)).size,
    imported.length,
  );
  for (const preset of imported) {
    assert.match(preset.key, /^onepic-(?:case|framework)-\d+$/u);
    assert.match(preset.source?.promptHash ?? "", /^[0-9a-f]{64}$/u);
    assert.ok(
      preset.visualBlueprint.includes("only as a transferable visual-treatment reference"),
    );
    assert.ok(
      preset.preserveRules.some((rule) =>
        rule.includes("pose, expression, wardrobe, props, scene"),
      ),
    );
  }
});

test("compilePrompt rejects a non-positive reference image count", () => {
  const preset = findStylePreset("anime-scene");
  assert.ok(preset);
  assert.throws(() => compilePrompt({ preset, referenceImageCount: 0 }));
  assert.throws(() => compilePrompt({ preset, referenceImageCount: 1.5 }));
});
