// Paste this directly into the script editor at script.google.com
function generateAndPostJoke() {
  const GEMINI_API_KEY = "YOUR_GEMINI_API_KEY_HERE";
  const SUPABASE_URL = "https://abupzwybtmpcreemrhjg.supabase.co";
  const SUPABASE_SERVICE_ROLE_KEY = "YOUR_SUPABASE_SERVICE_ROLE_KEY_HERE";
  const BOT_ID = "00000000-0000-0000-0000-000000000001";

  try {
    // 1. Call Gemini API
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const geminiPayload = {
      contents: [{ parts: [{ text: 'Generate exactly 1 genuinely funny joke, anecdote, or humorous statement. Return the result in structured JSON format with a single key "caption".' }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: { caption: { type: "STRING" } },
          required: ["caption"]
        }
      }
    };

    const geminiOptions = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(geminiPayload),
      muteHttpExceptions: true
    };

    const geminiResponse = UrlFetchApp.fetch(geminiUrl, geminiOptions);
    const geminiJson = JSON.parse(geminiResponse.getContentText());
    
    // Parse out the text result
    const textOutput = geminiJson.candidates[0].content.parts[0].text;
    const jokeData = JSON.parse(textOutput);
    const captionText = jokeData.caption;

    Logger.log("Generated Joke: " + captionText);

    // 2. Insert into Supabase via REST API
    const supabaseUrlTarget = `${SUPABASE_URL}/rest/v1/posts`;
    const now = new Date().toISOString();
    
    const supabasePayload = {
      user_id: BOT_ID,
      caption: captionText,
      image_url: null,
      visible_to: null,
      created_at: now,
      updated_at: now
    };

    const supabaseOptions = {
      method: "post",
      contentType: "application/json",
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
        "Prefer": "return=minimal"
      },
      payload: JSON.stringify(supabasePayload),
      muteHttpExceptions: true
    };

    const supabaseResponse = UrlFetchApp.fetch(supabaseUrlTarget, supabaseOptions);
    Logger.log("Supabase Response Code: " + supabaseResponse.getResponseCode());

  } catch(e) {
    Logger.log("Error encountered: " + e.toString());
  }
}
