import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const CATEGORY = "Photography & Realism";
const EXPECTED_COUNT = 80;
const DEFAULT_SOURCE =
  "/Volumes/zwl/open_sources/onepic-template-studio/data/library/templates.json";
const outputPath = resolve(
  import.meta.dirname,
  "../src/onepic-photography-templates.generated.ts",
);
const sourcePath = resolve(process.argv[2] ?? DEFAULT_SOURCE);

const library = JSON.parse(readFileSync(sourcePath, "utf8"));
if (!Array.isArray(library.templates)) {
  throw new Error("OnePic library does not contain a templates array.");
}

const templates = library.templates.filter(
  (template) => template.category === CATEGORY,
);
if (templates.length !== EXPECTED_COUNT) {
  throw new Error(
    `Expected ${EXPECTED_COUNT} ${CATEGORY} templates, found ${templates.length}.`,
  );
}

const requiredText = (template, field) => {
  const value = template[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${template.id ?? "unknown"}: missing ${field}.`);
  }
  return value.trim();
};

const sanitizeBlueprint = (value) =>
  value
    .replace(/\{argument\b[^{}]*\}/giu, (placeholder) => {
      const defaultValue =
        /\bdefault=(?:"([^"]*)"|'([^']*)'|([^}]+))/iu.exec(placeholder);
      return (
        defaultValue?.[1]?.trim() ??
        defaultValue?.[2]?.trim() ??
        defaultValue?.[3]?.trim() ??
        "an input-derived detail"
      );
    })
    .replace(/\bREFERENCE[_ -]?\d+\b/giu, "the uploaded image")
    .replace(/@image\d+/giu, "the uploaded image")
    .replace(/\[([^\]\n]{1,160})\]/gu, (_placeholder, content) => {
      const choices = String(content).replaceAll("/", " or ");
      return `an input-derived choice for ${choices}`;
    });

const classify = (template) => {
  const text = `${template.title}\n${template.blueprint}`.toLowerCase();
  if (/建筑|室内|空间|interior|architecture|room|building|hangar/u.test(text)) {
    return "空间建筑";
  }
  if (/产品|商品|commercial|product|e-commerce|广告|brand|campaign/u.test(text)) {
    return "商业产品";
  }
  if (/街头|纪实|street|candid|documentary|snapshot|手机/u.test(text)) {
    return "街头纪实";
  }
  if (/胶片|film|polaroid|vintage|y2k|nostalg/u.test(text)) {
    return "胶片复古";
  }
  if (/夜|neon|霓虹|tungsten|flash|暗调|low-light/u.test(text)) {
    return "夜景闪光";
  }
  if (/山|海|花|自然|travel|outdoor|garden|sky|landscape/u.test(text)) {
    return "自然旅行";
  }
  if (/人像|portrait|face|woman|man|人物|selfie/u.test(text)) {
    return "人像摄影";
  }
  return "创意写实";
};

const recommendedFor = (category) =>
  ({
    人像摄影: "人像、肖像、时尚",
    街头纪实: "街拍、日常、纪实",
    商业产品: "产品、商业、品牌内容",
    自然旅行: "旅行、户外、自然",
    胶片复古: "日常、聚会、复古叙事",
    夜景闪光: "夜景、室内、都市",
    空间建筑: "建筑、室内、空间",
    创意写实: "创意摄影、社交内容、实验画面",
  })[category];

const recommendedMotion = (category) =>
  ({
    人像摄影: "微距推近",
    街头纪实: "多图故事连缀",
    商业产品: "立体视差",
    自然旅行: "柔光呼吸",
    胶片复古: "多图故事连缀",
    夜景闪光: "柔光呼吸",
    空间建筑: "立体视差",
    创意写实: "微距推近",
  })[category];

const palettes = {
  人像摄影: ["#2a2225", "#a56f63", "#e9c9b4"],
  街头纪实: ["#202529", "#6f756f", "#c4ad83"],
  商业产品: ["#15181d", "#707783", "#d4b36b"],
  自然旅行: ["#223431", "#6f9981", "#d8c18a"],
  胶片复古: ["#3d3a31", "#9a805b", "#d9c9a6"],
  夜景闪光: ["#101526", "#367d8c", "#d15c72"],
  空间建筑: ["#25272a", "#8a887e", "#d9d3c6"],
  创意写实: ["#292232", "#7d6c90", "#d0a873"],
};

const rows = templates.map((template) => {
  const id = requiredText(template, "id");
  const title = requiredText(template, "title");
  const blueprint = sanitizeBlueprint(requiredText(template, "blueprint"));
  const promptHash = requiredText(template, "promptSha256");
  const category = classify({ title, blueprint });
  const previewPath =
    typeof template.preview === "string" && template.preview.length > 0
      ? template.preview
      : null;
  return {
    id,
    title,
    description: `来自 OnePic 摄影写实库的「${title}」视觉蓝图，已按 Live Photo 主体保留规则编译。`,
    category,
    recommendedFor: recommendedFor(category),
    recommendedMotion: recommendedMotion(category),
    colorPalette: palettes[category],
    previewPath,
    promptHash,
    blueprint,
  };
});

const header = `/**
 * Generated from OnePic Template Studio's ${CATEGORY} catalog.
 *
 * Source catalog: onepic-template-studio/data/library/templates.json
 * Count: ${rows.length}
 * Do not edit manually. Regenerate with:
 * node packages/prompt-kit/scripts/import-onepic-photography-presets.mjs <templates.json>
 */

export interface OnePicPhotographyTemplate {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly recommendedFor: string;
  readonly recommendedMotion: string;
  readonly colorPalette: readonly [string, string, string];
  readonly previewPath: string | null;
  readonly promptHash: string;
  readonly blueprint: string;
}

export const ONEPIC_PHOTOGRAPHY_TEMPLATES: readonly OnePicPhotographyTemplate[] = `;

writeFileSync(
  outputPath,
  `${header}${JSON.stringify(rows, null, 2)};\n`,
  "utf8",
);
console.log(`Generated ${rows.length} templates at ${outputPath}.`);
