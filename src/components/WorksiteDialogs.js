import React, { useState, useMemo, useEffect } from 'react';
import { collection, doc, addDoc, writeBatch, serverTimestamp, arrayUnion } from 'firebase/firestore';
import { db } from '../firebase';
import { logActivity } from '../utils/workSession';
import {
  PRODUCT_TYPES, MEMBER_STATUSES, RELATIONSHIPS, MEMBER_FIELDS,
  num, money, ymd, toDate, normNic, nicInfo, currentYear, nextPolicyYear, monthLabel,
  parseUpload, autoMap, rowToMember, validateMember, premiumToAnniversary,
} from '../utils/worksite';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import Stepper from '@mui/material/Stepper';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import Table from '@mui/material/Table';
import TableHead from '@mui/material/TableHead';
import TableBody from '@mui/material/TableBody';
import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import LinearProgress from '@mui/material/LinearProgress';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';

const NAVY = '#255EAB';
const sec = { fontSize: 11, fontWeight: 800, color: '#7C93B0', textTransform: 'uppercase', letterSpacing: 0.8, mt: 2, mb: 1 };
const btnGrad = { background: 'linear-gradient(135deg,#255EAB,#38A3E0)', color: '#fff', fontWeight: 700, textTransform: 'none', borderRadius: '10px', '&:hover': { background: 'linear-gradient(135deg,#1D4E96,#2E76C4)' } };

const endOfYear = () => `${new Date().getFullYear()}-12-31`;
const firstOfMonth = () => { const d = new Date(); return ymd(new Date(d.getFullYear(), d.getMonth(), 1)); };
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

export const emptyScheme = () => ({
  company_name: '', company_reg: '', company_address: '', contact_person: '', contact_designation: '',
  contact_phone: '', contact_email: '', product_name: '', product_type: PRODUCT_TYPES[0], insurer: '',
  master_policy_no: '', inception_date: firstOfMonth(), period_from: firstOfMonth(), period_to: endOfYear(),
  commission_rate: '', remittance_due_day: 15, min_entry_age: 18, max_entry_age: 60, account_manager: '',
  status: 'Active', notes: '', plans: [{ name: 'Basic', monthly_premium: '', sum_insured: '', benefits: '' }],
});

// Scheme doc payload from the form values (policy year kept in policy_years[]).
export function schemePayload(v, existing) {
  const years = Array.isArray(existing?.policy_years) ? [...existing.policy_years] : [];
  const y = { from: v.period_from, to: v.period_to };
  if (years.length) years[years.length - 1] = y; else years.push(y);
  const { period_from, period_to, ...rest } = v;
  return {
    ...rest,
    company_name: v.company_name.trim(), product_name: v.product_name.trim(),
    commission_rate: num(v.commission_rate), remittance_due_day: num(v.remittance_due_day) || 15,
    min_entry_age: v.min_entry_age === '' ? '' : num(v.min_entry_age), max_entry_age: v.max_entry_age === '' ? '' : num(v.max_entry_age),
    plans: (v.plans || []).filter(p => p.name.trim()).map(p => ({ name: p.name.trim(), monthly_premium: num(p.monthly_premium), sum_insured: num(p.sum_insured), benefits: p.benefits || '' })),
    policy_years: years,
    anniversary_date: v.period_to,
  };
}

export const schemeToForm = (s) => {
  const y = currentYear(s);
  return { ...emptyScheme(), ...s, period_from: y.from || '', period_to: y.to || '', plans: (s.plans && s.plans.length) ? s.plans.map(p => ({ ...p })) : emptyScheme().plans };
};

/* ── Scheme form (company + product + plans) ─────────────────────────────── */
export function SchemeForm({ value, onChange, insurers, hideCompany }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  const setPlan = (i, k, v) => onChange({ ...value, plans: value.plans.map((p, j) => j === i ? { ...p, [k]: v } : p) });
  const tf = (k, label, props = {}) => <TextField fullWidth size="small" label={label} value={value[k] ?? ''} onChange={set(k)} {...props} />;
  return (
    <Box>
      {!hideCompany && (<>
        <Typography sx={sec}>Employer (Policyholder)</Typography>
        <Grid container spacing={1.5}>
          <Grid item xs={12} sm={8}>{tf('company_name', 'Company Name *')}</Grid>
          <Grid item xs={12} sm={4}>{tf('company_reg', 'Business Reg. No.')}</Grid>
          <Grid item xs={12}>{tf('company_address', 'Address')}</Grid>
          <Grid item xs={12} sm={6}>{tf('contact_person', 'HR / Payroll Contact')}</Grid>
          <Grid item xs={12} sm={6}>{tf('contact_designation', 'Designation')}</Grid>
          <Grid item xs={12} sm={6}>{tf('contact_phone', 'Phone')}</Grid>
          <Grid item xs={12} sm={6}>{tf('contact_email', 'Email')}</Grid>
        </Grid>
      </>)}
      <Typography sx={sec}>Product & Master Policy</Typography>
      <Grid container spacing={1.5}>
        <Grid item xs={12} sm={6}>{tf('product_name', 'Product Name *', { placeholder: 'e.g. Staff Hospitalisation Plan' })}</Grid>
        <Grid item xs={12} sm={6}>{tf('product_type', 'Product Type', { select: true, children: PRODUCT_TYPES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>) })}</Grid>
        <Grid item xs={12} sm={6}>
          {insurers.length
            ? tf('insurer', 'Insurer *', { select: true, children: [...new Set([...insurers, value.insurer].filter(Boolean))].sort().map(n => <MenuItem key={n} value={n}>{n}</MenuItem>) })
            : tf('insurer', 'Insurer *')}
        </Grid>
        <Grid item xs={12} sm={6}>{tf('master_policy_no', 'Master Policy No.')}</Grid>
        <Grid item xs={12} sm={4}>{tf('inception_date', 'Original Inception', { type: 'date', InputLabelProps: { shrink: true } })}</Grid>
        <Grid item xs={6} sm={4}>{tf('period_from', 'Policy Year From *', { type: 'date', InputLabelProps: { shrink: true } })}</Grid>
        <Grid item xs={6} sm={4}>{tf('period_to', 'Anniversary (To) *', { type: 'date', InputLabelProps: { shrink: true }, helperText: 'All members renew on this date' })}</Grid>
      </Grid>
      <Typography sx={sec}>Commission & Rules</Typography>
      <Grid container spacing={1.5}>
        <Grid item xs={6} sm={3}>{tf('commission_rate', 'Commission % *', { type: 'number', helperText: 'Of premium collected' })}</Grid>
        <Grid item xs={6} sm={3}>{tf('remittance_due_day', 'Remit by (day)', { type: 'number', helperText: 'Of the following month' })}</Grid>
        <Grid item xs={6} sm={3}>{tf('min_entry_age', 'Min Entry Age', { type: 'number' })}</Grid>
        <Grid item xs={6} sm={3}>{tf('max_entry_age', 'Max Entry Age', { type: 'number' })}</Grid>
        <Grid item xs={12} sm={6}>{tf('account_manager', 'Account Manager')}</Grid>
        <Grid item xs={12} sm={6}>{tf('status', 'Scheme Status', { select: true, children: ['Active', 'Lapsed', 'Cancelled'].map(t => <MenuItem key={t} value={t}>{t}</MenuItem>) })}</Grid>
      </Grid>
      <Typography sx={sec}>Plans / Tiers (monthly premium per employee)</Typography>
      {value.plans.map((p, i) => (
        <Stack key={i} direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1 }} alignItems={{ sm: 'center' }}>
          <TextField size="small" label="Plan name" value={p.name} onChange={e => setPlan(i, 'name', e.target.value)} sx={{ flex: 1.2 }} />
          <TextField size="small" type="number" label="Monthly premium" value={p.monthly_premium} onChange={e => setPlan(i, 'monthly_premium', e.target.value)} sx={{ flex: 1 }} />
          <TextField size="small" type="number" label="Sum insured / limit" value={p.sum_insured} onChange={e => setPlan(i, 'sum_insured', e.target.value)} sx={{ flex: 1 }} />
          <TextField size="small" label="Key benefits" value={p.benefits} onChange={e => setPlan(i, 'benefits', e.target.value)} sx={{ flex: 2 }} />
          <IconButton size="small" disabled={value.plans.length === 1} onClick={() => onChange({ ...value, plans: value.plans.filter((_, j) => j !== i) })}><DeleteOutlineIcon fontSize="small" /></IconButton>
        </Stack>
      ))}
      <Button size="small" startIcon={<AddIcon />} onClick={() => onChange({ ...value, plans: [...value.plans, { name: '', monthly_premium: '', sum_insured: '', benefits: '' }] })} sx={{ textTransform: 'none' }}>Add plan</Button>
      <Typography sx={sec}>Notes</Typography>
      {tf('notes', 'Notes / special conditions', { multiline: true, minRows: 2 })}
    </Box>
  );
}

export const schemeFormErrors = (v, hideCompany) => {
  const e = [];
  if (!hideCompany && !v.company_name.trim()) e.push('Company name');
  if (!v.product_name.trim()) e.push('Product name');
  if (!v.insurer) e.push('Insurer');
  if (!v.period_from || !v.period_to) e.push('Policy year dates');
  else if (toDate(v.period_to) <= toDate(v.period_from)) e.push('Anniversary must be after the start');
  if (v.commission_rate === '' || v.commission_rate === null) e.push('Commission %');
  if (!v.plans.some(p => p.name.trim() && num(p.monthly_premium) > 0)) e.push('At least one plan with a premium');
  return e;
};

export function SchemeDialog({ open, initial, insurers, onClose, onSave }) {
  const [v, setV] = useState(emptyScheme());
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setV(initial ? schemeToForm(initial) : emptyScheme()); }, [open, initial]);
  const errs = schemeFormErrors(v);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>{initial ? 'Edit Scheme' : 'New Worksite Scheme'}</DialogTitle>
      <DialogContent dividers><SchemeForm value={v} onChange={setV} insurers={insurers} /></DialogContent>
      <DialogActions>
        {errs.length > 0 && <Typography sx={{ fontSize: 12, color: '#B45309', mr: 'auto', pl: 1 }}>Required: {errs.join(', ')}</Typography>}
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Cancel</Button>
        <Button disabled={!!errs.length || saving} sx={btnGrad} onClick={async () => { setSaving(true); try { await onSave(schemePayload(v, initial)); } finally { setSaving(false); } }}>
          {saving ? 'Saving…' : 'Save Scheme'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ── Upload wizard ───────────────────────────────────────────────────────── */
const STEPS = ['File', 'Scheme', 'Map Columns', 'Preview & Import'];

export function UploadDialog({ open, onClose, schemes, members, insurers, presetSchemeId, user, onDone }) {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [parseErr, setParseErr] = useState('');
  const [mode, setMode] = useState('existing'); // existing | new | split
  const [schemeId, setSchemeId] = useState('');
  const [tpl, setTpl] = useState(emptyScheme());
  const [joinDate, setJoinDate] = useState(firstOfMonth());
  const [map, setMap] = useState({});
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [unmatchedPlan, setUnmatchedPlan] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setStep(0); setFile(null); setParsed(null); setParseErr(''); setErr(''); setBusy(false);
    setMode(presetSchemeId ? 'existing' : (schemes.length ? 'existing' : 'new'));
    setSchemeId(presetSchemeId || ''); setTpl(emptyScheme()); setJoinDate(firstOfMonth());
    setMap({}); setOnlyIssues(false); setUnmatchedPlan('');
  }, [open, presetSchemeId, schemes.length]);

  const scheme = schemes.find(s => s.id === schemeId);
  // The scheme whose plans / rules apply to validation (template for new/split).
  const ruleScheme = useMemo(() => (mode === 'existing' ? scheme : schemePayload(tpl)), [mode, scheme, tpl]);
  const year = useMemo(() => (ruleScheme ? currentYear(ruleScheme) : null), [ruleScheme]);

  const pickFile = async (f) => {
    setFile(f); setParsed(null); setParseErr('');
    if (!f) return;
    try {
      const p = await parseUpload(f);
      if (!p.rows.length) throw new Error('No response rows found in the file.');
      setParsed(p);
    } catch (e) { setParseErr(e.message || 'Could not read the file.'); }
  };

  const goMap = () => {
    // Reuse the mapping saved on the chosen scheme, else the most recent upload's.
    const saved = (mode === 'existing' && scheme?.column_map)
      || [...schemes].filter(s => s.column_map).sort((a, b) => String(b.last_upload_at || '').localeCompare(String(a.last_upload_at || '')))[0]?.column_map || {};
    setMap(autoMap(parsed.headers, saved));
    setStep(2);
  };

  // Build preview rows: per company group, matched scheme, new/update/error status.
  const preview = useMemo(() => {
    if (step < 3 || !parsed) return null;
    const out = []; const seen = new Map();
    parsed.rows.forEach((row, idx) => {
      const m = rowToMember(row, map, ruleScheme, joinDate);
      if (!m.plan_matched && unmatchedPlan) {
        const p = (ruleScheme.plans || []).find(x => x.name === unmatchedPlan);
        if (p) { m.plan = p.name; m.plan_matched = true; m.monthly_premium = m.monthly_premium || num(p.monthly_premium); m.sum_insured = num(p.sum_insured); }
      }
      const company = mode === 'split' ? m.company : (mode === 'existing' ? scheme?.company_name : tpl.company_name);
      const target = mode === 'existing' ? scheme
        : mode === 'split' ? schemes.find(s => norm(s.company_name) === norm(company) && norm(s.product_name) === norm(tpl.product_name)) : null;
      const { errors, warnings } = validateMember(m, ruleScheme, year);
      if (mode === 'split' && !company) errors.push('Company missing');
      const existing = target && m.nic ? members.find(x => x.scheme_id === target.id && x.nic === m.nic) : null;
      const r = { idx: idx + 2, m, company, target, existing, errors, warnings, action: errors.length ? 'Error' : existing ? (existing.status === 'Removed' ? 'Re-join' : 'Update') : 'New' };
      // The same NIC twice for the same company: the later response is the correction.
      const dupKey = `${norm(company)}|${m.nic}`;
      if (m.nic && seen.has(dupKey)) { const prev = seen.get(dupKey); prev.action = 'Superseded'; prev.warnings.push(`Replaced by row ${r.idx}`); }
      if (m.nic) seen.set(dupKey, r);
      out.push(r);
    });
    return out;
  }, [step, parsed, map, ruleScheme, joinDate, unmatchedPlan, mode, scheme, schemes, tpl, members, year]);

  const counts = useMemo(() => {
    const c = { New: 0, Update: 0, 'Re-join': 0, Error: 0, Superseded: 0, companies: new Set(), newCompanies: new Set(), unmatched: 0 };
    (preview || []).forEach(r => { c[r.action]++; if (r.company) c.companies.add(norm(r.company)); if (mode !== 'existing' && !r.target && r.company && r.action !== 'Error') c.newCompanies.add(norm(r.company)); if (!r.m.plan_matched) c.unmatched++; });
    return c;
  }, [preview, mode]);

  const doImport = async () => {
    setBusy(true); setErr('');
    try {
      const rows = preview.filter(r => ['New', 'Update', 'Re-join'].includes(r.action));
      // Resolve / create the scheme for each company.
      const schemeFor = new Map();
      const by = user?.full_name || user?.email || '';
      for (const r of rows) {
        const key = norm(r.company);
        if (schemeFor.has(key)) continue;
        if (r.target) { schemeFor.set(key, r.target.id); continue; }
        const payload = { ...schemePayload({ ...tpl, company_name: r.company || tpl.company_name }), created_at: serverTimestamp(), created_by: by, ledger: {} };
        const ref = await addDoc(collection(db, 'worksite_schemes'), payload);
        schemeFor.set(key, ref.id);
      }
      const stats = {}; // schemeId → {added, updated}
      let batch = writeBatch(db); let ops = 0;
      const flush = async () => { if (ops) { await batch.commit(); batch = writeBatch(db); ops = 0; } };
      const now = new Date().toISOString();
      for (const r of rows) {
        const sid = schemeFor.get(norm(r.company));
        stats[sid] = stats[sid] || { added: 0, updated: 0 };
        const { plan_matched, company, ...m } = r.m;
        const raw = {}; Object.entries(parsed.rows[r.idx - 2]).forEach(([k, v]) => { raw[k.slice(0, 120)] = v instanceof Date ? ymd(v) : String(v ?? '').slice(0, 500); });
        if (r.existing) {
          // Update details with non-empty values; keep the original join date unless re-joining.
          const upd = {};
          Object.entries(m).forEach(([k, v]) => { if (v !== '' && v !== 0 && v !== null && k !== 'join_date') upd[k] = v; });
          if (r.action === 'Re-join') Object.assign(upd, { status: 'Active', join_date: m.join_date, exit_date: '', exit_reason: '', batch: m.join_date.slice(0, 7) });
          batch.update(doc(db, 'worksite_members', r.existing.id), { ...upd, form_response: raw, updated_at: now, updated_by: by });
          stats[sid].updated++;
        } else {
          batch.set(doc(collection(db, 'worksite_members')), { ...m, scheme_id: sid, status: 'Active', batch: m.join_date.slice(0, 7), exit_date: '', exit_reason: '', form_response: raw, created_at: now, created_by: by, source: 'upload' });
          stats[sid].added++;
        }
        if (++ops >= 400) await flush();
      }
      for (const [sid, st] of Object.entries(stats)) {
        batch.update(doc(db, 'worksite_schemes', sid), {
          column_map: map, last_upload_at: now,
          uploads: arrayUnion({ at: now, by, file: file?.name || '', join_date: joinDate, added: st.added, updated: st.updated, skipped: counts.Error }),
        });
        if (++ops >= 400) await flush();
      }
      await flush();
      logActivity(`Worksite upload: ${file?.name || ''} — ${rows.length} member(s) across ${Object.keys(stats).length} scheme(s)`);
      onDone(`Imported ${counts.New + counts['Re-join']} new and ${counts.Update} updated member(s)${counts.Error ? ` · ${counts.Error} row(s) skipped` : ''}.`, Object.keys(stats));
    } catch (e) {
      setErr(e.message || 'Import failed.');
    } finally { setBusy(false); }
  };

  const tplErrs = mode === 'existing' ? (scheme ? [] : ['Choose a scheme']) : schemeFormErrors(tpl, mode === 'split');
  const mapErrs = MEMBER_FIELDS.filter(f => f.required && !map[f.key]).map(f => f.label.replace(' *', ''));
  if (mode === 'split' && !map.company) mapErrs.push('Company column');
  const shown = (preview || []).filter(r => !onlyIssues || r.errors.length || r.warnings.length || r.action === 'Superseded');
  const actColor = { New: '#059669', Update: NAVY, 'Re-join': '#7C3AED', Error: '#DC2626', Superseded: '#9CA3AF' };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>Upload Enrolment Responses</DialogTitle>
      <DialogContent dividers>
        <Stepper activeStep={step} sx={{ mb: 2.5 }} alternativeLabel>{STEPS.map(s => <Step key={s}><StepLabel>{s}</StepLabel></Step>)}</Stepper>

        {step === 0 && (
          <Box>
            <Button component="label" variant="outlined" startIcon={<UploadFileOutlinedIcon />} sx={{ textTransform: 'none', borderRadius: '10px' }}>
              {file ? file.name : 'Choose Microsoft Forms export (.xlsx / .csv)'}
              <input hidden type="file" accept=".xlsx,.csv,.xls" onChange={e => pickFile(e.target.files?.[0] || null)} />
            </Button>
            {parseErr && <Alert severity="error" sx={{ mt: 1.5 }}>{parseErr}</Alert>}
            {parsed && <Alert severity="success" sx={{ mt: 1.5 }}>{parsed.rows.length} response(s), {parsed.headers.length} column(s) found.</Alert>}
            <Typography sx={sec}>Who is this upload for?</Typography>
            <RadioGroup value={mode} onChange={e => setMode(e.target.value)}>
              <FormControlLabel value="existing" disabled={!schemes.length} control={<Radio size="small" />} label="An existing scheme (add new joiners / update members)" />
              <FormControlLabel value="new" control={<Radio size="small" />} label="A new company — set up the scheme now" />
              <FormControlLabel value="split" control={<Radio size="small" />} label="Several companies in one file — split by a Company column (one scheme per company)" />
            </RadioGroup>
            <Typography sx={sec}>Enrolment batch / cover start</Typography>
            <TextField size="small" type="date" label="Join date for this batch" value={joinDate} onChange={e => setJoinDate(e.target.value)} InputLabelProps={{ shrink: true }}
              helperText="Used when the file has no join-date column. Members are billed monthly from this month to the anniversary." />
          </Box>
        )}

        {step === 1 && (mode === 'existing' ? (
          <Box>
            <TextField select fullWidth size="small" label="Scheme" value={schemeId} onChange={e => setSchemeId(e.target.value)}>
              {schemes.map(s => <MenuItem key={s.id} value={s.id}>{s.company_name} — {s.product_name}{s.status !== 'Active' ? ` (${s.status})` : ''}</MenuItem>)}
            </TextField>
            {scheme && <Alert severity="info" sx={{ mt: 1.5 }}>Plans: {(scheme.plans || []).map(p => `${p.name} (Rs ${money(p.monthly_premium)}/mo)`).join(' · ')} — anniversary {currentYear(scheme).to}.</Alert>}
          </Box>
        ) : (
          <Box>
            {mode === 'split' && <Alert severity="info" sx={{ mb: 1 }}>These product details are used for every company in the file. Companies that already have this product are matched by name; the rest get a new scheme. You can change commission and details per company afterwards.</Alert>}
            <SchemeForm value={tpl} onChange={setTpl} insurers={insurers} hideCompany={mode === 'split'} />
          </Box>
        ))}

        {step === 2 && parsed && (
          <Box>
            <Alert severity="info" sx={{ mb: 2 }}>Match each system field to a column from the form. Mappings are remembered for the next upload. NIC is the unique key — re-uploading updates existing members instead of duplicating them. DOB and gender are read from the NIC when not in the form.</Alert>
            <Grid container spacing={1.5}>
              {MEMBER_FIELDS.filter(f => f.key !== 'company' || mode === 'split').map(f => (
                <Grid item xs={12} sm={6} md={4} key={f.key}>
                  <TextField select fullWidth size="small" label={f.label} value={map[f.key] || ''} helperText={f.hint || (parsed.rows[0] && map[f.key] ? `e.g. ${String(parsed.rows[0][map[f.key]] instanceof Date ? ymd(parsed.rows[0][map[f.key]]) : parsed.rows[0][map[f.key]] ?? '').slice(0, 40)}` : ' ')}
                    onChange={e => setMap({ ...map, [f.key]: e.target.value })}>
                    <MenuItem value=""><em>— not in form —</em></MenuItem>
                    {parsed.headers.map(h => <MenuItem key={h} value={h}>{h}</MenuItem>)}
                  </TextField>
                </Grid>
              ))}
            </Grid>
          </Box>
        )}

        {step === 3 && preview && (
          <Box>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
              <Chip label={`New ${counts.New}`} sx={{ bgcolor: '#ECFDF5', color: '#059669', fontWeight: 700 }} />
              <Chip label={`Update ${counts.Update}`} sx={{ bgcolor: '#EFF6FF', color: NAVY, fontWeight: 700 }} />
              {counts['Re-join'] > 0 && <Chip label={`Re-join ${counts['Re-join']}`} sx={{ bgcolor: '#F5F3FF', color: '#7C3AED', fontWeight: 700 }} />}
              <Chip label={`Errors ${counts.Error}`} sx={{ bgcolor: '#FEF2F2', color: '#DC2626', fontWeight: 700 }} />
              {counts.Superseded > 0 && <Chip label={`Duplicates superseded ${counts.Superseded}`} />}
              {mode === 'split' && <Chip label={`${counts.companies.size} companies · ${counts.newCompanies.size} new scheme(s)`} sx={{ fontWeight: 700 }} />}
              <FormControlLabel sx={{ ml: 1 }} control={<Checkbox size="small" checked={onlyIssues} onChange={e => setOnlyIssues(e.target.checked)} />} label="Show only issues" />
            </Stack>
            {counts.unmatched > 0 && (ruleScheme?.plans || []).length > 0 && (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
                <Alert severity="warning" sx={{ flex: 1, py: 0 }}>{counts.unmatched} row(s) have a plan that doesn't match the scheme's plans.</Alert>
                <TextField select size="small" label="Apply plan to those rows" value={unmatchedPlan} onChange={e => setUnmatchedPlan(e.target.value)} sx={{ minWidth: 220 }}>
                  <MenuItem value=""><em>Leave as is</em></MenuItem>
                  {ruleScheme.plans.map(p => <MenuItem key={p.name} value={p.name}>{p.name} (Rs {money(p.monthly_premium)})</MenuItem>)}
                </TextField>
              </Stack>
            )}
            <TableContainer sx={{ maxHeight: 420, border: '1px solid #E5E7EB', borderRadius: '10px' }}>
              <Table size="small" stickyHeader>
                <TableHead><TableRow>
                  {['Row', 'Action', mode === 'split' ? 'Company' : null, 'Name', 'NIC', 'Plan', 'Monthly', 'Join', 'To anniversary', 'Issues'].filter(Boolean).map(h => <TableCell key={h} sx={{ fontWeight: 700, fontSize: 12, bgcolor: '#F2F7FC' }}>{h}</TableCell>)}
                </TableRow></TableHead>
                <TableBody>
                  {shown.slice(0, 500).map(r => {
                    const toAnn = year ? premiumToAnniversary({ ...r.m, status: 'Active' }, year) : null;
                    return (
                      <TableRow key={r.idx} sx={{ opacity: r.action === 'Superseded' ? 0.5 : 1 }}>
                        <TableCell sx={{ fontSize: 12 }}>{r.idx}</TableCell>
                        <TableCell><Chip size="small" label={r.action} sx={{ fontSize: 11, fontWeight: 700, color: actColor[r.action], bgcolor: 'transparent', border: `1px solid ${actColor[r.action]}` }} /></TableCell>
                        {mode === 'split' && <TableCell sx={{ fontSize: 12 }}>{r.company}{!r.target && r.company ? <Chip size="small" label="new" sx={{ ml: 0.5, height: 18, fontSize: 10 }} /> : null}</TableCell>}
                        <TableCell sx={{ fontSize: 12 }}>{r.m.full_name}</TableCell>
                        <TableCell sx={{ fontSize: 12 }}>{r.m.nic}</TableCell>
                        <TableCell sx={{ fontSize: 12 }}>{r.m.plan}</TableCell>
                        <TableCell sx={{ fontSize: 12 }}>{r.m.monthly_premium ? money(r.m.monthly_premium) : '—'}</TableCell>
                        <TableCell sx={{ fontSize: 12 }}>{r.m.join_date}</TableCell>
                        <TableCell sx={{ fontSize: 12 }}>{toAnn && toAnn.months ? `${toAnn.months} mo · ${money(toAnn.amount)}` : '—'}</TableCell>
                        <TableCell sx={{ fontSize: 11.5 }}>
                          {r.errors.map(e => <Box key={e} sx={{ color: '#DC2626' }}>{e}</Box>)}
                          {r.warnings.map(w => <Box key={w} sx={{ color: '#B45309' }}>{w}</Box>)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
            {shown.length > 500 && <Typography sx={{ fontSize: 12, color: '#6B7280', mt: 1 }}>Showing first 500 of {shown.length} rows.</Typography>}
            {busy && <LinearProgress sx={{ mt: 1.5 }} />}
            {err && <Alert severity="error" sx={{ mt: 1.5 }}>{err}</Alert>}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {step === 1 && tplErrs.length > 0 && <Typography sx={{ fontSize: 12, color: '#B45309', mr: 'auto', pl: 1 }}>Required: {tplErrs.join(', ')}</Typography>}
        {step === 2 && mapErrs.length > 0 && <Typography sx={{ fontSize: 12, color: '#B45309', mr: 'auto', pl: 1 }}>Map: {mapErrs.join(', ')}</Typography>}
        <Button onClick={onClose} disabled={busy} sx={{ textTransform: 'none' }}>Cancel</Button>
        {step > 0 && <Button onClick={() => setStep(step - 1)} disabled={busy} sx={{ textTransform: 'none' }}>Back</Button>}
        {step === 0 && <Button sx={btnGrad} disabled={!parsed} onClick={() => setStep(1)}>Next</Button>}
        {step === 1 && <Button sx={btnGrad} disabled={!!tplErrs.length} onClick={goMap}>Next</Button>}
        {step === 2 && <Button sx={btnGrad} disabled={!!mapErrs.length} onClick={() => setStep(3)}>Preview</Button>}
        {step === 3 && <Button sx={btnGrad} disabled={busy || !(counts.New + counts.Update + counts['Re-join'])} onClick={doImport}>
          {busy ? 'Importing…' : `Import ${counts.New + counts.Update + counts['Re-join']} member(s)`}
        </Button>}
      </DialogActions>
    </Dialog>
  );
}

/* ── Member add / edit ───────────────────────────────────────────────────── */
const emptyMember = () => ({
  full_name: '', nic: '', employee_no: '', dob: '', gender: '', mobile: '', email: '', address: '', department: '',
  plan: '', monthly_premium: '', sum_insured: '', join_date: firstOfMonth(), status: 'Active', exit_date: '', exit_reason: '',
  nominee_name: '', nominee_relationship: '', nominee_nic: '', nominee_mobile: '', nominee_share: '100', notes: '',
});

export function MemberDialog({ open, initial, scheme, members, onClose, onSave }) {
  const [v, setV] = useState(emptyMember());
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setV(initial ? { ...emptyMember(), ...initial } : { ...emptyMember(), plan: scheme?.plans?.[0]?.name || '', monthly_premium: scheme?.plans?.[0]?.monthly_premium || '', sum_insured: scheme?.plans?.[0]?.sum_insured || '' }); }, [open, initial, scheme]);
  const set = (k) => (e) => {
    const val = e.target.value; const nv = { ...v, [k]: val };
    if (k === 'plan') { const p = (scheme?.plans || []).find(x => x.name === val); if (p) { nv.monthly_premium = p.monthly_premium; nv.sum_insured = p.sum_insured; } }
    if (k === 'nic') { const info = nicInfo(val); if (info) { if (!v.dob) nv.dob = info.dob; if (!v.gender) nv.gender = info.gender; } }
    setV(nv);
  };
  const tf = (k, label, props = {}) => <TextField fullWidth size="small" label={label} value={v[k] ?? ''} onChange={set(k)} {...props} />;
  const nic = normNic(v.nic);
  const dup = nic && members.find(m => m.scheme_id === scheme?.id && m.nic === nic && m.id !== initial?.id);
  const errs = [!v.full_name.trim() && 'Name', !nic && 'NIC', dup && 'NIC already enrolled', !num(v.monthly_premium) && 'Premium', !v.join_date && 'Join date', v.status !== 'Active' && !v.exit_date && 'Exit date'].filter(Boolean);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>{initial ? 'Edit Member' : 'Add Member'}</DialogTitle>
      <DialogContent dividers>
        <Typography sx={sec}>Employee</Typography>
        <Grid container spacing={1.5}>
          <Grid item xs={12} sm={6}>{tf('full_name', 'Full Name *')}</Grid>
          <Grid item xs={12} sm={3}>{tf('nic', 'NIC *', { error: !!dup, helperText: dup ? `Already enrolled: ${dup.full_name}` : ' ' })}</Grid>
          <Grid item xs={12} sm={3}>{tf('employee_no', 'Employee / EPF No.')}</Grid>
          <Grid item xs={6} sm={3}>{tf('dob', 'Date of Birth', { type: 'date', InputLabelProps: { shrink: true } })}</Grid>
          <Grid item xs={6} sm={3}>{tf('gender', 'Gender', { select: true, children: ['', 'Male', 'Female'].map(g => <MenuItem key={g} value={g}>{g || '—'}</MenuItem>) })}</Grid>
          <Grid item xs={6} sm={3}>{tf('mobile', 'Mobile')}</Grid>
          <Grid item xs={6} sm={3}>{tf('email', 'Email')}</Grid>
          <Grid item xs={12} sm={6}>{tf('department', 'Department / Branch')}</Grid>
          <Grid item xs={12} sm={6}>{tf('address', 'Address')}</Grid>
        </Grid>
        <Typography sx={sec}>Cover</Typography>
        <Grid container spacing={1.5}>
          <Grid item xs={12} sm={4}>{tf('plan', 'Plan', { select: true, children: [...new Set([...(scheme?.plans || []).map(p => p.name), v.plan].filter(Boolean))].map(n => <MenuItem key={n} value={n}>{n}</MenuItem>) })}</Grid>
          <Grid item xs={6} sm={4}>{tf('monthly_premium', 'Monthly Premium *', { type: 'number' })}</Grid>
          <Grid item xs={6} sm={4}>{tf('sum_insured', 'Sum Insured / Limit', { type: 'number' })}</Grid>
          <Grid item xs={6} sm={4}>{tf('join_date', 'Join / Cover Start *', { type: 'date', InputLabelProps: { shrink: true } })}</Grid>
          <Grid item xs={6} sm={4}>{tf('status', 'Status', { select: true, children: MEMBER_STATUSES.map(s => <MenuItem key={s} value={s}>{s === 'Continuing' ? 'Continuing (pays individually)' : s}</MenuItem>) })}</Grid>
          {v.status !== 'Active' && <Grid item xs={6} sm={4}>{tf('exit_date', 'Exit / Switch Date *', { type: 'date', InputLabelProps: { shrink: true } })}</Grid>}
          {v.status !== 'Active' && <Grid item xs={12}>{tf('exit_reason', 'Reason (resigned, retired, opted out, non-payment…)')}</Grid>}
        </Grid>
        <Typography sx={sec}>Nominee / Beneficiary</Typography>
        <Grid container spacing={1.5}>
          <Grid item xs={12} sm={4}>{tf('nominee_name', 'Nominee Name')}</Grid>
          <Grid item xs={6} sm={3}>{tf('nominee_relationship', 'Relationship', { select: true, children: [...new Set(['', ...RELATIONSHIPS, v.nominee_relationship])].map(r => <MenuItem key={r} value={r}>{r || '—'}</MenuItem>) })}</Grid>
          <Grid item xs={6} sm={2}>{tf('nominee_share', 'Share %')}</Grid>
          <Grid item xs={6} sm={3}>{tf('nominee_nic', 'Nominee NIC')}</Grid>
          <Grid item xs={6} sm={4}>{tf('nominee_mobile', 'Nominee Contact')}</Grid>
          <Grid item xs={12} sm={8}>{tf('notes', 'Notes')}</Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        {errs.length > 0 && <Typography sx={{ fontSize: 12, color: '#B45309', mr: 'auto', pl: 1 }}>Required: {errs.join(', ')}</Typography>}
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Cancel</Button>
        <Button sx={btnGrad} disabled={!!errs.length || saving} onClick={async () => {
          setSaving(true);
          try {
            await onSave({ ...v, nic, nominee_nic: normNic(v.nominee_nic), monthly_premium: num(v.monthly_premium), sum_insured: num(v.sum_insured), exit_date: v.status === 'Active' ? '' : v.exit_date, exit_reason: v.status === 'Active' ? '' : v.exit_reason, batch: String(v.join_date).slice(0, 7) });
          } finally { setSaving(false); }
        }}>{saving ? 'Saving…' : 'Save Member'}</Button>
      </DialogActions>
    </Dialog>
  );
}

/* ── Exit (leaver) ───────────────────────────────────────────────────────── */
export function ExitDialog({ open, member, isAdmin, onClose, onSave, onDelete }) {
  const [choice, setChoice] = useState('Continuing');
  const [date, setDate] = useState(ymd(new Date()));
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) { setChoice('Continuing'); setDate(ymd(new Date())); setReason(''); } }, [open]);
  if (!member) return null;
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>Member leaving — {member.full_name}</DialogTitle>
      <DialogContent dividers>
        <RadioGroup value={choice} onChange={e => setChoice(e.target.value)}>
          <FormControlLabel value="Continuing" control={<Radio size="small" />} label={<Box><b>Continue cover individually</b><Typography sx={{ fontSize: 12, color: '#6B7280' }}>Employer deductions stop; the member keeps the cover and pays the premium themselves. Still renews at the anniversary.</Typography></Box>} />
          <FormControlLabel value="Removed" control={<Radio size="small" />} label={<Box><b>Remove from scheme</b><Typography sx={{ fontSize: 12, color: '#6B7280' }}>Cover ends. The record and premium history are kept for reports.</Typography></Box>} />
          {isAdmin && <FormControlLabel value="Delete" control={<Radio size="small" />} label={<Box><b style={{ color: '#DC2626' }}>Delete from the database</b><Typography sx={{ fontSize: 12, color: '#6B7280' }}>Permanently erases the member. Past months' premium due will be recalculated without them — use only for wrong entries.</Typography></Box>} />}
        </RadioGroup>
        {choice !== 'Delete' && (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 2 }}>
            <TextField size="small" type="date" label={choice === 'Continuing' ? 'Last employer deduction / switch date' : 'Cover end date'} value={date} onChange={e => setDate(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ minWidth: 230 }}
              helperText="Exit month is still billed unless the date is the 1st." />
            <TextField size="small" fullWidth label="Reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="Resigned / retired / opted out / non-payment" />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Cancel</Button>
        {choice === 'Delete'
          ? <Button color="error" variant="contained" sx={{ textTransform: 'none', fontWeight: 700 }} onClick={onDelete}>Delete permanently</Button>
          : <Button sx={btnGrad} disabled={!date} onClick={() => onSave({ status: choice, exit_date: date, exit_reason: reason })}>Confirm</Button>}
      </DialogActions>
    </Dialog>
  );
}

/* ── Monthly ledger entry (remittance to insurer + commission received) ──── */
export function LedgerDialog({ open, row, onClose, onSave }) {
  const [v, setV] = useState({});
  useEffect(() => {
    if (open && row) setV({
      remitted_group: row.remitted_group || '', remitted_individual: row.remitted_individual || '', remitted_date: row.remitted_date, remittance_ref: row.remittance_ref,
      commission_rate: row.rate, commission_received: row.commRec || '', commission_received_date: row.commission_received_date, commission_ref: row.commission_ref, notes: row.notes,
    });
  }, [open, row]);
  if (!row) return null;
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const remitted = num(v.remitted_group) + num(v.remitted_individual);
  const commDue = remitted * num(v.commission_rate) / 100;
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>{monthLabel(row.month)} — Premium & Commission</DialogTitle>
      <DialogContent dividers>
        <Alert severity="info" sx={{ mb: 1.5 }}>
          Due: payroll Rs {money(row.group)} ({row.gCount}) + individual Rs {money(row.individual)} ({row.iCount}) = <b>Rs {money(row.due)}</b> · remit by {row.due_by}
        </Alert>
        <Typography sx={sec}>Premium paid to insurer</Typography>
        <Grid container spacing={1.5}>
          <Grid item xs={6}><TextField fullWidth size="small" type="number" label="By employer (payroll)" value={v.remitted_group ?? ''} onChange={set('remitted_group')} helperText={<span style={{ cursor: 'pointer', color: NAVY }} onClick={() => setV({ ...v, remitted_group: row.group })}>Fill due amount</span>} /></Grid>
          <Grid item xs={6}><TextField fullWidth size="small" type="number" label="By individual payers" value={v.remitted_individual ?? ''} onChange={set('remitted_individual')} helperText={<span style={{ cursor: 'pointer', color: NAVY }} onClick={() => setV({ ...v, remitted_individual: row.individual })}>Fill due amount</span>} /></Grid>
          <Grid item xs={6}><TextField fullWidth size="small" type="date" label="Paid on" value={v.remitted_date || ''} onChange={set('remitted_date')} InputLabelProps={{ shrink: true }} /></Grid>
          <Grid item xs={6}><TextField fullWidth size="small" label="Insurer receipt / ref" value={v.remittance_ref || ''} onChange={set('remittance_ref')} /></Grid>
        </Grid>
        <Typography sx={sec}>Commission from insurer</Typography>
        <Grid container spacing={1.5}>
          <Grid item xs={4}><TextField fullWidth size="small" type="number" label="Rate %" value={v.commission_rate ?? ''} onChange={set('commission_rate')} /></Grid>
          <Grid item xs={8}><TextField fullWidth size="small" disabled label="Commission earned (on premium paid)" value={money(commDue)} /></Grid>
          <Grid item xs={4}><TextField fullWidth size="small" type="number" label="Received" value={v.commission_received ?? ''} onChange={set('commission_received')} helperText={<span style={{ cursor: 'pointer', color: NAVY }} onClick={() => setV({ ...v, commission_received: Math.round(commDue * 100) / 100 })}>Fill earned</span>} /></Grid>
          <Grid item xs={4}><TextField fullWidth size="small" type="date" label="Received on" value={v.commission_received_date || ''} onChange={set('commission_received_date')} InputLabelProps={{ shrink: true }} /></Grid>
          <Grid item xs={4}><TextField fullWidth size="small" label="Commission ref" value={v.commission_ref || ''} onChange={set('commission_ref')} /></Grid>
          <Grid item xs={12}><TextField fullWidth size="small" label="Notes" value={v.notes || ''} onChange={set('notes')} /></Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Cancel</Button>
        <Button sx={btnGrad} onClick={() => onSave({
          remitted_group: num(v.remitted_group), remitted_individual: num(v.remitted_individual), remitted_date: v.remitted_date || '', remittance_ref: v.remittance_ref || '',
          commission_rate: num(v.commission_rate), commission_received: num(v.commission_received), commission_received_date: v.commission_received_date || '', commission_ref: v.commission_ref || '', notes: v.notes || '',
        })}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

/* ── Anniversary renewal ─────────────────────────────────────────────────── */
export function RenewDialog({ open, scheme, activeCount, onClose, onRenew }) {
  const [rate, setRate] = useState('');
  const [plans, setPlans] = useState([]);
  const [apply, setApply] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open && scheme) { setRate(scheme.commission_rate ?? ''); setPlans((scheme.plans || []).map(p => ({ ...p, new_premium: p.monthly_premium }))); setApply(true); } }, [open, scheme]);
  if (!scheme) return null;
  const y = currentYear(scheme); const ny = nextPolicyYear(y);
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>Renew at Anniversary</DialogTitle>
      <DialogContent dividers>
        <Alert severity="info" sx={{ mb: 1.5 }}>
          Closes policy year {y.from} → {y.to} (its monthly premium figures are frozen) and opens <b>{ny?.from} → {ny?.to}</b>. All {activeCount} active / continuing member(s) roll over; removed members do not.
        </Alert>
        <TextField size="small" type="number" label="Commission % for the new year" value={rate} onChange={e => setRate(e.target.value)} sx={{ mb: 2 }} />
        <Typography sx={sec}>Plan premiums for the new year</Typography>
        {plans.map((p, i) => (
          <Stack key={p.name} direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Typography sx={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{p.name}</Typography>
            <Typography sx={{ fontSize: 12, color: '#6B7280', width: 110 }}>now {money(p.monthly_premium)}</Typography>
            <TextField size="small" type="number" label="New monthly" value={p.new_premium} onChange={e => setPlans(plans.map((x, j) => j === i ? { ...x, new_premium: e.target.value } : x))} sx={{ width: 150 }} />
          </Stack>
        ))}
        <FormControlLabel control={<Checkbox size="small" checked={apply} onChange={e => setApply(e.target.checked)} />} label="Apply new plan premiums to members on the standard plan rate" />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy} sx={{ textTransform: 'none' }}>Cancel</Button>
        <Button sx={btnGrad} disabled={busy || !ny} onClick={async () => { setBusy(true); try { await onRenew({ nextYear: ny, rate: num(rate), plans, apply }); } finally { setBusy(false); } }}>
          {busy ? 'Renewing…' : `Renew to ${ny?.to || ''}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
