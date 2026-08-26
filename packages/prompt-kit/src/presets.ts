/**
 * Registry of style presets for image generation.
 *
 * A preset describes how reference photos are restyled, not what is in them.
 * Subject identity, headcount and framing are governed by preserve rules;
 * typography, logos and dates are forbidden here because they are rendered
 * deterministically outside the model (AGENTS.md §12).
 */

import { ONEPIC_PHOTOGRAPHY_TEMPLATES } from "./onepic-photography-templates.generated.js";

export interface StylePresetSource {
  readonly project: "onepic-template-studio";
  readonly templateId: string;
  readonly promptHash: string;
  readonly previewUrl: string | null;
}

export interface StylePreset {
  /** Stable identifier, e.g. "cinematic-portrait". Never renamed in place. */
  readonly key: string;
  /** Preset version, e.g. "v1". Any semantic change must bump it. */
  readonly version: string;
  /** Chinese display name. */
  readonly name: string;
  /** One-sentence Chinese summary for UI copy. */
  readonly description: string;
  /** UI grouping copied from the approved high-fidelity prototype. */
  readonly category: string;
  /** Short suitability guidance displayed in the style workbench. */
  readonly recommendedFor: string;
  /** Suggested media motion after the still image is approved. */
  readonly recommendedMotion: string;
  /** Three stable colors used to render a local, non-network preview swatch. */
  readonly colorPalette: readonly [string, string, string];
  /** Stable visual preview token consumed by the Web style catalog. */
  readonly previewStyle: string;
  /** English visual blueprint consumed by the image model. */
  readonly visualBlueprint: string;
  /** What must survive the restyle. */
  readonly preserveRules: readonly string[];
  /** What must never appear in the output. */
  readonly forbiddenElements: readonly string[];
  /** Provenance for imported prompt-library styles. */
  readonly source?: StylePresetSource;
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

const BUILT_IN_STYLE_PRESETS: readonly StylePreset[] = [
  {
    key: "cinematic-portrait",
    version: "v1",
    name: "电影感人像",
    description: "浅景深与暖金侧光,把照片处理成 35mm 胶片质感的人像剧照。",
    category: "电影胶片",
    recommendedFor: "人像、旅行、纪实",
    recommendedMotion: "微距推近",
    colorPalette: ["#1e252b", "#a76c43", "#e9c89a"],
    previewStyle: "cinematic-film",
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
    category: "艺术插画",
    recommendedFor: "宠物、亲子、静物",
    recommendedMotion: "立体视差",
    colorPalette: ["#d6634a", "#f1c769", "#6a9485"],
    previewStyle: "paper-cut",
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
    category: "商业摄影",
    recommendedFor: "产品、静物、收藏",
    recommendedMotion: "微距推近",
    colorPalette: ["#d9d7d2", "#8e9297", "#353940"],
    previewStyle: "studio-product",
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
    category: "艺术插画",
    recommendedFor: "街景、旅行、人物",
    recommendedMotion: "多图故事连缀",
    colorPalette: ["#8fc7e8", "#f3d57a", "#de826a"],
    previewStyle: "anime-scene",
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
  {
    key: "tokyo-rain-neon",
    version: "v1",
    name: "东京雨夜霓虹",
    description: "冷调青蓝与暖色霓虹反光交织,呈现潮湿街面的电影纵深。",
    category: "都市夜景",
    recommendedFor: "夜景、街拍、城市旅行",
    recommendedMotion: "柔光呼吸",
    colorPalette: ["#071b2f", "#08a4b8", "#ff5b67"],
    previewStyle: "tokyo-neon",
    visualBlueprint:
      "Restyle the scene as a rainy metropolitan night photographed through cinematic glass. Use deep cyan-blue ambient light, restrained coral and amber neon reflections, wet pavement with elongated diffuse reflections, fine mist and layered atmospheric depth. Preserve readable subject separation with controlled highlights and dense but detailed shadows. Keep the composition elegant and minimal rather than filling the frame with signs.",
    preserveRules: [
      ...SHARED_PRESERVE_RULES,
      "Preserve faces, silhouettes and all primary subject boundaries despite the reflected neon light.",
    ],
    forbiddenElements: [
      ...SHARED_FORBIDDEN_ELEMENTS,
      "Illegible invented storefront lettering and excessive neon clutter.",
    ],
  },
  {
    key: "nordic-minimal",
    version: "v1",
    name: "北欧极简纯净冷光",
    description: "高明度、低饱和的通透柔光,强调留白、材质和自然肤色。",
    category: "编辑美学",
    recommendedFor: "室内、人像、生活方式",
    recommendedMotion: "微距推近",
    colorPalette: ["#eef0ed", "#bdc6c5", "#6f7c7d"],
    previewStyle: "nordic-minimal",
    visualBlueprint:
      "Restyle the scene with Nordic editorial minimalism. Use diffused Scandinavian window daylight, a high-key low-saturation palette, clean pale surfaces, soft shadow roll-off and disciplined negative space. Keep natural skin texture and understated material detail. The result should feel calm, modern and carefully art-directed without looking sterile.",
    preserveRules: [
      ...SHARED_PRESERVE_RULES,
      "Preserve the original subject placement while simplifying only nonessential background clutter.",
    ],
    forbiddenElements: [
      ...SHARED_FORBIDDEN_ELEMENTS,
      "Heavy contrast, saturated props and glossy artificial skin.",
    ],
  },
  {
    key: "mediterranean-sunset",
    version: "v1",
    name: "地中海落日流金",
    description: "低角度落日、温暖长阴影与流金空气感,呈现松弛的假日电影氛围。",
    category: "自然光影",
    recommendedFor: "海边、旅行、人像",
    recommendedMotion: "柔光呼吸",
    colorPalette: ["#5c4031", "#d98f45", "#f2d49b"],
    previewStyle: "sunset-glow",
    visualBlueprint:
      "Restyle the scene at Mediterranean golden hour with low-angle sunlight, long warm shadows, luminous dust in the air and gentle sea-blue countertones. Use golden highlights, terracotta midtones and soft cream reflections. Preserve an airy vacation mood and believable natural light without turning the image orange.",
    preserveRules: [
      ...SHARED_PRESERVE_RULES,
      "Preserve natural skin color underneath the warm environmental light.",
    ],
    forbiddenElements: [
      ...SHARED_FORBIDDEN_ELEMENTS,
      "Artificial orange color casts and blown featureless highlights.",
    ],
  },
  {
    key: "vintage-polaroid-600",
    version: "v1",
    name: "复古宝丽来 600",
    description: "略微褪色的青黄底色、柔美朦胧感与即时成像的偶然质感。",
    category: "复古胶片",
    recommendedFor: "日常、聚会、旅行",
    recommendedMotion: "多图故事连缀",
    colorPalette: ["#4f665f", "#d1b773", "#efe2bd"],
    previewStyle: "polaroid",
    visualBlueprint:
      "Restyle the source as a late-twentieth-century instant-film photograph with softly faded cyan-yellow color, gentle flash falloff, slightly lifted blacks, subtle chemical color variation and a modestly soft optical rendering. Keep the image intimate and spontaneous while maintaining facial fidelity and a clean frame.",
    preserveRules: [
      ...SHARED_PRESERVE_RULES,
      "Preserve candid expressions and the original distance between subjects.",
    ],
    forbiddenElements: [
      ...SHARED_FORBIDDEN_ELEMENTS,
      "Physical instant-film borders, handwritten notes and fake date imprints.",
    ],
  },
  {
    key: "hong-kong-motion-mood",
    version: "v1",
    name: "港风慢门情绪",
    description: "慢门拖影、高反差色彩碰撞与私密昏暗空间构成都市情绪片段。",
    category: "都市夜景",
    recommendedFor: "街拍、室内、双人叙事",
    recommendedMotion: "多图故事连缀",
    colorPalette: ["#18372d", "#b53f2f", "#ddaf58"],
    previewStyle: "motion-mood",
    visualBlueprint:
      "Restyle the scene as an intimate Hong Kong urban mood photograph using selective slow-shutter motion trails, saturated red-green color contrast, dim practical lighting and compressed cinematic framing. Keep faces and the primary subject sharp enough to recognize while allowing peripheral movement to smear into expressive streaks.",
    preserveRules: [
      ...SHARED_PRESERVE_RULES,
      "Keep facial features and eyes recognizable; motion blur may affect only secondary movement and background light.",
    ],
    forbiddenElements: [
      ...SHARED_FORBIDDEN_ELEMENTS,
      "Uniform full-frame blur and unreadable facial features.",
    ],
  },
  {
    key: "cyber-neon",
    version: "v1",
    name: "赛博霓虹 2077",
    description: "深黑底色衬托电光青、酸性绿与玫红,形成强烈数字未来感。",
    category: "未来视觉",
    recommendedFor: "夜景、潮流人像、科技产品",
    recommendedMotion: "立体视差",
    colorPalette: ["#090b16", "#00e7d3", "#ef38a8"],
    previewStyle: "cyber-neon",
    visualBlueprint:
      "Restyle the image with a restrained cyber-neon visual language: deep black negative space, electric cyan, acid green and magenta edge light, controlled volumetric haze and precise reflective materials. Keep the subject premium and photographic rather than turning it into a game screenshot.",
    preserveRules: [
      ...SHARED_PRESERVE_RULES,
      "Preserve realistic anatomy and material texture under the colored edge lighting.",
    ],
    forbiddenElements: [
      ...SHARED_FORBIDDEN_ELEMENTS,
      "HUD overlays, interface graphics and excessive synthetic armor.",
    ],
  },
  {
    key: "leica-monochrome",
    version: "v1",
    name: "徕卡高反差黑白",
    description: "深邃暗部、清晰微反差与完整灰阶,强化构图轮廓和人物神情。",
    category: "纪实摄影",
    recommendedFor: "人像、街拍、建筑",
    recommendedMotion: "微距推近",
    colorPalette: ["#111111", "#747474", "#dedede"],
    previewStyle: "monochrome",
    visualBlueprint:
      "Restyle the scene as premium monochrome documentary photography with rich tonal gradation, deep velvety blacks, crisp micro-contrast and luminous but controlled highlights. Preserve fine skin, fabric and architectural textures. Use composition and light rather than effects to create emotional weight.",
    preserveRules: [
      ...SHARED_PRESERVE_RULES,
      "Preserve separation between similarly toned subjects through local contrast.",
    ],
    forbiddenElements: [
      ...SHARED_FORBIDDEN_ELEMENTS,
      "Color tinting, crushed shadow detail and artificial vignette halos.",
    ],
  },
  {
    key: "impressionist-waterlight",
    version: "v1",
    name: "睡莲印象水光",
    description: "柔和流动的光影笔触与水面色彩交叠,营造梦境般的印象派氛围。",
    category: "艺术插画",
    recommendedFor: "花园、水景、风景",
    recommendedMotion: "柔光呼吸",
    colorPalette: ["#56796d", "#8cae9e", "#d9b7ce"],
    previewStyle: "impression-water",
    visualBlueprint:
      "Restyle the scene as a luminous impressionist painting built from soft broken brushstrokes, reflected water color, atmospheric violet-green shadows and warm floating highlights. Retain recognizable subject shapes and the original composition while allowing edges and background light to dissolve gently into painterly color.",
    preserveRules: [
      ...SHARED_PRESERVE_RULES,
      "Keep faces, hands and primary silhouettes structurally clear beneath the painterly surface.",
    ],
    forbiddenElements: [
      ...SHARED_FORBIDDEN_ELEMENTS,
      "Heavy impasto that destroys facial detail and decorative picture frames.",
    ],
  },
  {
    key: "fuji-classic-chrome",
    version: "v1",
    name: "富士经典正片",
    description: "低饱和冷峻天空与柔和暖肤色,形成克制而有故事感的纪实色调。",
    category: "复古胶片",
    recommendedFor: "旅行、街拍、日常纪实",
    recommendedMotion: "多图故事连缀",
    colorPalette: ["#455967", "#8e8a73", "#bf876e"],
    previewStyle: "classic-chrome",
    visualBlueprint:
      "Restyle the scene with a restrained classic-chrome film palette: muted cool skies, softly warm skin, compressed saturation, delicate grain and documentary midtone contrast. Favor understated colors, realistic daylight and quiet narrative detail over dramatic effects.",
    preserveRules: [
      ...SHARED_PRESERVE_RULES,
      "Preserve the natural relationship between skin tones, sky and environmental colors.",
    ],
    forbiddenElements: [
      ...SHARED_FORBIDDEN_ELEMENTS,
      "Oversaturated blues, orange-teal blockbuster grading and heavy bloom.",
    ],
  },
  {
    key: "anime-cel-90s",
    version: "v1",
    name: "90s 经典赛璐珞手绘",
    description: "清晰线稿、赛璐珞分层阴影与手绘背景,呈现明朗怀旧的动画质感。",
    category: "艺术插画",
    recommendedFor: "人物、街景、旅行",
    recommendedMotion: "多图故事连缀",
    colorPalette: ["#77b6d8", "#f0d276", "#c86752"],
    previewStyle: "anime-90s",
    visualBlueprint:
      "Restyle the scene as a 1990s hand-painted cel animation frame with crisp ink linework, flat base colors, two-level cel shadows, airy blue skies and gouache-like background painting. Keep character proportions, facial identity and all key props stable while introducing a warm nostalgic afternoon atmosphere.",
    preserveRules: [
      ...SHARED_PRESERVE_RULES,
      "Preserve hands, eyes and facial proportions with clean intentional linework.",
    ],
    forbiddenElements: [
      ...SHARED_FORBIDDEN_ELEMENTS,
      "Modern 3D anime rendering, glossy plastic skin and photographic lens grain.",
    ],
  },
  {
    key: "dreamy-halation",
    version: "v1",
    name: "柔光梦境扩散",
    description: "黑柔滤镜般的高光泛光与柔焦边缘,营造唯美、浪漫而克制的梦境感。",
    category: "自然光影",
    recommendedFor: "逆光人像、婚礼、花卉",
    recommendedMotion: "柔光呼吸",
    colorPalette: ["#6d5871", "#c49ab4", "#f1d8c9"],
    previewStyle: "dreamy-halation",
    visualBlueprint:
      "Restyle the scene with subtle diffusion-filter halation: luminous highlights bloom softly into warm surrounding color, edges relax gently and shadow contrast stays creamy. Preserve sharp eyes and core facial features while allowing backlight, flowers and background practicals to dissolve into a controlled dreamlike glow.",
    preserveRules: [
      ...SHARED_PRESERVE_RULES,
      "Keep eyes and primary facial features crisp beneath the surrounding diffusion.",
    ],
    forbiddenElements: [
      ...SHARED_FORBIDDEN_ELEMENTS,
      "Milky low-contrast haze across the entire frame and beauty-filter skin smoothing.",
    ],
  },
];

const ONEPIC_STYLE_PRESETS: readonly StylePreset[] =
  ONEPIC_PHOTOGRAPHY_TEMPLATES.map((template) => ({
    key: `onepic-${template.id}`,
    version: "v1",
    name: template.title,
    description: template.description,
    category: template.category,
    recommendedFor: template.recommendedFor,
    recommendedMotion: template.recommendedMotion,
    colorPalette: template.colorPalette,
    previewStyle: `onepic-${template.id}`,
    visualBlueprint: [
      "Use the following source template only as a transferable visual-treatment reference.",
      "Learn its photographic medium, lens behavior, lighting, palette, texture, atmosphere and finishing language.",
      "The uploaded images remain the only authority for subject matter, identity, headcount, pose, wardrobe, objects, setting, framing and visible facts.",
      "Ignore or automatically adapt sample people, brands, places, slogans, fixed text, placeholders and requested substitutions from the source template.",
      "",
      `SOURCE TEMPLATE ${template.id} / ${template.title}`,
      template.blueprint,
    ].join("\n"),
    preserveRules: [
      ...SHARED_PRESERVE_RULES,
      "Preserve the original pose, expression, wardrobe, props, scene, camera viewpoint and composition; transfer only the source template's visual treatment.",
      "Treat named or described sample subjects in the source template as non-binding examples and never replace uploaded-image content with them.",
    ],
    forbiddenElements: [
      ...SHARED_FORBIDDEN_ELEMENTS,
      "Sample brands, sample slogans, sample place names and fixed copy inherited from the source template.",
      "Template placeholder syntax or explanatory prompt text in the finished image.",
    ],
    source: {
      project: "onepic-template-studio",
      templateId: template.id,
      promptHash: template.promptHash,
      previewUrl:
        template.previewPath === null
          ? null
          : `https://onepic.motion-cover.com/${template.previewPath}`,
    },
  }));

export const STYLE_PRESETS: readonly StylePreset[] = [
  ...BUILT_IN_STYLE_PRESETS,
  ...ONEPIC_STYLE_PRESETS,
];

export function findStylePreset(key: string): StylePreset | undefined {
  return STYLE_PRESETS.find((preset) => preset.key === key);
}
