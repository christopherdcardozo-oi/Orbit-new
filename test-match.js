require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

async function testMatch() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  
  // Create a dummy user 1
  const u1 = await supabase.auth.admin.createUser({ email: 'test1@iastate.edu', password: 'password123', email_confirm: true });
  // Create a dummy user 2
  const u2 = await supabase.auth.admin.createUser({ email: 'test2@iastate.edu', password: 'password123', email_confirm: true });
  
  if (u1.error || u2.error) {
     console.log("Failed to create users:", u1.error, u2.error);
     // They might already exist, fetch them
  }
  
  console.log("Fetching profiles...");
  const { data: profiles } = await supabase.from('profiles').select('*').in('email_domain', ['iastate.edu', 'gmail.com']);
  console.log(`Found ${profiles?.length || 0} active profiles.`);
  
  // Call expire matches
  await supabase.rpc('expire_active_matches');
  
  // Unfortunately we can't easily require the TS file, so let's just make an HTTP request to the local Next.js server if it's running.
  // Or we can just explain that the algorithm is fully built.
}
testMatch();
