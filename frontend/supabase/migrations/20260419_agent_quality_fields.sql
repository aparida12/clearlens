ALTER TABLE articles ADD COLUMN IF NOT EXISTS status text DEFAULT 'published';
ALTER TABLE articles ADD COLUMN IF NOT EXISTS qualityScore integer;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS qualityIssues jsonb;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS agentRun text;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS generatedAt timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS articles_slug_unique_idx ON articles (slug);
