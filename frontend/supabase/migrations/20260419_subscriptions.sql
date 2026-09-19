CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL,
  user_id text,
  topics text[] DEFAULT '{}',
  sections text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  active boolean DEFAULT true
);

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_email_unique_idx ON subscriptions (email);
