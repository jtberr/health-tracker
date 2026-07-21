import type { Metadata } from "next";
import { SignupForm } from "./SignupForm";

export const metadata: Metadata = { title: "Sign up — Health Tracker" };

export default function SignupPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-zinc-900">Create your account</h1>
      <SignupForm />
    </div>
  );
}
