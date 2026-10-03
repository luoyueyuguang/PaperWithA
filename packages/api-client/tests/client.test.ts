import { describe, expect, it, vi } from "vitest";
import { CoreClient, CoreClientError } from "../src/index";

class FakeSocket {
  onmessage: ((message: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;

  close() {
    this.closed = true;
  }

  emit(data: string) {
    this.onmessage?.({ data });
  }
}

function clientWith(fetchImpl: typeof fetch, socket?: FakeSocket) {
  return new CoreClient({
    baseUrl: "http://core.test:4130/",
    fetchImpl,
    webSocketFactory: () => (socket ?? new FakeSocket()) as unknown as WebSocket,
  });
}

describe("CoreClient", () => {
  it("posts a prompt and returns the run id", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ runId: "run-1" }), { status: 200 });
    }) as typeof fetch;

    const client = clientWith(fetchImpl);
    await expect(client.prompt("s1", "核心贡献是什么？")).resolves.toEqual({ runId: "run-1" });
    expect(calls[0]?.url).toBe("http://core.test:4130/api/sessions/s1/prompt");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ text: "核心贡献是什么？" }));
  });

  it("surfaces the server message and status on failure", async () => {
    const fetchImpl = (async () => new Response("session not found", { status: 404 })) as typeof fetch;
    await expect(clientWith(fetchImpl).prompt("missing", "hi")).rejects.toThrowError(
      expect.objectContaining({ name: "CoreClientError", status: 404, message: "session not found" }),
    );
  });

  it("reports an unreachable core as status 0", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const error = await clientWith(fetchImpl)
      .health()
      .then(() => null)
      .catch((caught: unknown) => caught as CoreClientError);
    expect(error?.status).toBe(0);
    expect(error?.message).toContain("ECONNREFUSED");
  });

  it("emits parsed events until the subscription closes", () => {
    const socket = new FakeSocket();
    const handler = vi.fn();
    const subscription = clientWith(vi.fn() as unknown as typeof fetch, socket).subscribe(handler);

    socket.emit('{"type":"text-delta","sessionId":"s1","runId":"r1","delta":"你"}');
    socket.emit("broken json");
    expect(handler).toHaveBeenCalledTimes(1);

    subscription.close();
    socket.emit('{"type":"text-delta","sessionId":"s1","runId":"r1","delta":"好"}');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(socket.closed).toBe(true);
  });
});
