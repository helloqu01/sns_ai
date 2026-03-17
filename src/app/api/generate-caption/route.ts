import { NextRequest, NextResponse } from "next/server";
import { geminiFlashModel, geminiProModel } from "@/lib/gemini";
import { UnifiedFestival } from "@/types/festival";

type SlidePayload = {
  title?: unknown;
  body?: unknown;
  content?: unknown;
};

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const getToneGuide = (tone?: string) => {
  switch (tone) {
    case "professional":
      return "전문적이고 신뢰감 있는 정보 전달 중심 톤으로 작성하세요.";
    case "trendy":
      return "감각적이고 요즘 인스타그램 피드에 어울리는 트렌디한 톤으로 작성하세요.";
    default:
      return "친근하고 편안하게 읽히는 톤으로 작성하세요.";
  }
};

const getCaptionStyleGuide = (captionStyle?: string) => {
  switch (captionStyle) {
    case "magazine":
      return "매거진 에디토리얼처럼 흐름이 정돈된 스타일을 유지하세요.";
    case "promotional":
      return "참여, 저장, 클릭을 유도하는 프로모션형 문장 흐름을 사용하세요.";
    case "minimal":
      return "짧고 단정하게 핵심만 남기는 미니멀 스타일로 작성하세요.";
    default:
      return "정보성과 분위기를 균형 있게 섞은 밸런스형 스타일로 작성하세요.";
  }
};

const getAspectRatioGuide = (aspectRatio?: string) => {
  switch (aspectRatio) {
    case "1:1":
      return "정사각형 피드형 포맷이라 문장을 너무 길게 늘이지 말고 임팩트 있게 정리하세요.";
    case "16:9":
      return "가로형 배너 포맷이라 한눈에 읽히는 짧은 호흡을 유지하세요.";
    case "9:16":
      return "세로 숏폼 포맷이라 리듬감 있고 짧은 문장 위주로 구성하세요.";
    case "3:4":
      return "세로 포스터형 포맷이라 문단은 짧게 나누되 정보는 충분히 담으세요.";
    default:
      return "4:5 피드 최적 포맷이라 가독성과 정보량의 균형을 맞추세요.";
  }
};

const buildFallbackCaption = (params: {
  slides: SlidePayload[];
  content?: string;
  sourceLabel?: string;
  tone?: string;
  captionStyle?: string;
}) => {
  const titles = params.slides
    .map((slide) => asNonEmptyString(slide.title))
    .filter((title): title is string => Boolean(title))
    .slice(0, 4);

  const opener = params.tone === "professional"
    ? "이번 카드뉴스 핵심 포인트를 빠르게 정리했습니다."
    : params.tone === "trendy"
      ? "이번 카드뉴스, 저장각 포인트만 감도 있게 정리해봤어요."
      : "이번 카드뉴스 핵심만 보기 좋게 정리해봤어요.";

  const closer = params.captionStyle === "promotional"
    ? "저장해두고 바로 콘텐츠 제작에 활용해보세요."
    : params.captionStyle === "minimal"
      ? "저장해두고 필요할 때 바로 확인해보세요."
      : "저장해두고 Canva에서 마무리한 뒤 바로 활용해보세요.";

  const hashtags = (titles.length > 0 ? titles : ["페스티벌", "카드뉴스"])
    .map((item) => item.replace(/\s+/g, ""))
    .slice(0, 5)
    .map((item) => `#${item}`)
    .join(" ");

  return [
    opener,
    titles.length > 0 ? `오늘 체크할 포인트: ${titles.join(" · ")}` : asNonEmptyString(params.content),
    closer,
    hashtags || "#페스티벌 #카드뉴스",
  ]
    .filter(Boolean)
    .join("\n\n");
};

const buildSlideSummary = (slides: SlidePayload[]) =>
  slides
    .map((slide, index) => {
      const title = asNonEmptyString(slide.title) || "-";
      const body = asNonEmptyString(slide.body) || asNonEmptyString(slide.content) || "-";
      return `[슬라이드 ${index + 1}]
- 제목: ${title}
- 내용: ${body}`;
    })
    .join("\n\n");

const buildCardnewsCaptionPrompt = (params: {
  slides: SlidePayload[];
  content?: string;
  style?: string;
  target?: string;
  genre?: string;
  source?: string;
  sourceLabel?: string;
  tone?: string;
  captionStyle?: string;
  aspectRatio?: string;
}) => `
당신은 한국 인스타그램 카드뉴스용 캡션을 작성하는 콘텐츠 에디터입니다.
아래 카드뉴스 기획안과 원문 정보를 바탕으로, 게시 직전에 바로 사용할 수 있는 인스타그램 캡션을 작성하세요.

[목표]
- 카드뉴스 내용을 3~5문장 내외로 자연스럽게 소개
- 저장/공유를 유도하는 마무리 문장 포함
- 실제 브랜드 운영자가 바로 붙여넣을 수 있는 자연스러운 한국어 톤 유지

[톤/스타일 기준]
- ${getToneGuide(params.tone)}
- ${getCaptionStyleGuide(params.captionStyle)}
- 카드 배율은 ${params.aspectRatio || "4:5"}입니다. ${getAspectRatioGuide(params.aspectRatio)}

[작성 기준]
1. 결과는 캡션 본문만 출력하세요. 설명, 따옴표, 마크다운은 금지합니다.
2. 뉴스레터 스타일은 ${params.style || "카드뉴스"} 톤을 유지하세요.
3. 타겟 독자는 ${params.target || "일반 독자"}입니다.
4. 장르/카테고리(${params.genre || "일반"}) 특성이 느껴지게 작성하세요.
5. 해시태그는 아래 규칙으로 4~6개 생성하세요.
   - 행사명 기반 1개: #뷰티풀민트라이프2026
   - 아티스트/라인업 기반 1개 (있을 경우): #김늑 #찰리빈웍스
   - 장르 기반 1개: #인디페스티벌 #단독공연 #록페스티벌
   - 지역 기반 1개 (있을 경우): #서울공연 #부산공연
   - 계정 고정 태그 1개: #퀸즈스마일 or #the_qmag
   - 일반 태그 1개: #페스티벌 #공연추천 #주말뭐할까
   - 절대 금지: #페스티벌가이드 #주간페스티벌 #페스티벌소식 같은 범용 태그
   - 없는 정보로 해시태그 만들지 말 것
6. "Source:" 같은 출처 표기 문구는 캡션에 포함하지 마세요.

[원문 정보]
${params.content || "-"}

[카드뉴스 기획안]
${buildSlideSummary(params.slides)}
`;

const buildFestivalCaptionPrompt = (festivals: UnifiedFestival[], tone?: string, captionStyle?: string) => {
  const festivalDataText = festivals.map((f: UnifiedFestival, index: number) => {
    return `[페스티벌 ${index + 1}]
- 이름: ${f.title}
- 장소: ${f.location}
- 일정: ${f.startDate} ~ ${f.endDate}
- 장르: ${f.genre}
- QUEENS SMILE 서비스 여부: ${f.services && f.services.length > 0 ? f.services.join(", ") : "없음"}`;
  }).join("\n\n");

  return `
당신은 QUEENS SMILE이 운영하는 인스타그램 계정의 콘텐츠 에디터입니다.
다음 제공된 페스티벌 데이터를 바탕으로 인스타그램 피드용 캡션 본문을 작성해 주세요.

[톤/스타일 기준]
- ${getToneGuide(tone)}
- ${getCaptionStyleGuide(captionStyle)}
- 과한 분석이나 너무 긴 설명은 피하세요.

[엄격한 작성 규칙]
1. 결과는 캡션 본문만 출력하세요. 설명, 따옴표, 코드블록, 마크다운(별표/하이픈/번호 목록) 금지.
2. 반드시 아래 [크롤링된 페스티벌 데이터]에 있는 행사만 언급하세요. 없는 행사명/정보를 절대 추가하지 마세요.
3. 데이터가 1개면 그 1개만, 2개 이상이면 최대 5개까지만 요약하세요.
4. QUEENS SMILE 서비스가 있는 페스티벌에만 브랜드를 자연스럽게 언급하세요.
5. 마무리는 저장/참고를 유도하는 문장으로 끝내고, 마지막에 해시태그 3~5개를 붙이세요.
6. 날짜/장소/장르는 제공 데이터와 다르게 쓰지 마세요.

[크롤링된 페스티벌 데이터]
${festivalDataText}
`;
};

const sanitizeGeneratedCaption = (text: string) =>
  text
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .trim();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const slides = Array.isArray(body?.slides) ? body.slides as SlidePayload[] : [];
    const festivals = Array.isArray(body?.festivals) ? body.festivals as UnifiedFestival[] : [];
    const tone = asNonEmptyString(body?.tone) || "friendly";
    const captionStyle = asNonEmptyString(body?.captionStyle) || "balanced";
    const aspectRatio = asNonEmptyString(body?.aspectRatio) || "4:5";

    if (slides.length > 0 || asNonEmptyString(body?.content)) {
      const prompt = buildCardnewsCaptionPrompt({
        slides,
        content: asNonEmptyString(body?.content) || undefined,
        style: asNonEmptyString(body?.style) || undefined,
        target: asNonEmptyString(body?.target) || undefined,
        genre: asNonEmptyString(body?.genre) || undefined,
        source: asNonEmptyString(body?.source) || undefined,
        sourceLabel: asNonEmptyString(body?.sourceLabel) || undefined,
        tone,
        captionStyle,
        aspectRatio,
      });

      try {
        const result = await geminiFlashModel.generateContent(prompt);
        const response = await result.response;
        const text = response.text().trim();
        if (text) {
          return NextResponse.json({ caption: text });
        }
      } catch (error) {
        console.warn("Cardnews caption regeneration fallback:", error);
      }

      return NextResponse.json({
        caption: buildFallbackCaption({
          slides,
          content: asNonEmptyString(body?.content) || undefined,
          sourceLabel: asNonEmptyString(body?.sourceLabel) || asNonEmptyString(body?.source) || undefined,
          tone,
          captionStyle,
        }),
      });
    }

    if (festivals.length === 0) {
      return NextResponse.json({ error: "Content or festivals data is required" }, { status: 400 });
    }

    const result = await geminiProModel.generateContent(
      buildFestivalCaptionPrompt(festivals, tone, captionStyle),
    );
    const response = await result.response;
    const text = sanitizeGeneratedCaption(response.text().trim());

    return NextResponse.json({ caption: text });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    console.error("Caption Generation Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
