-- The UI text size (Ajustes › Perfil): sm, md or lg.
ALTER TABLE "users" ADD COLUMN "textSize" TEXT NOT NULL DEFAULT 'md';
