import https from "https";

export function ipv4Fetch(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const url = new URL(input.toString());
    const body = typeof init.body === "string" ? init.body : "";

    const req = https.request(
      {
        hostname: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: init.method ?? "GET",
        family: 4,
        timeout: 10_000,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "User-Agent": "Do-It",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];

        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));

        res.on("end", () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode ?? 200,
              headers: res.headers as Record<string, string>,
            }),
          );
        });
      },
    );

    req.on("error", reject);

    req.setTimeout(10_000, () => {
      req.destroy(new Error("IPv4 RPC request timed out"));
    });

    if (body) req.write(body);
    req.end();
  });
}