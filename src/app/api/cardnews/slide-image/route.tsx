import { NextRequest, NextResponse } from "next/server";
import { ImageResponse } from "next/og";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const clampText = (value: unknown, maxLength: number, fallback: string) => {
  const trimmed = typeof value === "string" ? value.trim() : "";
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
  const indexNumber = Number.parseInt(index, 10);
  const isCoverSlide = Number.isFinite(indexNumber) && indexNumber === 1;
  const bgUrl = searchParams.get("bg");
  const { width, height } = resolveSize(ratio, renderMode);
  const hasBackgroundImage = isHttpUrl(bgUrl);
  const fallbackBackground =
    "radial-gradient(circle at 20% 20%, #fb7185 0%, transparent 48%), radial-gradient(circle at 80% 15%, #a78bfa 0%, transparent 42%), linear-gradient(150deg, #0f172a 0%, #1e293b 45%, #334155 100%)";

  const image = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          padding: isCoverSlide ? 52 : 64,
          color: "#ffffff",
          fontFamily: "sans-serif",
          backgroundImage: hasBackgroundImage ? undefined : fallbackBackground,
          backgroundSize: "cover",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center",
        }}
      >
        {hasBackgroundImage && bgUrl ? (
          <img
            src={bgUrl}
            alt=""
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: "center",
            }}
          />
        ) : null}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(2,6,23,0.12) 0%, rgba(2,6,23,0.26) 45%, rgba(2,6,23,0.64) 100%)",
          }}
        />
        {isCoverSlide ? (
          <>
            <div
              style={{
                position: "relative",
                width: "100%",
                marginTop: "auto",
                display: "flex",
                alignItems: "flex-end",
              }}
            >
              <div
                style={{
                  maxWidth: "90%",
                  fontSize: Math.max(50, Math.round(width * 0.056)),
                  lineHeight: 1.16,
                  fontWeight: 900,
                  letterSpacing: -1.6,
                  whiteSpace: "pre-wrap",
                  textShadow: "0 6px 24px rgba(2,6,23,0.55)",
                }}
              >
                {title}
              </div>
            </div>
          </>
        ) : (
          <>
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
          </>
        )}
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
