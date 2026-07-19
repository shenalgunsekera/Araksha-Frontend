// Live "Outstanding Days".
//
// Counts up by 1 every day from the policy commencement date until payment is
// made, then shows 0 once the payment status is "Paid". Computed on read so it
// never goes stale — the `os_days` stored on the client is only a snapshot from
// the last time the record was saved, which is why old policies froze at an old
// number (e.g. a policy from 1 Jun still reading 43 weeks later). Always prefer
// this over the stored value when displaying or exporting.
export function liveOsDays(client) {
  if (!client) return '';
  if (String(client.payment_status || '').toLowerCase() === 'paid') return '0';

  const from = client.policy_period_from;
  if (!from) return client.os_days ?? '';
  const start = new Date(from?.toDate ? from.toDate() : from);
  if (isNaN(start)) return client.os_days ?? '';

  // Once a payment date is recorded the clock stops there; otherwise it runs to today.
  const rawEnd = client.payment_date;
  const end = rawEnd ? new Date(rawEnd?.toDate ? rawEnd.toDate() : rawEnd) : new Date();
  if (isNaN(end)) return '';

  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  const diff = Math.round((end - start) / 86400000);
  return diff > 0 ? String(diff) : '0';
}
