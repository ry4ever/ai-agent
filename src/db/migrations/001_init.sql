-- Agent Services Platform — Initial Schema

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- All payment transactions recorded here
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_hash VARCHAR(66) NOT NULL,
  agent_address VARCHAR(42) NOT NULL,
  service_endpoint VARCHAR(255) NOT NULL,
  amount_usdc DECIMAL(18,6) NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  status VARCHAR(20) DEFAULT 'confirmed',
  metadata JSONB
);

-- Aggregated daily revenue per service
CREATE TABLE IF NOT EXISTS revenue_daily (
  date DATE NOT NULL,
  service_endpoint VARCHAR(255) NOT NULL,
  total_usdc DECIMAL(18,6) DEFAULT 0,
  total_requests INT DEFAULT 0,
  unique_agents INT DEFAULT 0,
  PRIMARY KEY (date, service_endpoint)
);

-- Agent request history for rate limiting analytics
CREATE TABLE IF NOT EXISTS agent_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_address VARCHAR(42) NOT NULL,
  service_endpoint VARCHAR(255) NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  paid BOOLEAN DEFAULT FALSE,
  response_ms INT
);

CREATE INDEX IF NOT EXISTS idx_tx_agent ON transactions(agent_address);
CREATE INDEX IF NOT EXISTS idx_tx_service ON transactions(service_endpoint);
CREATE INDEX IF NOT EXISTS idx_tx_timestamp ON transactions(timestamp);
CREATE INDEX IF NOT EXISTS idx_tx_hash ON transactions(tx_hash);
CREATE INDEX IF NOT EXISTS idx_agent_requests_address ON agent_requests(agent_address);
CREATE INDEX IF NOT EXISTS idx_agent_requests_timestamp ON agent_requests(timestamp);
