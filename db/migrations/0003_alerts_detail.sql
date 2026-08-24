-- TASK-182: fired membership alerts need their trigger detail persisted.
-- The evaluate pipeline composes "{strategyId} top-{N}: entered/exited SYM, SYM"
-- but only marked active=0/fired_at; GET /api/alerts had nothing to render in
-- the fired journal, which printed bare null symbols instead.
ALTER TABLE alerts ADD COLUMN detail TEXT;
