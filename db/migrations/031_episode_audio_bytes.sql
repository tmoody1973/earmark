-- Weekly episode (M5-T11). Additive only.
-- audio_bytes is the MP3 size the private RSS feed reports as the enclosure length.
alter table episodes add column if not exists audio_bytes int;
