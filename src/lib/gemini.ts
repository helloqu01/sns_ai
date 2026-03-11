import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.NEXT_PUBLIC_GEMINI_API_KEY?.trim() || "";
const genAI = new GoogleGenerativeAI(apiKey);

// Flash model: gemini-2.5-flash (기본 슬라이드 생성 + 캡션)
export const geminiFlashModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// Pro model: gemini-2.5-pro (15장 이상 고품질 생성)
export const geminiProModel = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

// Default export for backward compatibility
export const geminiModel = geminiFlashModel;
