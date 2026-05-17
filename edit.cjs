const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.example' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';
// Actually anon key won't read pg_trigger. But we can't query pg_trigger directly anyway from REST API.
