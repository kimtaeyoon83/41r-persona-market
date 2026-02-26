import Link from "next/link";

export default function Home() {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-12">
        <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
          41R Persona Market
        </h1>
        <p className="text-lg text-gray-400">
          AI Persona-Based Product Validation Marketplace on Solana
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Link href="/company" className="group block p-6 rounded-xl border border-gray-800 bg-gray-900 hover:border-purple-500/50 transition-all">
          <h2 className="text-xl font-semibold mb-2 group-hover:text-purple-300">For Companies</h2>
          <p className="text-gray-400 text-sm">
            Register your product URL, get AI-generated test cases, and receive detailed feedback from real testers and AI personas.
          </p>
          <div className="mt-4 text-purple-400 text-sm">Register a test &rarr;</div>
        </Link>

        <Link href="/tester/tests" className="group block p-6 rounded-xl border border-gray-800 bg-gray-900 hover:border-cyan-500/50 transition-all">
          <h2 className="text-xl font-semibold mb-2 group-hover:text-cyan-300">For Testers</h2>
          <p className="text-gray-400 text-sm">
            Test products, earn USDC rewards ($3-$5 per test), and after 3 tests, your AI Persona earns passive income.
          </p>
          <div className="mt-4 text-cyan-400 text-sm">Browse tests &rarr;</div>
        </Link>

        <Link href="/persona" className="group block p-6 rounded-xl border border-gray-800 bg-gray-900 hover:border-green-500/50 transition-all">
          <h2 className="text-xl font-semibold mb-2 group-hover:text-green-300">Persona Gallery</h2>
          <p className="text-gray-400 text-sm">
            Browse AI Personas with verified on-chain credentials. Each Persona represents a real tester&apos;s expertise.
          </p>
          <div className="mt-4 text-green-400 text-sm">Explore personas &rarr;</div>
        </Link>

        <Link href="/autotest" className="group block p-6 rounded-xl border border-gray-800 bg-gray-900 hover:border-orange-500/50 transition-all">
          <h2 className="text-xl font-semibold mb-2 group-hover:text-orange-300">Auto Test Engine</h2>
          <p className="text-gray-400 text-sm">
            AI Personas automatically visit your site, test interactions, and generate detailed reports with 41R Token settlement.
          </p>
          <div className="mt-4 text-orange-400 text-sm">Run auto test &rarr;</div>
        </Link>
      </div>

      <div className="mt-12 p-6 rounded-xl border border-gray-800 bg-gray-900/50">
        <h3 className="text-sm font-medium text-gray-400 mb-3">Powered by Solana</h3>
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="px-3 py-1 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20">x402 Micropayment</span>
          <span className="px-3 py-1 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">Token-2022 Transfer Fee</span>
          <span className="px-3 py-1 rounded-full bg-green-500/10 text-green-300 border border-green-500/20">Transfer Hook</span>
          <span className="px-3 py-1 rounded-full bg-orange-500/10 text-orange-300 border border-orange-500/20">SAS Attestation</span>
        </div>
      </div>
    </div>
  );
}
