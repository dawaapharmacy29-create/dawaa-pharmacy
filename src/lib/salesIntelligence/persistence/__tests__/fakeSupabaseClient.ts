// Sales Intelligence Phase H.1B — in-memory fake Supabase client for permanent local tests.
//
// NOT itself a test file (never added to scripts/run-tests.cjs's testFiles list) — a shared test
// helper imported BY hashing/writer test files. The simplified describe/it/expect harness in
// run-tests.cjs does not support vi.mock/vi.fn (see its own header comment), so writer-level tests
// need a real object implementing the same `.from()/.rpc()` surface the writers call, rather than a
// mocked import. This fake reimplements, in plain JS, the SAME semantics as the four live RPCs
// (design doc §26/§27: no-op detection, versioning, insert-as-false/retire-old/flip-new-current
// ordering) and the FK/uniqueness constraints the six live tables enforce — close enough fidelity to
// exercise the writer modules' own logic end-to-end without a live database, never a claim that it
// replaces the live-DB verification done separately in this phase's controlled write validation.
export interface FakeRow {
  [key: string]: unknown;
}

export interface FakeSupabaseClient {
  from(table: string): any;
  rpc(name: string, params: FakeRow): Promise<{ data: any; error: any }>;
  __tables: Record<string, FakeRow[]>;
}

function genId(prefix: string, counter: { n: number }): string {
  counter.n += 1;
  return `${prefix}-${counter.n}`;
}

export function createFakeSupabaseClient(): FakeSupabaseClient {
  const tables: Record<string, FakeRow[]> = {
    sales_intelligence_cases: [],
    sales_intelligence_case_analyses: [],
    sales_intelligence_policy_config: [],
    sales_intelligence_policy_evaluations: [],
    sales_intelligence_attributions: [],
    sales_intelligence_basket_invoice_matches: [],
  };
  const counter = { n: 0 };

  function matchesFilters(row: FakeRow, filters: Array<[string, unknown]>): boolean {
    return filters.every(([col, val]) => row[col] === val);
  }

  function from(table: string) {
    if (!(table in tables)) throw new Error(`fake client: unknown table ${table}`);
    const filters: Array<[string, unknown]> = [];
    const builder: any = {
      select() {
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push([col, val]);
        return builder;
      },
      async maybeSingle() {
        const rows = tables[table].filter((r) => matchesFilters(r, filters));
        if (rows.length > 1) throw new Error(`fake client: maybeSingle() matched >1 row in ${table}`);
        return { data: rows[0] ?? null, error: null };
      },
      async insert(obj: FakeRow) {
        tables[table].push({ ...obj });
        return { data: null, error: null };
      },
      async update(obj: FakeRow) {
        const rows = tables[table].filter((r) => matchesFilters(r, filters));
        rows.forEach((r) => Object.assign(r, obj));
        return { data: null, error: null };
      },
      async upsert(obj: FakeRow, opts: { onConflict: string }) {
        const key = opts.onConflict;
        const existing = tables[table].find((r) => r[key] === obj[key]);
        if (existing) Object.assign(existing, obj);
        else tables[table].push({ ...obj });
        return { data: null, error: null };
      },
    };
    return builder;
  }

  function requireExists(table: string, col: string, val: unknown, label: string) {
    if (!tables[table].some((r) => r[col] === val)) {
      throw new Error(`fake client: FK violation — ${label} (${col}=${val}) not found in ${table}`);
    }
  }

  async function rpc(name: string, params: FakeRow): Promise<{ data: any; error: any }> {
    try {
      if (name === 'sales_intelligence_write_case_analysis') return { data: await writeCaseAnalysis(params), error: null };
      if (name === 'sales_intelligence_write_policy_evaluation') return { data: await writePolicyEvaluation(params), error: null };
      if (name === 'sales_intelligence_write_attribution') return { data: await writeAttribution(params), error: null };
      if (name === 'sales_intelligence_write_basket_invoice_match') return { data: await writeBasketInvoiceMatch(params), error: null };
      throw new Error(`fake client: unknown rpc ${name}`);
    } catch (err) {
      return { data: null, error: err };
    }
  }

  async function writeCaseAnalysis(params: FakeRow) {
    const caseId = params.p_case_id as string;
    const row = params.p_row as FakeRow;
    requireExists('sales_intelligence_cases', 'case_id', caseId, 'case_analyses.case_id');

    const existing = tables.sales_intelligence_case_analyses.find((r) => r.case_id === caseId && r.is_current === true);
    const isNoOp =
      Boolean(existing) &&
      existing!.semantic_source_hash === row.semantic_source_hash &&
      existing!.pipeline_version === row.pipeline_version &&
      existing!.engine_version_case_segmentation === row.engine_version_case_segmentation &&
      existing!.engine_version_historical_closure === row.engine_version_historical_closure &&
      existing!.engine_version_commercial_confirmation === row.engine_version_commercial_confirmation &&
      existing!.engine_version_protocol_applicability === row.engine_version_protocol_applicability;
    if (isNoOp) return { is_new: false, ...existing };

    const newId = genId('analysis', counter);
    const newRow: FakeRow = {
      ...row,
      analysis_id: newId,
      case_id: caseId,
      analysis_version: (existing?.analysis_version as number | undefined ?? 0) + 1,
      is_current: true,
      superseded_at: null,
      superseded_by_analysis_id: null,
      analyzed_at: new Date().toISOString(),
    };
    if (existing) {
      existing.is_current = false;
      existing.superseded_at = new Date().toISOString();
      existing.superseded_by_analysis_id = newId;
    }
    tables.sales_intelligence_case_analyses.push(newRow);
    return { is_new: true, ...newRow };
  }

  async function writePolicyEvaluation(params: FakeRow) {
    const analysisId = params.p_analysis_id as string;
    const row = params.p_row as FakeRow;
    requireExists('sales_intelligence_case_analyses', 'analysis_id', analysisId, 'policy_evaluations.analysis_id');
    requireExists('sales_intelligence_policy_config', 'policy_config_id', row.policy_config_id, 'policy_evaluations.policy_config_id');

    const existing = tables.sales_intelligence_policy_evaluations.find((r) => r.analysis_id === analysisId && r.is_current === true);
    const isNoOp =
      Boolean(existing) && existing!.policy_input_hash === row.policy_input_hash && existing!.policy_config_id === row.policy_config_id;
    if (isNoOp) return { is_new: false, ...existing };

    const newId = genId('policyeval', counter);
    const newRow: FakeRow = {
      ...row,
      policy_evaluation_id: newId,
      analysis_id: analysisId,
      evaluation_version: (existing?.evaluation_version as number | undefined ?? 0) + 1,
      is_current: true,
      superseded_at: null,
      superseded_by_policy_evaluation_id: null,
      evaluated_at: new Date().toISOString(),
    };
    if (existing) {
      existing.is_current = false;
      existing.superseded_at = new Date().toISOString();
      existing.superseded_by_policy_evaluation_id = newId;
    }
    tables.sales_intelligence_policy_evaluations.push(newRow);
    return { is_new: true, ...newRow };
  }

  async function writeAttribution(params: FakeRow) {
    const analysisId = params.p_analysis_id as string;
    const row = params.p_row as FakeRow;
    requireExists('sales_intelligence_case_analyses', 'analysis_id', analysisId, 'attributions.analysis_id');

    const existing = tables.sales_intelligence_attributions.find((r) => r.analysis_id === analysisId && r.is_current_evaluation === true);
    const isNoOp =
      Boolean(existing) &&
      existing!.attribution_input_hash === row.attribution_input_hash &&
      existing!.attribution_engine_version === row.attribution_engine_version;
    if (isNoOp) return { is_new: false, ...existing };

    const newId = genId('attribution', counter);
    const newRow: FakeRow = {
      ...row,
      id: newId,
      analysis_id: analysisId,
      evaluation_version: (existing?.evaluation_version as number | undefined ?? 0) + 1,
      is_current_evaluation: true,
      superseded_at: null,
      superseded_by_evaluation_version: null,
      evaluated_at: new Date().toISOString(),
    };
    if (existing) {
      existing.is_current_evaluation = false;
      existing.superseded_at = new Date().toISOString();
      existing.superseded_by_evaluation_version = newRow.evaluation_version;
    }
    tables.sales_intelligence_attributions.push(newRow);
    return { is_new: true, ...newRow };
  }

  async function writeBasketInvoiceMatch(params: FakeRow) {
    const analysisId = params.p_analysis_id as string;
    const row = params.p_row as FakeRow;
    requireExists('sales_intelligence_case_analyses', 'analysis_id', analysisId, 'basket_invoice_matches.analysis_id');
    requireExists('sales_intelligence_attributions', 'id', row.attribution_row_id, 'basket_invoice_matches.attribution_row_id');

    const existing = tables.sales_intelligence_basket_invoice_matches.find(
      (r) => r.analysis_id === analysisId && r.is_current_evaluation === true
    );
    const isNoOp =
      Boolean(existing) &&
      existing!.attribution_row_id === row.attribution_row_id &&
      existing!.matching_input_hash === row.matching_input_hash &&
      existing!.matching_engine_version === row.matching_engine_version;
    if (isNoOp) return { is_new: false, ...existing };

    const newId = genId('match', counter);
    const newRow: FakeRow = {
      ...row,
      id: newId,
      analysis_id: analysisId,
      evaluation_version: (existing?.evaluation_version as number | undefined ?? 0) + 1,
      is_current_evaluation: true,
      superseded_at: null,
      superseded_by_evaluation_version: null,
      evaluated_at: new Date().toISOString(),
    };
    if (existing) {
      existing.is_current_evaluation = false;
      existing.superseded_at = new Date().toISOString();
      existing.superseded_by_evaluation_version = newRow.evaluation_version;
    }
    tables.sales_intelligence_basket_invoice_matches.push(newRow);
    return { is_new: true, ...newRow };
  }

  return { from, rpc, __tables: tables };
}
