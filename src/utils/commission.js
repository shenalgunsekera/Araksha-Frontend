// Live commission — fills the standard commission (premiums × rate) when the
// stored value is empty, matching the underwriting form's auto-calc. Used so
// imported records (which don't store commission) still show it wherever
// commission is displayed, without needing a re-import.
//
// Rates come from the admin rate table when a `schedules` map is passed (the
// products map from settings/commission_rates), resolved by product + policy
// start date; otherwise the built-in per-class defaults apply. A stored value
// always wins over the computed one, so anything entered by hand is preserved.
//
// Total = Basic + SRCC + TC, plus the Special Commission on a Special record
// (new single field, or the legacy commission_special_amount for old records).

import { rateFor, defaultRate } from './commissionRates';

const num = (v) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0;
const r2  = (n) => Math.round(n * 100) / 100;
const has = (v) => v !== undefined && v !== null && v !== '';

export function liveCommission(client, schedules) {
  const c = client || {};
  const mc = c.main_class || '';
  const rate = schedules ? rateFor(schedules, c.product, mc, c.policy_period_from) : defaultRate(mc);

  let commission_pct     = has(c.commission_pct)   ? c.commission_pct   : String(rate.basic);
  let commission_basic   = has(c.commission_basic) ? c.commission_basic : (num(c.basic_premium) ? String(r2(num(c.basic_premium) * rate.basic / 100)) : '');
  const commission_srcc  = has(c.commission_srcc)  ? c.commission_srcc  : (num(c.srcc_premium)  ? String(r2(num(c.srcc_premium)  * rate.srcc  / 100)) : '');
  const commission_tc    = has(c.commission_tc)    ? c.commission_tc    : (num(c.tc_premium)    ? String(r2(num(c.tc_premium)    * rate.tc    / 100)) : '');

  // Special commission: the new single field, else the legacy +/- amount. Older
  // Special records kept their commission in Basic — for a Special policy that value
  // IS the special commission, so surface it under Special and clear Basic (display
  // only; the record persists this on its next save via the form migration).
  let commission_special = has(c.commission_special) ? c.commission_special
    : (num(c.commission_special_amount) ? String(num(c.commission_special_amount)) : '');
  if (c.commission_type === 'Special' && !num(commission_special) && num(commission_basic)) {
    commission_special = commission_basic;
    commission_basic = '';
    commission_pct = '';
  }

  const special = num(commission_special);
  const total = num(commission_basic) + num(commission_srcc) + num(commission_tc) + special;
  const commission_total = has(c.commission_total) ? c.commission_total : (total ? String(r2(total)) : '');

  return { commission_pct, commission_basic, commission_srcc, commission_tc, commission_special, commission_total };
}
