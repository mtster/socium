import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  console.log("----- HUMOR BOT EDGE FUNCTION TRIGGERED -----");
  
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!geminiKey) {
      throw new Error("Missing GEMINI_API_KEY environment variable");
    }
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env variables");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Calculate the days in the current month
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-based index (0 = Jan, 1 = Feb, etc.)
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const jokeCount = daysInMonth * 3;

    console.log(`Configuring humor for Year: ${year}, Month: ${month + 1}. Days: ${daysInMonth}. Target count: ${jokeCount}`);

    // Create start and end date of the target month
    const startOfMonth = new Date(year, month, 1, 0, 0, 0);
    const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59);

    // 2. Clean out old future jokes scheduled for this month to ensure we do not create duplicates
    console.log("Cleaning previously scheduled bot jokes for the month...");
    const { error: deleteError } = await supabase
      .from('posts')
      .delete()
      .eq('user_id', '415f3e9b-75db-4428-ba2c-ec9b7754f9a5')
      .gte('created_at', startOfMonth.toISOString())
      .lte('created_at', endOfMonth.toISOString());

    if (deleteError) {
      console.warn("Delete old posts error (non-blocking if none existed):", deleteError);
    }

    // 3. Request jokes from Gemini 3.5 Flash using structured output
    const prompt = `Generate exactly ${jokeCount} genuinely funny and diverse jokes, anecdotes, and humorous statements. They should cover observational humor, situational jokes, lighthearted wordplay, clever puns, dry humor, and dad jokes. Keep the language fun, engaging, friendly, safe and suitable for a social network. Avoid sensitive, political, or offensive topics. Return the results in structured JSON format with a list of captions.`;

    console.log("Invoking Gemini 3.5 Flash API...");
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${geminiKey}`;
    
    const requestBody = {
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            jokes: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  caption: { type: "STRING" }
                },
                required: ["caption"]
              }
            }
          },
          required: ["jokes"]
        }
      }
    };

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error (Status ${response.status}): ${errorText}`);
    }

    const responseJson = await response.json();
    const textOutput = responseJson.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textOutput) {
      throw new Error("No text output received from Gemini API");
    }

    const { jokes } = JSON.parse(textOutput);
    if (!jokes || !Array.isArray(jokes)) {
      throw new Error("Parsed output does not contain an array of jokes");
    }

    console.log(`Generated ${jokes.length} jokes from Gemini API successfully.`);

    // 4. Inject articles into posts table 8 hours apart starting from the 1st day of the month
    const postsToInsert = [];
    const botId = '415f3e9b-75db-4428-ba2c-ec9b7754f9a5';

    // Verify the bot profile exists; if not, upsert it first so FK references don't fail
    const { data: profileCheck } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', botId)
      .maybeSingle();

    if (!profileCheck) {
      console.log("Humor department bot profile is missing. Creating standard profile row...");
      await supabase
        .from('profiles')
        .insert({
          id: botId,
          username: 'humor',
          full_name: 'Socium Humor Department',
          avatar_url: 'https://images.unsplash.com/photo-1531256379416-9f000e90aacc?auto=format&fit=crop&q=80&w=200&h=200',
          bio: 'Official humor hub of Socium. 3 delicious doses of jokes served fresh daily!'
        });
    }

    for (let i = 0; i < jokes.length; i++) {
      // Calculate timestamp 8 hours apart
      const timeOffsetMs = i * 8 * 60 * 60 * 1000;
      const scheduledTime = new Date(startOfMonth.getTime() + timeOffsetMs);

      postsToInsert.push({
        user_id: botId,
        caption: jokes[i].caption,
        image_url: null,
        visible_to: null,
        created_at: scheduledTime.toISOString(),
        updated_at: scheduledTime.toISOString()
      });
    }

    console.log(`Inserting ${postsToInsert.length} post records into 'posts' table...`);
    
    // Chunk database insert to protect database transaction payload limits
    const chunkSize = 50;
    for (let i = 0; i < postsToInsert.length; i += chunkSize) {
      const chunk = postsToInsert.slice(i, i + chunkSize);
      const { error: insertError } = await supabase
        .from('posts')
        .insert(chunk);

      if (insertError) {
        throw new Error(`Database record insertion error: ${insertError.message}`);
      }
    }

    console.log("Humor Bot Scheduling task executed perfectly!");
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Successfully generated and scheduled ${postsToInsert.length} jokes for the month.` 
      }), 
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error("FATAL ERROR in humor edge function:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }), 
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
