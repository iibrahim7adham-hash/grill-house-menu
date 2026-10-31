// Restaurant-specific behavior.
//
// To load menu data from the central database, import the shared client
// (never create a new one, and never use a service-role key here):
//
//   import { supabase } from "/shared/supabase/client.js";
//
// Row Level Security only exposes published restaurants to visitors.
