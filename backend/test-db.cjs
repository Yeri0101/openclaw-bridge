const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function main() {
    const { data, error } = await supabase.from('request_logs').select('*').order('created_at', { ascending: false }).limit(3);
    if (error) {
        console.error("Error:", error);
    } else {
        console.log("LAST LOGS:", data);
    }
}
main();
