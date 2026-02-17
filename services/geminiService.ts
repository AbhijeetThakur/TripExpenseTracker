
import { GoogleGenAI, Type } from "@google/genai";
import { ExpenseCategory } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const analyzeReceipt = async (base64Image: string): Promise<{ 
  title: string; 
  amount: number; 
  category: ExpenseCategory 
}> => {
  const model = 'gemini-3-flash-preview';
  
  const response = await ai.models.generateContent({
    model,
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: base64Image.split(',')[1] || base64Image,
          },
        },
        {
          text: "Analyze this receipt. Tell me the likely title of the expense, the total amount in numbers, and categorize it into one of: Food, Water, Transport, Fine, Stay, or Misc. Return as JSON."
        }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          amount: { type: Type.NUMBER },
          category: { type: Type.STRING }
        },
        required: ["title", "amount", "category"]
      }
    }
  });

  return JSON.parse(response.text);
};
