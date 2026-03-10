import { NextRequest, NextResponse } from "next/server";
import { ImageResponse } from "next/og";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const clampText = (value: string | null, maxLength: number, fallback: string) => {
  const trimmed = (value || "").trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLength);
};

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

const isHttpUrl = (value: string | null) => {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ratio = clampText(searchParams.get("ratio"), 8, "4:5");
  const mode = clampText(searchParams.get("mode"), 16, "default");
  const renderMode = mode === "publish" ? "publish" : "default";
  const title = clampText(searchParams.get("title"), 80, "카드뉴스");
  const body = clampText(searchParams.get("body"), 260, "핵심 정보를 확인하세요.");
  const index = clampText(searchParams.get("index"), 4, "1");
  const bgUrl = searchParams.get("bg");
  const { width, height } = resolveSize(ratio, renderMode);

  const backgroundStyle = isHttpUrl(bgUrl)
    ? {
      backgroundImage: `linear-gradient(180deg, rgba(2,6,23,0.35) 0%, rgba(2,6,23,0.8) 100%), url(${bgUrl})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    }
    : {
      backgroundImage:
        "radial-gradient(circle at 20% 20%, #fb7185 0%, transparent 48%), radial-gradient(circle at 80% 15%, #a78bfa 0%, transparent 42%), linear-gradient(150deg, #0f172a 0%, #1e293b 45%, #334155 100%)",
    };

  const image = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          padding: 64,
          color: "#ffffff",
          fontFamily: "sans-serif",
          ...backgroundStyle,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 34,
            right: 34,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 9999,
            border: "1px solid rgba(255,255,255,0.28)",
            background: "rgba(15,23,42,0.45)",
            padding: "10px 16px",
            fontSize: 22,
            fontWeight: 700,
          }}
        >
          {`SLIDE ${index}`}
        </div>
        <div
          style={{
            width: "100%",
            marginTop: "auto",
            marginBottom: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 28,
            borderRadius: 36,
            background: "rgba(2,6,23,0.42)",
            border: "1px solid rgba(255,255,255,0.18)",
            backdropFilter: "blur(4px)",
            padding: "46px 44px",
          }}
        >
          <div
            style={{
              fontSize: 62,
              lineHeight: 1.2,
              fontWeight: 900,
              letterSpacing: -1.4,
              whiteSpace: "pre-wrap",
            }}
          >
            {title}
          </div>
          <div
            style={{
              fontSize: 34,
              lineHeight: 1.4,
              fontWeight: 600,
              opacity: 0.95,
              whiteSpace: "pre-wrap",
            }}
          >
            {body}
          </div>
        </div>
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
}
