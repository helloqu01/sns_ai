import { NextRequest, NextResponse } from "next/server";
import { geminiFlashModel } from "@/lib/gemini";
import { getFirebaseAdmin } from "@/lib/firebase-admin-helpers";

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

const fallbackAngles = [
  { type: "VIBE",     label: "감성/분위기", hook: "이번 시즌 꼭 가야 할 이유",           description: "분위기와 경험을 중심으로 한 앵글" },
  { type: "LINEUP",   label: "라인업",      hook: "이 라인업 보고도 안 가면 후회",        description: "아티스트 기대감을 자극하는 앵글" },
  { type: "SCARCITY", label: "희소성",      hook: "딱 이번뿐, 놓치면 1년 기다려야 해",   description: "희소성으로 클릭을 유도하는 앵글" },
];

export async function POST(req: NextRequest) {
  try {
    const uid = await getUidFromRequest(req);
    if (!uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { content } = await req.json();
    if (!content) {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
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
${content}

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
      const angles = Array.isArray(parsed.angles) ? parsed.angles.slice(0, 3) : [];
      if (angles.length === 0) throw new Error("Empty angles");
      return NextResponse.json({ angles });
    } catch {
      return NextResponse.json({ angles: fallbackAngles });
    }
  } catch {
    return NextResponse.json({ angles: fallbackAngles });
  }
}
