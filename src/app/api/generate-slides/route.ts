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
const MIN_SLIDE_COUNT = 1;
const MAX_SLIDE_COUNT = 20;
const MAX_GENERATION_ATTEMPTS = 3;
const DEFAULT_KEYWORDS = "festival event poster social media korean campaign";

type GeneratedSlide = {
  title: string;
  body: string;
  keywords: string;
};

type SlideGenerationProvider = "gemini" | "free-ai";
type SlideGenerationResult = { text: string; provider: SlideGenerationProvider };
type SlideValidationResult = { slides: GeneratedSlide[]; blockingIssues: string[] };

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const toSafeSlideCount = (value: unknown) => {
  const parsed = typeof value === "number"
    ? value
    : Number.parseInt(typeof value === "string" ? value : String(DEFAULT_SLIDE_COUNT), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SLIDE_COUNT;
  const rounded = Math.round(parsed);
  return Math.min(Math.max(rounded, MIN_SLIDE_COUNT), MAX_SLIDE_COUNT);
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

const sanitizeSlideBody = (body: string) => {
  const normalizedBody = body.trim();
  return normalizedBody.replace(/\n?Source:\s*.+$/i, "").trim();
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

const buildFreeAiPrompt = (prompt: string, slideCount: number) => `${prompt}

[추가 필수 규칙]
- 마크다운, 코드블록, 설명문 없이 JSON만 출력하세요.
- 반드시 slides 배열 길이는 정확히 ${slideCount}여야 합니다.
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
      : sanitizeSlideBody(forceSentenceEnding(rawBody || "핵심 정보를 확인하세요."));

    slides.push({
      title,
      body,
      keywords: rawKeywords || DEFAULT_KEYWORDS,
    });
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

const forceSentenceEnding = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) return "핵심 정보를 확인하세요.";
  if (/[다요]$/.test(trimmed)) return trimmed;
  return `${trimmed}다`;
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
    const bodyCore = i === 0 ? "" : forceSentenceEnding(piece);
    slides.push({
      title: i === 0 ? title : title.slice(0, 20),
      body: bodyCore,
      keywords: DEFAULT_KEYWORDS,
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

  const closer = "📌 저장해두고 놓치지 마세요!";

  return [
    opener,
    closer,
    hashtags || "#페스티벌 #카드뉴스",
  ]
    .filter(Boolean)
    .join("\n\n");
};

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
  });
};

const generateWithFreeAi = async (prompt: string, slideCount: number) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FREE_AI_TIMEOUT_MS);
  try {
    const maxTokens = Math.min(Math.max(1200, 500 + slideCount * 180), 3200);
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
            content: buildFreeAiPrompt(prompt, slideCount),
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
  slideCount: number,
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
    const text = await generateWithFreeAi(prompt, slideCount);
    return { text, provider: "free-ai" };
  }
};

export async function POST(req: NextRequest) {
  try {
    const uid = await getUidFromRequest(req);
    if (!uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const requestBody = await req.json();
    const content = asNonEmptyString(requestBody?.content);
    const style = asNonEmptyString(requestBody?.style) || undefined;
    const target = asNonEmptyString(requestBody?.target) || undefined;
    const aspectRatio = asNonEmptyString(requestBody?.aspectRatio) || "4:5";
    const genre = asNonEmptyString(requestBody?.genre) || undefined;
    const source = asNonEmptyString(requestBody?.source) || undefined;
    const sourceLabel = asNonEmptyString(requestBody?.sourceLabel) || undefined;
    const imageUrl = asNonEmptyString(requestBody?.imageUrl) || undefined;
    const slideCount = toSafeSlideCount(requestBody?.slideCount);
    const tone = asNonEmptyString(requestBody?.tone) || "friendly";
    const captionStyle = asNonEmptyString(requestBody?.captionStyle) || "balanced";
    const sourceText = sourceLabel || source || "입력 데이터";
    const festivalTitle = extractFestivalTitle(content || "");

    if (!content) {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }

    const isTrendySource = source === "FESTIVAL_LIFE";
    const trendyContext = isTrendySource
      ? `\n- 특이사항: 이 정보는 MZ세대에게 가장 핫한 트렌디 매체(페스티벌 라이프)에서 수집되었습니다. 더욱 힙하고 바이럴될 수 있는 톤앤매너를 유지하세요.`
      : `\n- 특이사항: 이 정보는 ${sourceText}에서 제공된 검증된 문화예술 정보입니다.`;

    // Define adaptive planning guide based on slide count
    let slideGuide = "";
    if (slideCount <= 3) {
      slideGuide = `[초간결 숏폼 모드 (1-3장)]
- 목표: 핵심 요약과 강렬한 인상
- 가이드: 텍스트를 최소화하고 비주얼 키워드 중심으로 구성하세요. 호흡이 매우 빨라야 합니다.`;
    } else if (slideCount <= 10) {
      slideGuide = `[슬라이드 역할 분배 - 반드시 이 순서를 따르세요]
슬라이드 1 (COVER): 행사명을 강렬하게. 부제목 1줄 추가. 이미지 비중 최대.
슬라이드 2 (HOOK): 숫자, 질문, 또는 강한 선언형 카피. "왜 이게 지금 핫한지" 한 문장으로.
슬라이드 3~${slideCount - 1} (INFO): 슬라이드마다 딱 하나의 포인트만 다루세요.
  - 일정/장소 슬라이드, 라인업 슬라이드, 티켓 정보 슬라이드 등으로 각각 분리.
  - 절대 같은 내용을 반복하지 마세요.
슬라이드 ${slideCount} (CTA): "저장하세요" 또는 "공유하면 같이 가요" 등 행동 유도로 마무리.`;
    } else {
      slideGuide = `[딥다이브 매거진 모드 (11-20장)]
- 목표: 종합 가이드 및 심층 정보
- 가이드: 페스티벌 라인업, 타임테이블, 준비물, 근처 맛집, 꿀팁 등 모든 세부 정보를 스토리텔링 형식으로 연결하세요. 페이지 간의 연결성을 극대화하세요.`;
    }

    const prompt = `
당신은 인스타그램 카드뉴스 제작 전문가입니다.
제공된 내용을 바탕으로 아래 '분량별 기획 가이드'에 맞게 카드뉴스 기획안을 작성해주세요.${trendyContext}
출처 정보: ${sourceText}

[제작 원칙]
1. 슬라이드 1은 제목(title)에 페스티벌/공연명 "${festivalTitle}"만 넣고, body는 반드시 빈 문자열("")로 작성하세요.
2. 슬라이드 2부터는 각 슬라이드의 body에 핵심 메시지만 작성하고 "Source:" 표기는 넣지 마세요.
3. 장르(${genre || "일반"})의 특성을 살려 타겟(${target || "일반 독자"})에게 매력적으로 보이도록 작성하세요.
4. 반드시 요청한 개수(${slideCount}개)의 슬라이드를 생성하세요.
5. 최종 결과물은 ${aspectRatio} 배율에 맞게 텍스트 길이와 정보량을 조절하세요.
6. 슬라이드 텍스트에 "Source:", "Canva", 내부 제작 도구 관련 문구를 절대 포함하지 마세요.

${slideGuide}

[레이아웃 기준]
- 최종 카드 비율: ${aspectRatio}
- ${getAspectRatioGuide(aspectRatio)}

[입력 정보]
- 내용: ${content}
- 장르/카테고리: ${genre || "일반"}
- 뉴스레터 스타일: ${style || "카드뉴스"}
- 타겟 독자: ${target || "일반 독자"}
- 캡션 톤: ${tone}
- 캡션 스타일: ${captionStyle}

[텍스트 제약 조건]
- Headline (title): 반드시 20자 이내로 작성.
- Body:
  - 최대 3줄. 한 줄에 15자 이내를 권장.
  - 줄바꿈(\\n)으로 리듬을 만드세요. 한 문장이 한 줄.
  - 설명하지 말고 선언하세요. "~할 수 있습니다" 같은 서술형 금지.
  - 각 슬라이드는 반드시 이전 슬라이드와 다른 내용을 다뤄야 합니다.
  - 좋은 예: "딱 2일만 열려요.\\n매년 매진되는 그 페스타.\\n올해도 어김없이."
  - 나쁜 예: "행사명: OOO 행사 일정: OOO 행사 장소: OOO"
- 모든 결과물은 한국어 마케팅 어조를 사용해야 함.

[응답 형식]
- 반드시 정확히 ${slideCount}개의 슬라이드를 포함하는 JSON 형식으로 응답해주세요.
{
  "slides": [
    {
      "title": "헤드라인",
      "body": "본문 내용",
      "keywords": "image generation keywords in english"
    }
  ]
}
`;

    // Model selection: Use Pro for 15+ slides
    const selectedModel = slideCount >= 15 ? geminiProModel : geminiFlashModel;
    console.log(`Using model: ${slideCount >= 15 ? "Gemini Pro-tier" : "Gemini Flash-tier"} for ${slideCount} slides`);

    let aiProvider: SlideGenerationProvider = "gemini";
    let safeSlides: GeneratedSlide[] = [];
    let validationIssues: string[] = [];
    let passedValidation = false;
    let currentPrompt = prompt;

    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
      let generationResult: SlideGenerationResult;
      try {
        generationResult = await generateSlidesText(selectedModel, currentPrompt, slideCount);
      } catch (generationError) {
        console.warn(`Slide generation failed at attempt ${attempt}.`, generationError);
        if (attempt === MAX_GENERATION_ATTEMPTS) {
          break;
        }
        currentPrompt = buildRepairPrompt({
          originalPrompt: prompt,
          previousSlides: safeSlides.length > 0 ? safeSlides : buildRuleBasedSlides(content, slideCount, festivalTitle),
          blockingIssues: [
            generationError instanceof Error
              ? generationError.message
              : "모델 호출 실패로 재시도합니다.",
          ],
          slideCount,
        });
        continue;
      }

      if (generationResult.provider === "free-ai") {
        aiProvider = "free-ai";
      }

      let rawSlides: Array<Record<string, unknown>>;
      try {
        rawSlides = parseSlidesFromAiText(generationResult.text);
      } catch (parseError) {
        validationIssues = [
          parseError instanceof Error ? `JSON 파싱 실패: ${parseError.message}` : "JSON 파싱 실패",
        ];
        if (attempt === MAX_GENERATION_ATTEMPTS) {
          break;
        }
        currentPrompt = buildRepairPrompt({
          originalPrompt: prompt,
          previousSlides: safeSlides.length > 0 ? safeSlides : buildRuleBasedSlides(content, slideCount, festivalTitle),
          blockingIssues: validationIssues,
          slideCount,
        });
        continue;
      }

      const validated = validateAndNormalizeSlides({
        rawSlides,
        slideCount,
        festivalTitle,
      });
      safeSlides = validated.slides;
      validationIssues = validated.blockingIssues;

      if (validationIssues.length === 0) {
        passedValidation = true;
        break;
      }
      if (attempt === MAX_GENERATION_ATTEMPTS) {
        break;
      }

      currentPrompt = buildRepairPrompt({
        originalPrompt: prompt,
        previousSlides: safeSlides,
        blockingIssues: validationIssues,
        slideCount,
      });
    }

    if (!passedValidation) {
      if (safeSlides.length === 0) {
        safeSlides = buildRuleBasedSlides(content, slideCount, festivalTitle);
        validationIssues = ["검증 가능한 슬라이드를 생성하지 못해 규칙 기반 결과로 대체했습니다."];
      } else {
        console.warn("Returning best-effort slides after validation retries.", validationIssues);
      }
    }

    // Inject imageUrl into the first slide (Intro) if provided
    if (imageUrl && safeSlides.length > 0) {
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
          slideCount,
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
