import { NextRequest, NextResponse } from "next/server";
import { geminiFlashModel } from "@/lib/gemini";
import { getFirebaseAdmin } from "@/lib/firebase-admin-helpers";
import { resolveUidFromRequest } from "@/lib/api-auth";

type SuggestedAngle = {
  type: string;
  label: string;
  hook: string;
  description: string;
};

const ANGLE_CACHE_TTL_MS = 10 * 60 * 1000;
const angleCache = new Map<string, { expiresAt: number; angles: SuggestedAngle[] }>();

const getUidFromRequest = async (req: NextRequest) => {
  const authHeader = req.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!idToken) return null;
  const admin = getFirebaseAdmin();
  if (!admin) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return decoded.uid;
  } catch {
    return null;
  }
};

const ANGLE_TYPES = [
  { type: "SCARCITY", label: "희소성",      condition: "기간 1~3일이거나 매진 이력이 있을 때" },
  { type: "LINEUP",   label: "라인업",      condition: "라인업 정보가 있을 때" },
  { type: "VIBE",     label: "감성/분위기", condition: "신규 행사이거나 분위기 중심일 때" },
  { type: "TIP",      label: "실용/꿀팁",   condition: "정보량이 많을 때" },
  { type: "VALUE",    label: "가성비",      condition: "가격 정보가 있을 때" },
  { type: "TREND",    label: "트렌드",      condition: "MZ 타겟이거나 힙한 행사일 때" },
  { type: "TOGETHER", label: "동행/공유",   condition: "축제형이거나 야외 행사일 때" },
  { type: "STORY",    label: "스토리",      condition: "5년 이상 역사가 있는 행사일 때" },
] as const;

const ANGLE_DEFINITIONS = [
  { type: "SCARCITY",  label: "희소성",      hook: (title: string) => `${title}, 이번이 마지막일 수도`,         description: "희소성으로 클릭을 유도하는 앵글",    condition: (c: string) => /매진|한정|단독|마지막|1회/.test(c) },
  { type: "LINEUP",    label: "라인업",      hook: () => "이 라인업, 다시 볼 수 없다",                         description: "아티스트 기대감을 자극하는 앵글",    condition: (c: string) => /라인업|아티스트|출연|헤드라이너|밴드|가수/.test(c) },
  { type: "VIBE",      label: "감성/분위기", hook: (title: string) => `${title} — 올해 꼭 가야 할 이유`,        description: "분위기와 경험을 중심으로 한 앵글",   condition: () => true },
  { type: "TIP",       label: "실용/꿀팁",   hook: () => "가기 전에 꼭 알아야 할 것들",                         description: "저장하고 싶은 실용 정보 앵글",       condition: (c: string) => /주차|할인|예매|팁|준비|패킹/.test(c) },
  { type: "VALUE",     label: "가성비",      hook: () => "이 퀄리티에 이 가격, 올해 최고의 선택",              description: "합리적 선택을 어필하는 앵글",        condition: (c: string) => /가격|원|무료|할인|티켓|입장료/.test(c) },
  { type: "TREND",     label: "트렌드",      hook: (title: string) => `지금 이걸 모르면 뒤처진다 — ${title}`,   description: "MZ 감성 트렌드 앵글",               condition: (c: string) => /트렌드|힙|MZ|핫|인기|버즈/.test(c) },
  { type: "TOGETHER",  label: "동행/공유",   hook: () => "혼자 가기 아까운 공연, 같이 가요",                    description: "함께 가고 싶은 감정을 자극하는 앵글", condition: (c: string) => /페스티벌|야외|축제|파티|함께/.test(c) },
  { type: "STORY",     label: "스토리",      hook: (title: string) => `${title}의 역사가 이번 무대에`,          description: "브랜드 서사와 역사를 강조하는 앵글", condition: (c: string) => /주년|역사|기념|창립|시즌/.test(c) },
];

const buildDynamicFallback = (content: string, title: string) => {
  // condition 매칭되는 앵글 우선 선택
  const matched = ANGLE_DEFINITIONS.filter((a) => a.type !== "VIBE" && a.condition(content));
  // VIBE는 항상 후보
  const vibe = ANGLE_DEFINITIONS.find((a) => a.type === "VIBE")!;

  // 매칭된 것 중 2개 + VIBE 조합, 없으면 LINEUP + SCARCITY + VIBE
  const selected = matched.length >= 2
    ? [matched[0], matched[1], vibe]
    : matched.length === 1
      ? [matched[0], vibe, ANGLE_DEFINITIONS.find((a) => a.type === "LINEUP")!]
      : [ANGLE_DEFINITIONS.find((a) => a.type === "LINEUP")!, ANGLE_DEFINITIONS.find((a) => a.type === "SCARCITY")!, vibe];

  return selected.slice(0, 3).map((a) => ({
    type: a.type,
    label: a.label,
    hook: a.hook(title),
    description: a.description,
  }));
};

const toCacheKey = (content: string) =>
  content.replace(/\s+/g, " ").trim().slice(0, 1200).toLowerCase();

const readCachedAngles = (content: string) => {
  const key = toCacheKey(content);
  const cached = angleCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt < Date.now()) {
    angleCache.delete(key);
    return null;
  }
  return cached.angles;
};

const writeCachedAngles = (content: string, angles: SuggestedAngle[]) => {
  const key = toCacheKey(content);
  angleCache.set(key, { angles, expiresAt: Date.now() + ANGLE_CACHE_TTL_MS });
};

const normalizeSuggestedAngles = (value: unknown): SuggestedAngle[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): SuggestedAngle | null => {
      if (!item || typeof item !== "object") return null;
      const raw = item as Record<string, unknown>;
      const type = typeof raw.type === "string" && raw.type.trim().length > 0 ? raw.type.trim() : "CUSTOM";
      const label = typeof raw.label === "string" ? raw.label.trim() : "";
      const hook = typeof raw.hook === "string" ? raw.hook.trim() : "";
      const description = typeof raw.description === "string" ? raw.description.trim() : "";
      if (!label && !hook && !description) return null;
      return { type, label, hook, description };
    })
    .filter((item): item is SuggestedAngle => Boolean(item))
    .slice(0, 3);
};

export async function POST(req: NextRequest) {
  let parsedContent = "";
  let parsedTitle = "이 행사";
  try {
    const uid = await resolveUidFromRequest(req);
    if (!uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = await req.json();
    const content = payload?.content;
    const title = payload?.title;
    if (!content) {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }
    const normalizedContent = typeof content === "string" ? content : String(content);
    const normalizedTitle = typeof title === "string" && title.trim().length > 0 ? title.trim() : "이 행사";
    parsedContent = normalizedContent;
    parsedTitle = normalizedTitle;

    const cachedAngles = readCachedAngles(normalizedContent);
    if (cachedAngles) {
      return NextResponse.json({ angles: cachedAngles });
    }

    const angleTypeList = ANGLE_TYPES.map(
      (a) => `- ${a.type} (${a.label}): ${a.condition}`
    ).join("\n");

    const prompt = `
당신은 인스타그램 카드뉴스 기획 전문가입니다.
아래 행사 정보를 읽고, 제시된 앵글 타입 8종 중 가장 잘 맞는 3개를 선택해주세요.

[앵글 타입 8종]
${angleTypeList}

[행사 정보]
${normalizedContent}

[작성 규칙]
1. 위 8종 중 이 행사에 가장 적합한 타입 3개를 선택하세요.
2. 각 타입에 맞는 hook은 오늘의집/무신사 스타일로 20자 이내로 작성하세요.
3. description은 이 앵글로 만들면 어떤 느낌인지 30자 이내로 작성하세요.
4. 반드시 아래 JSON 형식만 반환하세요. 설명, 마크다운 금지.

{
  "angles": [
    { "type": "타입ID", "label": "한글타입명", "hook": "훅 카피", "description": "한줄 설명" },
    { "type": "타입ID", "label": "한글타입명", "hook": "훅 카피", "description": "한줄 설명" },
    { "type": "타입ID", "label": "한글타입명", "hook": "훅 카피", "description": "한줄 설명" }
  ]
}
`;

    try {
      const result = await geminiFlashModel.generateContent(prompt);
      const text = result.response.text().trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("JSON not found");
      const parsed = JSON.parse(jsonMatch[0]);
      const angles = normalizeSuggestedAngles(parsed.angles);
      if (angles.length === 0) throw new Error("Empty angles");
      writeCachedAngles(normalizedContent, angles);
      return NextResponse.json({ angles });
    } catch {
      const dynamicFallback = buildDynamicFallback(parsedContent, parsedTitle);
      writeCachedAngles(parsedContent, dynamicFallback);
      return NextResponse.json({ angles: dynamicFallback });
    }
  } catch {
    const dynamicFallback = buildDynamicFallback(parsedContent, parsedTitle);
    return NextResponse.json({ angles: dynamicFallback });
  }
}
