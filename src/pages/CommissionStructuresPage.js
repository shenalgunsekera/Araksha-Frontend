import React, { useState, useEffect, useMemo } from 'react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { PRODUCTS } from '../config/products';
import { expandLadder, totalMonths } from '../utils/commissionStructures';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Collapse from '@mui/material/Collapse';
import Chip from '@mui/material/Chip';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import Skeleton from '@mui/material/Skeleton';
import InputAdornment from '@mui/material/InputAdornment';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import SearchIcon from '@mui/icons-material/Search';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';

const STRUCT_DOC = doc(db, 'settings', 'commission_structures');
const blankSeg = () => ({ unit: 'year', length: '1', rate: '' });

const PRODUCT_LIST = Object.values(PRODUCTS).filter(p => !p.hidden).map(p => ({ label: p.label }));

export default function CommissionStructuresPage() {
  const [structs, setStructs] = useState({}); // { [productLabel]: [segments] }
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [search,  setSearch]  = useState('');
  const [openProduct, setOpenProduct] = useState('');
  const [toast, setToast] = useState({ open: false, msg: '', severity: 'success' });

  useEffect(() => {
    getDoc(STRUCT_DOC)
      .then(snap => {
        const products = (snap.exists() && snap.data().products) || {};
        const map = {};
        Object.entries(products).forEach(([label, v]) => {
          map[label] = Array.isArray(v) ? v : (Array.isArray(v?.segments) ? v.segments : []);
        });
        setStructs(map);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const setSegs   = (product, segs)      => setStructs(s => ({ ...s, [product]: segs }));
  const addSeg    = (product)            => setSegs(product, [...(structs[product] || []), blankSeg()]);
  const removeSeg = (product, idx)       => setSegs(product, (structs[product] || []).filter((_, i) => i !== idx));
  const updateSeg = (product, idx, field, val) =>
    setSegs(product, (structs[product] || []).map((r, i) => i === idx ? { ...r, [field]: val } : r));

  const save = async () => {
    setSaving(true);
    // Keep only segments that carry a rate, and only products that have any.
    const clean = {};
    Object.entries(structs).forEach(([label, segs]) => {
      const kept = (segs || [])
        .filter(s => s.rate !== '' && s.rate != null && Number(s.length) > 0)
        .map(s => ({ unit: s.unit === 'month' ? 'month' : 'year', length: Number(s.length) || 1, rate: Number(s.rate) || 0 }));
      if (kept.length) clean[label] = { segments: kept };
    });
    try {
      await setDoc(STRUCT_DOC, { products: clean, updated_at: serverTimestamp() }, { merge: true });
      setToast({ open: true, msg: 'Commission structures saved.', severity: 'success' });
    } catch (err) {
      setToast({ open: true, msg: `Could not save: ${err.message || err}`, severity: 'error' });
    }
    setSaving(false);
  };

  const products = useMemo(() => {
    const q = search.trim().toLowerCase();
    return PRODUCT_LIST.filter(p => !q || p.label.toLowerCase().includes(q));
  }, [search]);

  const configuredCount = Object.values(structs).filter(segs => (segs || []).some(s => s.rate !== '' && Number(s.length) > 0)).length;

  return (
    <Box className="page-enter" sx={{ maxWidth: 1000, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap', mb: 0.5 }}>
        <Box sx={{ flex: 1, minWidth: 240 }}>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>Commission Structures</Typography>
          <Typography sx={{ fontSize: 13, color: '#9CA3AF', mt: 0.3 }}>
            Declining commission scales — the rate steps down each policy year (or month). A policy uses the
            rate for its position in the schedule, measured from the original policy's start date, and steps to
            the next rate as it renews.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<SaveOutlinedIcon />} onClick={save} disabled={saving || loading}
          sx={{ textTransform: 'none', fontWeight: 700 }}>
          {saving ? 'Saving…' : 'Save all changes'}
        </Button>
      </Box>

      <Chip size="small" label={`${configuredCount} product${configuredCount === 1 ? '' : 's'} with a structure`}
        sx={{ my: 2, height: 24, fontSize: 11.5, fontWeight: 700, bgcolor: 'rgba(37,94,171,0.10)', color: '#255EAB' }} />

      <TextField size="small" fullWidth placeholder="Search products…" value={search} onChange={e => setSearch(e.target.value)}
        InputProps={{ startAdornment: (<InputAdornment position="start"><SearchIcon sx={{ fontSize: 18, color: '#9CA3AF' }} /></InputAdornment>) }}
        sx={{ mb: 2, '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />

      {loading ? (
        <Skeleton variant="rounded" height={220} />
      ) : products.map(p => {
        const segs = structs[p.label] || [];
        const isOpen = openProduct === p.label;
        const active = segs.filter(s => s.rate !== '' && Number(s.length) > 0);
        const ladder = expandLadder(active);
        const months = totalMonths(active);
        const span = months >= 12 && months % 12 === 0 ? `${months / 12} yr` : `${months} mo`;
        return (
          <Card key={p.label} sx={{ mb: 1.2, border: '1px solid rgba(56,163,224,0.14)' }}>
            <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
              <Box sx={{ px: 2, py: 1.4, display: 'flex', alignItems: 'center', gap: 1.5, cursor: 'pointer',
                         '&:hover': { bgcolor: 'rgba(37,94,171,0.02)' } }}
                   onClick={() => setOpenProduct(o => o === p.label ? '' : p.label)}>
                <Typography sx={{ fontSize: 13.5, fontWeight: 700, flex: 1 }}>{p.label}</Typography>
                <Chip size="small" label={active.length ? `${ladder.length} step${ladder.length === 1 ? '' : 's'} · ${span}` : 'no structure'}
                  sx={{ height: 22, fontSize: 11, fontWeight: 700,
                        bgcolor: active.length ? 'rgba(5,150,105,0.10)' : 'rgba(0,0,0,0.05)',
                        color: active.length ? '#059669' : '#9CA3AF' }} />
                {isOpen ? <ExpandLessIcon sx={{ color: '#9CA3AF' }} /> : <ExpandMoreIcon sx={{ color: '#9CA3AF' }} />}
              </Box>
              <Collapse in={isOpen} timeout={200} unmountOnExit>
                <Box sx={{ px: 2, pb: 2, pt: 0.5, borderTop: '1px solid rgba(56,163,224,0.08)' }}>
                  {segs.length > 0 && (
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 32px', gap: 1, mb: 0.6, px: 0.3,
                               '& > *': { fontSize: 10.5, fontWeight: 800, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.3 } }}>
                      <Box>Unit</Box><Box>How many</Box><Box>Rate %</Box><Box />
                    </Box>
                  )}
                  {segs.map((s, idx) => (
                    <Box key={idx} sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 32px', gap: 1, mb: 0.8, alignItems: 'center' }}>
                      <Select size="small" value={s.unit} onChange={e => updateSeg(p.label, idx, 'unit', e.target.value)} sx={{ fontSize: 12 }}>
                        <MenuItem value="year" sx={{ fontSize: 12 }}>Year(s)</MenuItem>
                        <MenuItem value="month" sx={{ fontSize: 12 }}>Month(s)</MenuItem>
                      </Select>
                      <TextField size="small" type="number" inputProps={{ min: 1, step: 1, inputMode: 'numeric' }} value={s.length}
                        onChange={e => updateSeg(p.label, idx, 'length', e.target.value)} sx={{ '& input': { fontSize: 12 } }} />
                      <TextField size="small" type="number" inputProps={{ step: 'any', inputMode: 'decimal' }} value={s.rate}
                        onChange={e => updateSeg(p.label, idx, 'rate', e.target.value)}
                        InputProps={{ endAdornment: <InputAdornment position="end" sx={{ '& p': { fontSize: 11 } }}>%</InputAdornment> }}
                        sx={{ '& input': { fontSize: 12 } }} />
                      <IconButton size="small" onClick={() => removeSeg(p.label, idx)} sx={{ color: '#dc2626' }}><DeleteOutlineIcon sx={{ fontSize: 18 }} /></IconButton>
                    </Box>
                  ))}
                  <Button size="small" startIcon={<AddIcon sx={{ fontSize: 16 }} />} onClick={() => addSeg(p.label)}
                    sx={{ textTransform: 'none', mt: 0.5, color: '#255EAB' }}>Add step</Button>

                  {ladder.length > 0 && (
                    <Box sx={{ mt: 1.5, pt: 1.2, borderTop: '1px dashed rgba(56,163,224,0.18)' }}>
                      <Typography sx={{ fontSize: 10.5, fontWeight: 800, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.4, mb: 0.8 }}>
                        Preview
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 0.8, flexWrap: 'wrap' }}>
                        {ladder.map((step, i) => (
                          <Box key={i} sx={{ px: 1, py: 0.5, borderRadius: '8px', bgcolor: 'rgba(37,94,171,0.06)', border: '1px solid rgba(37,94,171,0.15)' }}>
                            <Typography sx={{ fontSize: 10, color: '#6B7280', fontWeight: 700 }}>{step.label}</Typography>
                            <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#255EAB' }}>{step.rate}%</Typography>
                          </Box>
                        ))}
                      </Box>
                    </Box>
                  )}
                </Box>
              </Collapse>
            </CardContent>
          </Card>
        );
      })}

      <Snackbar open={toast.open} autoHideDuration={4000} onClose={() => setToast(t => ({ ...t, open: false }))}>
        <Alert severity={toast.severity} variant="filled">{toast.msg}</Alert>
      </Snackbar>
    </Box>
  );
}
