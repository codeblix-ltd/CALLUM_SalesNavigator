import { performance } from 'node:perf_hooks';
import { openDatabase } from '../apps/control-plane/db.mjs';

const db=openDatabase();
try {
  const start=performance.now();
  const total=(await db.query('SELECT count(*)::INT8 AS n FROM public.leads')).rows[0].n;
  const niches=(await db.query(`SELECT niche,count(*)::INT8 AS n FROM public.lead_niches
    GROUP BY niche ORDER BY n DESC,niche LIMIT 30`)).rows;
  const assignments=(await db.query('SELECT count(*)::INT8 AS n FROM public.lead_assignments')).rows[0].n;
  const searchStart=performance.now();
  const search=(await db.query(`SELECT count(*)::INT8 AS n FROM public.leads WHERE search_text ILIKE $1`,['%director%'])).rows[0].n;
  console.log(JSON.stringify({total:Number(total),v1AssignmentsReadOnly:Number(assignments),topNiches:niches.map(x=>({niche:x.niche,count:Number(x.n)})),searchCount:Number(search),searchMs:Math.round(performance.now()-searchStart),totalMs:Math.round(performance.now()-start)}));
} finally { await db.close(); }
