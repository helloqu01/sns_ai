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

type GeneratedSlide = {
  title: string;
  body: string;
  keywords: string;
};

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

const forceSentenceEnding = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) return "핵심 정보를 확인하세요.";
  if (/[다요]$/.test(trimmed)) return trimmed;
  return `${trimmed}다`;
};

const buildRuleBasedSlides = (
  content: string,
  slideCount: number,
  source?: string,
): GeneratedSlide[] => {
  const sourceText = source?.trim() || "입력 데이터";
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
      ? "핵심 기획안"
      : `포인트 ${i + 1}`;
    const bodyCore = forceSentenceEnding(piece);
    slides.push({
      title: title.slice(0, 20),
      body: `${bodyCore}\nSource: ${sourceText}`,
      keywords: "festival event poster social media korean campaign",
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

  const closer = params.captionStyle === "promotional"
    ? "저장해두고 Canva에서 마무리한 뒤 바로 업로드해보세요."
    : params.captionStyle === "minimal"
      ? "저장해두고 필요할 때 바로 꺼내보세요."
      : "저장해두고 Canva에서 문구를 조금만 다듬어 바로 활용해보세요.";

  return [
    opener,
    titles.length > 0 ? `오늘 체크할 포인트: ${titles.join(" · ")}` : null,
    closer,
    params.sourceLabel ? `Source: ${params.sourceLabel}` : null,
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
6. 출처가 있으면 본문 마지막 근처에 "Source: ${params.sourceLabel || params.source}"를 한 번 포함하세요.

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

export async function POST(req: NextRequest) {
  try {
    const uid = await getUidFromRequest(req);
    if (!uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const {
      content,
      style,
      target,
      aspectRatio = "4:5",
      genre,
      source,
      sourceLabel,
      imageUrl,
      slideCount = 6,
      tone = "friendly",
      captionStyle = "balanced",
    } = await req.json();

    if (!content) {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }

    const isTrendySource = source === 'FESTIVAL_LIFE';
    const trendyContext = isTrendySource
      ? `\n- 특이사항: 이 정보는 MZ세대에게 가장 핫한 트렌디 매체(페스티벌 라이프)에서 수집되었습니다. 더욱 힙하고 바이럴될 수 있는 톤앤매너를 유지하세요.`
      : `\n- 특이사항: 이 정보는 ${sourceLabel || source}에서 제공된 검증된 문화예술 정보입니다.`;

    // Define adaptive planning guide based on slide count
    let slideGuide = "";
    if (slideCount <= 3) {
      slideGuide = `[초간결 숏폼 모드 (1-3장)]
- 목표: 핵심 요약과 강렬한 인상
- 가이드: 텍스트를 최소화하고 비주얼 키워드 중심으로 구성하세요. 호흡이 매우 빨라야 합니다.`;
    } else if (slideCount <= 10) {
      slideGuide = `[표준 매거진 모드 (4-10장)]
- 목표: 기승전결이 있는 정석 구조
- 구조: 도입(1) - 문제제기/흥미유발(1) - 정보전달(2~${slideCount - 2}) - 마무리/CTA(1)`;
    } else {
      slideGuide = `[딥다이브 매거진 모드 (11-20장)]
- 목표: 종합 가이드 및 심층 정보
- 가이드: 페스티벌 라인업, 타임테이블, 준비물, 근처 맛집, 꿀팁 등 모든 세부 정보를 스토리텔링 형식으로 연결하세요. 페이지 간의 연결성을 극대화하세요.`;
    }

    const prompt = `
당신은 인스타그램 카드뉴스 제작 전문가입니다.
제공된 내용을 바탕으로 아래 '분량별 기획 가이드'에 맞게 카드뉴스 기획안을 작성해주세요.${trendyContext}
출처 정보: ${sourceLabel || source}

[제작 원칙]
1. 각 슬라이드의 'Caption' 마지막 줄에는 반드시 "Source: ${sourceLabel || source}"를 포함하세요.
2. 장르(${genre})의 특성을 살려 타겟(${target})에게 매력적으로 보이도록 작성하세요.
3. 반드시 요청한 개수(${slideCount}개)의 슬라이드를 생성하세요.
4. 최종 결과물은 ${aspectRatio} 배율에 맞게 텍스트 길이와 정보량을 조절하세요.

${slideGuide}

[레이아웃 기준]
- 최종 카드 비율: ${aspectRatio}
- ${getAspectRatioGuide(aspectRatio)}

[입력 정보]
- 내용: ${content}
- 장르/카테고리: ${genre || '일반'}
- 뉴스레터 스타일: ${style}
- 타겟 독자: ${target}
- 캡션 톤: ${tone}
- 캡션 스타일: ${captionStyle}

[텍스트 제약 조건]
- Headline (title): 반드시 20자 이내로 작성.
- Body: 가독성을 위해 불필요한 미사여구를 빼고 '다', '요'로 끝나는 명확한 문장 사용.
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
    console.log(`Using model: ${slideCount >= 15 ? 'Gemini 1.5 Pro' : 'Gemini 1.5 Flash'} for ${slideCount} slides`);

    let text = "";
    let aiProvider: "gemini" | "free-ai" = "gemini";
    try {
      const result = await selectedModel.generateContent(prompt);
      const response = await result.response;
      text = response.text();
    } catch (geminiError) {
      if (!isQuotaExceededError(geminiError)) {
        throw geminiError;
      }
      console.warn("Gemini quota exceeded. Falling back to free AI provider.");
      aiProvider = "free-ai";
      try {
        text = await generateWithFreeAi(prompt, slideCount);
      } catch (freeAiError) {
        console.warn("Free AI provider failed. Falling back to rule-based slide generator.", freeAiError);
        text = JSON.stringify({
          slides: buildRuleBasedSlides(content, slideCount, sourceLabel || source),
        });
      }
    }

    let data: { slides?: Array<Record<string, unknown>> } = {};
    try {
      data = JSON.parse(extractJsonText(text));
    } catch (parseError) {
      if (aiProvider !== "free-ai") {
        throw parseError;
      }
      console.warn("Failed to parse free AI JSON. Using rule-based slides.", parseError);
      data = {
        slides: buildRuleBasedSlides(content, slideCount, sourceLabel || source),
      };
    }

    // Inject imageUrl into the first slide (Intro) if provided
    if (imageUrl && data.slides && data.slides.length > 0) {
      data.slides[0].image = imageUrl;
    }

    // Data Integrity Validation: Check if count matches
    if (data.slides && data.slides.length !== slideCount) {
      console.warn(`AI generated ${data.slides.length} slides, but ${slideCount} were requested. Adjusting...`);
      // If AI failed to match count, we might need a fallback or just return what we got
      // For now, we return as is but log the inconsistency
    }

    const safeSlides = Array.isArray(data.slides) ? data.slides : [];
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

    return NextResponse.json({ ...data, slides: safeSlides, caption, draftId, aiProvider });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    console.error("AI Generation Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
