import { createHash } from "node:crypto";

import type { StylePreset } from "./presets.js";

/**
 * Prompt template version. Any change to the compiled prompt structure,
 * section order or fixed wording must bump this (e.g. "style-extension.v2").
 */
export const PROMPT_TEMPLATE_VERSION = "style-extension.v1";

export interface CompilePromptInput {
  readonly preset: StylePreset;
  /** Total number of reference images sent with the request. Must be >= 1. */
  readonly referenceImageCount: number;
}

export interface CompiledPrompt {
  readonly prompt: string;
  /** `${preset.key}@${preset.version}+${PROMPT_TEMPLATE_VERSION}` */
  readonly promptVersion: string;
  /** Lowercase sha256 hex of the compiled prompt string. */
  readonly promptHash: string;
}

export function compilePrompt(input: CompilePromptInput): CompiledPrompt {
  const { preset, referenceImageCount } = input;
  if (!Number.isInteger(referenceImageCount) || referenceImageCount < 1) {
    throw new Error("referenceImageCount must be a positive integer");
  }

  const prompt = buildPromptText(preset, referenceImageCount);
  const promptVersion = `${preset.key}@${preset.version}+${PROMPT_TEMPLATE_VERSION}`;
  const promptHash = createHash("sha256").update(prompt, "utf8").digest("hex");
  return { prompt, promptVersion, promptHash };
}

function buildPromptText(preset: StylePreset, referenceImageCount: number): string {
  const lines: string[] = [];

  lines.push("[System / Prompt]");
  lines.push(
    "You are an image restyling model. Reinterpret the uploaded images in the visual style defined below.",
  );
  lines.push("");

  lines.push("[Input Image Roles]");
  lines.push(
    `You receive ${referenceImageCount} reference image(s). Their order is fixed and meaningful:`,
  );
  lines.push(
    "- Image 1 is the cover / primary content image: it defines the subject, content and composition of the result.",
  );
  if (referenceImageCount > 1) {
    lines.push(
      `- Images 2 to ${referenceImageCount} are additional content references: use them to keep subjects, wardrobe and scene details consistent.`,
    );
  }
  lines.push("- Never reorder or ignore this role assignment.");
  lines.push("");

  lines.push("BEGIN VISUAL BLUEPRINT");
  lines.push(preset.visualBlueprint);
  lines.push("END VISUAL BLUEPRINT");
  lines.push("");

  lines.push("[Preserve Rules]");
  for (const rule of preset.preserveRules) {
    lines.push(`- ${rule}`);
  }
  lines.push("");

  lines.push("[Forbidden Elements]");
  lines.push(
    "The following elements must never appear in the output. Text-like elements of any kind are strictly off-limits: they are rendered deterministically outside this model.",
  );
  for (const element of preset.forbiddenElements) {
    lines.push(`- ${element}`);
  }
  lines.push("");

  lines.push("[Output Requirements]");
  lines.push("- Return only the finished image.");
  lines.push("- Do not explain, describe or comment on the image.");
  lines.push("- Do not ask follow-up questions; make the best interpretation from the inputs above.");

  return lines.join("\n");
}
