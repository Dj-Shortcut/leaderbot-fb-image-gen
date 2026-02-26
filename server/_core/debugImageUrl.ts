import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ImageUrlProbeResult = {
  statusCode: number;
  contentType: string;
};

export async function probeImageUrlForMessenger(
  url: string
): Promise<ImageUrlProbeResult> {
  const { stdout } = await execFileAsync("curl", [
    "-X",
    "GET",
    "-L",
    "-A",
    "facebookexternalhit/1.1",
    "-sS",
    "-o",
    "/dev/null",
    "-w",
    "%{http_code}\n%{content_type}\n",
    url,
  ]);

  const [rawStatus = "", rawContentType = ""] = stdout.trim().split("\n");
  const statusCode = Number.parseInt(rawStatus.trim(), 10);
  const contentType = rawContentType.trim().toLowerCase();

  if (!Number.isFinite(statusCode)) {
    throw new Error(
      `Could not parse HTTP status code from curl output: ${JSON.stringify(stdout)}`
    );
  }

  return {
    statusCode,
    contentType,
  };
}

export async function assertMessengerImageUrl(
  url: string
): Promise<ImageUrlProbeResult> {
  const result = await probeImageUrlForMessenger(url);

  if (result.statusCode !== 200) {
    throw new Error(
      `Expected status 200, got ${result.statusCode} for URL: ${url}`
    );
  }

  if (!result.contentType.startsWith("image/")) {
    throw new Error(
      `Expected Content-Type to start with image/, got ${result.contentType || "(empty)"} for URL: ${url}`
    );
  }

  return result;
}

async function runCli(): Promise<void> {
  const url = process.argv
    .slice(2)
    .find(arg => arg !== "--")
    ?.trim();

  if (!url) {
    console.error("Usage: pnpm debug:image-url -- <url>");
    process.exitCode = 1;
    return;
  }

  const result = await assertMessengerImageUrl(url);
  console.log(
    JSON.stringify(
      {
        ok: true,
        url,
        statusCode: result.statusCode,
        contentType: result.contentType,
      },
      null,
      2
    )
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runCli().catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: message,
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  });
}
