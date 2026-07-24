export type MappingExpression =
  | { kind: "json-pointer"; path: string }
  | { kind: "literal"; value: string | number | boolean | null }
  | { kind: "list"; items: MappingExpression[] };

export interface ProviderManifest {
  providerId: string;
  manifestVersion: string;
  apiVersion: string;
  transport: "http-json" | "sse";
  endpoint: string;
  allowedDomains: string[];
  authentication: { scheme: "api-key" | "oauth" | "none" };
  requestMapping: MappingExpression;
  responseMapping: MappingExpression;
}

export type ManifestErrorCode =
  | "invalid-structure"
  | "unsupported-version"
  | "unsupported-mapping"
  | "undeclared-domain"
  | "incomplete-auth";

export interface ManifestError {
  code: ManifestErrorCode;
  path: string;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateMapping(value: unknown, path: string, errors: ManifestError[]): value is MappingExpression {
  if (!isRecord(value) || typeof value.kind !== "string") {
    errors.push({ code: "unsupported-mapping", path, message: "mapping must be declarative" });
    return false;
  }
  if (value.kind === "json-pointer") {
    if (typeof value.path !== "string" || (!value.path.startsWith("/") && value.path !== "")) {
      errors.push({ code: "unsupported-mapping", path, message: "json-pointer requires an absolute pointer" });
      return false;
    }
    return true;
  }
  if (value.kind === "literal") {
    if (!(value.value === null || ["string", "number", "boolean"].includes(typeof value.value))) {
      errors.push({ code: "unsupported-mapping", path, message: "literal must be a scalar" });
      return false;
    }
    return true;
  }
  if (value.kind === "list") {
    if (!Array.isArray(value.items)) {
      errors.push({ code: "unsupported-mapping", path, message: "list requires items" });
      return false;
    }
    value.items.forEach((item, index) => validateMapping(item, `${path}.items[${index}]`, errors));
    return true;
  }
  errors.push({ code: "unsupported-mapping", path, message: `mapping kind ${value.kind} is not allowed` });
  return false;
}

export function validateProviderManifest(input: unknown): ManifestError[] {
  const errors: ManifestError[] = [];
  if (!isRecord(input)) {
    return [{ code: "invalid-structure", path: "$", message: "manifest must be an object" }];
  }
  if (typeof input.providerId !== "string" || typeof input.endpoint !== "string") {
    errors.push({ code: "invalid-structure", path: "$", message: "providerId and endpoint are required" });
  }
  if (input.apiVersion !== "paperwitha.provider.v1") {
    errors.push({ code: "unsupported-version", path: "apiVersion", message: "only provider API v1 is supported" });
  }
  if (!isRecord(input.authentication)
    || (input.authentication.scheme !== "api-key"
      && input.authentication.scheme !== "oauth"
      && input.authentication.scheme !== "none")) {
    errors.push({ code: "incomplete-auth", path: "authentication", message: "a supported authentication scheme is required" });
  }
  const allowedDomains = Array.isArray(input.allowedDomains)
    ? input.allowedDomains.filter((domain): domain is string => typeof domain === "string")
    : [];
  try {
    const hostname = new URL(String(input.endpoint)).hostname;
    const declared = allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
    if (!declared) errors.push({ code: "undeclared-domain", path: "endpoint", message: "endpoint domain is not declared" });
  } catch {
    errors.push({ code: "invalid-structure", path: "endpoint", message: "endpoint must be a URL" });
  }
  validateMapping(input.requestMapping, "requestMapping", errors);
  validateMapping(input.responseMapping, "responseMapping", errors);
  if (input.transport !== "http-json" && input.transport !== "sse") {
    errors.push({ code: "invalid-structure", path: "transport", message: "unsupported transport" });
  }
  return errors;
}

export interface StreamEvent {
  kind: "delta" | "done";
  text: string;
}

export class ProviderStreamError extends Error {
  readonly code = "malformed-stream" as const;

  constructor(message: string) {
    super(message);
    this.name = "ProviderStreamError";
  }
}

export function parseSseEvents(source: string, responseMapping?: MappingExpression): StreamEvent[] {
  const events: StreamEvent[] = [];
  for (const block of source.split(/\n\s*\n/)) {
    const data = block.split("\n").find((line) => line.startsWith("data:"))?.slice(5).trim();
    if (!data || data === "[DONE]") {
      if (data === "[DONE]") events.push({ kind: "done", text: "" });
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      throw new ProviderStreamError("SSE data is not valid JSON");
    }
    const text = responseMapping ? evaluateMapping(responseMapping, parsed) : isRecord(parsed) ? parsed.delta : undefined;
    if (typeof text !== "string") throw new ProviderStreamError("SSE mapping did not produce a string delta");
    events.push({ kind: "delta", text });
  }
  return events;
}

export interface ProviderMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ProviderChatRequest {
  model: string;
  messages: readonly ProviderMessage[];
  temperature?: number;
}

export interface ProviderClientOptions {
  fetchImpl?: typeof fetch;
  credential?: string;
}

function pointerValue(input: unknown, path: string): unknown {
  if (path === "") return input;
  if (!path.startsWith("/")) return undefined;
  return path.slice(1).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~")).reduce<unknown>((value, part) => {
    if (Array.isArray(value)) return value[Number(part)];
    if (isRecord(value)) return value[part];
    return undefined;
  }, input);
}

export function evaluateMapping(expression: MappingExpression, input: unknown): unknown {
  if (expression.kind === "json-pointer") return pointerValue(input, expression.path);
  if (expression.kind === "literal") return expression.value;
  return expression.items.map((item) => evaluateMapping(item, input));
}

export class ProviderClient {
  private readonly fetchImpl: typeof fetch;
  private readonly credential: string | undefined;

  constructor(private readonly manifest: ProviderManifest, options: ProviderClientOptions = {}) {
    const errors = validateProviderManifest(manifest);
    if (errors.length) throw new Error(`invalid provider manifest: ${errors.map((error) => error.code).join(",")}`);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.credential = options.credential;
    if (manifest.authentication.scheme === "api-key" && !this.credential) throw new Error("api-key provider requires an ephemeral credential");
  }

  async *streamChat(request: ProviderChatRequest, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const headers: Record<string, string> = { "content-type": "application/json", accept: this.manifest.transport === "sse" ? "text/event-stream" : "application/json" };
    if (this.credential) headers.authorization = `Bearer ${this.credential}`;
    const init: RequestInit = {
      method: "POST",
      headers,
      body: JSON.stringify(evaluateMapping(this.manifest.requestMapping, request)),
    };
    if (signal) init.signal = signal;
    const response = await this.fetchImpl(this.manifest.endpoint, init);
    if (!response.ok) throw new Error(`provider request failed: HTTP ${response.status}`);
    if (this.manifest.transport === "http-json") {
      const payload = await response.json() as unknown;
      const text = evaluateMapping(this.manifest.responseMapping, payload);
      if (typeof text !== "string") throw new ProviderStreamError("response mapping did not produce text");
      yield { kind: "delta", text };
      yield { kind: "done", text: "" };
      return;
    }
    if (!response.body) throw new ProviderStreamError("SSE response has no body");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
      const blocks = buffer.split(/\n\s*\n/);
      buffer = blocks.pop() ?? "";
      for (const event of parseSseEvents(blocks.join("\n\n"), this.manifest.responseMapping)) yield event;
      if (chunk.done) break;
    }
    if (buffer.trim()) for (const event of parseSseEvents(buffer, this.manifest.responseMapping)) yield event;
  }
}
