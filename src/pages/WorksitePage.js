import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, getDocs, doc, addDoc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { saveAs } from 'file-saver';
import { db } from '../firebase';
import { useAuth } from '../App';
import { logActivity } from '../utils/workSession';
import { confirmTypedDelete } from '../utils/confirmDelete';
import {
  num, money, monthKey, monthLabel, currentYear, ledgerRows, ledgerTotals, billingBucket,
  premiumToAnniversary, memberPremium, ageOn,
} from '../utils/worksite';
import { SchemeDialog, UploadDialog, MemberDialog, ExitDialog, LedgerDialog, RenewDialog } from '../components/WorksiteDialogs';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Table from '@mui/material/Table';
import TableHead from '@mui/material/TableHead';
import TableBody from '@mui/material/TableBody';
import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import Pagination from '@mui/material/Pagination';
import Skeleton from '@mui/material/Skeleton';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import LogoutOutlinedIcon from '@mui/icons-material/LogoutOutlined';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import RestoreIcon from '@mui/icons-material/Restore';

const NAVY = '#255EAB';
const btnGrad = { background: 'linear-gradient(135deg,#255EAB,#38A3E0)', color: '#fff', fontWeight: 700, textTransform: 'none', borderRadius: '10px', '&:hover': { background: 'linear-gradient(135deg,#1D4E96,#2E76C4)' } };
const btnOut = { textTransform: 'none', fontWeight: 700, borderRadius: '10px', borderColor: 'rgba(37,94,171,0.35)', color: NAVY };
const th = { fontWeight: 700, fontSize: 12, color: '#0A1A3E', bgcolor: '#F2F7FC', whiteSpace: 'nowrap' };
const td = { fontSize: 12.5, whiteSpace: 'nowrap' };
const STATUS_COLORS = { Active: ['#ECFDF5', '#059669'], Continuing: ['#FFFBEB', '#B45309'], Removed: ['#F3F4F6', '#6B7280'], Lapsed: ['#FEF2F2', '#DC2626'], Cancelled: ['#F3F4F6', '#6B7280'] };
const PER_PAGE = 25;

const StatusChip = ({ s }) => {
  const [bg, fg] = STATUS_COLORS[s] || STATUS_COLORS.Active;
  return <Chip size="small" label={s === 'Continuing' ? 'Continuing (individual)' : s} sx={{ bgcolor: bg, color: fg, fontWeight: 700, fontSize: 11, height: 22 }} />;
};

function Kpi({ label, value, sub, color }) {
  return (
    <Card sx={{ p: 1.8, flex: '1 1 160px', minWidth: 150, border: '1px solid rgba(56,163,224,0.12)', boxShadow: 'none', borderRadius: '14px' }}>
      <Typography sx={{ fontSize: 11, fontWeight: 800, color: '#7C93B0', textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</Typography>
      <Typography sx={{ fontSize: 20, fontWeight: 800, color: color || '#0A1A3E', mt: 0.3 }}>{value}</Typography>
      {sub && <Typography sx={{ fontSize: 11.5, color: '#9CA3AF' }}>{sub}</Typography>}
    </Card>
  );
}

function downloadCsv(name, headers, rows) {
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
  saveAs(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), name);
}
const safeName = (s) => String(s || '').replace(/[^\w-]+/g, '_').slice(0, 60);

export default function WorksitePage() {
  const { user, userProfile } = useAuth();
  const isAdmin = userProfile?.role === 'admin';
  const byName = userProfile?.full_name || user?.email || '';

  const [schemes, setSchemes] = useState([]);
  const [members, setMembers] = useState([]);
  const [insurers, setInsurers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [toast, setToast] = useState({ open: false, msg: '', severity: 'success' });
  const notify = (msg, severity = 'success') => setToast({ open: true, msg, severity });

  const [selId, setSelId] = useState(null);
  const [tab, setTab] = useState(0);
  const [search, setSearch] = useState('');
  const [statusF, setStatusF] = useState('All');
  const [planF, setPlanF] = useState('All');
  const [batchF, setBatchF] = useState('All');
  const [page, setPage] = useState(1);
  const [yearIdx, setYearIdx] = useState(-1);

  const [schemeDlg, setSchemeDlg] = useState({ open: false, initial: null });
  const [uploadDlg, setUploadDlg] = useState({ open: false, preset: '' });
  const [memberDlg, setMemberDlg] = useState({ open: false, initial: null });
  const [exitDlg, setExitDlg] = useState(null);
  const [ledgerDlg, setLedgerDlg] = useState(null);
  const [renewOpen, setRenewOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setLoadErr('');
    try {
      const [sS, mS] = await Promise.all([getDocs(collection(db, 'worksite_schemes')), getDocs(collection(db, 'worksite_members'))]);
      setSchemes(sS.docs.map(d => ({ ...d.data(), id: d.id })));
      setMembers(mS.docs.map(d => ({ ...d.data(), id: d.id })));
    } catch (e) {
      setLoadErr(e.code === 'permission-denied' ? 'Access to worksite data is blocked by the database rules — the updated Firestore rules need to be deployed.' : (e.message || 'Could not load worksite data.'));
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    getDocs(collection(db, 'insurance_companies'))
      .then(s => setInsurers([...new Set(s.docs.map(d => d.data().name).filter(Boolean))].sort()))
      .catch(() => {});
  }, []);

  const nowMk = monthKey(new Date());

  // Per-scheme figures for the current policy year.
  const stats = useMemo(() => {
    const out = {};
    for (const s of schemes) {
      const ms = members.filter(m => m.scheme_id === s.id);
      const y = currentYear(s);
      const rows = ledgerRows(s, ms, y);
      const t = ledgerTotals(rows);
      const cur = rows.find(r => r.month === nowMk);
      out[s.id] = {
        members: ms, rows, totals: t, year: y,
        active: ms.filter(m => m.status === 'Active').length,
        continuing: ms.filter(m => m.status === 'Continuing').length,
        monthly: cur ? cur.due : ms.filter(m => m.status !== 'Removed').reduce((a, m) => a + memberPremium(m), 0),
        annual: rows.reduce((a, r) => a + r.due, 0),
      };
    }
    return out;
  }, [schemes, members, nowMk]);

  const totals = useMemo(() => {
    const t = { active: 0, continuing: 0, monthly: 0, annual: 0, remitted: 0, arrears: 0, commRec: 0, commOs: 0, expectedComm: 0 };
    schemes.filter(s => s.status !== 'Cancelled').forEach(s => {
      const x = stats[s.id]; if (!x) return;
      t.active += x.active; t.continuing += x.continuing; t.monthly += x.monthly; t.annual += x.annual;
      t.remitted += x.totals.remitted; t.arrears += x.totals.arrears; t.commRec += x.totals.commRec; t.commOs += x.totals.commOs; t.expectedComm += x.totals.expectedComm;
    });
    return t;
  }, [schemes, stats]);

  const sel = schemes.find(s => s.id === selId) || null;
  const selStats = sel ? stats[sel.id] : null;
  useEffect(() => { setPage(1); }, [search, statusF, planF, batchF, selId]);
  useEffect(() => { setYearIdx(-1); setTab(0); setStatusF('All'); setPlanF('All'); setBatchF('All'); setSearch(''); }, [selId]);

  /* ── writes ── */
  const saveScheme = async (payload) => {
    try {
      if (schemeDlg.initial) {
        await updateDoc(doc(db, 'worksite_schemes', schemeDlg.initial.id), { ...payload, updated_at: new Date().toISOString(), updated_by: byName });
        logActivity(`Worksite scheme edited: ${payload.company_name} — ${payload.product_name}`);
      } else {
        const ref = await addDoc(collection(db, 'worksite_schemes'), { ...payload, ledger: {}, created_at: new Date().toISOString(), created_by: byName });
        logActivity(`Worksite scheme created: ${payload.company_name} — ${payload.product_name}`);
        setSelId(ref.id);
      }
      setSchemeDlg({ open: false, initial: null }); notify('Scheme saved'); load();
    } catch (e) { notify(e.message || 'Save failed', 'error'); }
  };

  const deleteScheme = async () => {
    const ms = selStats?.members || [];
    if (!confirmTypedDelete(`Delete scheme "${sel.company_name} — ${sel.product_name}" and its ${ms.length} member record(s)?`)) return;
    try {
      let b = writeBatch(db); let n = 0;
      for (const m of ms) { b.delete(doc(db, 'worksite_members', m.id)); if (++n >= 400) { await b.commit(); b = writeBatch(db); n = 0; } }
      b.delete(doc(db, 'worksite_schemes', sel.id)); await b.commit();
      logActivity(`Worksite scheme deleted: ${sel.company_name} — ${sel.product_name} (${ms.length} members)`);
      setSelId(null); notify('Scheme deleted'); load();
    } catch (e) { notify(e.message || 'Delete failed', 'error'); }
  };

  const saveMember = async (data) => {
    try {
      const { id, ...rest } = data;
      if (memberDlg.initial) {
        await updateDoc(doc(db, 'worksite_members', memberDlg.initial.id), { ...rest, updated_at: new Date().toISOString(), updated_by: byName });
        logActivity(`Worksite member edited: ${rest.full_name} (${sel.company_name})`);
      } else {
        await addDoc(collection(db, 'worksite_members'), { ...rest, scheme_id: sel.id, source: 'manual', created_at: new Date().toISOString(), created_by: byName });
        logActivity(`Worksite member added: ${rest.full_name} (${sel.company_name})`);
      }
      setMemberDlg({ open: false, initial: null }); notify('Member saved'); load();
    } catch (e) { notify(e.message || 'Save failed', 'error'); }
  };

  const saveExit = async (vals) => {
    try {
      await updateDoc(doc(db, 'worksite_members', exitDlg.id), { ...vals, updated_at: new Date().toISOString(), updated_by: byName });
      logActivity(`Worksite member ${vals.status === 'Continuing' ? 'continuing individually' : 'removed'}: ${exitDlg.full_name} (${sel.company_name})`);
      setExitDlg(null); notify(vals.status === 'Continuing' ? 'Member now pays individually' : 'Member removed from scheme'); load();
    } catch (e) { notify(e.message || 'Update failed', 'error'); }
  };

  const deleteMember = async () => {
    if (!confirmTypedDelete(`Permanently delete ${exitDlg.full_name} (${exitDlg.nic}) from the database?`)) return;
    try {
      await deleteDoc(doc(db, 'worksite_members', exitDlg.id));
      logActivity(`Worksite member deleted: ${exitDlg.full_name} (${sel.company_name})`);
      setExitDlg(null); notify('Member deleted'); load();
    } catch (e) { notify(e.message || 'Delete failed', 'error'); }
  };

  const reinstate = async (m) => {
    if (!window.confirm(`Reinstate ${m.full_name} as an active (payroll) member? Billing resumes as if they never left.`)) return;
    try {
      await updateDoc(doc(db, 'worksite_members', m.id), { status: 'Active', exit_date: '', exit_reason: '', updated_at: new Date().toISOString(), updated_by: byName });
      logActivity(`Worksite member reinstated: ${m.full_name} (${sel.company_name})`); load();
    } catch (e) { notify(e.message || 'Update failed', 'error'); }
  };

  const saveLedger = async (vals) => {
    try {
      const prev = (sel.ledger || {})[ledgerDlg.month] || {};
      await updateDoc(doc(db, 'worksite_schemes', sel.id), { [`ledger.${ledgerDlg.month}`]: { ...prev, ...vals, updated_at: new Date().toISOString(), updated_by: byName } });
      logActivity(`Worksite ledger ${ledgerDlg.month}: ${sel.company_name} — paid ${money(vals.remitted_group + vals.remitted_individual)}, commission rec. ${money(vals.commission_received)}`);
      setLedgerDlg(null); notify('Saved'); load();
    } catch (e) { notify(e.message || 'Save failed', 'error'); }
  };

  const renew = async ({ nextYear, rate, plans, apply }) => {
    try {
      const closing = selStats.rows;
      const ledger = { ...(sel.ledger || {}) };
      // Freeze the closing year's due figures so new rates never rewrite history.
      closing.forEach(r => { ledger[r.month] = { ...(ledger[r.month] || {}), snapshot: true, due_group: r.group, due_individual: r.individual, count_group: r.gCount, count_individual: r.iCount, commission_rate: (ledger[r.month] || {}).commission_rate ?? num(sel.commission_rate) }; });
      const b = writeBatch(db);
      b.update(doc(db, 'worksite_schemes', sel.id), {
        ledger, policy_years: [...(sel.policy_years || [currentYear(sel)]), nextYear], anniversary_date: nextYear.to, commission_rate: rate,
        plans: plans.map(({ new_premium, ...p }) => ({ ...p, monthly_premium: num(new_premium) })),
        renewals: [...(sel.renewals || []), { at: new Date().toISOString(), by: byName, from: nextYear.from, to: nextYear.to }],
      });
      let changed = 0;
      if (apply) {
        for (const m of selStats.members) {
          if (m.status === 'Removed') continue;
          const p = plans.find(x => x.name === m.plan);
          if (p && num(p.monthly_premium) === memberPremium(m) && num(p.new_premium) !== memberPremium(m)) {
            b.update(doc(db, 'worksite_members', m.id), { monthly_premium: num(p.new_premium), premium_history: [...(m.premium_history || []), { until: currentYear(sel).to, monthly_premium: memberPremium(m) }] });
            changed++;
          }
        }
      }
      await b.commit();
      logActivity(`Worksite scheme renewed: ${sel.company_name} — ${sel.product_name} to ${nextYear.to}`);
      setRenewOpen(false); notify(`Renewed to ${nextYear.to}${changed ? ` · ${changed} member premium(s) updated` : ''}`); load();
    } catch (e) { notify(e.message || 'Renewal failed', 'error'); }
  };

  /* ── exports ── */
  const exportMembers = (s, ms) => {
    const y = currentYear(s);
    downloadCsv(`Worksite_Members_${safeName(s.company_name)}.csv`,
      ['Company', 'Product', 'Name', 'NIC', 'Employee No', 'DOB', 'Age', 'Gender', 'Mobile', 'Email', 'Department', 'Plan', 'Monthly Premium', 'Sum Insured', 'Join Date', 'Batch', 'Status', 'Exit Date', 'Exit Reason', 'Months to Anniversary', 'Premium to Anniversary', 'Nominee', 'Relationship', 'Nominee NIC', 'Nominee Contact', 'Share %'],
      ms.map(m => { const p = premiumToAnniversary(m, y); return [s.company_name, s.product_name, m.full_name, m.nic, m.employee_no, m.dob, ageOn(m.dob) ?? '', m.gender, m.mobile, m.email, m.department, m.plan, memberPremium(m), m.sum_insured, m.join_date, m.batch, m.status, m.exit_date, m.exit_reason, p.months, p.amount, m.nominee_name, m.nominee_relationship, m.nominee_nic, m.nominee_mobile, m.nominee_share]; }));
  };
  const exportLedger = (s, rows) => downloadCsv(`Worksite_Ledger_${safeName(s.company_name)}.csv`,
    ['Month', 'Payroll Members', 'Individual Members', 'Payroll Due', 'Individual Due', 'Total Due', 'Remit By', 'Paid by Employer', 'Paid by Individuals', 'Total Paid', 'Paid On', 'Insurer Ref', 'Arrears', 'Overdue', 'Comm %', 'Commission Earned', 'Commission Received', 'Received On', 'Commission O/S', 'Notes'],
    rows.map(r => [r.label, r.gCount, r.iCount, r.group, r.individual, r.due, r.due_by, r.remitted_group, r.remitted_individual, r.remitted, r.remitted_date, r.remittance_ref, r.arrears, r.overdue ? 'Yes' : 'No', r.rate, r.commDue.toFixed(2), r.commRec, r.commission_received_date, r.commOs.toFixed(2), r.notes]));
  // Month schedule: who is billed in a month and how much — for the employer's payroll / the insurer.
  const exportSchedule = (s, ms, mk) => {
    const rows = ms.map(m => ({ m, b: billingBucket(m, mk) })).filter(x => x.b).sort((a, b) => a.m.full_name.localeCompare(b.m.full_name));
    downloadCsv(`Worksite_Schedule_${safeName(s.company_name)}_${mk}.csv`,
      ['#', 'Name', 'NIC', 'Employee No', 'Department', 'Plan', 'Monthly Premium', 'Paid Via', 'Join Date', 'Status'],
      [...rows.map((x, i) => [i + 1, x.m.full_name, x.m.nic, x.m.employee_no, x.m.department, x.m.plan, memberPremium(x.m), x.b === 'group' ? 'Payroll' : 'Individual', x.m.join_date, x.m.status]),
        ['', 'TOTAL', '', '', '', '', rows.reduce((a, x) => a + memberPremium(x.m), 0), '', '', '']]);
  };

  /* ── render: list of schemes ── */
  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return schemes
      .filter(s => !q || [s.company_name, s.product_name, s.insurer, s.master_policy_no].some(v => String(v || '').toLowerCase().includes(q)))
      .sort((a, b) => String(a.company_name).localeCompare(String(b.company_name)));
  }, [schemes, search]);

  if (!sel) return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1.5} sx={{ mb: 2 }}>
        <Box>
          <Typography sx={{ fontSize: 22, fontWeight: 800, color: '#0A1A3E' }}>Worksite Products</Typography>
          <Typography sx={{ fontSize: 13, color: '#6B7280' }}>Voluntary group schemes — one line per employer, members enrolled through the company form</Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<UploadFileOutlinedIcon />} sx={btnOut} onClick={() => setUploadDlg({ open: true, preset: '' })}>Upload Responses</Button>
          <Button startIcon={<AddIcon />} sx={btnGrad} onClick={() => setSchemeDlg({ open: true, initial: null })}>New Scheme</Button>
        </Stack>
      </Stack>
      {loadErr && <Alert severity="error" sx={{ mb: 2 }}>{loadErr}</Alert>}
      <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1.5} sx={{ mb: 2 }}>
        <Kpi label="Schemes" value={schemes.filter(s => s.status === 'Active').length} sub={`${schemes.length} total`} />
        <Kpi label="Members" value={totals.active} sub={`+ ${totals.continuing} paying individually`} />
        <Kpi label="Premium this month" value={`Rs ${money(totals.monthly)}`} sub={`Rs ${money(totals.annual)} this policy year`} />
        <Kpi label="Paid to insurers" value={`Rs ${money(totals.remitted)}`} sub="Current policy years" />
        <Kpi label="Premium arrears" value={`Rs ${money(totals.arrears)}`} color={totals.arrears > 0 ? '#DC2626' : '#059669'} sub="Past the remittance date" />
        <Kpi label="Commission receivable" value={`Rs ${money(totals.commOs)}`} color={totals.commOs > 0 ? '#B45309' : '#059669'} sub={`Rs ${money(totals.commRec)} received`} />
      </Stack>
      <Card sx={{ border: '1px solid rgba(56,163,224,0.12)', boxShadow: 'none', borderRadius: '14px' }}>
        <Box sx={{ p: 1.5 }}>
          <TextField size="small" placeholder="Search company, product, insurer, policy no…" value={search} onChange={e => setSearch(e.target.value)} sx={{ width: { xs: '100%', sm: 360 } }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18, color: '#38A3E0' }} /></InputAdornment> }} />
        </Box>
        <TableContainer>
          <Table size="small">
            <TableHead><TableRow>
              {['Company', 'Product', 'Insurer', 'Master Policy', 'Anniversary', 'Members', 'Premium / month', 'Comm %', 'Arrears', 'Comm. O/S', 'Status'].map(h => <TableCell key={h} sx={th}>{h}</TableCell>)}
            </TableRow></TableHead>
            <TableBody>
              {loading ? [...Array(4)].map((_, i) => <TableRow key={i}><TableCell colSpan={11}><Skeleton /></TableCell></TableRow>)
                : list.length === 0 ? <TableRow><TableCell colSpan={11} sx={{ textAlign: 'center', py: 5, color: '#9CA3AF' }}>No schemes yet — create one or upload a form export.</TableCell></TableRow>
                : list.map(s => {
                  const x = stats[s.id];
                  return (
                    <TableRow key={s.id} hover sx={{ cursor: 'pointer' }} onClick={() => setSelId(s.id)}>
                      <TableCell sx={{ ...td, fontWeight: 700, color: NAVY }}>{s.company_name}</TableCell>
                      <TableCell sx={td}>{s.product_name}<Typography sx={{ fontSize: 11, color: '#9CA3AF' }}>{s.product_type}</Typography></TableCell>
                      <TableCell sx={td}>{s.insurer}</TableCell>
                      <TableCell sx={td}>{s.master_policy_no || '—'}</TableCell>
                      <TableCell sx={td}>{x?.year.to || '—'}</TableCell>
                      <TableCell sx={td}>{x?.active || 0}{x?.continuing ? <Typography component="span" sx={{ fontSize: 11, color: '#B45309' }}> +{x.continuing}</Typography> : null}</TableCell>
                      <TableCell sx={td}>{money(x?.monthly)}</TableCell>
                      <TableCell sx={td}>{num(s.commission_rate)}%</TableCell>
                      <TableCell sx={{ ...td, color: x?.totals.arrears > 0 ? '#DC2626' : '#059669', fontWeight: 700 }}>{money(x?.totals.arrears)}</TableCell>
                      <TableCell sx={{ ...td, color: x?.totals.commOs > 0.005 ? '#B45309' : '#059669', fontWeight: 700 }}>{money(x?.totals.commOs)}</TableCell>
                      <TableCell sx={td}><StatusChip s={s.status || 'Active'} /></TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
      {dialogs()}
    </Box>
  );

  /* ── render: one scheme ── */
  const years = Array.isArray(sel.policy_years) && sel.policy_years.length ? sel.policy_years : [currentYear(sel)];
  const yi = yearIdx < 0 || yearIdx >= years.length ? years.length - 1 : yearIdx;
  const ms = selStats.members;
  const yRows = yi === years.length - 1 ? selStats.rows : ledgerRows(sel, ms, years[yi]);
  const yTot = ledgerTotals(yRows);
  const plans = [...new Set(ms.map(m => m.plan).filter(Boolean))].sort();
  const batches = [...new Set(ms.map(m => m.batch || String(m.join_date || '').slice(0, 7)).filter(Boolean))].sort();
  const q = search.trim().toLowerCase();
  const filteredMs = ms.filter(m =>
    (statusF === 'All' || m.status === statusF) && (planF === 'All' || m.plan === planF)
    && (batchF === 'All' || (m.batch || String(m.join_date || '').slice(0, 7)) === batchF)
    && (!q || [m.full_name, m.nic, m.employee_no, m.department, m.mobile, m.nominee_name].some(v => String(v || '').toLowerCase().includes(q))))
    .sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)));
  const pageCount = Math.max(1, Math.ceil(filteredMs.length / PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const pageMs = filteredMs.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);
  const cy = selStats.year;

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Button startIcon={<ArrowBackIcon />} onClick={() => setSelId(null)} sx={{ textTransform: 'none', mb: 1, color: NAVY }}>All schemes</Button>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'center' }} spacing={1.5} sx={{ mb: 2 }}>
        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography sx={{ fontSize: 22, fontWeight: 800, color: '#0A1A3E' }}>{sel.company_name}</Typography>
            <StatusChip s={sel.status || 'Active'} />
          </Stack>
          <Typography sx={{ fontSize: 13, color: '#6B7280' }}>
            {sel.product_name} · {sel.insurer}{sel.master_policy_no ? ` · Policy ${sel.master_policy_no}` : ''} · Year {cy.from} → {cy.to} · Commission {num(sel.commission_rate)}%
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button variant="outlined" startIcon={<UploadFileOutlinedIcon />} sx={btnOut} onClick={() => setUploadDlg({ open: true, preset: sel.id })}>Upload Responses</Button>
          <Button variant="outlined" startIcon={<AddIcon />} sx={btnOut} onClick={() => setMemberDlg({ open: true, initial: null })}>Add Member</Button>
          <Button variant="outlined" startIcon={<AutorenewIcon />} sx={btnOut} onClick={() => setRenewOpen(true)}>Renew</Button>
          <Button variant="outlined" startIcon={<EditOutlinedIcon />} sx={btnOut} onClick={() => setSchemeDlg({ open: true, initial: sel })}>Edit</Button>
          {isAdmin && <IconButton onClick={deleteScheme} title="Delete scheme"><DeleteOutlineIcon sx={{ color: '#DC2626' }} /></IconButton>}
        </Stack>
      </Stack>

      <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1.5} sx={{ mb: 2 }}>
        <Kpi label="Active members" value={selStats.active} sub={`${selStats.continuing} individual · ${ms.filter(m => m.status === 'Removed').length} removed`} />
        <Kpi label="Premium this month" value={`Rs ${money(selStats.monthly)}`} sub={`Rs ${money(selStats.annual)} this year`} />
        <Kpi label="Paid to insurer" value={`Rs ${money(selStats.totals.remitted)}`} sub={`Rs ${money(selStats.totals.pending)} not yet due`} />
        <Kpi label="Arrears" value={`Rs ${money(selStats.totals.arrears)}`} color={selStats.totals.arrears > 0 ? '#DC2626' : '#059669'} sub={`${selStats.totals.overdueMonths} month(s) overdue`} />
        <Kpi label="Commission earned" value={`Rs ${money(selStats.totals.commDue)}`} sub={`Rs ${money(selStats.totals.expectedComm)} if fully paid`} />
        <Kpi label="Commission O/S" value={`Rs ${money(selStats.totals.commOs)}`} color={selStats.totals.commOs > 0.005 ? '#B45309' : '#059669'} sub={`Rs ${money(selStats.totals.commRec)} received`} />
      </Stack>

      <Card sx={{ border: '1px solid rgba(56,163,224,0.12)', boxShadow: 'none', borderRadius: '14px' }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 1.5, borderBottom: '1px solid #EEF2F7', '& .MuiTab-root': { textTransform: 'none', fontWeight: 700 } }}>
          <Tab label={`Members (${ms.length})`} />
          <Tab label="Premium & Commission" />
          <Tab label="Scheme Details" />
          <Tab label={`Uploads (${(sel.uploads || []).length})`} />
        </Tabs>

        {tab === 0 && (
          <Box>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ p: 1.5 }} alignItems={{ md: 'center' }}>
              <TextField size="small" placeholder="Search name, NIC, emp no, nominee…" value={search} onChange={e => setSearch(e.target.value)} sx={{ minWidth: 260 }}
                InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18, color: '#38A3E0' }} /></InputAdornment> }} />
              <TextField select size="small" label="Status" value={statusF} onChange={e => setStatusF(e.target.value)} sx={{ minWidth: 140 }}>
                {['All', 'Active', 'Continuing', 'Removed'].map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </TextField>
              <TextField select size="small" label="Plan" value={planF} onChange={e => setPlanF(e.target.value)} sx={{ minWidth: 140 }}>
                {['All', ...plans].map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </TextField>
              <TextField select size="small" label="Batch" value={batchF} onChange={e => setBatchF(e.target.value)} sx={{ minWidth: 140 }}>
                {['All', ...batches].map(s => <MenuItem key={s} value={s}>{s === 'All' ? s : monthLabel(s)}</MenuItem>)}
              </TextField>
              <Box sx={{ flex: 1 }} />
              <Button size="small" startIcon={<FileDownloadOutlinedIcon />} sx={{ textTransform: 'none' }} onClick={() => exportMembers(sel, filteredMs)}>Export</Button>
            </Stack>
            <TableContainer>
              <Table size="small">
                <TableHead><TableRow>
                  {['Name', 'NIC', 'Emp No', 'Department', 'Plan', 'Monthly', 'Joined', 'To anniversary', 'Nominee', 'Status', ''].map(h => <TableCell key={h} sx={th}>{h}</TableCell>)}
                </TableRow></TableHead>
                <TableBody>
                  {pageMs.length === 0 ? <TableRow><TableCell colSpan={11} sx={{ textAlign: 'center', py: 4, color: '#9CA3AF' }}>No members{ms.length ? ' match the filters' : ' yet — upload the form export or add members'}.</TableCell></TableRow>
                    : pageMs.map(m => {
                      const p = premiumToAnniversary(m, cy);
                      return (
                        <TableRow key={m.id} hover sx={{ opacity: m.status === 'Removed' ? 0.55 : 1 }}>
                          <TableCell sx={{ ...td, fontWeight: 600 }}>{m.full_name}</TableCell>
                          <TableCell sx={td}>{m.nic}</TableCell>
                          <TableCell sx={td}>{m.employee_no || '—'}</TableCell>
                          <TableCell sx={td}>{m.department || '—'}</TableCell>
                          <TableCell sx={td}>{m.plan || '—'}</TableCell>
                          <TableCell sx={td}>{money(m.monthly_premium)}</TableCell>
                          <TableCell sx={td}>{m.join_date}</TableCell>
                          <TableCell sx={td}>{p.months ? `${p.months} mo · ${money(p.amount)}` : '—'}</TableCell>
                          <TableCell sx={td}>{m.nominee_name ? `${m.nominee_name}${m.nominee_relationship ? ` (${m.nominee_relationship})` : ''}` : '—'}</TableCell>
                          <TableCell sx={td}><StatusChip s={m.status} />{m.exit_date ? <Typography sx={{ fontSize: 10.5, color: '#9CA3AF' }}>from {m.exit_date}</Typography> : null}</TableCell>
                          <TableCell sx={{ ...td, textAlign: 'right' }}>
                            <Tooltip title="Edit"><IconButton size="small" onClick={() => setMemberDlg({ open: true, initial: m })}><EditOutlinedIcon fontSize="small" /></IconButton></Tooltip>
                            {m.status === 'Active'
                              ? <Tooltip title="Member leaving"><IconButton size="small" onClick={() => setExitDlg(m)}><LogoutOutlinedIcon fontSize="small" /></IconButton></Tooltip>
                              : <Tooltip title="Reinstate as active"><IconButton size="small" onClick={() => reinstate(m)}><RestoreIcon fontSize="small" /></IconButton></Tooltip>}
                            {m.status !== 'Active' && isAdmin && <Tooltip title="Remove / delete"><IconButton size="small" onClick={() => setExitDlg(m)}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            </TableContainer>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 1.5 }}>
              <Typography sx={{ fontSize: 12, color: '#6B7280' }}>{filteredMs.length ? `Showing ${(safePage - 1) * PER_PAGE + 1}–${Math.min(safePage * PER_PAGE, filteredMs.length)} of ${filteredMs.length}` : ''}</Typography>
              {pageCount > 1 && <Pagination size="small" count={pageCount} page={safePage} onChange={(_, v) => setPage(v)} />}
            </Stack>
          </Box>
        )}

        {tab === 1 && (
          <Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ p: 1.5 }} alignItems={{ sm: 'center' }}>
              <TextField select size="small" label="Policy year" value={yi} onChange={e => setYearIdx(Number(e.target.value))} sx={{ minWidth: 230 }}>
                {years.map((y, i) => <MenuItem key={i} value={i}>{y.from} → {y.to}{i === years.length - 1 ? ' (current)' : ''}</MenuItem>)}
              </TextField>
              <Typography sx={{ fontSize: 12, color: '#6B7280', flex: 1 }}>
                Premium is deducted by the employer and paid to the insurer; commission is earned on what the insurer receives. Click a month to record payments.
              </Typography>
              <Button size="small" startIcon={<FileDownloadOutlinedIcon />} sx={{ textTransform: 'none' }} onClick={() => exportLedger(sel, yRows)}>Export</Button>
            </Stack>
            <TableContainer>
              <Table size="small">
                <TableHead><TableRow>
                  {['Month', 'Members', 'Premium due', 'Remit by', 'Paid to insurer', 'Paid on', 'Arrears', 'Comm %', 'Comm. earned', 'Comm. received', 'Comm. O/S', ''].map(h => <TableCell key={h} sx={th}>{h}</TableCell>)}
                </TableRow></TableHead>
                <TableBody>
                  {yRows.map(r => (
                    <TableRow key={r.month} hover sx={{ cursor: 'pointer', bgcolor: r.month === nowMk ? 'rgba(56,163,224,0.06)' : undefined }} onClick={() => setLedgerDlg(r)}>
                      <TableCell sx={{ ...td, fontWeight: 700 }}>{r.label}{r.snapshot ? <Chip size="small" label="closed" sx={{ ml: 0.5, height: 18, fontSize: 10 }} /> : null}</TableCell>
                      <TableCell sx={td}>{r.gCount}{r.iCount ? <Typography component="span" sx={{ fontSize: 11, color: '#B45309' }}> +{r.iCount}</Typography> : null}</TableCell>
                      <TableCell sx={td}>{money(r.due)}</TableCell>
                      <TableCell sx={td}>{r.due_by}</TableCell>
                      <TableCell sx={td}>{r.remitted ? money(r.remitted) : '—'}</TableCell>
                      <TableCell sx={td}>{r.remitted_date || '—'}</TableCell>
                      <TableCell sx={{ ...td, fontWeight: 700, color: r.overdue ? '#DC2626' : r.arrears > 0 ? '#9CA3AF' : '#059669' }}>{r.arrears > 0 ? money(r.arrears) : '✓'}{r.excess > 0.005 ? <Typography sx={{ fontSize: 10.5, color: NAVY }}>+{money(r.excess)} over</Typography> : null}</TableCell>
                      <TableCell sx={td}>{r.rate}%</TableCell>
                      <TableCell sx={td}>{money(r.commDue)}</TableCell>
                      <TableCell sx={td}>{r.commRec ? money(r.commRec) : '—'}</TableCell>
                      <TableCell sx={{ ...td, fontWeight: 700, color: r.commOs > 0.005 ? '#B45309' : '#059669' }}>{money(r.commOs)}</TableCell>
                      <TableCell sx={td} onClick={e => e.stopPropagation()}>
                        <Tooltip title="Download the member schedule for this month"><IconButton size="small" onClick={() => exportSchedule(sel, ms, r.month)}><FileDownloadOutlinedIcon fontSize="small" /></IconButton></Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow sx={{ '& td': { fontWeight: 800, bgcolor: '#F2F7FC' } }}>
                    <TableCell sx={td}>Total</TableCell><TableCell sx={td} />
                    <TableCell sx={td}>{money(yTot.due)}</TableCell><TableCell sx={td} />
                    <TableCell sx={td}>{money(yTot.remitted)}</TableCell><TableCell sx={td} />
                    <TableCell sx={{ ...td, color: yTot.arrears > 0 ? '#DC2626' : '#059669' }}>{money(yTot.arrears)}</TableCell><TableCell sx={td} />
                    <TableCell sx={td}>{money(yTot.commDue)}</TableCell>
                    <TableCell sx={td}>{money(yTot.commRec)}</TableCell>
                    <TableCell sx={{ ...td, color: yTot.commOs > 0.005 ? '#B45309' : '#059669' }}>{money(yTot.commOs)}</TableCell><TableCell sx={td} />
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}

        {tab === 2 && (
          <Box sx={{ p: 2.5 }}>
            {[
              ['Employer', [['Company', sel.company_name], ['Business Reg.', sel.company_reg], ['Address', sel.company_address], ['HR / Payroll contact', [sel.contact_person, sel.contact_designation].filter(Boolean).join(' — ')], ['Phone', sel.contact_phone], ['Email', sel.contact_email]]],
              ['Product', [['Product', sel.product_name], ['Type', sel.product_type], ['Insurer', sel.insurer], ['Master policy', sel.master_policy_no], ['Original inception', sel.inception_date], ['Current year', `${cy.from} → ${cy.to}`], ['Account manager', sel.account_manager]]],
              ['Rules', [['Commission', `${num(sel.commission_rate)}% of premium collected`], ['Remittance due', `Day ${num(sel.remittance_due_day) || 15} of the following month`], ['Entry age', `${sel.min_entry_age || '—'} to ${sel.max_entry_age || '—'}`], ['Notes', sel.notes]]],
            ].map(([title, rows]) => (
              <Box key={title} sx={{ mb: 2.5 }}>
                <Typography sx={{ fontSize: 11, fontWeight: 800, color: '#7C93B0', textTransform: 'uppercase', letterSpacing: 0.8, mb: 1 }}>{title}</Typography>
                {rows.map(([k, v]) => (
                  <Stack key={k} direction="row" sx={{ py: 0.5, borderBottom: '1px dashed #EEF2F7' }}>
                    <Typography sx={{ width: 190, fontSize: 13, color: '#6B7280' }}>{k}</Typography>
                    <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#0A1A3E', whiteSpace: 'pre-wrap' }}>{v || '—'}</Typography>
                  </Stack>
                ))}
              </Box>
            ))}
            <Typography sx={{ fontSize: 11, fontWeight: 800, color: '#7C93B0', textTransform: 'uppercase', letterSpacing: 0.8, mb: 1 }}>Plans</Typography>
            <Table size="small" sx={{ maxWidth: 720 }}>
              <TableHead><TableRow>{['Plan', 'Monthly premium', 'Sum insured / limit', 'Benefits', 'Members'].map(h => <TableCell key={h} sx={th}>{h}</TableCell>)}</TableRow></TableHead>
              <TableBody>{(sel.plans || []).map(p => (
                <TableRow key={p.name}>
                  <TableCell sx={td}>{p.name}</TableCell><TableCell sx={td}>{money(p.monthly_premium)}</TableCell><TableCell sx={td}>{p.sum_insured ? money(p.sum_insured) : '—'}</TableCell>
                  <TableCell sx={{ fontSize: 12.5 }}>{p.benefits || '—'}</TableCell><TableCell sx={td}>{ms.filter(m => m.plan === p.name && m.status !== 'Removed').length}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
            {(sel.renewals || []).length > 0 && (
              <Typography sx={{ fontSize: 12, color: '#6B7280', mt: 2 }}>Renewals: {sel.renewals.map(r => `${r.from} → ${r.to} (by ${r.by || '—'})`).join(' · ')}</Typography>
            )}
          </Box>
        )}

        {tab === 3 && (
          <TableContainer>
            <Table size="small">
              <TableHead><TableRow>{['Uploaded', 'By', 'File', 'Batch join date', 'Added', 'Updated', 'Skipped'].map(h => <TableCell key={h} sx={th}>{h}</TableCell>)}</TableRow></TableHead>
              <TableBody>
                {(sel.uploads || []).length === 0 ? <TableRow><TableCell colSpan={7} sx={{ textAlign: 'center', py: 4, color: '#9CA3AF' }}>No uploads yet.</TableCell></TableRow>
                  : [...sel.uploads].reverse().map((u, i) => (
                    <TableRow key={i}>
                      <TableCell sx={td}>{new Date(u.at).toLocaleString('en-GB')}</TableCell><TableCell sx={td}>{u.by}</TableCell><TableCell sx={td}>{u.file}</TableCell>
                      <TableCell sx={td}>{u.join_date}</TableCell><TableCell sx={td}>{u.added}</TableCell><TableCell sx={td}>{u.updated}</TableCell><TableCell sx={td}>{u.skipped}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>
      {dialogs()}
    </Box>
  );

  function dialogs() {
    return (<>
      <SchemeDialog open={schemeDlg.open} initial={schemeDlg.initial} insurers={insurers} onClose={() => setSchemeDlg({ open: false, initial: null })} onSave={saveScheme} />
      <UploadDialog open={uploadDlg.open} presetSchemeId={uploadDlg.preset} schemes={schemes} members={members} insurers={insurers} user={{ full_name: byName }}
        onClose={() => setUploadDlg({ open: false, preset: '' })}
        onDone={(msg, ids) => { setUploadDlg({ open: false, preset: '' }); notify(msg); load(); if (ids.length === 1) setSelId(ids[0]); }} />
      {sel && <MemberDialog open={memberDlg.open} initial={memberDlg.initial} scheme={sel} members={members} onClose={() => setMemberDlg({ open: false, initial: null })} onSave={saveMember} />}
      <ExitDialog open={!!exitDlg} member={exitDlg} isAdmin={isAdmin} onClose={() => setExitDlg(null)} onSave={saveExit} onDelete={deleteMember} />
      <LedgerDialog open={!!ledgerDlg} row={ledgerDlg} onClose={() => setLedgerDlg(null)} onSave={saveLedger} />
      {sel && <RenewDialog open={renewOpen} scheme={sel} activeCount={(selStats?.members || []).filter(m => m.status !== 'Removed').length} onClose={() => setRenewOpen(false)} onRenew={renew} />}
      <Snackbar open={toast.open} autoHideDuration={4000} onClose={() => setToast(t => ({ ...t, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={toast.severity} onClose={() => setToast(t => ({ ...t, open: false }))}>{toast.msg}</Alert>
      </Snackbar>
    </>);
  }
}
