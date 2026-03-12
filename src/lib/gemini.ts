import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY || "";
const genAI = new GoogleGenerativeAI(apiKey);

const flashModelName = process.env.GEMINI_FLASH_MODEL ?? "gemini-2.5-flash";
const proModelName = process.env.GEMINI_PRO_MODEL ?? "gemini-2.5-flash";

export const geminiFlashModel = genAI.getGenerativeModel({ model: flashModelName });
export const geminiProModel = genAI.getGenerativeModel({ model: proModelName });
export const geminiModel = geminiFlashModel;
