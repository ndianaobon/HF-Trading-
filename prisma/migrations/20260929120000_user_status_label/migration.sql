-- Custom account status text set by staff (display only; "status" still controls access).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "statusLabel" TEXT;
