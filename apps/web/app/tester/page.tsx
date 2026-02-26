import Link from "next/link";

export default function TesterLanding() {
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Tester Portal</h1>
      <p className="text-gray-400 text-sm mb-8">Test products, earn USDC, build your AI Persona</p>

      <div className="space-y-4">
        <Link href="/tester/tests" className="block p-5 rounded-lg border border-gray-800 bg-gray-900 hover:border-cyan-500/50 transition-colors">
          <h2 className="font-semibold mb-1">Available Tests</h2>
          <p className="text-sm text-gray-400">Browse and take tests to earn $3-$5 USDC per completion</p>
        </Link>

        <Link href="/tester/profile" className="block p-5 rounded-lg border border-gray-800 bg-gray-900 hover:border-cyan-500/50 transition-colors">
          <h2 className="font-semibold mb-1">My Profile</h2>
          <p className="text-sm text-gray-400">View your stats, generate your AI Persona after 3 tests</p>
        </Link>
      </div>

      <div className="mt-8 p-4 rounded-lg bg-gray-900/50 border border-gray-800">
        <h3 className="text-sm font-medium text-cyan-400 mb-2">How it works</h3>
        <ol className="text-sm text-gray-400 space-y-1 list-decimal list-inside">
          <li>Register with your Solana wallet</li>
          <li>Complete 3 manual tests (earn $3-$5 USDC each)</li>
          <li>Your AI Persona is automatically generated</li>
          <li>Persona earns passive income from auto tests</li>
        </ol>
      </div>
    </div>
  );
}
