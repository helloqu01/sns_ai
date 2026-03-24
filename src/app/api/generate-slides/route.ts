import { NextRequest, NextResponse } from "next/server";
import { geminiFlashModel, geminiProModel } from "@/lib/gemini";
import { db, isFirebaseConfigured } from "@/lib/firebase-admin";
import { getFirebaseAdmin } from "@/lib/firebase-admin-helpers";
import { getUserCardnewsCollection } from "@/lib/firestore-cardnews";
import { invalidateCardnewsListCache } from "@/lib/services/cardnews-list-cache";

const FREE_AI_URL = process.env.FREE_AI_URL || "https://text.pollinations.ai/openai";
const FREE_AI_MODEL = process.env.FREE_AI_MODEL || "openai";
const FREE_AI_TIMEOUT_MS = Number.parseInt(process.env.FREE_AI_TIMEOUT_MS || "45000", 10);
const FREE_AI_REASONING_EFFORT = process.env.FREE_AI_REASONING_EFFORT || "low";
const DEFAULT_SLIDE_COUNT = 6;
const MAX_GENERATION_ATTEMPTS = 3;
const DEFAULT_KEYWORDS = "festival event poster social media korean campaign";

type GeneratedSlide = {
  title: string;
  body: string;
  keywords: string;
  imageUrl?: string;
  textPosition?: "top" | "center" | "bottom";
};

type SlideGenerationProvider = "gemini" | "free-ai";
type SlideGenerationResult = { text: string; provider: SlideGenerationProvider };
type SlideValidationResult = { slides: GeneratedSlide[]; blockingIssues: string[] };
type CurationFestival = {
  title: string;
  startDate: string;
  endDate: string;
  location: string;
  genre: string;
  lineup?: string;
  price?: string;
  imageUrl?: string;
};

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const toCurationFestival = (value: unknown): CurationFestival | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const title = asNonEmptyString(raw.title);
  const startDate = asNonEmptyString(raw.startDate);
  const endDate = asNonEmptyString(raw.endDate);
  const location = asNonEmptyString(raw.location);
  const genre = asNonEmptyString(raw.genre) || "일반";
  if (!title || !startDate || !endDate || !location) return null;

  return {
    title,
    startDate,
    endDate,
    location,
    genre,
    lineup: asNonEmptyString(raw.lineup) || undefined,
    price: asNonEmptyString(raw.price) || undefined,
    imageUrl: asNonEmptyString(raw.imageUrl) || undefined,
  };
};

const toSafeSlideCount = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(n, 3), 10);
};

const countChars = (value: string) => Array.from(value).length;
const trimToChars = (value: string, maxChars: number) => Array.from(value).slice(0, maxChars).join("");

const extractFestivalTitle = (content: string) => {
  const normalized = content.replace(/\r/g, "").trim();
  if (!normalized) return "행사명 미정";

  const labeledMatch = normalized.match(/(?:^|\n)\s*(?:공연명|행사명|축제명|페스티벌명|제목)\s*[:：]\s*(.+)/i);
  if (labeledMatch?.[1]) {
    const labeledTitle = labeledMatch[1].split("\n")[0]?.trim();
    if (labeledTitle) return labeledTitle;
  }

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return "행사명 미정";

  const metadataPrefixPattern = /^(?:장소|기간|일시|시간|문의|가격|요금|출연|라인업)\s*[:：]/i;
  const candidate = lines.find((line) => !metadataPrefixPattern.test(line)) || lines[0];
  return candidate.replace(/^[\-*\s]+/, "").trim() || "행사명 미정";
};

const normalizeSlideLine = (line: string) => {
  const trimmed = line.trim();
  if (!trimmed) return "";

  const collapsed = trimmed.replace(/\s+/g, " ");
  // Remove narrative period punctuation while preserving numeric dots like 2026.04.03.
  return collapsed.replace(/\.(?!\d)/g, "").trim();
};

const sanitizeSlideBody = (body: string) => {
  const normalizedBody = body
    .replace(/\r/g, "")
    .replace(/\n?Source:\s*.+$/i, "")
    .trim();
  if (!normalizedBody) return "";

  const lines = normalizedBody
    .split("\n")
    .map((line) => normalizeSlideLine(line))
    .filter(Boolean);
  return lines.join("\n").trim();
};

const normalizeForDuplicateCheck = (value: string) =>
  value
    .toLowerCase()
    .replace(/\n?Source:\s*.+$/i, "")
    .replace(/[^a-z0-9가-힣]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const getUidFromRequest = async (req: NextRequest) => {
  const authHeader = req.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!idToken) return null;
  const admin = getFirebaseAdmin();
  if (!admin) return null;
  const decoded = await admin.auth().verifyIdToken(idToken);
  return decoded.uid;
};

const getAspectRatioGuide = (aspectRatio?: string) => {
  switch (aspectRatio) {
    case "1:1":
      return "정사각형 피드형 포맷입니다. 제목은 짧고 강하게, 본문은 중간 밀도로 유지하세요.";
    case "16:9":
      return "가로형 배너 포맷입니다. 한 장에 너무 많은 줄바꿈을 넣지 말고, 한눈에 읽히는 헤드라인 위주로 구성하세요.";
    case "9:16":
      return "세로 숏폼 포맷입니다. 문장을 짧게 끊고, 첫 화면 임팩트와 스크롤 리듬을 살리세요.";
    case "3:4":
      return "세로 포스터형 포맷입니다. 정보량은 충분히 담되, 블록별로 명확히 나눠 가독성을 유지하세요.";
    default:
      return "4:5 인스타그램 피드 최적 포맷입니다. 제목과 본문 길이를 균형 있게 배치하고 핵심 문장을 우선 배치하세요.";
  }
};

const getToneGuide = (tone?: string) => {
  switch (tone) {
    case "professional":
      return "전문적이고 신뢰감 있는 에디터 톤으로 작성하세요.";
    case "trendy":
      return "감각적이고 요즘 피드 문법에 맞는 트렌디한 톤으로 작성하세요.";
    default:
      return "친근하고 자연스럽게 저장/공유하고 싶어지는 톤으로 작성하세요.";
  }
};

const getCaptionStyleGuide = (captionStyle?: string) => {
  switch (captionStyle) {
    case "magazine":
      return "매거진 에디토리얼처럼 문장 흐름이 정돈된 스타일로 작성하세요.";
    case "promotional":
      return "참여, 반응, 클릭을 유도하는 프로모션형 문장 흐름을 사용하세요.";
    case "minimal":
      return "불필요한 수식어를 줄이고 짧고 명확하게 요약하세요.";
    default:
      return "정보와 분위기를 균형 있게 섞은 밸런스형 스타일로 작성하세요.";
  }
};

const createDraftCardnews = async (payload: {
  uid: string;
  slides: unknown[];
  caption?: string;
  content: string;
  style?: string;
  target?: string;
  aspectRatio?: string;
  genre?: string;
  source?: string;
  sourceLabel?: string;
  imageUrl?: string;
  tone?: string;
  captionStyle?: string;
  slideCount: number;
}): Promise<string | null> => {
  if (!db || !isFirebaseConfigured) return null;
  const docRef = getUserCardnewsCollection(payload.uid).doc();
  const now = new Date().toISOString();
  await docRef.set({
    uid: payload.uid,
    status: "draft",
    slides: payload.slides,
    caption: payload.caption ?? null,
    content: payload.content,
    style: payload.style ?? null,
    target: payload.target ?? null,
    aspectRatio: payload.aspectRatio ?? null,
    genre: payload.genre ?? null,
    source: payload.source ?? null,
    sourceLabel: payload.sourceLabel ?? null,
    imageUrl: payload.imageUrl ?? null,
    tone: payload.tone ?? null,
    captionStyle: payload.captionStyle ?? null,
    slideCount: payload.slideCount,
    createdAt: now,
    updatedAt: now,
  });
  invalidateCardnewsListCache(payload.uid);
  return docRef.id;
};

const extractJsonText = (text: string) => {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to parse JSON from AI response");
  }
  return jsonMatch[0];
};

const isQuotaExceededError = (error: unknown) => {
  const rawMessage = error instanceof Error ? error.message : String(error ?? "");
  const message = rawMessage.toLowerCase();
  return [
    "quota",
    "resource_exhausted",
    "rate limit",
    "too many requests",
    "429",
    "exceeded your current quota",
  ].some((token) => message.includes(token));
};

const buildFreeAiPrompt = (prompt: string, requestedSlideCount: number | null) => `${prompt}

[추가 필수 규칙]
- 마크다운, 코드블록, 설명문 없이 JSON만 출력하세요.
- ${requestedSlideCount
    ? `slides 배열 길이는 정확히 ${requestedSlideCount}여야 합니다.`
    : "slides 배열 길이는 3~10개 사이에서 입력 정보량에 맞게 결정하세요."}
- 각 slide는 title, body, keywords를 반드시 포함하세요.
`;

const parseSlidesFromAiText = (text: string): Array<Record<string, unknown>> => {
  const parsed = JSON.parse(extractJsonText(text)) as { slides?: unknown };
  if (!Array.isArray(parsed.slides)) {
    throw new Error("AI response does not include a valid slides array.");
  }
  return parsed.slides.map((slide) => (slide && typeof slide === "object" ? slide as Record<string, unknown> : {}));
};

const validateAndNormalizeSlides = (params: {
  rawSlides: Array<Record<string, unknown>>;
  slideCount: number;
  festivalTitle: string;
  imageUrl?: string;
}): SlideValidationResult => {
  const blockingIssues: string[] = [];
  if (params.rawSlides.length !== params.slideCount) {
    blockingIssues.push(
      `슬라이드 수 불일치 (요청 ${params.slideCount}개 / 응답 ${params.rawSlides.length}개)`,
    );
  }

  const slides: GeneratedSlide[] = [];
  for (let index = 0; index < params.slideCount; index += 1) {
    const rawSlide = params.rawSlides[index] || {};
    const rawTitle = asNonEmptyString(rawSlide.title);
    const rawBody = asNonEmptyString(rawSlide.body) || asNonEmptyString(rawSlide.content);
    const rawKeywords = asNonEmptyString(rawSlide.keywords);

    if (index !== 0 && !rawTitle) {
      blockingIssues.push(`${index + 1}번 슬라이드 title 누락`);
    }
    if (index !== 0 && !rawBody) {
      blockingIssues.push(`${index + 1}번 슬라이드 body 누락`);
    }

    const title = index === 0
      ? params.festivalTitle
      : (() => {
        const titleBase = rawTitle || `슬라이드 ${index + 1}`;
        return countChars(titleBase) > 20 ? trimToChars(titleBase, 20) : titleBase;
      })();
    const body = index === 0
      ? ""
      : sanitizeSlideBody(rawBody || "핵심 정보를 확인하세요.");
    const rawPosition = rawSlide.textPosition;
    const textPosition = (rawPosition === "top" || rawPosition === "center" || rawPosition === "bottom")
      ? rawPosition
      : index === 0 ? "bottom"
      : index === 1 ? "center"
      : index === params.slideCount - 1 ? "bottom"
      : "top";
    const keywords = rawKeywords || DEFAULT_KEYWORDS;
    const slide: GeneratedSlide = {
      title,
      body,
      keywords,
      imageUrl: index === 0 ? params.imageUrl : undefined,
      textPosition,
    };

    slides.push(slide);
  }

  const seenTitles = new Map<string, number>();
  const seenBodies = new Map<string, number>();
  slides.forEach((slide, index) => {
    const normalizedTitle = normalizeForDuplicateCheck(slide.title);
    const normalizedBody = normalizeForDuplicateCheck(slide.body);

    if (normalizedTitle) {
      const seenIndex = seenTitles.get(normalizedTitle);
      if (seenIndex !== undefined) {
        blockingIssues.push(`중복 title 감지 (${seenIndex + 1}번, ${index + 1}번)`);
      } else {
        seenTitles.set(normalizedTitle, index);
      }
    }

    if (normalizedBody) {
      const seenIndex = seenBodies.get(normalizedBody);
      if (seenIndex !== undefined) {
        blockingIssues.push(`중복 body 감지 (${seenIndex + 1}번, ${index + 1}번)`);
      } else {
        seenBodies.set(normalizedBody, index);
      }
    }
  });

  return { slides, blockingIssues };
};

const buildRepairPrompt = (params: {
  originalPrompt: string;
  previousSlides: GeneratedSlide[];
  blockingIssues: string[];
  slideCount: number;
}) => {
  const previousSlidesText = JSON.stringify({ slides: params.previousSlides }, null, 2);
  const issuesText = params.blockingIssues.slice(0, 12).map((issue, idx) => `${idx + 1}. ${issue}`).join("\n");
  return `${params.originalPrompt}

[검증 실패 항목 - 반드시 수정]
${issuesText}

[직전 출력(JSON)]
${previousSlidesText}

[재생성 지시]
- 위 실패 항목만 우선적으로 수정하세요.
- 반드시 정확히 ${params.slideCount}개의 slides를 반환하세요.
- 오직 JSON만 반환하세요.
`;
};

const buildRuleBasedSlides = (
  content: string,
  slideCount: number,
  festivalTitle: string,
): GeneratedSlide[] => {
  const cleaned = content.replace(/\s+/g, " ").trim();
  const pieces = cleaned
    .split(/[.!?\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const basePieces = pieces.length > 0 ? pieces : [cleaned || "행사 핵심 정보를 정리해 보세요"];

  const slides: GeneratedSlide[] = [];
  for (let i = 0; i < slideCount; i += 1) {
    const piece = basePieces[i % basePieces.length];
    const title = i === 0
      ? festivalTitle
      : `포인트 ${i + 1}`;
    const bodyCore = i === 0 ? "" : sanitizeSlideBody(piece || "핵심 정보를 확인하세요.");
    const textPosition: GeneratedSlide["textPosition"] = i === 0
      ? "bottom"
      : i === 1
        ? "center"
        : i === slideCount - 1
          ? "bottom"
          : "top";
    slides.push({
      title: i === 0 ? title : title.slice(0, 20),
      body: bodyCore,
      keywords: DEFAULT_KEYWORDS,
      textPosition,
    });
  }
  return slides;
};

const buildRuleBasedCaption = (params: {
  slides: Array<Record<string, unknown>>;
  sourceLabel?: string;
  genre?: string;
  tone?: string;
  captionStyle?: string;
  angleHook?: string | null;
}) => {
  const titles = params.slides
    .map((slide) => {
      const title = typeof slide.title === "string" ? slide.title.trim() : "";
      return title;
    })
    .filter(Boolean)
    .slice(0, 4);

  const hashtagSource = titles.length > 0 ? titles : [params.genre || "페스티벌", "카드뉴스"];
  const hashtags = hashtagSource
    .map((item) => item.replace(/\s+/g, ""))
    .filter(Boolean)
    .slice(0, 5)
    .map((item) => `#${item}`)
    .join(" ");

  const opener = params.tone === "professional"
    ? "이번 카드뉴스에서 꼭 확인해야 할 핵심 포인트를 정리했습니다."
    : params.tone === "trendy"
      ? "이번 카드뉴스, 저장각 포인트만 감도 있게 정리해봤어요."
      : "이번 카드뉴스 핵심만 보기 좋게 정리해봤어요.";

  const angleLine = typeof params.angleHook === "string" && params.angleHook.trim().length > 0
    ? `${params.angleHook.trim()}를 중심으로 핵심만 정리했습니다.`
    : "";

  const closer = "📌 저장해두고 놓치지 마세요!";

  return [
    opener,
    angleLine,
    closer,
    hashtags || "#페스티벌 #카드뉴스",
  ]
    .filter(Boolean)
    .join("\n\n");
};

const buildCurationPrompt = (params: {
  festivals: CurationFestival[];
  theme: string;
  aspectRatio: string;
}) => `당신은 @the_qmag 인스타그램 매거진의 카드뉴스 에디터입니다.
여러 공연/페스티벌을 묶어 "${params.theme}" 테마의 큐레이션 카드뉴스를 작성하세요.

[에디토리얼 톤]
- 담담하고 확신 있는 선언체. 마침표로 끝낼 것.
- 절대 금지: "역대급", "실화냐", 이모지, 질문형 제목

[슬라이드 구조]
슬라이드 1 (COVER)
- title: "${params.theme}"
- body: 이번 큐레이션을 한 줄로 요약하는 선언체
  예) "이번 주, 놓치면 아쉬운 공연들."
- textPosition: "bottom"

슬라이드 2~${params.festivals.length + 1} (각 행사 소개)
- 행사마다 슬라이드 1장씩
- title: 행사명 20자 이내
- body: 날짜, 장소, 핵심 정보 2~3줄
  예) "3월 26일 단 하루.\\n롤링홀.\\n1일권 55,000원."
- textPosition: "top"

슬라이드 ${params.festivals.length + 2} (CTA)
- title: "더 알아보기"
- body: "저장해두고\\n하나씩 확인해봐."
- textPosition: "bottom"

[행사 데이터]
${params.festivals.map((f, i) => `
행사 ${i + 1}:
- 제목: ${f.title}
- 일정: ${f.startDate} ~ ${f.endDate}
- 장소: ${f.location}
- 장르: ${f.genre}
${f.lineup ? `- 라인업: ${f.lineup}` : ''}
${f.price ? `- 가격: ${f.price}` : ''}
`.trim()).join('\n\n')}

[응답 형식] JSON만 출력. 마크다운 없이.
슬라이드 수: 정확히 ${params.festivals.length + 2}개
{
  "slides": [
    {
      "title": "헤드라인",
      "body": "본문 내용",
      "keywords": "curation concert festival poster korean",
      "textPosition": "bottom"
    }
  ]
}`;

const buildCaptionPrompt = (params: {
  slides: Array<Record<string, unknown>>;
  content: string;
  style?: string;
  target?: string;
  genre?: string;
  source?: string;
  sourceLabel?: string;
  tone?: string;
  captionStyle?: string;
  aspectRatio?: string;
}) => {
  const slideSummary = params.slides
    .map((slide, index) => {
      const title = typeof slide.title === "string" ? slide.title.trim() : "";
      const body = typeof slide.body === "string"
        ? slide.body.trim()
        : (typeof slide.content === "string" ? slide.content.trim() : "");
      return `[슬라이드 ${index + 1}]
- 제목: ${title || "-"}
- 내용: ${body || "-"}`;
    })
    .join("\n\n");

  return `
당신은 한국 인스타그램 카드뉴스용 캡션을 작성하는 콘텐츠 에디터입니다.
아래 카드뉴스 기획안과 원문 정보를 바탕으로, 게시 직전에 바로 사용할 수 있는 인스타그램 캡션을 작성하세요.

[목표]
- 카드뉴스 내용을 3~5문장 내외로 자연스럽게 소개
- 저장/공유를 유도하는 마무리 문장 포함
- 너무 장황하지 않고, 실제 브랜드 운영자가 바로 붙여넣을 수 있는 톤 유지

[톤/스타일 기준]
- ${getToneGuide(params.tone)}
- ${getCaptionStyleGuide(params.captionStyle)}
- 카드 레이아웃 비율은 ${params.aspectRatio || "4:5"} 기준입니다. ${getAspectRatioGuide(params.aspectRatio)}

[작성 규칙]
1. 결과는 캡션 본문만 출력하세요. 설명, 제목, 따옴표, 마크다운은 금지합니다.
2. 말투는 ${params.target || "일반 독자"}에게 자연스럽게 읽히는 한국어 마케팅 톤으로 작성하세요.
3. 스타일은 ${params.style || "카드뉴스"} 톤을 유지하세요.
4. 장르/카테고리(${params.genre || "일반"}) 특성이 보이게 작성하세요.
5. 마지막에는 해시태그 3~5개를 자연스럽게 붙이세요.
6. "Canva", "카드뉴스 제작", "업로드", "Source:" 같은 내부 작업 흔적은 절대 포함하지 마세요.

[원문 정보]
${params.content}

[카드뉴스 기획안]
${slideSummary}
`;
};

const generateCaptionFromSlides = async (params: {
  slides: Array<Record<string, unknown>>;
  content: string;
  style?: string;
  target?: string;
  genre?: string;
  source?: string;
  sourceLabel?: string;
  tone?: string;
  captionStyle?: string;
  aspectRatio?: string;
  angleHook?: string | null;
}) => {
  try {
    const result = await geminiFlashModel.generateContent(buildCaptionPrompt(params));
    const response = await result.response;
    const text = response.text().trim();
    if (text) {
      return text;
    }
  } catch (error) {
    console.warn("Failed to generate caption alongside slides. Falling back to rule-based caption.", error);
  }

  return buildRuleBasedCaption({
    slides: params.slides,
    sourceLabel: params.sourceLabel || params.source,
    genre: params.genre,
    tone: params.tone,
    captionStyle: params.captionStyle,
    angleHook: params.angleHook,
  });
};

const generateWithFreeAi = async (prompt: string, requestedSlideCount: number | null) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FREE_AI_TIMEOUT_MS);
  try {
    const countForBudget = requestedSlideCount ?? DEFAULT_SLIDE_COUNT;
    const maxTokens = Math.min(Math.max(1200, 500 + countForBudget * 180), 3200);
    const response = await fetch(FREE_AI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: FREE_AI_MODEL,
        reasoning_effort: FREE_AI_REASONING_EFFORT,
        max_tokens: maxTokens,
        temperature: 0.7,
        messages: [
          {
            role: "system",
            content:
              "You are an Instagram card-news planner for Korean audiences. Return strict JSON only.",
          },
          {
            role: "user",
            content: buildFreeAiPrompt(prompt, requestedSlideCount),
          },
        ],
      }),
      signal: controller.signal,
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(`Free AI request failed (${response.status}): ${rawText.slice(0, 500)}`);
    }

    // OpenAI-like completion format; fallback to raw response if format differs.
    try {
      const parsed = JSON.parse(rawText) as {
        choices?: Array<{
          finish_reason?: string;
          message?: { content?: string; reasoning_content?: string };
        }>;
      };
      const firstChoice = parsed.choices?.[0];
      const content = firstChoice?.message?.content;
      if (typeof content === "string" && content.trim().length > 0) {
        return content.trim();
      }

      // Some free models send only reasoning_content. If JSON appears there, salvage it.
      const reasoning = firstChoice?.message?.reasoning_content;
      if (typeof reasoning === "string" && reasoning.includes("{") && reasoning.includes("}")) {
        try {
          return extractJsonText(reasoning);
        } catch {
          // keep going
        }
      }

      if (firstChoice?.finish_reason === "length") {
        throw new Error("Free AI response was truncated before final JSON output.");
      }
    } catch {
      // Ignore and treat the response as plain text.
    }
    return rawText;
  } finally {
    clearTimeout(timeoutId);
  }
};

const generateSlidesText = async (
  selectedModel: typeof geminiFlashModel,
  prompt: string,
  requestedSlideCount: number | null,
): Promise<SlideGenerationResult> => {
  try {
    const result = await selectedModel.generateContent(prompt);
    const response = await result.response;
    return { text: response.text(), provider: "gemini" };
  } catch (geminiError) {
    if (!isQuotaExceededError(geminiError)) {
      throw geminiError;
    }
    console.warn("Gemini quota exceeded. Falling back to free AI provider.");
    const text = await generateWithFreeAi(prompt, requestedSlideCount);
    return { text, provider: "free-ai" };
  }
};

export async function POST(req: NextRequest) {
  try {
    const uid = await getUidFromRequest(req);
    if (!uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = await req.json() as Record<string, unknown>;
    const content = asNonEmptyString(payload?.content);
    const style = asNonEmptyString(payload?.style) || undefined;
    const target = asNonEmptyString(payload?.target) || undefined;
    const aspectRatio = asNonEmptyString(payload?.aspectRatio) || "4:5";
    const genre = asNonEmptyString(payload?.genre) || undefined;
    const source = asNonEmptyString(payload?.source) || undefined;
    const sourceLabel = asNonEmptyString(payload?.sourceLabel) || undefined;
    const imageUrl = asNonEmptyString(payload?.imageUrl) || undefined;
    const requestedSlideCount = toSafeSlideCount(payload?.slideCount);
    const slideCount = requestedSlideCount ?? 0; // 0이면 AI가 자율 결정
    const generationSlideCount = requestedSlideCount ?? DEFAULT_SLIDE_COUNT;
    const guideSlideCount = requestedSlideCount ?? DEFAULT_SLIDE_COUNT;
    const guideInfoSlideEnd = Math.max(guideSlideCount - 1, 3);
    const tone = asNonEmptyString(payload?.tone) || "friendly";
    const captionStyle = asNonEmptyString(payload?.captionStyle) || "balanced";
    const angle = typeof payload.angle === "string" ? payload.angle : null;
    const angleHook = typeof payload.angleHook === "string" ? payload.angleHook : null;
    const sourceText = sourceLabel || source || "입력 데이터";
    const festivalTitle = extractFestivalTitle(content || "");

    // 큐레이션 모드 분기
    const isCuration = payload?.mode === "curation";
    const curationFestivals = Array.isArray(payload?.festivals)
      ? payload.festivals.map(toCurationFestival).filter((item): item is CurationFestival => Boolean(item))
      : [];
    const curationTheme = typeof payload?.theme === "string" ? payload.theme : "이번 주 공연 소식";

    if (isCuration && curationFestivals.length > 0) {
      const curationPrompt = buildCurationPrompt({
        festivals: curationFestivals,
        theme: curationTheme,
        aspectRatio: asNonEmptyString(payload?.aspectRatio) || "4:5",
      });
      const selectedModel = geminiFlashModel;
      const result = await generateSlidesText(selectedModel, curationPrompt, curationFestivals.length + 2);
      const rawSlides = parseSlidesFromAiText(result.text).slice(0, curationFestivals.length + 2);
      const mappedSlides = rawSlides.map((rawSlide, index) => {
        const slide = { ...rawSlide } as Record<string, unknown>;
        const festival = index >= 1 && index <= curationFestivals.length ? curationFestivals[index - 1] : null;
        const posterUrl = festival?.imageUrl;
        if (posterUrl) {
          slide.image = posterUrl;
          slide.imageUrl = posterUrl;
        }
        return slide;
      });
      const curationContent = [
        `테마: ${curationTheme}`,
        ...curationFestivals.map((festival, index) =>
          `${index + 1}. ${festival.title}\n- 일정: ${festival.startDate} ~ ${festival.endDate}\n- 장소: ${festival.location}\n- 장르: ${festival.genre}`,
        ),
      ].join("\n\n");
      const caption = mappedSlides.length > 0
        ? await generateCaptionFromSlides({
          slides: mappedSlides,
          content: curationContent,
          style,
          target,
          aspectRatio,
          genre,
          source,
          sourceLabel,
          tone,
          captionStyle,
          angleHook,
        })
        : "";

      let draftId: string | null = null;
      if (mappedSlides.length > 0) {
        try {
          draftId = await createDraftCardnews({
            uid,
            slides: mappedSlides,
            caption,
            content: curationContent,
            style,
            target,
            aspectRatio,
            genre,
            source,
            sourceLabel,
            imageUrl: curationFestivals[0]?.imageUrl,
            tone,
            captionStyle,
            slideCount: mappedSlides.length,
          });
        } catch (draftError) {
          console.warn("Failed to persist curation cardnews draft:", draftError);
        }
      }

      return NextResponse.json({ slides: mappedSlides, caption, draftId, provider: result.provider, mode: "curation" });
    }

    if (!content) {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }

    const isTrendySource = source === "FESTIVAL_LIFE";
    const trendyContext = isTrendySource
      ? `\n- 특이사항: 이 정보는 MZ세대에게 가장 핫한 트렌디 매체(페스티벌 라이프)에서 수집되었습니다. 더욱 힙하고 바이럴될 수 있는 톤앤매너를 유지하세요.`
      : `\n- 특이사항: 이 정보는 ${sourceText}에서 제공된 검증된 문화예술 정보입니다.`;

    // Define adaptive planning guide based on slide count
    let slideGuide = "";
    if (guideSlideCount <= 3) {
      slideGuide = `[초간결 숏폼 모드 (1-3장)]
- 목표: 핵심 요약과 강렬한 인상
- 가이드: 텍스트를 최소화하고 비주얼 키워드 중심으로 구성하세요. 호흡이 매우 빨라야 합니다.`;
    } else if (guideSlideCount <= 10) {
      slideGuide = `[슬라이드 역할 분배 - 반드시 이 순서를 따르세요]
슬라이드 1 (COVER): 행사명을 강렬하게. body는 반드시 빈 문자열.
슬라이드 2 (HOOK): 이 행사를 봐야 하는 이유 한 문장. 숫자나 구체적 사실 기반으로.
슬라이드 3~${guideInfoSlideEnd} (INFO): 슬라이드마다 딱 하나의 정보만 다루세요.
  - 일정/장소, 라인업, 티켓 가격/예매처, 주의사항 등 각각 분리.
  - 반드시 입력 데이터에 있는 실제 정보를 그대로 사용하세요.
  - 없는 정보는 만들어내지 마세요.
슬라이드 ${guideSlideCount} (CTA): 저장/공유/예매 유도로 마무리.`;
    } else {
      slideGuide = `[딥다이브 매거진 모드 (11-20장)]
- 목표: 종합 가이드 및 심층 정보
- 가이드: 페스티벌 라인업, 타임테이블, 준비물, 근처 맛집, 꿀팁 등 모든 세부 정보를 스토리텔링 형식으로 연결하세요. 페이지 간의 연결성을 극대화하세요.`;
    }

    const angleContext = angle && angleHook
      ? `\n[앵글 전략 - 최우선 적용]\n이 카드뉴스는 "${angleHook}" 메시지를 중심으로 구성해야 합니다.\n첫 슬라이드부터 마지막 슬라이드까지 이 앵글 하나로 일관되게 만들어주세요.\n정보를 나열하지 말고, 선택한 앵글의 감정과 메시지가 전달되도록 카피를 작성하세요.\n`
      : "";

    const slideCountGuide = slideCount > 0
      ? `슬라이드 수: 정확히 ${slideCount}장`
      : `슬라이드 수: 입력된 행사 정보량을 분석해서 3~10장 사이에서 최적 수를 직접 결정하세요.
  - 정보가 풍부하면 (라인업, 티켓, 장소, 일정 등 다수) → 6~10장
  - 정보가 적으면 (제목, 날짜, 장소 정도) → 3~5장
  - 억지로 채우거나 자르지 말 것. 슬라이드마다 실제 내용이 있어야 함.`;

    const prompt = `
당신은 @the_qmag 인스타그램 매거진의 카드뉴스 에디터입니다.
공연·페스티벌 정보를 에디토리얼 스타일로 정리해 카드뉴스 기획안을 작성하세요.
${trendyContext}

${angleContext}

[에디토리얼 톤 기준 - 반드시 준수]
- 공연/페스티벌 매거진 에디터 시점으로 작성
- 담담하고 확신 있는 선언체
- 슬라이드 문장에서는 마침표(.)를 사용하지 말 것
- 과장 없이 행사의 본질을 전달
- 절대 금지: "실화냐", "역대급", "대박", "어떻게", 질문형 제목(~냐?), 이모지
- 절대 금지: "~할 수 있습니다", "~해보세요" 같은 서술형/권유형

[슬라이드 역할 - 반드시 이 구조를 따를 것]
슬라이드 1 (COVER)
- title: 행사명 20자 이내
- body: 이 행사의 본질을 담은 1~2줄 선언체
  좋은 예: "롤링 31주년을 기념하는 하루\n단 한 번의 무대"
  좋은 예: "5월의 마지막 주말\n문화비축기지가 무대가 된다"
  나쁜 예: "" (빈 문자열 금지)
  나쁜 예: "역대급 라인업이 온다!"
- textPosition: "bottom"

슬라이드 2 (HOOK)
- title: 이 행사를 봐야 하는 이유 한 줄
- body: 구체적 사실이나 숫자 기반 선언. 감정을 자극하되 과장 없이
  좋은 예: "단 하루만\n김늑과 함께\n후회 없는 밤이다"
- textPosition: "center"

슬라이드 3~${guideInfoSlideEnd} (INFO)
- 슬라이드마다 딱 하나의 정보만 다룰 것
  일정/장소 슬라이드, 라인업 슬라이드, 티켓/예매 슬라이드 등 각각 분리
- title: 정보 카테고리명 (예: "언제, 어디서", "라인업", "티켓 정보")
- body: 입력 데이터의 실제 정보를 그대로 사용
  좋은 예: "2026년 5월 30~31일\n서울 문화비축기지\n1일권 121,000원"
  나쁜 예: "상세 정보 참조" "추후 공개"
- 없는 정보는 절대 만들어내지 말 것
- textPosition: "top"

슬라이드 ${guideSlideCount} (CTA)
- title: 저장/예매/공유 유도 한 줄
- body: 짧고 명확한 행동 유도
  좋은 예: "친구 태그하고\n같이 가자"
- textPosition: "bottom"

[텍스트 제약]
- title: 20자 이내
- body: 최대 3줄, 한 줄 15자 이내, 줄바꿈은 \\n 사용
- 문장 내 마침표(.) 사용 금지
- 각 슬라이드는 반드시 이전 슬라이드와 다른 내용
- "Source:", "Canva" 등 내부 문구 절대 금지

[입력 정보 활용 규칙]
- 장소, 날짜, 가격, 예매처 등 실제 데이터가 있으면 반드시 그대로 사용
- 없는 정보는 절대 만들어내지 말 것
- 내용: ${content}
- 장르: ${genre || "일반"}
- 스타일: ${style || "카드뉴스"}
- 타겟: ${target || "일반 독자"}
- 비율: ${aspectRatio} → ${getAspectRatioGuide(aspectRatio)}
${slideCountGuide}

${slideGuide}

[응답 형식] JSON만 출력. 마크다운·설명문 없이.
슬라이드 수는 위 가이드에 따라 결정.
{
  "slides": [
    {
      "title": "헤드라인",
      "body": "본문 내용",
      "keywords": "image generation keywords in english",
      "textPosition": "bottom"
    }
  ]
}
`;

    // Model selection: Use Pro for 15+ slides
    const selectedModel = generationSlideCount >= 15 ? geminiProModel : geminiFlashModel;
    console.log(
      `Using model: ${generationSlideCount >= 15 ? "Gemini Pro-tier" : "Gemini Flash-tier"} for ${requestedSlideCount ?? "auto"} slides`,
    );

    let aiProvider: SlideGenerationProvider = "gemini";
    let safeSlides: GeneratedSlide[] = [];
    let validationIssues: string[] = [];
    let passedValidation = false;
    let currentPrompt = prompt;
    let currentValidationSlideCount = generationSlideCount;

    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
      let generationResult: SlideGenerationResult;
      try {
        generationResult = await generateSlidesText(selectedModel, currentPrompt, requestedSlideCount);
      } catch (generationError) {
        console.warn(`Slide generation failed at attempt ${attempt}.`, generationError);
        if (attempt === MAX_GENERATION_ATTEMPTS) {
          break;
        }
        currentPrompt = buildRepairPrompt({
          originalPrompt: prompt,
          previousSlides: safeSlides.length > 0
            ? safeSlides
            : buildRuleBasedSlides(content, currentValidationSlideCount, festivalTitle),
          blockingIssues: [
            generationError instanceof Error
              ? generationError.message
              : "모델 호출 실패로 재시도합니다.",
          ],
          slideCount: currentValidationSlideCount,
        });
        continue;
      }

      const usedFreeAiFallback = generationResult.provider === "free-ai";
      if (usedFreeAiFallback) {
        aiProvider = "free-ai";
      }

      let rawSlides: Array<Record<string, unknown>>;
      try {
        rawSlides = parseSlidesFromAiText(generationResult.text);
      } catch (parseError) {
        validationIssues = [
          parseError instanceof Error ? `JSON 파싱 실패: ${parseError.message}` : "JSON 파싱 실패",
        ];
        if (usedFreeAiFallback) {
          validationIssues.push("쿼터 초과로 free-ai 폴백 응답 파싱에 실패해 재시도를 생략했습니다.");
          break;
        }
        if (attempt === MAX_GENERATION_ATTEMPTS) {
          break;
        }
        currentPrompt = buildRepairPrompt({
          originalPrompt: prompt,
          previousSlides: safeSlides.length > 0
            ? safeSlides
            : buildRuleBasedSlides(content, currentValidationSlideCount, festivalTitle),
          blockingIssues: validationIssues,
          slideCount: currentValidationSlideCount,
        });
        continue;
      }

      currentValidationSlideCount = requestedSlideCount
        ?? Math.min(Math.max(rawSlides.length, 3), 10);
      const validated = validateAndNormalizeSlides({
        rawSlides,
        slideCount: currentValidationSlideCount,
        festivalTitle,
        imageUrl,
      });
      safeSlides = validated.slides;
      validationIssues = validated.blockingIssues;

      if (validationIssues.length === 0) {
        passedValidation = true;
        break;
      }
      if (usedFreeAiFallback) {
        // Gemini quota-exceeded 상태에서는 동일 요청 재시도로 품질 개선이 거의 없어 지연만 증가함.
        break;
      }
      if (attempt === MAX_GENERATION_ATTEMPTS) {
        break;
      }

      currentPrompt = buildRepairPrompt({
        originalPrompt: prompt,
        previousSlides: safeSlides,
        blockingIssues: validationIssues,
        slideCount: currentValidationSlideCount,
      });
    }

    if (!passedValidation) {
      if (safeSlides.length === 0) {
        safeSlides = buildRuleBasedSlides(content, currentValidationSlideCount, festivalTitle);
        validationIssues = ["검증 가능한 슬라이드를 생성하지 못해 규칙 기반 결과로 대체했습니다."];
      } else {
        console.warn("Returning best-effort slides after validation retries.", validationIssues);
      }
    }

    // Keep first-slide image fields for downstream preview/publishing compatibility.
    if (imageUrl && safeSlides.length > 0) {
      safeSlides[0].imageUrl = imageUrl;
      (safeSlides[0] as GeneratedSlide & { image?: string }).image = imageUrl;
    }

    const caption = safeSlides.length > 0
      ? await generateCaptionFromSlides({
        slides: safeSlides,
        content,
        style,
        target,
        aspectRatio,
        genre,
        source,
        sourceLabel,
        tone,
        captionStyle,
        angleHook,
      })
      : "";

    let draftId: string | null = null;
    if (safeSlides.length > 0) {
      try {
        draftId = await createDraftCardnews({
          uid,
          slides: safeSlides,
          caption,
          content,
          style,
          target,
          genre,
          source,
          sourceLabel,
          imageUrl,
          slideCount: safeSlides.length,
        });
      } catch (draftError) {
        console.warn("Failed to persist cardnews draft:", draftError);
      }
    }

    return NextResponse.json({ slides: safeSlides, caption, draftId, aiProvider, validationIssues });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    console.error("AI Generation Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
