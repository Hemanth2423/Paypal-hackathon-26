import ConnectPanel from "@/components/ConnectPanel";
import { readSyncSummary } from "@/lib/sync";

export const dynamic = "force-dynamic";

export default function ConnectPage() {
  return (
    <section className="mx-auto max-w-[480px]">
      <h1 className="text-center text-4xl font-light text-navy">Connect your merchant</h1>
      <p className="mt-3 text-center text-muted">
        We read your failed renewals from Braintree to show where revenue is leaking.
      </p>
      <div className="mt-8">
        <ConnectPanel initialSummary={readSyncSummary()} />
      </div>
    </section>
  );
}
