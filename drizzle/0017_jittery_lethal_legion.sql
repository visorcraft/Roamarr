ALTER TABLE `trip_expenses` ADD `category` text DEFAULT 'other' CHECK("trip_expenses"."category" in ('lodging','transport','food','activities','other'));
