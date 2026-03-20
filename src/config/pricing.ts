// All prices are in USDC micro-units (6 decimals)
// e.g. 1000 = $0.001, 2000 = $0.002, 5000 = $0.005

export const PRICING = {
  // Data API
  SENTIMENT: '2000',         // $0.002
  COMPANY:   '5000',         // $0.005
  ENRICH:    '8000',         // $0.008
  NEWS:      '3000',         // $0.003
  EXTRACT:   '4000',         // $0.004

  // Sub-agents
  CONTRACT_ANALYZER: '100000', // $0.10
  CODE_REVIEWER:      '50000', // $0.05
  RESEARCH_SYNTH:    '150000', // $0.15
} as const;

export type PricingKey = keyof typeof PRICING;

// Convert micro-units to display USD string
export function microToUSD(microUnits: string): string {
  return (parseInt(microUnits) / 1_000_000).toFixed(4).replace(/\.?0+$/, '');
}
