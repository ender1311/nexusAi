import { Zap } from "lucide-react";
import { GoogleSignInButton } from "./google-sign-in-button";

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized:
    "Sign in failed. Nexus only accepts @youversion.com and @life.church accounts.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackURL?: string; error?: string }>;
}) {
  const params = await searchParams;
  const callbackURL = params.callbackURL ?? "/";
  const errorMessage = params.error ? (ERROR_MESSAGES[params.error] ?? "Sign in failed. Please try again.") : null;
  const errorCallbackURL = `/login?callbackURL=${encodeURIComponent(callbackURL)}&error=unauthorized`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 rounded-xl border bg-card p-8 shadow-sm">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Zap className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Nexus</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Sign in with your YouVersion or Life.Church account
            </p>
          </div>
        </div>

        {errorMessage && (
          <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {errorMessage}
          </p>
        )}

        <GoogleSignInButton
          callbackURL={callbackURL}
          errorCallbackURL={errorCallbackURL}
        />
      </div>
    </div>
  );
}
