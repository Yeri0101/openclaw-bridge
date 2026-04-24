-- Disable RLS on request_logs to allow the backend to read/write using anon key.
ALTER TABLE public.request_logs DISABLE ROW LEVEL SECURITY;
