import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://jycggfokarxlookuhspn.supabase.co';
const supabaseKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp5Y2dnZm9rYXJ4bG9va3Voc3BuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTI0MTQxNDYsImV4cCI6MjAyNzk5MDE0Nn0.vt6fK_eCKxhK115FMeJ5YK8GzPBJKUrxYNJUJPQgCQM';

const supabase = createClient(supabaseUrl, supabaseKey);

export default supabase;
