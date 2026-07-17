type ApiErrorBody = { error?: string; message?: string };

export async function apiJson<T = any>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text();
  let body: ApiErrorBody & Record<string, unknown> = {};

  if (raw && contentType.includes("application/json")) {
    try {
      body = JSON.parse(raw) as ApiErrorBody & Record<string, unknown>;
    } catch {
      throw new Error(`ReliefLink received malformed data from ${url}. Redeploy the current main branch.`);
    }
  } else if (raw.trimStart().startsWith("<")) {
    throw new Error(
      `This deployment does not contain ${url}. Vercel returned a web page instead of the API. Redeploy the latest main commit and verify the Root Directory is vision_agent/web.`,
    );
  } else if (raw) {
    throw new Error(`Unexpected response from ${url} (${response.status}).`);
  }

  if (!response.ok) throw new Error(body.error || body.message || `Request failed (${response.status})`);
  return body as T;
}
