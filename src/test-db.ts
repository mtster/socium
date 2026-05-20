import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

async function run() {
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("No Supabase URL or Anon key found in environment");
    return;
  }
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data, error } = await supabase.from('connections').select('*').limit(1);
  if (error) {
    console.error("Error querying connections:", error);
  } else {
    console.log("Connections query succeeded. Rows:", data);
  }
}
run();
