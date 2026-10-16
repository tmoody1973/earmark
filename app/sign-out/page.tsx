import { SignOutButton } from "@clerk/nextjs";

// M1 scaffold — replaced by the M4 Impeccable build. Public path so a refused non-owner can leave.
export default function SignOutPage() {
  return (
    <main className="garden">
      <h1>Leaving so soon?</h1>
      <p>Sign out of this account to try a different one.</p>
      <SignOutButton redirectUrl="/sign-in">
        <button type="button" className="signout">Sign out</button>
      </SignOutButton>
    </main>
  );
}
