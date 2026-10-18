// Worksite (voluntary group) schemes — shared calculation + parsing helpers.
//
// Model
//   worksite_schemes/{id}  one per employer + product (the master policy / line item)
//   worksite_members/{id}  one per enrolled employee (the certificate), keyed by NIC
//
// Billing is monthly and co-terminous: a member is billed from the month they
// join until the scheme anniversary, then continues into the next policy year.
// The employer deducts via payroll and remits to the INSURER; the insurer pays
// the broker commission later. The scheme ledger (one entry per month) records
// what was remitted to the insurer and what commission has been received, so
// premium arrears and commission receivable are always visible.

export const PRODUCT_TYPES = [
  'Group Life', 'Group Hospitalisation (Surgical & Hospital)', 'Personal Accident',
  'Critical Illness', 'Group Health / OPD', 'Funeral / Last Expense', 'Other',
];

export const MEMBER_STATUSES = ['Active', 'Continuing', 'Removed'];
// Active     — enrolled, premium deducted by the employer
// Continuing — left the employer / scheme deductions but keeps cover by paying individually
// Removed    — cover ceased (kept for history; can also be deleted outright)

export const RELATIONSHIPS = ['Spouse', 'Child', 'Father', 'Mother', 'Brother', 'Sister', 'Other'];

/* ── numbers / dates ─────────────────────────────────────────────────────── */
export const num = (v) => { const x = parseFloat(String(v ?? '').replace(/,/g, '')); return isNaN(x) ? 0 : x; };
export const money = (v) => num(v).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const monthLabel = (mk) => {
  if (!mk) return '';
  const [y, m] = mk.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
};

// Accepts Date, ISO / d/m/y / m/d/y strings, Excel serials, Firestore Timestamps.
export function toDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v?.toDate) return v.toDate();
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)); // Excel serial
    return null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    let a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000;
    // Microsoft Forms exports US order (m/d/yyyy); fall back to d/m when m > 12.
    const [mo, da] = a > 12 ? [b, a] : [a, b];
    return new Date(y, mo - 1, da);
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
export const toYmd = (v) => { const d = toDate(v); return d ? ymd(d) : ''; };

// Every month (YYYY-MM) from `from` to `to` inclusive.
export function monthsBetween(from, to) {
  const a = toDate(from), b = toDate(to);
  if (!a || !b || b < a) return [];
  const out = []; const d = new Date(a.getFullYear(), a.getMonth(), 1);
  while (d <= b && out.length < 240) { out.push(monthKey(d)); d.setMonth(d.getMonth() + 1); }
  return out;
}

/* ── NIC (Sri Lanka) ─────────────────────────────────────────────────────── */
export const normNic = (v) => String(v ?? '').toUpperCase().replace(/[\s-]/g, '');
export const validNic = (n) => /^\d{9}[VX]$/.test(n) || /^\d{12}$/.test(n);

// DOB + gender encoded in the NIC (day-of-year counts Feb as 29 days; +500 = female).
export function nicInfo(nicRaw) {
  const n = normNic(nicRaw);
  if (!validNic(n)) return null;
  const year = n.length === 10 ? 1900 + +n.slice(0, 2) : +n.slice(0, 4);
  let day = +(n.length === 10 ? n.slice(2, 5) : n.slice(4, 7));
  const gender = day > 500 ? 'Female' : 'Male';
  if (day > 500) day -= 500;
  if (day < 1 || day > 366) return null;
  const mdays = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let m = 0; while (m < 12 && day > mdays[m]) { day -= mdays[m]; m++; }
  if (m > 11) return null;
  return { dob: `${year}-${pad(m + 1)}-${pad(day)}`, gender };
}

export function ageOn(dob, on) {
  const b = toDate(dob), d = toDate(on) || new Date();
  if (!b) return null;
  let a = d.getFullYear() - b.getFullYear();
  if (d.getMonth() < b.getMonth() || (d.getMonth() === b.getMonth() && d.getDate() < b.getDate())) a--;
  return a;
}

/* ── policy years ────────────────────────────────────────────────────────── */
export const currentYear = (s) => {
  const ys = Array.isArray(s?.policy_years) ? s.policy_years : [];
  return ys.length ? ys[ys.length - 1] : { from: s?.inception_date || '', to: s?.anniversary_date || '' };
};
export function nextPolicyYear(y) {
  const to = toDate(y.to); if (!to) return null;
  const from = new Date(to); from.setDate(from.getDate() + 1);
  const end = new Date(from); end.setFullYear(end.getFullYear() + 1); end.setDate(end.getDate() - 1);
  return { from: ymd(from), to: ymd(end) };
}

/* ── member billing ──────────────────────────────────────────────────────── */
// First billable month: the month they joined (cover starts on the join date).
export const startMonth = (m) => { const d = toDate(m.join_date); return d ? monthKey(d) : ''; };
// First month NO LONGER billed through the employer: the exit month when the exit
// is on the 1st, otherwise the following month (the exit month is still deducted).
export function switchMonth(m) {
  const d = toDate(m.exit_date); if (!d) return '';
  const s = new Date(d.getFullYear(), d.getMonth() + (d.getDate() === 1 ? 0 : 1), 1);
  return monthKey(s);
}
export const memberPremium = (m) => num(m.monthly_premium);

// Which bucket a member falls in for a month: 'group' | 'individual' | null.
export function billingBucket(m, mk) {
  const st = startMonth(m);
  if (!st || mk < st) return null;
  const sw = switchMonth(m);
  if (m.status === 'Active' || !sw || mk < sw) return 'group';
  return m.status === 'Continuing' ? 'individual' : null;
}

// Premium due for one month from the live member list.
export function monthDue(members, mk) {
  let group = 0, individual = 0, gCount = 0, iCount = 0;
  for (const m of members) {
    const b = billingBucket(m, mk);
    if (b === 'group') { group += memberPremium(m); gCount++; }
    else if (b === 'individual') { individual += memberPremium(m); iCount++; }
  }
  return { group, individual, gCount, iCount };
}

// Premium for a member from their join month to the end of the policy year.
export function premiumToAnniversary(m, year) {
  const months = monthsBetween(year.from, year.to).filter(mk => billingBucket(m, mk));
  return { months: months.length, amount: months.length * memberPremium(m) };
}

// The scheme ledger for one policy year — one row per month. Months already
// snapshotted (recorded / closed at renewal) keep their stored due figures so
// later rate changes never rewrite history.
export function ledgerRows(scheme, members, year) {
  const ledger = scheme?.ledger || {};
  const rate = num(scheme?.commission_rate);
  return monthsBetween(year.from, year.to).map(mk => {
    const e = ledger[mk] || {};
    const live = monthDue(members, mk);
    const snap = e.snapshot === true;
    const group = snap ? num(e.due_group) : live.group;
    const individual = snap ? num(e.due_individual) : live.individual;
    const gCount = snap ? num(e.count_group) : live.gCount;
    const iCount = snap ? num(e.count_individual) : live.iCount;
    const due = group + individual;
    const remitted = num(e.remitted_group) + num(e.remitted_individual);
    const r = e.commission_rate !== undefined && e.commission_rate !== '' ? num(e.commission_rate) : rate;
    const commDue = remitted * r / 100;
    const commRec = num(e.commission_received);
    // Payroll deducted in month M is due at the insurer by the scheme's due day of M+1.
    const [yy, mm] = mk.split('-').map(Number);
    const dueBy = new Date(yy, mm, Math.min(28, num(scheme?.remittance_due_day) || 15));
    const overdue = due - remitted > 0.005 && new Date() > dueBy;
    return {
      month: mk, label: monthLabel(mk), snapshot: snap,
      group, individual, due, gCount, iCount, members: gCount + iCount,
      remitted_group: num(e.remitted_group), remitted_individual: num(e.remitted_individual), remitted,
      remitted_date: e.remitted_date || '', remittance_ref: e.remittance_ref || '',
      due_by: ymd(dueBy), overdue,
      arrears: Math.max(0, due - remitted), excess: Math.max(0, remitted - due),
      rate: r, commDue, commRec, commOs: commDue - commRec,
      commission_received_date: e.commission_received_date || '', commission_ref: e.commission_ref || '',
      notes: e.notes || '',
    };
  });
}

// Totals for a set of ledger rows. Unremitted premium is split into arrears
// (past the remittance due date) and pending (not yet due).
export function ledgerTotals(rows) {
  const t = { due: 0, remitted: 0, arrears: 0, pending: 0, commDue: 0, commRec: 0, commOs: 0, expectedComm: 0, overdueMonths: 0 };
  for (const r of rows) {
    t.due += r.due; t.remitted += r.remitted;
    if (r.overdue) { t.arrears += r.arrears; t.overdueMonths++; } else t.pending += r.arrears;
    t.commDue += r.commDue; t.commRec += r.commRec; t.commOs += r.commOs;
    t.expectedComm += r.due * r.rate / 100;
  }
  return t;
}

/* ── upload: parse + column mapping ──────────────────────────────────────── */
export const MEMBER_FIELDS = [
  { key: 'company',              label: 'Company / Employer', hint: 'Only if one form is shared by several companies', re: /(company|employer|organi[sz]ation|workplace)/i },
  { key: 'full_name',            label: 'Full Name *',        required: true, re: /(full\s*name|name\s*(with|of)|employee\s*name|^name$|your\s*name)/i, prefer: /(full\s*name|name\s*(with|of)|employee\s*name|your\s*name)/i },
  { key: 'nic',                  label: 'NIC / Passport *',   required: true, re: /(nic|national\s*id|identity|passport)/i },
  { key: 'employee_no',          label: 'Employee / EPF No.', re: /(emp(loyee)?\s*(no|number|id|code)|epf|staff\s*(no|id))/i },
  { key: 'dob',                  label: 'Date of Birth',      re: /(birth|dob)/i },
  { key: 'gender',               label: 'Gender',             re: /(gender|sex)/i },
  { key: 'mobile',               label: 'Mobile',             re: /(mobile|phone|contact\s*no|telephone|whats\s*app)/i },
  { key: 'email',                label: 'Email',              re: /(e-?mail)/i },
  { key: 'address',              label: 'Address',            re: /(address)/i },
  { key: 'department',           label: 'Department / Branch',re: /(department|branch|division|location|designation|section)/i },
  { key: 'plan',                 label: 'Plan / Option',      re: /(plan|option|package|tier|cover\s*level)/i },
  { key: 'monthly_premium',      label: 'Monthly Premium',    re: /(premium|amount|contribution)/i },
  { key: 'join_date',            label: 'Join / Start Date',  re: /(join|commence|effective|cover\s*start|start\s*date)/i },
  { key: 'nominee_name',         label: 'Nominee Name',       re: /(nominee|beneficiary).*(name)|^(nominee|beneficiary)$/i },
  { key: 'nominee_relationship', label: 'Nominee Relationship', re: /(relation)/i },
  { key: 'nominee_nic',          label: 'Nominee NIC',        re: /(nominee|beneficiary).*(nic|id)/i },
  { key: 'nominee_mobile',       label: 'Nominee Contact',    re: /(nominee|beneficiary).*(mobile|phone|contact)/i },
  { key: 'nominee_share',        label: 'Nominee Share %',    re: /(share|percent|%)/i },
];

// Pick a header for each field: the previously saved mapping wins when the header
// still exists, otherwise the first unclaimed header matching the field pattern.
export function autoMap(headers, saved = {}) {
  const map = {}; const used = new Set();
  for (const f of MEMBER_FIELDS) {
    if (saved[f.key] && headers.includes(saved[f.key])) { map[f.key] = saved[f.key]; used.add(saved[f.key]); }
  }
  // Specific patterns (nominee_*) first so "Nominee Name" isn't taken by full_name.
  const order = [...MEMBER_FIELDS].sort((a, b) => (b.key.startsWith('nominee') ? 1 : 0) - (a.key.startsWith('nominee') ? 1 : 0));
  for (const f of order) {
    if (map[f.key]) continue;
    // Member fields never claim a nominee/beneficiary column ("Nominee Mobile" ≠ Mobile).
    const memberField = !f.key.startsWith('nominee');
    const ok = (x) => !used.has(x) && !(memberField && /nominee|beneficiary/i.test(x));
    const h = (f.prefer && headers.find(x => ok(x) && f.prefer.test(x))) || headers.find(x => ok(x) && f.re.test(x));
    if (h) { map[f.key] = h; used.add(h); }
  }
  return map;
}

const cellText = (v) => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(t => t.text).join('');
    if (v.text !== undefined) return String(v.text);
    if (v.result !== undefined) return v.result instanceof Date ? v.result : String(v.result);
    return '';
  }
  return typeof v === 'number' ? v : String(v).trim();
};

// Parse an .xlsx (Microsoft Forms export) or .csv into { headers, rows }.
export async function parseUpload(file) {
  const name = (file?.name || '').toLowerCase();
  if (name.endsWith('.csv')) {
    const { default: Papa } = await import('papaparse');
    const text = await file.text();
    const res = Papa.parse(text, { header: true, skipEmptyLines: 'greedy' });
    const headers = (res.meta.fields || []).map(h => String(h).trim()).filter(Boolean);
    return { headers, rows: res.data.map(r => { const o = {}; headers.forEach(h => { o[h] = (r[h] ?? '').toString().trim(); }); return o; }) };
  }
  if (name.endsWith('.xls')) throw new Error('Old .xls files are not supported — open it in Excel and "Save As" .xlsx (or export the Form responses again).');
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('The workbook has no sheets.');
  let headers = []; const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, i) => {
    const vals = row.values.slice(1).map(cellText); // exceljs rows are 1-indexed
    if (!headers.length) { headers = vals.map((h, j) => String(h || `Column ${j + 1}`).trim()); return; }
    if (vals.every(v => v === '' || v === null)) return;
    const o = {}; headers.forEach((h, j) => { o[h] = vals[j] ?? ''; }); rows.push(o);
  });
  return { headers, rows };
}

// Turn one raw row into a member draft using the column map + scheme plans.
export function rowToMember(row, map, scheme, fallbackJoin) {
  const get = (k) => (map[k] ? row[map[k]] : '');
  const str = (k) => { const v = get(k); return v instanceof Date ? ymd(v) : String(v ?? '').trim(); };
  const nic = normNic(str('nic'));
  const info = nicInfo(nic);
  const plans = Array.isArray(scheme?.plans) ? scheme.plans : [];
  const planRaw = str('plan');
  // Match the plan by exact name, then by containment ("Plan B - Rs 1,500" → "Plan B").
  const plan = plans.find(p => p.name.toLowerCase() === planRaw.toLowerCase())
    || plans.find(p => planRaw && (planRaw.toLowerCase().includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(planRaw.toLowerCase())))
    || (plans.length === 1 ? plans[0] : null);
  const premRaw = num(str('monthly_premium'));
  const g = str('gender');
  return {
    full_name: str('full_name'),
    nic,
    employee_no: str('employee_no'),
    dob: toYmd(get('dob')) || info?.dob || '',
    gender: /^f/i.test(g) ? 'Female' : /^m/i.test(g) ? 'Male' : (info?.gender || ''),
    mobile: str('mobile'), email: str('email'), address: str('address'), department: str('department'),
    plan: plan ? plan.name : planRaw,
    plan_matched: !!plan,
    monthly_premium: premRaw || (plan ? num(plan.monthly_premium) : 0),
    sum_insured: plan ? num(plan.sum_insured) : 0,
    join_date: toYmd(get('join_date')) || fallbackJoin,
    nominee_name: str('nominee_name'), nominee_relationship: str('nominee_relationship'),
    nominee_nic: normNic(str('nominee_nic')), nominee_mobile: str('nominee_mobile'),
    nominee_share: str('nominee_share'),
    company: str('company'),
  };
}

// Validation for the preview: errors block the row, warnings are shown only.
export function validateMember(m, scheme, year) {
  const errors = [], warnings = [];
  if (!m.full_name) errors.push('Name missing');
  if (!m.nic) errors.push('NIC missing');
  else if (!validNic(m.nic) && !/^[A-Z]\d{7,8}$/.test(m.nic)) warnings.push('NIC format looks wrong');
  if (!m.monthly_premium) errors.push('No premium (plan not matched)');
  else if (!m.plan_matched && (scheme?.plans || []).length) warnings.push(`Plan "${m.plan || '—'}" not in scheme`);
  const jd = toDate(m.join_date);
  if (!jd) errors.push('Join date missing');
  else if (year?.to && jd > toDate(year.to)) warnings.push('Joins after anniversary');
  const age = ageOn(m.dob, m.join_date);
  if (age !== null) {
    if (scheme?.min_entry_age && age < num(scheme.min_entry_age)) warnings.push(`Age ${age} below entry age`);
    if (scheme?.max_entry_age && age > num(scheme.max_entry_age)) warnings.push(`Age ${age} above entry age`);
  }
  return { errors, warnings };
}
