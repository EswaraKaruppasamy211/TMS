CREATE TABLE IF NOT EXISTS students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roll_no text NOT NULL UNIQUE,
  name text NOT NULL,
  dept text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
  rotation_order integer NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY DEFAULT 'default',
  session_capacity integer NOT NULL DEFAULT 15,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  role_structure jsonb NOT NULL DEFAULT
    '[{"role":"Prepared Speaker","count":3},{"role":"Specific Evaluator","count":3},{"role":"Table Topic Speaker","count":3},{"role":"Timer","count":1},{"role":"AH Counter","count":1},{"role":"Grammarian","count":1},{"role":"TMOD","count":1},{"role":"GE","count":1},{"role":"TTM","count":1}]'::jsonb
);

INSERT INTO app_settings (key) VALUES ('default') ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS rotation_state (
  key text PRIMARY KEY,
  next_index integer NOT NULL DEFAULT 0
);
INSERT INTO rotation_state (key) VALUES ('global') ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date date NOT NULL UNIQUE,
  theme text NOT NULL DEFAULT '',
  cancelled_by_college_leave boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'Generated'
    CHECK (status IN ('Draft', 'Generated', 'Modified', 'Finalized', 'Completed')),
  rotation_start_index integer NOT NULL DEFAULT 0,
  rotation_end_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS cancelled_by_college_leave boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id),
  report_date date NOT NULL,
  type text NOT NULL CHECK (type IN ('OD', 'LEAVE')),
  marked_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, report_date)
);

CREATE TABLE IF NOT EXISTS college_leaves (
  report_date date PRIMARY KEY,
  reason text NOT NULL DEFAULT '',
  marked_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  slot_index integer NOT NULL,
  role text NOT NULL,
  student_id uuid NOT NULL REFERENCES students(id),
  is_replacement boolean NOT NULL DEFAULT false,
  replaced_student_id uuid REFERENCES students(id),
  replacement_reason text CHECK (replacement_reason IN ('OD', 'LEAVE')),
  manual_override boolean NOT NULL DEFAULT false,
  UNIQUE (session_id, slot_index),
  UNIQUE (session_id, student_id)
);

CREATE TABLE IF NOT EXISTS session_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id),
  original_role text NOT NULL,
  replacement_id uuid REFERENCES students(id),
  reason text NOT NULL CHECK (reason IN ('OD', 'LEAVE')),
  changed_by text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, student_id)
);

CREATE TABLE IF NOT EXISTS session_audit (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT '',
  slot_index integer,
  from_student_id uuid REFERENCES students(id),
  to_student_id uuid REFERENCES students(id),
  reason text NOT NULL CHECK (reason IN ('OD', 'LEAVE', 'MANUAL_OVERRIDE')),
  changed_by text NOT NULL DEFAULT '',
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS role_history (
  id bigserial PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES students(id),
  role text NOT NULL,
  report_date date NOT NULL,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS role_history_scoring_idx
  ON role_history (student_id, role, report_date) WHERE active;
