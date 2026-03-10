import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY || "";
const genAI = new GoogleGenerativeAI(apiKey);

// Flash model: Verified 'gemini-2.5-flash-lite'
export const geminiFlashModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

// Pro model: Currently using Flash as fallback due to environment naming issues with gemini-1.5-pro
export const geminiProModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

// Default export for backward compatibility
export const geminiModel = geminiFlashModel;
