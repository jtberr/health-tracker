import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Log in — Health Tracker" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-ink">Log in</h1>
      {error === "auth_callback_failed" && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          That confirmation link is invalid or expired. Try logging in, or sign up again.
        </p>
      )}
      <LoginForm />
    </div>
  );
}
