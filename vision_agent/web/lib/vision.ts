import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "dotenv";
import { resolve } from "node:path";
import sharp from "sharp";

const localEnvironment = {
  ...(config({ path: resolve(process.cwd(), "../../.env"), override: false, quiet: true }).parsed ?? {}),
  ...(config({ path: resolve(process.cwd(), ".env"), override: false, quiet: true }).parsed ?? {}),
};

function setting(name: string) {
  return process.env[name] || localEnvironment[name];
}

export type Detection = {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  className: string;
};

export type VisionResult = {
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  yoloModel: string;
  detections: Detection[];
  visibleObjectCount: number;
  averageConfidence: number;
  classification: {
    product: string;
    category: string;
    packaging: string;
    source: "vision_llm" | "operator_required";
    confidence: number;
    uncertainty: string | null;
  };
  disagreement: string | null;
  countMethod: "claude_two_pass";
  countNote: string;
  mode: "cloud";
};

const CATEGORIES = ["canned_goods", "produce", "dairy", "dry_goods"] as const;
type ClaudeCount = { counts: Record<(typeof CATEGORIES)[number], number>; notes: string };

const CLAUDE_COUNT_PROMPT = `You count food-bank inventory in a still image. Scan systematically left-to-right and front-to-back, region by region. Count separate items even when partially occluded if a rim, lid, edge, or side identifies the item. Do not count the same item twice. Describe your regions and running tally first, then end with a JSON object containing counts for exactly canned_goods, produce, dairy, and dry_goods plus notes. Do not count sealed cartons unless visible labels or packaging support an estimate; flag uncertainty in notes.`;

function parseClaudeCount(text: string): ClaudeCount {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Claude did not return a count record");
  const parsed = JSON.parse(match[0]) as { counts?: Record<string, unknown>; notes?: string };
  const counts = Object.fromEntries(CATEGORIES.map((category) => [category, Math.max(0, Math.round(Number(parsed.counts?.[category] ?? 0)))])) as ClaudeCount["counts"];
  return { counts, notes: parsed.notes ?? "" };
}

async function countWithClaude(imageDataUrl: string): Promise<{ count: ClaudeCount; confidence: number }> {
  const apiKey = setting("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured for Claude counting");
  const client = new Anthropic({ apiKey });
  const image = imageDataUrl.split(",")[1];
  const mediaType = imageDataUrl.match(/^data:(.*?);/)?.[1] ?? "image/jpeg";
  async function pass(independent: boolean) {
    const reasoningResponse = await client.messages.create({
      model: setting("CLAUDE_MODEL") ?? "claude-opus-4-8",
      max_tokens: 1800,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg", data: image } },
        { type: "text", text: `${CLAUDE_COUNT_PROMPT}${independent ? " Perform an independent recount; do not copy a prior answer." : ""}` },
      ] }],
    });
    const reasoning = reasoningResponse.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
    const extractionResponse = await client.messages.create({
      model: setting("CLAUDE_MODEL") ?? "claude-opus-4-8",
      max_tokens: 500,
      ...({ output_config: { format: { type: "json_schema", schema: {
        type: "object",
        properties: {
          counts: { type: "object", properties: Object.fromEntries(CATEGORIES.map((category) => [category, { type: "integer" }])), required: [...CATEGORIES], additionalProperties: false },
          notes: { type: "string" },
        },
        required: ["counts", "notes"],
        additionalProperties: false,
      } } } } as unknown as Record<string, unknown>),
      messages: [{ role: "user", content: `Extract the final count from this visual record. Return only the schema. Use the running tally, count partially visible items identified by rims/lids/edges, and preserve uncertainty in notes.\n\n${reasoning}` }],
    });
    const count = parseClaudeCount(extractionResponse.content.filter((block) => block.type === "text").map((block) => block.text).join("\n"));
    return { counts: count.counts, notes: [count.notes, reasoning].filter(Boolean).join(" ") };
  }
  const [first, second] = await Promise.all([pass(false), pass(true)]);
  const deltas = CATEGORIES.map((category) => Math.abs(first.counts[category] - second.counts[category]));
  const confidence = deltas.length ? deltas.reduce((sum, delta, index) => sum + Math.max(0, 1 - delta / Math.max(first.counts[CATEGORIES[index]], second.counts[CATEGORIES[index]], 1)), 0) / deltas.length : 0;
  const counts = Object.fromEntries(CATEGORIES.map((category) => [category, Math.round((first.counts[category] + second.counts[category]) / 2)])) as ClaudeCount["counts"];
  const disagreement = CATEGORIES.filter((category) => first.counts[category] !== second.counts[category]).map((category) => `${category} differed (${first.counts[category]} vs ${second.counts[category]})`).join("; ");
  return { count: { counts, notes: [first.notes, second.notes, disagreement && `Independent-pass disagreement: ${disagreement}`].filter(Boolean).join(" ") }, confidence };
}

type RoboflowResponse = {
  image?: { width?: number; height?: number };
  predictions?: Array<{ x: number; y: number; width: number; height: number; confidence: number; class: string }>;
};

async function runRoboflowRequest(base64: string, apiKey: string, model: string) {
  const response = await fetch(
    `https://serverless.roboflow.com/${model.split("/").map((part) => encodeURIComponent(part)).join("/")}?api_key=${encodeURIComponent(apiKey)}&confidence=${encodeURIComponent(setting("YOLO_CONFIDENCE") ?? "20")}&overlap=30`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: base64 },
  );
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Roboflow inference for ${model} failed (${response.status}): ${detail}`);
  }
  return await response.json() as RoboflowResponse;
}

function filterPredictions(result: RoboflowResponse): Detection[] {
  const countClasses = (setting("YOLO_COUNT_CLASSES") ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return (result.predictions ?? []).map((item) => ({
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
    confidence: item.confidence,
    className: item.class,
  })).filter((item) => countClasses.length === 0 || countClasses.includes(item.className.toLowerCase()));
}

function intersectionOverUnion(first: Detection, second: Detection) {
  const firstLeft = first.x - first.width / 2;
  const firstTop = first.y - first.height / 2;
  const secondLeft = second.x - second.width / 2;
  const secondTop = second.y - second.height / 2;
  const intersectionWidth = Math.max(0, Math.min(firstLeft + first.width, secondLeft + second.width) - Math.max(firstLeft, secondLeft));
  const intersectionHeight = Math.max(0, Math.min(firstTop + first.height, secondTop + second.height) - Math.max(firstTop, secondTop));
  const intersection = intersectionWidth * intersectionHeight;
  const union = first.width * first.height + second.width * second.height - intersection;
  return union ? intersection / union : 0;
}

function suppressDuplicateDetections(detections: Detection[]) {
  const threshold = Number(setting("YOLO_NMS_IOU") ?? "0.45");
  const kept: Detection[] = [];
  for (const detection of [...detections].sort((a, b) => b.confidence - a.confidence)) {
    if (!kept.some((existing) => existing.className === detection.className && intersectionOverUnion(existing, detection) >= threshold)) {
      kept.push(detection);
    }
  }
  return kept;
}

async function runRoboflow(bytes: Buffer): Promise<{ predictions: Detection[]; width: number; height: number }> {
  const apiKey = setting("ROBOFLOW_API_KEY");
  const model = setting("YOLO_MODEL_ID");
  if (!apiKey || !model) throw new Error("Roboflow is not configured");
  const metadata = await sharp(bytes).metadata();
  const width = metadata.width ?? 900;
  const height = metadata.height ?? 600;
  const grid = Math.max(1, Math.min(3, Math.round(Number(setting("YOLO_TILE_GRID") ?? "3"))));
  if (grid === 1) {
    const result = await runRoboflowRequest(bytes.toString("base64"), apiKey, model);
    return { width, height, predictions: filterPredictions(result) };
  }

  const overlap = Math.min(0.45, Math.max(0.1, Number(setting("YOLO_TILE_OVERLAP") ?? "0.25")));
  const tileWidth = Math.min(width, Math.ceil((width * (1 + overlap)) / (grid + overlap)));
  const tileHeight = Math.min(height, Math.ceil((height * (1 + overlap)) / (grid + overlap)));
  const tiles = Array.from({ length: grid * grid }, (_, index) => {
    const column = index % grid;
    const row = Math.floor(index / grid);
    const left = grid === 1 ? 0 : Math.round((width - tileWidth) * column / (grid - 1));
    const top = grid === 1 ? 0 : Math.round((height - tileHeight) * row / (grid - 1));
    return { left, top };
  });
  const tileResults = await Promise.all(tiles.map(async ({ left, top }) => {
    const tileBytes = await sharp(bytes).extract({ left, top, width: tileWidth, height: tileHeight }).jpeg({ quality: 90 }).toBuffer();
    const result = await runRoboflowRequest(tileBytes.toString("base64"), apiKey, model);
    const resultWidth = result.image?.width ?? tileWidth;
    const resultHeight = result.image?.height ?? tileHeight;
    return filterPredictions(result).map((detection) => ({
      ...detection,
      x: left + detection.x * tileWidth / resultWidth,
      y: top + detection.y * tileHeight / resultHeight,
      width: detection.width * tileWidth / resultWidth,
      height: detection.height * tileHeight / resultHeight,
    }));
  }));
  return {
    width,
    height,
    predictions: suppressDuplicateDetections(tileResults.flat()),
  };
}

async function classifyWithVision(imageDataUrl: string) {
  const apiKey = setting("OPENAI_API_KEY");
  if (!apiKey) return null;
  const client = new OpenAI({ apiKey });
  const completion = await client.chat.completions.create({
    model: setting("OPENAI_VISION_MODEL") ?? "gpt-4.1-mini",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "Identify the food product and broad category. Do not count objects. Return JSON with product, category, packaging, confidence from 0 to 1, and uncertainty (string or null)." },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ],
    }],
    response_format: { type: "json_object" },
  });
  return JSON.parse(completion.choices[0]?.message.content ?? "{}") as {
    product?: string;
    category?: string;
    packaging?: string;
    confidence?: number;
    uncertainty?: string | null;
  };
}

export async function analyzeStillImage(input: {
  bytes: Buffer;
  contentType: string;
}): Promise<VisionResult> {
  const base64 = input.bytes.toString("base64");
  const imageDataUrl = `data:${input.contentType};base64,${base64}`;
  const missing = [
      !setting("ROBOFLOW_API_KEY") ? "ROBOFLOW_API_KEY" : null,
      !setting("YOLO_MODEL_ID") ? "YOLO_MODEL_ID" : null,
    ].filter(Boolean);
  if (missing.length) {
      throw new Error(
        `Cloud detection was selected, but ${missing.join(" and ")} is missing. Add it to the repository .env or vision_agent/web/.env.local, then restart Next.js.`,
      );
  }
  const result = await runRoboflow(input.bytes);
  const detections=result.predictions,imageWidth=result.width,imageHeight=result.height;
  const claude = await countWithClaude(imageDataUrl);
  const llm = await classifyWithVision(imageDataUrl);
  const totalClaudeCount = Object.values(claude.count.counts).reduce((sum, count) => sum + count, 0);
  const detectorCount = detections.length;
  const usedDetectorFallback = totalClaudeCount === 0 && detectorCount > 0;
  const visibleCount = usedDetectorFallback ? detectorCount : totalClaudeCount;
  const classification = llm ? {
    product: llm.product ?? "Unconfirmed food package",
    category: llm.category ?? "uncategorized",
    packaging: llm.packaging ?? "unknown",
    source: "vision_llm" as const,
    confidence: llm.confidence ?? 0.5,
    uncertainty: llm.uncertainty ?? null,
  } : {
    product: "Detected food packages",
    category: "mixed_food_packages",
    packaging: "unknown",
    source: "operator_required" as const,
    confidence: 0,
    uncertainty: "Claude counted visible items, but product classification needs operator confirmation.",
  };
  const classSet = new Set(detections.map((item) => item.className.toLowerCase()));
  const disagreement = classSet.size > 1
    ? `Detector returned multiple package classes: ${[...classSet].join(", ")}`
    : null;
  return {
    imageDataUrl,
    imageWidth,
    imageHeight,
    yoloModel: String(setting("YOLO_MODEL_ID")),
    detections,
    visibleObjectCount: visibleCount,
    averageConfidence: usedDetectorFallback ? Math.min(0.59, detections.reduce((sum, item) => sum + item.confidence, 0) / detectorCount) : claude.confidence,
    classification,
    disagreement,
    countMethod: "claude_two_pass",
    countNote: usedDetectorFallback
      ? `Claude returned an all-zero tally, so the UI shows ${detectorCount} visible detector packages as a conservative fallback. Confirm or correct the quantity before approval. ${claude.count.notes}`
      : `Claude two-pass count: ${claude.count.notes || "two independent region-by-region counts"}. Bounding boxes are Roboflow overlays and may not equal the Claude count.`,
    mode:"cloud",
  };
}
