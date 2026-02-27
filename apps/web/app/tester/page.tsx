import Link from "next/link";

export default function TesterLanding() {
  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl font-bold mb-2">Tester Portal</h1>
      <p className="text-[var(--text-secondary)] text-sm mb-8">Test products, earn USDC, build your AI Persona</p>

      <div className="space-y-3">
        <Link href="/tester/tests" className="block p-5 rounded-xl border border-border-dim bg-surface hover:border-sol-blue/30 hover:bg-surface-elevated transition-all card-hover">
          <h2 className="font-display font-semibold mb-1">Available Tests</h2>
          <p className="text-sm text-[var(--text-secondary)]">Browse and take tests to earn $3-$5 USDC per completion</p>
        </Link>

        <Link href="/tester/profile" className="block p-5 rounded-xl border border-border-dim bg-surface hover:border-sol-blue/30 hover:bg-surface-elevated transition-all card-hover">
          <h2 className="font-display font-semibold mb-1">My Profile</h2>
          <p className="text-sm text-[var(--text-secondary)]">View your stats, generate your AI Persona after 3 tests</p>
        </Link>
      </div>

      <div className="mt-8 p-5 rounded-xl bg-surface border border-border-dim">
        <h3 className="text-sm font-mono text-sol-blue uppercase tracking-wider mb-3">How it works</h3>
        <ol className="text-sm text-[var(--text-secondary)] space-y-2 list-decimal list-inside">
          <li>Register with your Solana wallet</li>
          <li>Complete 3 manual tests (earn $3-$5 USDC each)</li>
          <li>Your AI Persona is automatically generated</li>
          <li>Persona earns passive income from auto tests</li>
        </ol>
      </div>
    </div>
  );
}
