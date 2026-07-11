// Insurance company contact configuration.
// Companies are managed in the Admin Panel (Insurance Companies section) and
// stored in Firestore — add Araksha's own insurer contacts there.

export const COMPANY_CATEGORIES = ['Motor', 'Non Motor', 'Life'];

export const CATEGORY_COLORS = {
  'Motor':     { bg:'rgba(59,130,246,0.10)',  color:'#2563eb',  border:'rgba(59,130,246,0.25)'  },
  'Non Motor': { bg:'rgba(16,185,129,0.10)', color:'#059669',  border:'rgba(16,185,129,0.25)'  },
  'Life':      { bg:'rgba(139,92,246,0.10)', color:'#7c3aed',  border:'rgba(139,92,246,0.25)'  },
};
