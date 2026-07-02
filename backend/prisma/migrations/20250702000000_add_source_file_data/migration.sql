-- Add source_file_data column to timesheets table for persistent file storage
ALTER TABLE "timesheets" ADD COLUMN IF NOT EXISTS "source_file_data" BYTEA;
