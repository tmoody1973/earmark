-- Place-tip lookup bias (decision 046). said_lat/said_lng = where the CONVERSATION happened (Bee's primary_location),
-- not where the place is: lat/lng keep that meaning (place nudges depend on it). Personal location data: forgetting a
-- rec deletes its row, so these go with it. Additive, nullable, idempotent.
alter table recommendations
  add column if not exists said_lat double precision,
  add column if not exists said_lng double precision;
