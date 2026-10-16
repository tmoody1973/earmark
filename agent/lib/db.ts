import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { getEnv } from "./env";

let client: NeonQueryFunction<false, false> | undefined;
export function db(): NeonQueryFunction<false, false> {
  client ??= neon(getEnv().DATABASE_URL);
  return client;
}
