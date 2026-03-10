import { randomUUID } from "crypto";
import { ImageResponse } from "next/og";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { storageBucket } from "@/lib/firebase-admin";

export type CardnewsAssetSlide = {
  title?: string | null;
  body?: string | null;
  content?: string | null;
  keywords?: string | null;
  image?: string | null;
};

export type PersistedCardnewsSlide = {
  title: string;
  body: string;
  keywords?: string;
  renderedImageUrl: string;
};

const DOWNLOAD_URL_HOST = "https://firebasestorage.googleapis.com";

const clampText = (value: string | null | undefined, maxLength: number, fallback: string) => {
  const trimmed = (value || "").trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLength);
};

const isHttpUrl = (value: string | null | undefined) => {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const resolveSize = (ratio: string) => {
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
};

const getBodyText = (slide: CardnewsAssetSlide) => {
  if (typeof slide.body === "string") return slide.body;
  if (typeof slide.content === "string") return slide.content;
  return "";
};

const buildDownloadUrl = (bucketName: string, filePath: string, token: string) =>
  `${DOWNLOAD_URL_HOST}/v0/b/${bucketName}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;

const renderSlideBuffer = async (params: {
  slide: CardnewsAssetSlide;
  index: number;
  ratio: string;
  backgroundImageUrl?: string | null;
}) => {
  const title = clampText(params.slide.title, 80, `슬라이드 ${params.index + 1}`);
  const body = clampText(getBodyText(params.slide), 260, "핵심 정보를 확인하세요.");
  const indexLabel = String(params.index + 1);
  const { width, height } = resolveSize(params.ratio);

  const backgroundStyle = isHttpUrl(params.backgroundImageUrl)
    ? {
        backgroundImage: `linear-gradient(180deg, rgba(2,6,23,0.35) 0%, rgba(2,6,23,0.8) 100%), url(${params.backgroundImageUrl})`,
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
          {`SLIDE ${indexLabel}`}
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
  return Buffer.from(
    jpeg.encode(
      {
        data: png.data,
        width: png.width,
        height: png.height,
      },
      82,
    ).data,
  );
};

export const materializeCardnewsSlides = async (params: {
  uid: string;
  cardnewsId: string;
  slides: CardnewsAssetSlide[];
  aspectRatio?: string | null;
  backgroundImageUrl?: string | null;
}) => {
  if (!storageBucket || params.slides.length === 0) {
    return null;
  }

  const ratio = clampText(params.aspectRatio, 8, "4:5");
  const persistedSlides: PersistedCardnewsSlide[] = [];

  for (let index = 0; index < params.slides.length; index += 1) {
    const slide = params.slides[index];
    const filePath = `users/${params.uid}/cardnews/${params.cardnewsId}/slides/${String(index + 1).padStart(2, "0")}.jpg`;
    const token = randomUUID();
    const buffer = await renderSlideBuffer({
      slide,
      index,
      ratio,
      backgroundImageUrl: params.backgroundImageUrl,
    });
    const file = storageBucket.file(filePath);
    await file.save(buffer, {
      resumable: false,
      contentType: "image/jpeg",
      metadata: {
        cacheControl: "public, max-age=31536000, immutable",
        metadata: {
          firebaseStorageDownloadTokens: token,
        },
      },
    });

    persistedSlides.push({
      title: clampText(slide.title, 80, `슬라이드 ${index + 1}`),
      body: clampText(getBodyText(slide), 260, "핵심 정보를 확인하세요."),
      keywords: typeof slide.keywords === "string" ? slide.keywords : "",
      renderedImageUrl: buildDownloadUrl(storageBucket.name, filePath, token),
    });
  }

  return {
    slides: persistedSlides,
    slideImageUrls: persistedSlides.map((slide) => slide.renderedImageUrl),
    previewImageUrl: persistedSlides[0]?.renderedImageUrl || null,
  };
};

export const deleteCardnewsSlideAssets = async (uid: string, cardnewsId: string) => {
  if (!storageBucket) return;
  await storageBucket.deleteFiles({
    prefix: `users/${uid}/cardnews/${cardnewsId}/slides/`,
  });
};
