import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI, Modality } from "@google/genai"; // ← đổi SDK

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const imageFile = form.get("image") as File | null;
    const prompt = form.get("prompt") as string;
    const apiKey = (form.get("apiKey") as string) || process.env.GEMINI_API_KEY || "";

    if (!apiKey) return NextResponse.json({ error: "Thiếu API key" }, { status: 400 });
    if (!imageFile) return NextResponse.json({ error: "Thiếu ảnh" }, { status: 400 });
    if (!prompt) return NextResponse.json({ error: "Thiếu prompt" }, { status: 400 });

    const imageBytes = await imageFile.arrayBuffer();
    const base64Image = Buffer.from(imageBytes).toString("base64");
    const mimeType = imageFile.type || "image/png";

    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash-preview-image-generation", // ← model duy nhất gen ảnh được
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data: base64Image } },
            { text: prompt },
          ],
        },
      ],
      config: {
        responseModalities: [Modality.IMAGE, Modality.TEXT], // ← bắt buộc
      },
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];

    for (const part of parts) {
      if (part.inlineData?.mimeType?.startsWith("image/")) {
        return NextResponse.json({
          success: true,
          imageData: part.inlineData.data,
          mimeType: part.inlineData.mimeType,
        });
      }
    }

    const text = parts.find((p) => p.text)?.text ?? "";
    return NextResponse.json({ error: `Gemini không trả về ảnh: ${text}` }, { status: 422 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}