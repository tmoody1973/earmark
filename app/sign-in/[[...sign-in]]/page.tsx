import Link from "next/link";
import { SignIn } from "@clerk/nextjs";

// M1 scaffold — replaced by the M4 Impeccable build.
export default function SignInPage() {
  return (
    <main className="garden garden-center">
      <SignIn />
      <p className="sign-in-about"><Link href="/about">What is Earmark?</Link></p>
    </main>
  );
}
