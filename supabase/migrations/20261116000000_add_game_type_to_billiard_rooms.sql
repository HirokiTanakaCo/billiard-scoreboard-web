ALTER TABLE public.billiard_rooms
ADD COLUMN IF NOT EXISTS game_type text NOT NULL DEFAULT '9ball';
