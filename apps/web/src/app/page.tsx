import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-24">
      <div className="text-center space-y-6">
        <h1 className="text-6xl font-bold tracking-tight">ForgeSF</h1>
        <p className="text-xl text-muted-foreground max-w-2xl">
          Multi-tenant Salesforce AI Agent Platform
        </p>
        <div className="flex gap-4 justify-center pt-6">
          <Button asChild>
            <Link href="/signup">Get Started</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/login">Sign In</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
