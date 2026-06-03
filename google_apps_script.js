function generateWeeklyJokeBatch() {
  const GEMINI_API_KEY = "YOUR_GEMINI_API_KEY_HERE";
  const SUPABASE_URL = "https://abupzwybtmpcreemrhjg.supabase.co";
  const SUPABASE_SERVICE_ROLE_KEY = "YOUR_SUPABASE_SERVICE_ROLE_KEY_HERE";
  const BOT_ID = "00000000-0000-0000-0000-000000000001";

  try {
    // 1. Calculate the timestamp for 7 days ago (Weekly Monday Sync)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoIso = sevenDaysAgo.toISOString();

    // 2. Fetch real user posts from the last 7 days up to a high ceiling limit of 300 rows.
    // Specifying the limit and order directly in the URL prevents Apps Script from crashing 
    // on high-activity weeks and keeps token payload within optimal ranges.
    const supabaseFetchUrl = `${SUPABASE_URL}/rest/v1/posts?user_id=neq.${BOT_ID}&created_at=gte.${sevenDaysAgoIso}&select=caption&limit=300&order=created_at.desc`;
    const fetchOptions = {
      method: "get",
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": "Bearer " + SUPABASE_SERVICE_ROLE_KEY
      },
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(supabaseFetchUrl, fetchOptions);
    let userPostCaptions = [];
    
    if (response.getResponseCode() === 200) {
      const postsData = JSON.parse(response.getContentText());
      userPostCaptions = postsData.map(p => p.caption).filter(Boolean);
    } else {
      Logger.log("Failed to fetch posts from Supabase. Code: " + response.getResponseCode());
    }

    // 3. Define the fallback topics matrix to supplement sparse or repetitive data pools
    const fallbackTopics = ["commuting", "remote work zoom calls", "modern dating apps", "streaming platform decision fatigue", "gym culture", "coffee dependency"];
    const styles = ["dry observational wit", "mildly cynical corporate satire", "relatable slice-of-life humor"];

    // 4. Construct the Intelligent Single Master Prompt
    const prompt = `You are the automated resident comedian for a social network. 
    
Your task is to analyze the following raw text snippets posted by real users on our platform over the past 7 days:
${JSON.stringify(userPostCaptions)}

INSTRUCTIONS:
1. QUANTITY: Generate exactly 7 completely distinct, high-quality jokes, witty observations, or humorous short anecdotes.
2. VAST DATA HANDLING: If the array above contains large amounts of selections (up to 300 entries), sift through the entire noise pool and cherry-pick only the absolute best, most distinct, and engaging phrases, concepts, or unique themes to build your comedy. 
3. SMART HYBRID FALLBACK & SUPPLEMENTATION MECHANISM:
   - Carefully evaluate the balance of the text snippets. If the posts are completely empty, hold too few elements, or are heavily dominated by the same 1 or 2 repetitive ideas, you MUST NOT write 7 jokes about those same repetitive concepts.
   - Extract what little unique value or keywords you can find from those posts, but then actively SUPPLEMENT the remaining quota to reach 7 items by inventing completely random, highly diverse, unpredictable topics, target audiences, and absurd everyday situations from your own imagination. You can also mix in universal subjects like ${JSON.stringify(fallbackTopics)} written in styles like ${JSON.stringify(styles)}.
   - If the user posts are completely sufficient, diverse, and plentiful enough to organically fuel 7 uniquely structured jokes, stay entirely grounded in the posts and do not inject random external subjects.
4. VARIETY: Ensure extreme internal variety. Do not repeat punchlines, joke setups, or structural tropes across the 7 items.

Return the final output strictly as a structured JSON object containing a "jokes" key holding an array of exactly 7 elements, where each element is an object with a single "caption" key.`;

    // 5. Query Gemini (Targeting your gemini-3.5-flash model endpoint)
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const geminiPayload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.85, // Balanced variance for healthy creative deviation when text pools run narrow
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            jokes: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: { caption: { type: "STRING" } },
                required: ["caption"]
              }
            }
          },
          required: ["jokes"]
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
    if (geminiResponse.getResponseCode() !== 200) {
      Logger.log("Gemini API Error: " + geminiResponse.getContentText());
      return;
    }

    const geminiJson = JSON.parse(geminiResponse.getContentText());
    const rawTextResult = geminiJson.candidates[0].content.parts[0].text;
    let parsedJokesArray = JSON.parse(rawTextResult).jokes;

    // Direct guardrail: ensure array truncation matches exactly 7 elements max
    if (parsedJokesArray.length > 7) {
      parsedJokesArray = parsedJokesArray.slice(0, 7);
    }

    // 6. Loop through the jokes and stagger their timestamps over the next 7 days (every 24 hours)
    const bulkInsertPayload = [];
    const baseTime = new Date(); // Start scheduling from right now

    for (let i = 0; i < parsedJokesArray.length; i++) {
      // 7 jokes staggered 24 hours apart perfectly spans a 168-hour (7-day) week
      const futureTimestamp = new Date(baseTime.getTime() + (i * 24 * 60 * 60 * 1000));
      
      bulkInsertPayload.push({
        user_id: BOT_ID,
        caption: parsedJokesArray[i].caption,
        image_url: null,
        visible_to: null,
        created_at: futureTimestamp.toISOString(),
        updated_at: futureTimestamp.toISOString()
      });
    }

    // 7. Bulk insert all 7 entries to Supabase in exactly ONE network request
    const supabaseInsertUrl = `${SUPABASE_URL}/rest/v1/posts`;
    const insertOptions = {
      method: "post",
      contentType: "application/json",
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
        "Prefer": "return=minimal"
      },
      payload: JSON.stringify(bulkInsertPayload),
      muteHttpExceptions: true
    };

    const insertResponse = UrlFetchApp.fetch(supabaseInsertUrl, insertOptions);
    Logger.log(`Successfully queued ${parsedJokesArray.length} jokes! Supabase Status: ` + insertResponse.getResponseCode());

  } catch(e) {
    Logger.log("Execution error: " + e.toString());
  }
}
