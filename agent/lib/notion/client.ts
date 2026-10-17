import { getEnv } from "../env";

// Minimal client for pnpm forget (M3-T11). M3-T1 grows it into the full client (rate limit, retries) with this interface.
export const NOTION_VERSION = "2026-03-11";
type Method = "GET" | "POST" | "PATCH" | "DELETE";

export class NotionApiError extends Error {
  constructor(public status: number, public path: string, public body: string) {
    super(`Notion ${status} on ${path}: ${body.slice(0, 300)}`);
    this.name = "NotionApiError";
  }
}

export interface NotionClient {
  request<T = unknown>(method: Method, path: string, body?: unknown): Promise<T>;
}

export function createNotionClient(opts: { token?: string; fetchImpl?: typeof fetch } = {}): NotionClient {
  const token = opts.token ?? getEnv().NOTION_TOKEN;
  if (!token) throw new Error("NOTION_TOKEN is not set");
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    async request<T>(method: Method, path: string, body?: unknown): Promise<T> {
      const res = await fetchImpl(`https://api.notion.com/v1${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new NotionApiError(res.status, path, await res.text());
      return (res.status === 204 ? undefined : await res.json()) as T;
    },
  };
}

export async function trashNotionPage(pageId: string, notion: NotionClient = createNotionClient()): Promise<void> {
  await notion.request("PATCH", `/pages/${pageId}`, { in_trash: true });
}
