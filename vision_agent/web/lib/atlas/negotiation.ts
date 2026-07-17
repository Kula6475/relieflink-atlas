import OpenAI from "openai";

export type NegotiationFacts = {
  requestingSite: string;
  requestingAgent: string;
  donorSite: string;
  donorAgent: string;
  category: string;
  requested: number;
  offered: number;
  verifiedSurplus: number;
  safetyStock: number;
  distanceMiles: number;
};

export function verifiedSurplus(
  onHand: number,
  safetyStock: number,
  reserved: number,
) {
  return Math.max(0, Math.floor(onHand - safetyStock - reserved));
}

export function boundedOffer(shortage: number, surplus: number) {
  return Math.max(0, Math.min(Math.floor(shortage), Math.floor(surplus)));
}

export async function explainNegotiation(
  facts: NegotiationFacts,
): Promise<{ mode: "openai" | "rules"; explanation: string }> {
  const fallback = `${facts.requestingAgent} requested ${facts.requested} ${facts.category} from ${facts.donorAgent}. ${facts.donorAgent} verified ${facts.verifiedSurplus} units above safety stock and offered ${facts.offered}. The offer is bounded by recorded surplus to avoid demand amplification, over-ordering, and food waste.`;
  if (!process.env.OPENAI_API_KEY)
    return { mode: "rules", explanation: fallback };
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_TEXT_MODEL || "gpt-5-mini",
      messages: [
        {
          role: "system",
          content:
            "You explain a food-bank agent negotiation. Preserve every supplied quantity exactly. Never approve, alter, or invent a commitment. In 2 concise sentences explain why the offer counters bullwhip amplification, waste, and excess stock. Return only the schema.",
        },
        { role: "user", content: JSON.stringify(facts) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "negotiation_explanation",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: { explanation: { type: "string" } },
            required: ["explanation"],
          },
        },
      },
    });
    const parsed = JSON.parse(response.choices[0]?.message.content || "{}") as {
      explanation?: string;
    };
    return { mode: "openai", explanation: parsed.explanation || fallback };
  } catch {
    return { mode: "rules", explanation: fallback };
  }
}
