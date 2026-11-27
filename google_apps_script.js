function generateWeeklyJokeBatch() {
  const GEMINI_API_KEY = "YOUR_GEMINI_API_KEY_HERE";
  const SUPABASE_URL = "https://abupzwybtmpcreemrhjg.supabase.co";
  const SUPABASE_SERVICE_ROLE_KEY = "YOUR_SUPABASE_SERVICE_ROLE_KEY_HERE";
  const BOT_ID = "00000000-0000-0000-0000-000000000001";
  const MODEL_NAME = "gemini-3.8-flash";

  const runStart = Date.now();
  const logStep = (msg) => {
    const secs = ((Date.now() - runStart) / 1000).toFixed(2);
    Logger.log(`[+${secs}s] ${msg}`);
  };

  const shuffleArray = (arr) => {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  };

  try {
    logStep(`Starting Socium Humor Department batch (model=${MODEL_NAME})`);

    // 1. Calculate the timestamp for 7 days ago (Weekly Monday Sync)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoIso = sevenDaysAgo.toISOString();

    const supabaseHeaders = {
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": "Bearer " + SUPABASE_SERVICE_ROLE_KEY
    };

    // 2. Fetch real user posts from the last 7 days (up to 300) AND the bot's own last 25 posts in parallel
    const userPostsUrl = `${SUPABASE_URL}/rest/v1/posts?user_id=neq.${BOT_ID}&created_at=gte.${sevenDaysAgoIso}&select=caption&limit=300&order=created_at.desc`;
    const botHistoryUrl = `${SUPABASE_URL}/rest/v1/posts?user_id=eq.${BOT_ID}&select=caption&limit=25&order=created_at.desc`;

    logStep("Fetching user posts & bot history from Supabase...");
    const responses = UrlFetchApp.fetchAll([
      { url: userPostsUrl, method: "get", headers: supabaseHeaders, muteHttpExceptions: true },
      { url: botHistoryUrl, method: "get", headers: supabaseHeaders, muteHttpExceptions: true }
    ]);

    logStep(`Supabase fetch finished -> userPosts HTTP ${responses[0].getResponseCode()}, botHistory HTTP ${responses[1].getResponseCode()}`);

    let userPostCaptions = [];
    if (responses[0].getResponseCode() === 200) {
      const postsData = JSON.parse(responses[0].getContentText());
      const seenUserCaptions = {};
      for (let i = 0; i < postsData.length; i++) {
        const clean = (postsData[i].caption || "").replace(/\s+/g, " ").trim();
        if (clean.length > 0 && !seenUserCaptions[clean]) {
          seenUserCaptions[clean] = true;
          userPostCaptions.push(clean.length > 220 ? clean.slice(0, 220) + "..." : clean);
          if (userPostCaptions.length >= 150) break;
        }
      }
      logStep(`Parsed ${postsData.length} raw user posts -> kept ${userPostCaptions.length} unique non-empty captions.`);
    } else {
      logStep(`ERROR fetching user posts: ${responses[0].getContentText()}`);
    }

    let recentBotCaptions = [];
    if (responses[1].getResponseCode() === 200) {
      const botData = JSON.parse(responses[1].getContentText());
      recentBotCaptions = botData
        .map(p => (p.caption || "").replace(/\s+/g, " ").trim())
        .filter(c => c.length > 0)
        .map(c => (c.length > 180 ? c.slice(0, 180) + "..." : c));
      logStep(`Loaded ${recentBotCaptions.length} recent bot posts for deduplication.`);
    } else {
      logStep(`ERROR fetching bot history: ${responses[1].getContentText()}`);
    }

    // 3. Weekly rotating micro-premise bank (no generic "Netflix/dating apps/coffee" clichés).
    const microScenarioPool = [
      "making intense eye contact through the bathroom stall crack",
      "telling the barber 'looks great' when you look like a Victorian orphan",
      "doing the awkward half-jog across a crosswalk to pretend you care",
      "grocery self-checkout accusing you of stealing a single banana",
      "opening the same empty fridge four times lowering your standards each time",
      "receiving a voice note over 4 minutes long from a friend",
      "pretending to read the shampoo bottle or menu intently to avoid small talk",
      "buying fancy olive oil and then putting it on frozen nuggets",
      "carrying 14 grocery bags in one trip to prove something to nobody",
      "getting caught in a 300-meter hallway walk toward someone you already waved at",
      "lying straight to your dentist's face about flossing twice a day",
      "forgetting a neighbor's name for 3 years so now you just call them 'boss' or 'legend'",
      "a dog aggressively judging your life choices from a parked car window",
      "trying to whisper in a dead-quiet elevator and somehow making it 10x louder",
      "watching a toddler stare at you in public like you owe them money",
      "paying $9 for a tiny artisanal pastry and eating it over the sink like a raccoon",
      "taking one tiny bite of something spicy and instantly sweating like a witness",
      "fixing a noisy appliance by hitting it once with the flat of your hand",
      "accidentally liking an acquaintance's photo from 2019 at 2:14 AM",
      "having a completely fake argument in the shower and still losing",
      "putting on 'nice clothes' just to go buy dish soap",
      "someone hitting 'reply all' on a massive group message by mistake",
      "getting overly competitive with the car next to you at a red light",
      "ordering something sophisticated at a restaurant just to pronounce it horribly wrong",
      "spending 20 minutes assembling flat-pack furniture backwards before noticing",
      "a cat knocking a full glass off the counter while maintaining unblinking eye contact",
      "your friend giving you terrible directions while confidently pointing the wrong way",
      "receiving an unsolicited 40-minute life lecture from an older relative",
      "buying gym shorts with pockets so shallow your phone escapes every time you sit",
      "pretending to check a very urgent text because you walked the wrong way down the street",
      "trying to peel a stubborn price sticker off a gift until it turns into fuzzy cardboard",
      "splitting a restaurant bill with that one friend who ordered lobster and 'just had a bite'",
      "hearing your own recorded voice and realizing why people talk over you",
      "trying to parallel park while two strangers stop walking specifically to watch",
      "a suspiciously cheap mechanic saying 'yeah that noise isn't supposed to happen'",
      "falling asleep for 20 minutes and waking up convinced it is 1997",
      "buying healthy vegetables just to watch them slowly turn into liquid in the crisper drawer",
      "trying to discreetly adjust something in public and looking directly at a security camera",
      "waiting politely for someone to finish typing for 4 minutes only to receive 'k'",
      "a friend saying 'let me drive, I know a shortcut' and adding 25 minutes to the trip"
    ];

    const weeklySeeds = shuffleArray(microScenarioPool).slice(0, 8);
    const weeklyVoices = shuffleArray([
      "deadpan friend texting the group chat after a bizarre errand",
      "petty hyper-specific observer noticing tiny absurdities in normal people",
      "relatable storyteller recounting a minor disaster that snowballed",
      "dry sarcastic realist poking holes in human overconfidence"
    ]).slice(0, 3);

    // 4. Construct the Comedy Writer System + Master Prompt
    const systemInstruction = `You are the comedy writer behind "Socium Humor Department", the funniest account on a tight-knit social app where friends post updates and hang out.
Write posts that make real people laugh out loud and screenshot them for friends—never generic AI stand-up clichés.

RULES:
- BANNED TOPICS (unless a user post from this week explicitly mentions them): scrolling Netflix for 45 minutes, dating apps/swiping, Zoom "you're on mute", needing coffee to function, Mondays, "adulting", January gym resolutions, airline fees, generic AI jokes.
- BANNED OPENERS/FORMATS: Never start with "Nobody:", "Me:", "POV:", "Am I the only one who...", "Ever notice how...", "Wait for it", or cheesy questions ("Why do we always..."). Zero hashtags; 0–1 emoji max.
- BE SPECIFIC: Specific numbers, weird believable human details, petty escalation, and sharp timing beat broad generalizations.
- ANECDOTES: Short first-person or "saw someone today" mini-stories (2–4 crisp sentences) that feel real, slightly humiliating or petty, and end on a deadpan twist.`;

    const prompt = `Generate EXACTLY 7 distinct posts for this week using the data below.

REAL USER POSTS (LAST 7 DAYS):
${JSON.stringify(userPostCaptions)}

RECENT BOT POSTS (DO NOT REPEAT PREMISES OR PUNCHLINES):
${JSON.stringify(recentBotCaptions)}

WEEKLY FRESH SEEDS (use when user posts are sparse/repetitive):
Seeds: ${JSON.stringify(weeklySeeds)}
Voices: ${JSON.stringify(weeklyVoices)}

REQUIREMENTS:
1. USER-POST CALLBACKS:
   - Mine the real user posts for specific themes, moods, hobbies, complaints, or weird phrases from this week and turn them into insider jokes, teasing riffs, or companion anecdotes (never robotic summaries).
   - If user posts are diverse enough, base 3–5 items on them and make the rest original. If empty/sparse/repetitive, take at most 1–2 angles from them and invent fresh everyday material for the rest.
2. FORMAT MIX (7 TOTAL):
   - 3 realistic funny anecdotes ("anecdote") — grounded 2–4 sentence mini-stories with concrete detail and a deadpan twist.
   - 2 ultra-punchy observational one-liners ("one_liner") — 1–2 sentences, unexpected reversal.
   - 2 user-post riffs or absurd everyday scenarios ("post_riff" or "scenario").
3. Ensure every single item has a completely different topic, opening line, and rhythm.

Return strictly JSON: {"jokes":[{"category":"...","caption":"..."}]}`;

    // 5. Query Gemini (Targeting gemini-3.8-flash)
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${GEMINI_API_KEY}`;
    const geminiPayload = {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.95,
        topP: 0.95,
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            jokes: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  category: { type: "STRING" },
                  caption: { type: "STRING" }
                },
                required: ["category", "caption"]
              }
            }
          },
          required: ["jokes"]
        }
      }
    };

    const payloadString = JSON.stringify(geminiPayload);
    logStep(`Calling Gemini (${MODEL_NAME}) | promptChars=${prompt.length} | totalPayloadBytes=${payloadString.length}...`);

    const geminiOptions = {
      method: "post",
      contentType: "application/json",
      payload: payloadString,
      muteHttpExceptions: true
    };

    const geminiResponse = UrlFetchApp.fetch(geminiUrl, geminiOptions);
    const geminiStatus = geminiResponse.getResponseCode();
    const geminiRawBody = geminiResponse.getContentText();
    logStep(`Gemini responded -> HTTP ${geminiStatus} | bodyLength=${geminiRawBody.length}`);

    if (geminiStatus !== 200) {
      logStep(`Gemini API Error Body: ${geminiRawBody}`);
      return;
    }

    const geminiJson = JSON.parse(geminiRawBody);
    if (!geminiJson.candidates || !geminiJson.candidates[0]?.content?.parts?.[0]?.text) {
      logStep(`Unexpected Gemini response structure: ${geminiRawBody}`);
      return;
    }

    const rawTextResult = geminiJson.candidates[0].content.parts[0].text;
    logStep(`Gemini generated text: ${rawTextResult}`);

    let parsedJokesArray = JSON.parse(rawTextResult).jokes || [];
    parsedJokesArray = parsedJokesArray
      .filter(j => j && j.caption && j.caption.trim().length > 0)
      .slice(0, 7);

    if (parsedJokesArray.length === 0) {
      logStep("Gemini returned 0 usable jokes.");
      return;
    }

    parsedJokesArray = shuffleArray(parsedJokesArray);

    // 6. Stagger timestamps over the next 7 days (every 24 hours)
    const bulkInsertPayload = [];
    const baseTime = new Date();

    for (let i = 0; i < parsedJokesArray.length; i++) {
      const futureTimestamp = new Date(baseTime.getTime() + (i * 24 * 60 * 60 * 1000));
      bulkInsertPayload.push({
        user_id: BOT_ID,
        caption: parsedJokesArray[i].caption.trim(),
        image_url: null,
        visibility_mode: 'all_connections',
        audience: null,
        created_at: futureTimestamp.toISOString(),
        updated_at: futureTimestamp.toISOString()
      });
    }

    // 7. Bulk insert all entries to Supabase in ONE network request
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

    logStep(`Inserting ${bulkInsertPayload.length} scheduled posts into Supabase...`);
    const insertResponse = UrlFetchApp.fetch(supabaseInsertUrl, insertOptions);
    const statusCode = insertResponse.getResponseCode();
    const responseBody = insertResponse.getContentText();

    if (statusCode >= 200 && statusCode < 300) {
      logStep(`SUCCESS! Queued ${parsedJokesArray.length} jokes (HTTP ${statusCode}). Categories: ${JSON.stringify(parsedJokesArray.map(j => j.category))}`);
    } else {
      logStep(`CRITICAL: Supabase insert failed (HTTP ${statusCode}): ${responseBody}`);
      throw new Error(`Supabase insert failed (${statusCode}): ` + responseBody);
    }

  } catch (e) {
    logStep("Execution error: " + (e && e.stack ? e.stack : e.toString()));
  }
}
