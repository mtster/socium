function generateWeeklyJokeBatch() {
  const GEMINI_API_KEY = "YOUR_GEMINI_API_KEY_HERE";
  const SUPABASE_URL = "https://abupzwybtmpcreemrhjg.supabase.co";
  const SUPABASE_SERVICE_ROLE_KEY = "YOUR_SUPABASE_SERVICE_ROLE_KEY_HERE";
  const BOT_ID = "00000000-0000-0000-0000-000000000001";

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
    // 1. Calculate the timestamp for 7 days ago (Weekly Monday Sync)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoIso = sevenDaysAgo.toISOString();

    const supabaseHeaders = {
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": "Bearer " + SUPABASE_SERVICE_ROLE_KEY
    };

    // 2. Fetch real user posts from the last 7 days (up to 300) AND the bot's own last 35 posts
    //    (approx. 5 weeks of history) in parallel so Gemini never repeats old premises or tropes.
    const userPostsUrl = `${SUPABASE_URL}/rest/v1/posts?user_id=neq.${BOT_ID}&created_at=gte.${sevenDaysAgoIso}&select=caption&limit=300&order=created_at.desc`;
    const botHistoryUrl = `${SUPABASE_URL}/rest/v1/posts?user_id=eq.${BOT_ID}&select=caption&limit=35&order=created_at.desc`;

    const responses = UrlFetchApp.fetchAll([
      { url: userPostsUrl, method: "get", headers: supabaseHeaders, muteHttpExceptions: true },
      { url: botHistoryUrl, method: "get", headers: supabaseHeaders, muteHttpExceptions: true }
    ]);

    let userPostCaptions = [];
    if (responses[0].getResponseCode() === 200) {
      const postsData = JSON.parse(responses[0].getContentText());
      userPostCaptions = postsData
        .map(p => (p.caption || "").trim())
        .filter(c => c.length > 0);
    } else {
      Logger.log("Failed to fetch user posts from Supabase. Code: " + responses[0].getResponseCode());
    }

    let recentBotCaptions = [];
    if (responses[1].getResponseCode() === 200) {
      const botData = JSON.parse(responses[1].getContentText());
      recentBotCaptions = botData
        .map(p => (p.caption || "").trim())
        .filter(c => c.length > 0);
    } else {
      Logger.log("Failed to fetch recent bot history. Code: " + responses[1].getResponseCode());
    }

    // 3. Weekly rotating micro-premise bank (no generic "Netflix/dating apps/coffee" clichés).
    //    Randomly picking a fresh subset each week forces genuinely different territory every run.
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
    const systemInstruction = `You are the comedy writer behind "Socium Humor Department", the funniest account on a tight-knit social app where friends post unfiltered updates and hang out.
Your job is NOT to sound like a generic AI stand-up bot or a viral Twitter engagement farmer. Your job is to write posts that make real people laugh out loud and screenshot them for their friends.

STRICT ANTI-CLICHÉ & QUALITY RULES:
- BANNED TOPICS (NEVER mention these unless a real user post from this week explicitly brings them up): scrolling Netflix/streaming for 45 minutes and falling asleep, modern dating apps/swiping, Zoom calls / "you're on mute", needing coffee to function, "Monday mornings", "adulting is hard", January gym resolutions, airline peanuts, or generic tech/AI jokes.
- BANNED FORMATTING TROPES: NEVER start a joke with "Nobody:", "Me:", "POV:", "Am I the only one who...", "Ever notice how...", "Wait for it", or cheesy rhetorical setups ("Why do we always..."). No hashtags, no forced emoji spam (0 or 1 emoji max, only if it truly sharpens the punchline).
- SPECIFICITY WINS: Generic comedy dies ("waiting at the DMV takes forever"). Specific details kill ("the guy ahead of me at the pharmacy argued for 11 minutes about a 40-cent coupon while holding everyone hostage with a melted ice cream cone"). Give concrete numbers, believable weird behavior, and sharp comedic timing.
- ANECDOTE RULES: Realistic anecdotes must feel like something that could actually happen in real life this week—petty, slightly humiliating, weirdly vivid, with an unexpected human reaction or escalation—NOT cartoonish slapstick or unbelievable fake stories.`;

    const prompt = `Analyze the real user posts from our platform over the last 7 days, plus your own recent bot posts so you don't repeat yourself, and generate EXACTLY 7 brand-new posts for the upcoming week.

=== REAL USER POSTS FROM THE LAST 7 DAYS (UP TO 300) ===
${JSON.stringify(userPostCaptions)}

=== YOUR OWN RECENT BOT POSTS (DO NOT REPEAT ANY PREMISE, TOPIC, OR PUNCHLINE FROM THESE) ===
${JSON.stringify(recentBotCaptions)}

=== FRESH RANDOMIZED WEEKLY INSPIRATION SEEDS (OPTIONAL IF USER POSTS ARE SPARSE/REPETITIVE) ===
Seeds: ${JSON.stringify(weeklySeeds)}
Tone lenses: ${JSON.stringify(weeklyVoices)}

REQUIREMENTS FOR THE 7 POSTS:
1. RECENT-POST CALLBACKS MECHANISM (KEEP & ELEVATE):
   - Carefully mine the real user posts above for specific themes, habits, drama, complaints, hobbies, weird phrases, or recurring moods from this week.
   - Do NOT lazily summarize or quote posts ("Congrats on your workout!"). Instead, turn what users actually posted into sharp insider jokes, teasing exaggerated scenarios, or funny companion anecdotes that feel tuned into the feed's vibe this week.
   - Balance rule:
     * If the user posts are rich and diverse enough to fuel 3–5 genuinely distinct jokes/anecdotes without repeating the same theme, make 3–5 items grounded in the user posts and fill the rest with original comedy.
     * If the user posts are empty, sparse, or all about the same 1–2 repetitive things, extract at most 1–2 sharp jokes from them and invent the rest from scratch using fresh everyday territory (inspired by the weekly seeds or completely new unexpected situations).

2. REQUIRED FORMAT MIX ACROSS THE 7 ITEMS:
   - Include **3 realistic funny anecdotes** ("anecdote"): Mini first-person or "saw someone today" stories (2 to 4 crisp sentences). Must have a grounded setup, vivid concrete detail, and a killer deadpan ending or petty twist.
   - Include **2 ultra-punchy observational jokes / twisted thoughts** ("one_liner"): 1 to 2 tight sentences. Unexpected reversal, zero filler words.
   - Include **2 user-post-inspired riffs OR absurd everyday scenarios** ("post_riff" or "scenario"): Distinct angle, completely different structure from the others.

3. SELF-CRITIQUE BEFORE FINALIZING:
   - Before outputting any item, ask: "Have I heard a weaker version of this joke on Instagram/Reddit 50 times?" If yes, throw it out and write something sharper, weirder, and more specific.
   - Every single one of the 7 items must cover a completely different subject, rhythm, and opening line.

Return strictly a JSON object with a "jokes" array of 7 objects, each with:
- "category": one of "anecdote", "one_liner", "post_riff", "scenario"
- "caption": the exact final post text ready to publish.`;

    // 5. Query Gemini (Targeting gemini-4-hydrogen)
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent?key=${GEMINI_API_KEY}`;
    const geminiPayload = {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 1.0,
        topP: 0.95,
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
    let parsedJokesArray = JSON.parse(rawTextResult).jokes || [];

    // Filter blanks, cap at 7, and shuffle order so formats alternate organically across the week
    parsedJokesArray = parsedJokesArray
      .filter(j => j && j.caption && j.caption.trim().length > 0)
      .slice(0, 7);

    if (parsedJokesArray.length === 0) {
      Logger.log("Gemini returned 0 usable jokes.");
      return;
    }

    parsedJokesArray = shuffleArray(parsedJokesArray);

    // 6. Loop through the jokes and stagger their timestamps over the next 7 days (every 24 hours)
    const bulkInsertPayload = [];
    const baseTime = new Date(); // Start scheduling from right now

    for (let i = 0; i < parsedJokesArray.length; i++) {
      // 7 jokes staggered 24 hours apart perfectly spans a 168-hour (7-day) week
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

    // 7. Bulk insert all entries to Supabase in exactly ONE network request
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
    const statusCode = insertResponse.getResponseCode();
    const responseBody = insertResponse.getContentText();

    if (statusCode >= 200 && statusCode < 300) {
      Logger.log(`Successfully queued ${parsedJokesArray.length} jokes! Breakdown: ${JSON.stringify(parsedJokesArray.map(j => j.category))}`);
    } else {
      Logger.log(`CRITICAL: Supabase insert failed with code ${statusCode}! Error body: ` + responseBody);
      throw new Error(`Supabase insert failed (${statusCode}): ` + responseBody);
    }

  } catch(e) {
    Logger.log("Execution error: " + e.toString());
  }
}
