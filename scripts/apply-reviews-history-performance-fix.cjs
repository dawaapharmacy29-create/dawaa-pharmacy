const fs = require('node:fs');
const path = require('node:path');

const filePath = path.join(process.cwd(), 'src/pages/Reviews.tsx');
let text = fs.readFileSync(filePath, 'utf8');

const draftKey = "const REVIEW_DRAFT_KEY = 'dawaa_conversation_review_draft_v3';";
const constants = `${draftKey}\nconst REVIEW_HISTORY_CACHE_KEY = 'dawaa_conversation_review_history_v1';\nconst REVIEW_HISTORY_SELECT = 'id,created_at,updated_at,reviewer_id,reviewer_name,reviewer_role,staff_id,doctor_id,staff_name,staff_role,doctor_name,branch,customer_id,customer_name,customer_code,customer_phone,invoice_number,evaluation_kind,conversation_type,evaluation_reason,conversation_date,total_score,final_score,level,point_impact,doctor_points_impact,main_positive_reason,main_negative_reason,reviewer_notes,training_recommendation,month_cycle,manager_review_score,manager_review_notes,manager_reviewed_by,manager_reviewed_at';`;

if (!text.includes('REVIEW_HISTORY_SELECT')) {
  if (!text.includes(draftKey)) throw new Error('Reviews.tsx draft-key anchor not found');
  text = text.replace(draftKey, constants);
}

if (!text.includes('const historyLoadSeq = useRef(0);')) {
  const block = /  const loadReviewHistory = useCallback\(async \(\) => \{[\s\S]*?\n  useEffect\(\(\) => \{\n    loadReviewHistory\(\);\n  \}, \[loadReviewHistory\]\);/;

  const replacement = `  const historyLoadSeq = useRef(0);
  const loadReviewHistory = useCallback(async () => {
    const requestId = ++historyLoadSeq.current;
    const cacheKey = \`${'${REVIEW_HISTORY_CACHE_KEY}'}:${'${user?.id || \'anonymous\'}'}\`;
    let cachedRows: ConversationReviewHistoryRow[] = [];

    setHistoryLoading(true);
    setHistoryError(null);

    try {
      const cachedRaw = window.sessionStorage.getItem(cacheKey);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw) as { savedAt?: number; rows?: ConversationReviewHistoryRow[] };
        const freshEnough = cached.savedAt && Date.now() - cached.savedAt < 10 * 60 * 1000;
        if (freshEnough && Array.isArray(cached.rows)) {
          cachedRows = cached.rows.filter((row) => canUserSeeConversationReviewBranch(user, row.branch));
          if (cachedRows.length) setReviewHistory(cachedRows);
        }
      }
    } catch {
      // Cache is best-effort only; never block the live request.
    }

    try {
      const queryHistory = () =>
        supabase
          .from('conversation_sales_reviews')
          .select(REVIEW_HISTORY_SELECT)
          .order('created_at', { ascending: false })
          .limit(3000);

      let response = await queryHistory();
      if (response.error && /schema cache|retrying|PGRST002/i.test(response.error.message || '')) {
        await new Promise((resolve) => window.setTimeout(resolve, 450));
        response = await queryHistory();
      }
      if (response.error) throw response.error;
      if (requestId !== historyLoadSeq.current) return;

      const sourceRows = (response.data || []) as ConversationReviewHistoryRow[];
      const rows = sourceRows.filter((row) => canUserSeeConversationReviewBranch(user, row.branch));
      setReviewHistory(rows);

      try {
        window.sessionStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), rows: sourceRows }));
      } catch {
        // Storage quota/privacy mode must not break history rendering.
      }

      const params = new URLSearchParams(window.location.search);
      const id = params.get('id');
      if (id) {
        const found = rows.find((row) => row.id === id);
        if (found) {
          setSelectedReview(found);
          setSelectedReviewId(found.id ?? null);
        } else {
          setSelectedReview(null);
          setSelectedReviewId(null);
        }
      }
    } catch (error) {
      if (requestId !== historyLoadSeq.current) return;
      setHistoryError((error as Error).message);
      if (!cachedRows.length) setReviewHistory([]);
    } finally {
      if (requestId === historyLoadSeq.current) setHistoryLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadReviewHistory();
  }, [loadReviewHistory]);

  useEffect(() => {
    const id = selectedReviewId;
    if (!id || !selectedReview || selectedReview.id !== id) return;
    if (selectedReview.raw_scores != null || selectedReview.review_items != null) return;

    let cancelled = false;
    supabase
      .from('conversation_sales_reviews')
      .select('*')
      .eq('id', id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        setSelectedReview(data as ConversationReviewHistoryRow);
      })
      .catch(() => {
        // The lightweight row still keeps the history usable if detail hydration fails.
      });

    return () => {
      cancelled = true;
    };
  }, [selectedReviewId, selectedReview]);`;

  if (!block.test(text)) throw new Error('Reviews.tsx history-loader block not found');
  text = text.replace(block, replacement);
}

fs.writeFileSync(filePath, text, 'utf8');
console.log('[reviews-history] lightweight history + lazy detail hydration applied');
