ALTER TABLE public.billiard_rooms
ADD COLUMN IF NOT EXISTS room_name text;

UPDATE public.billiard_rooms
SET room_name = room_id
WHERE room_name IS NULL OR btrim(room_name) = '';
