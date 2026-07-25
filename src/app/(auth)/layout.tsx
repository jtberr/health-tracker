import { Card } from "@/components/ui/Card";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-paper px-4 py-16">
      <svg
        aria-hidden="true"
        viewBox="0 0 400 400"
        className="pointer-events-none absolute -top-16 left-1/2 h-[520px] w-[520px] -translate-x-1/2 text-sage"
      >
        <path
          d="M20 300 C 120 60, 280 60, 380 220"
          fill="none"
          stroke="currentColor"
          strokeWidth="10"
          strokeLinecap="round"
          opacity="0.35"
        />
      </svg>
      <Card className="relative w-full max-w-sm p-8">{children}</Card>
    </div>
  );
}
