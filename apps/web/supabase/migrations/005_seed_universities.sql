-- Seed universities table with initial universities
INSERT INTO public.university_config (email_domain, university_name, timezone)
VALUES 
  ('iastate.edu', 'Iowa State University', 'America/Chicago'),
  ('uiowa.edu', 'University of Iowa', 'America/Chicago'),
  ('uni.edu', 'University of Northern Iowa', 'America/Chicago')
ON CONFLICT (email_domain) DO NOTHING;
