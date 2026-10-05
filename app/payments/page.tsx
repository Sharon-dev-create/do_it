import Dashboard from "../dashboard/page";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function PaymentsPage() {
  return (
    <>
      <div className="max-w-6xl mx-auto mb-4">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Back
        </Link>
      </div>
      <Dashboard />
    </>
  );
}
