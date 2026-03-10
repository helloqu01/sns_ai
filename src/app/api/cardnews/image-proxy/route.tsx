import { NextRequest, NextResponse } from "next/server";
import { ImageResponse } from "next/og";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const resolveSize = (ratio: string, mode: "default" | "publish") => {
  if (mode === "publish") {
    switch (ratio) {
      case "1:1":
        return { width: 720, height: 720 };
      case "16:9":
        return { width: 1280, height: 720 };
      case "9:16":
        return { width: 720, height: 1280 };
      case "3:4":
        return { width: 810, height: 1080 };
      default:
        return { width: 720, height: 900 };
    }
  }

  switch (ratio) {
    case "1:1":
      return { width: 1080, height: 1080 };
    case "16:9":
      return { width: 1600, height: 900 };
    case "9:16":
      return { width: 1080, height: 1920 };
    case "3:4":
      return { width: 1080, height: 1440 };
    default:
      return { width: 1080, height: 1350 };
  }
};

const isPrivateHostname = (hostname: string) => {
  const lower = hostname.trim().toLowerCase();
  if (!lower) return true;
  if (lower === "localhost" || lower === "127.0.0.1" || lower === "::1") {
    return true;
  }

  if (/^10\./.test(lower) || /^192\.168\./.test(lower)) {
    return true;
  }

  const private172 = lower.match(/^172\.(\d{1,3})\./);
  if (private172) {
    const second = Number(private172[1]);
    if (Number.isFinite(second) && second >= 16 && second <= 31) {
      return true;
    }
  }

  return false;
};

const isAllowedHttpUrl = (value: string | null): value is string => {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    if (isPrivateHostname(parsed.hostname)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const src = searchParams.get("src");
  const ratio = (searchParams.get("ratio") || "4:5").trim();
  const mode = (searchParams.get("mode") || "default").trim().toLowerCase();
  const renderMode = mode === "publish" ? "publish" : "default";

  if (!isAllowedHttpUrl(src)) {
    return NextResponse.json({ error: "Invalid src image URL" }, { status: 400 });
  }
  const sourceUrl = src;

  const { width, height } = resolveSize(ratio, renderMode);
  try {
    const image = new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            backgroundColor: "#0f172a",
          }}
        >
          <img
            src={sourceUrl}
            alt=""
            width={width}
            height={height}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        </div>
      ),
      { width, height },
    );

    const pngBuffer = Buffer.from(await image.arrayBuffer());
    const png = PNG.sync.read(pngBuffer);
    const jpegQuality = renderMode === "publish" ? 82 : 88;
    const jpegBuffer = Buffer.from(
      jpeg.encode(
        {
          data: png.data,
          width: png.width,
          height: png.height,
        },
        jpegQuality,
      ).data,
    );

    return new NextResponse(jpegBuffer, {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(jpegBuffer.byteLength),
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (error) {
    console.error("Image proxy render failed:", error);
    return NextResponse.json({ error: "Failed to render image proxy" }, { status: 502 });
  }
}
