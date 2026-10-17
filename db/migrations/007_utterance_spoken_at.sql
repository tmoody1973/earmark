-- Live bloom fix round 1 (M2-T6). Additive only.
-- The live stream sends each utterance's spoken_at. Keeping it dates a live mention by when it was said (not when the
-- webhook arrived), which is also what lets the completed pass match an unmapped live mention by the conversation's
-- start/end span (hasMentionFromSameOccasion).
alter table utterance_buffer add column spoken_at timestamptz;
