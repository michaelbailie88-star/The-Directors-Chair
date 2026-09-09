-- The Director's Chair — initial schema
-- Implements the locked pricing/gating spec exactly.

CREATE TABLE writers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  country TEXT,
  age_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_writers_email ON writers (email);

CREATE TABLE submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  writer_id UUID NOT NULL REFERENCES writers(id) ON DELETE CASCADE,
  path TEXT NOT NULL CHECK (path IN ('preset', 'original')),
  preset_title TEXT,
  preset_genre TEXT,
  original_premise TEXT,
  characters JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'second_look', 'selected', 'closed')),
  second_look_start TIMESTAMPTZ,
  second_look_expires TIMESTAMPTZ,
  consent_checked BOOLEAN NOT NULL DEFAULT FALSE,
  paid BOOLEAN NOT NULL DEFAULT FALSE,
  amount_paid_cents INTEGER,
  stripe_checkout_session_id TEXT,
  stripe_payment_intent_id TEXT,
  feedback_text TEXT,
  credit_line TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Path A submissions are always free/unpaid and never carry preset-null +
  -- original-not-null (or vice versa) — enforce shape matches the path.
  CONSTRAINT chk_path_shape CHECK (
    (path = 'preset' AND preset_title IS NOT NULL AND original_premise IS NULL)
    OR
    (path = 'original' AND original_premise IS NOT NULL AND preset_title IS NULL)
  ),
  -- Only Path B (original) can ever sit in Second Look — Path A has no fee,
  -- so no reconsideration window per the locked spec.
  CONSTRAINT chk_second_look_only_original CHECK (
    status != 'second_look' OR path = 'original'
  )
);
CREATE INDEX idx_submissions_status ON submissions (status);
CREATE INDEX idx_submissions_second_look_expires ON submissions (second_look_expires);
CREATE INDEX idx_submissions_writer ON submissions (writer_id);

CREATE TABLE casting_applicants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country TEXT NOT NULL,
  city TEXT NOT NULL,
  age INTEGER NOT NULL CHECK (age >= 18),
  gender TEXT NOT NULL,
  email TEXT NOT NULL,
  handles JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'applied'
    CHECK (status IN ('applied', 'shortlisted', 'cast', 'passed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_casting_status ON casting_applicants (status);
CREATE INDEX idx_casting_email ON casting_applicants (email);
