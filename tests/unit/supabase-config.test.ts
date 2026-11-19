import { describe, expect, it } from "vitest";
import { keyProjectMismatch } from "@/lib/data/store";

/** Unsigned test JWTs: only the payload matters (ref + role claims). */
const jwt = (ref: string, role: string) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ iss: "supabase", ref, role })).toString("base64url")}.sig`;
const A = "btfznkhnuytcfaduvjbm", B = "dpmxgfdhryuoolqbfeve";

describe("Supabase keys must belong to the URL's project", () => {
  it("accepts matching keys and new-style (non-JWT) keys", () => {
    expect(keyProjectMismatch({ NEXT_PUBLIC_SUPABASE_URL: `https://${A}.supabase.co`, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt(A, "anon"), SUPABASE_SERVICE_ROLE_KEY: jwt(A, "service_role") })).toBeNull();
    expect(keyProjectMismatch({ NEXT_PUBLIC_SUPABASE_URL: `https://${A}.supabase.co`, NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_x", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_x" })).toBeNull();
  });
  it("names the project a key really belongs to", () => {
    expect(keyProjectMismatch({ NEXT_PUBLIC_SUPABASE_URL: `https://${A}.supabase.co`, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt(A, "anon"), SUPABASE_SERVICE_ROLE_KEY: jwt(B, "service_role") }))
      .toBe(`SUPABASE_SERVICE_ROLE_KEY belongs to Supabase project ${B}, but NEXT_PUBLIC_SUPABASE_URL is project ${A}`);
  });
  it("catches the anon key pasted as the service role key", () => {
    expect(keyProjectMismatch({ NEXT_PUBLIC_SUPABASE_URL: `https://${A}.supabase.co`, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt(A, "anon"), SUPABASE_SERVICE_ROLE_KEY: jwt(A, "anon") }))
      .toMatch(/use the service_role key/);
  });
});
