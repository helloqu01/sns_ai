import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from "dotenv";
import path from "path";

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function exhaustiveTest() {
    const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    if (!apiKey) return;

    const genAI = new GoogleGenerativeAI(apiKey);
    const models = [
        "gemini-2.0-flash-lite",
        "gemini-2.0-flash",
        "gemini-exp-1206",
        "gemini-2.5-flash-lite"
    ];

    console.log("🧪 Exhaustive testing of Gemini models...");

    for (const modelName of models) {
        try {
            console.log(`📡 Testing ${modelName}...`);
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent("Hi");
            const response = await result.response;
            console.log(`✅ SUCCESS! Model ${modelName} is working.`);
            console.log(`🤖 Response: ${response.text()}`);
            return;
        } catch (e: unknown) {
            const status = typeof e === "object" && e !== null && "status" in e ? String((e as { status: unknown }).status) : "unknown";
            const message = e instanceof Error ? e.message : "Unknown error";
            console.log(`❌ FAILED ${modelName}: [${status}] ${message}`);
        }
    }

    console.log("🏁 All tests finished.");
}

exhaustiveTest();
