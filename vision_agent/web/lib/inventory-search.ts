import OpenAI from "openai";

export type InventoryFilter = {
  text: string | null;
  category: string | null;
  brand: string | null;
  zone: string | null;
  condition: "good" | "damaged" | "quarantined" | "expired" | null;
  expiration: "expired" | "today" | "this_week" | "next_30_days" | "none";
  maxQuantity: number | null;
  minQuantity: number | null;
  sort: "expiration" | "quantity_asc" | "quantity_desc" | "product";
};

const empty: InventoryFilter = {
  text: null,
  category: null,
  brand: null,
  zone: null,
  condition: null,
  expiration: "none",
  maxQuantity: null,
  minQuantity: null,
  sort: "expiration",
};

function rulesInterpret(query: string): InventoryFilter {
  const normalized = query.toLowerCase();
  const expiration = normalized.includes("expir")
    ? normalized.includes("today")
      ? "today"
      : normalized.includes("30")
        ? "next_30_days"
        : normalized.includes("week")
          ? "this_week"
          : normalized.includes("expired")
            ? "expired"
            : "none"
    : "none";
  const condition =
    (["quarantined", "damaged", "expired"] as const).find((value) =>
      normalized.includes(value),
    ) || null;
  const cleaned = normalized
    .replace(
      /show|find|where|all|everything|inventory|items?|expiring|expires?|this week|today|next 30 days|expired|damaged|quarantined|low stock|in stock|the|are|is|me/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  return {
    ...empty,
    text: cleaned || null,
    condition,
    expiration,
    maxQuantity: normalized.includes("low stock") ? 10 : null,
  };
}

export async function interpretInventoryQuery(query: string): Promise<{
  filter: InventoryFilter;
  interpreter: "openai" | "rules";
  fallbackReason?: string;
}> {
  if (process.env.OPENAI_API_KEY) {
    try {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const response = await client.chat.completions.create({
        model: process.env.OPENAI_TEXT_MODEL || "gpt-5-mini",
        messages: [
          {
            role: "system",
            content:
              "Translate a food-bank warehouse search into filters. Never invent values. Return only the schema.",
          },
          { role: "user", content: query },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "inventory_filter",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                text: { type: ["string", "null"] },
                category: { type: ["string", "null"] },
                brand: { type: ["string", "null"] },
                zone: { type: ["string", "null"] },
                condition: {
                  type: ["string", "null"],
                  enum: ["good", "damaged", "quarantined", "expired", null],
                },
                expiration: {
                  type: "string",
                  enum: [
                    "expired",
                    "today",
                    "this_week",
                    "next_30_days",
                    "none",
                  ],
                },
                maxQuantity: { type: ["number", "null"] },
                minQuantity: { type: ["number", "null"] },
                sort: {
                  type: "string",
                  enum: [
                    "expiration",
                    "quantity_asc",
                    "quantity_desc",
                    "product",
                  ],
                },
              },
              required: [
                "text",
                "category",
                "brand",
                "zone",
                "condition",
                "expiration",
                "maxQuantity",
                "minQuantity",
                "sort",
              ],
            },
          },
        },
      });
      return {
        filter: JSON.parse(
          response.choices[0]?.message.content || "{}",
        ) as InventoryFilter,
        interpreter: "openai",
      };
    } catch (error) {
      return {
        filter: rulesInterpret(query),
        interpreter: "rules",
        fallbackReason:
          error instanceof Error && error.message.includes("429")
            ? "OpenAI quota unavailable; safe rules used"
            : "OpenAI unavailable; safe rules used",
      };
    }
  }
  return { filter: rulesInterpret(query), interpreter: "rules" };
}
