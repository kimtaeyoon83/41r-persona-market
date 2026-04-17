/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: ['**/node_modules/**', '**/.git/**'],
      };
    }
    // Stub optional wagmi connectors we don't use so Next.js doesn't try to
    // resolve their peer deps during build. We only use injected + metaMask.
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      'porto/internal': false,
      'porto': false,
      '@base-org/account': false,
      '@coinbase/wallet-sdk': false,
      '@metamask/connect-evm': false,
      '@safe-global/safe-apps-provider': false,
      '@safe-global/safe-apps-sdk': false,
      '@walletconnect/ethereum-provider': false,
      accounts: false,
    };
    return config;
  },
};

export default nextConfig;
