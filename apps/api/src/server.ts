import { buildApp } from './app.js';
import { createPrisma } from './db.js';
import { loadEnv } from './env.js';
import { createHeliusProvider } from './providers/solana/heliusProvider.js';
import { createMarketDataProvider } from './providers/market/providerFactory.js';
import { createHistoricalMarketProvider } from './providers/historicalMarket/providerFactory.js';
import { createRpcClient } from './rpc.js';

async function main() {
  const env = loadEnv();
  const prisma = createPrisma(env.DATABASE_URL);
  const rpc = createRpcClient({ apiKey: env.HELIUS_API_KEY, cluster: env.SOLANA_CLUSTER });
  const activityProvider = createHeliusProvider({
    apiKey: env.HELIUS_API_KEY,
    cluster: env.SOLANA_CLUSTER,
  });
  const marketProvider = createMarketDataProvider(env.MARKET_DATA_PROVIDER);
  const historicalProvider = createHistoricalMarketProvider(env.HISTORICAL_MARKET_PROVIDER);

  const app = await buildApp({
    prisma,
    env,
    rpc,
    activityProvider,
    marketProvider,
    historicalProvider,
    logger: { level: 'info' },
  });

  try {
    await app.listen({ port: env.API_PORT, host: '127.0.0.1' });
    app.log.info(
      `Memecoin Lab API listening on http://127.0.0.1:${env.API_PORT} ` +
        `(RPC ${env.HELIUS_API_KEY ? 'configured' : 'NOT configured'})`,
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
