/** Top-up choices are denominated in Singapore cents. One USD cent buys 2,500 credits. */
export const SGD_TOPUP_CENTS = [500, 1000, 2000, 3000, 5000, 10000] as const;
export type CreditOption = { sgdCents: number; cnyCents: number; usdCents: number; credits: number };
export type CreditOptions = { rateDate: string; options: CreditOption[] };
export function buildCreditOptions(usdPerSgd: number, cnyPerSgd: number, rateDate: string): CreditOptions {
  if (!Number.isFinite(usdPerSgd) || usdPerSgd <= 0 || !Number.isFinite(cnyPerSgd) || cnyPerSgd <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(rateDate)) throw new Error("invalid_exchange_rates");
  return { rateDate, options: SGD_TOPUP_CENTS.map(sgdCents => {
    const usdCents = Math.round(sgdCents * usdPerSgd);
    if (!Number.isSafeInteger(usdCents) || usdCents <= 0) throw new Error("invalid_exchange_rates");
    return { sgdCents, cnyCents: Math.round(sgdCents * cnyPerSgd), usdCents, credits: usdCents * 2500 };
  }) };
}
