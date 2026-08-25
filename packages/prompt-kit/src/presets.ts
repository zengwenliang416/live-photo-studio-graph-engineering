/**
 * Registry of style presets for image generation.
 *
 * A preset describes how reference photos are restyled, not what is in them.
 * Subject identity, headcount and framing are governed by preserve rules;
 * typography, logos and dates are forbidden here because they are rendered
 * deterministically outside the model (AGENTS.md §12).
 */

export interface StylePreset {
  /** Stable identifier, e.g. "cinematic-portrait". Never renamed in place. */
  readonly key: string;
  /** Preset version, e.g. "v1". Any semantic change must bump it. */
  readonly version: string;
  /** Chinese display name. */
  readonly name: string;
  /** One-sentence Chinese summary for UI copy. */
  readonly description: string;
  /** English visual blueprint consumed by the image model. */
  readonly visualBlueprint: string;
  /** What must survive the restyle. */
  readonly preserveRules: readonly string[];
  /** What must never appear in the output. */
  readonly forbiddenElements: readonly string[];
}

const SHARED_PRESERVE_RULES: readonly string[] = [
  "Preserve the identity, facial features and body characteristics of every person in the uploaded images; do not swap, merge or invent faces.",
  "Preserve the exact number of people and the primary subject of the uploaded images; do not add or remove subjects.",
  "Preserve the orientation and aspect ratio of the uploaded cover image; do not crop to a different frame.",
];

const SHARED_FORBIDDEN_ELEMENTS: readonly string[] = [
  "Text of any kind: words, letters, numbers, captions or signage.",
  "Logos, brand marks and trademarks.",
  "Watermarks, stamps and copyright marks.",
  "Date stamps and time overlays.",
];

export const STYLE_PRESETS: readonly StylePreset[] = [
  {
    key: "cinematic-portrait",
    version: "v1",
    name: "电影感人像",
    description: "浅景深与暖金侧光,把照片处理成 35mm 胶片质感的人像剧照。",
    visualBlueprint: [
      "Restyle the scene as a cinematic portrait photographed on 35mm film.",
      "Light the subject with warm golden side light, as if from low sun or a",
      "practical lamp just outside the frame, letting the opposite side fall into",
      "soft, deep shadow for strong dimensional modeling. Keep the depth of field",
      "shallow: the subject stays tack sharp while foreground and background melt",
      "into creamy, elliptical bokeh. Apply a gentle filmic grade with warm",
      "highlights, slightly lifted blacks and muted teal shadows, plus fine visible",
      "grain and mild halation around bright edges. Favor a quiet, uncluttered",
      "composition with generous negative space around the subject, natural skin",
      "texture and a subdued, low-saturation palette overall.",
    ].join(" "),
    preserveRules: [
      ...SHARED_PRESERVE_RULES,
      "Preserve the original pose, expression and gaze direction of every person.",
    ],
    forbiddenElements: [
      ...SHARED_FORBIDDEN_ELEMENTS,
      "Harsh on-camera flash looks and flat, even studio lighting.",
    ],
  },
  {
    key: "paper-cut-illustration",
    version: "v1",
    name: "纸雕拼贴插画",
    description: "多层卡纸堆叠、手工裁切边缘与柔和纸影的拼贴插画风。",
    visualBlueprint: [
      "Restyle the scene as a layered paper-cut collage illustration.",
      "Rebuild every element from stacked sheets of colored cardstock: each shape",
      "carries a clean hand-trimmed edge with subtle irregularity, as if cut with",
      "scissors rather than a machine. Separate the layers with soft, diffused",
      "drop shadows so the depth between foreground, middle ground and background",
      "reads clearly, like a shallow shadow box. Keep all surfaces matte and",
      "texture the paper with a faint fibrous grain; avoid gloss, gradients and",
      "photorealistic shading. Compose with flat, confident color blocks drawn",
      "from a small harmonious palette, slightly desaturated and warm. Light the",
      "whole piece evenly from above so shadows stay gentle and the handmade,",
      "tactile character of the paper remains the hero.",
    ].join(" "),
    preserveRules: [
      ...SHARED_PRESERVE_RULES,
      "Preserve the relative positions and scale relationships of the main subjects.",
    ],
    forbiddenElements: [
      ...SHARED_FORBIDDEN_ELEMENTS,
      "Photorealistic rendering, glossy surfaces and 3D CGI shading.",
    ],
  },
  {
    key: "studio-product",
    version: "v1",
    name: "棚拍产品场景",
    description: "无缝背景、柔光箱与反射地面的高细节商业棚拍质感。",
    visualBlueprint: [
      "Restyle the scene as a professional studio product photograph.",
      "Place the subject on a seamless backdrop that curves smoothly from wall to",
      "floor with no horizon line, in a clean neutral tone chosen to complement",
      "the subject. Light it with large softboxes: broad, diffused key light that",
      "wraps gently, controlled fill to keep shadow detail, and a subtle rim light",
      "to separate the silhouette from the backdrop. Add a faint, realistic",
      "reflection of the subject on a polished floor surface beneath it. Render",
      "materials with high fidelity: crisp edges, believable metal, glass, fabric",
      "or plastic textures, and fine surface micro-detail. Keep the composition",
      "centered and calm with breathing room on all sides, colors accurate and a",
      "polished commercial-catalog finish throughout.",
    ].join(" "),
    preserveRules: [
      ...SHARED_PRESERVE_RULES,
      "Preserve the shape, proportions and material identity of the primary subject.",
    ],
    forbiddenElements: [
      ...SHARED_FORBIDDEN_ELEMENTS,
      "Cluttered props, busy backgrounds and outdoor environments.",
    ],
  },
  {
    key: "anime-scene",
    version: "v1",
    name: "日系动画场景",
    description: "赛璐璐上色、柔和天空光与风格化背景美术的日系动画画面。",
    visualBlueprint: [
      "Restyle the scene as a Japanese animation still with traditional cel",
      "shading. Paint characters and objects with flat base colors bounded by",
      "clean line work, then add one or two hard-edged cel shadow levels rather",
      "than smooth gradients. Let the light read as soft ambient sky light:",
      "gentle, slightly cool fill from above with warm sun-kissed accents where",
      "direct light lands. Treat the background as stylized background art,",
      "painted with looser brushwork, heightened color and atmospheric depth, so",
      "it sits slightly behind the crisply drawn subjects. Use a bright, airy",
      "palette with luminous skies and clear seasonal color cues. Keep linework",
      "consistent in weight, edges free of photographic noise, and the overall",
      "mood quiet and nostalgic, like a paused frame from a feature film.",
    ].join(" "),
    preserveRules: [
      ...SHARED_PRESERVE_RULES,
      "Preserve the original composition, poses and key props of the scene.",
    ],
    forbiddenElements: [
      ...SHARED_FORBIDDEN_ELEMENTS,
      "Photographic textures, film grain and realistic lens effects.",
    ],
  },
];

export function findStylePreset(key: string): StylePreset | undefined {
  return STYLE_PRESETS.find((preset) => preset.key === key);
}
