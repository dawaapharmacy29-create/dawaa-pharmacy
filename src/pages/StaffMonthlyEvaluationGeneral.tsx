      setManagerNotes('');
      setStatus('draft');
      setSentAtIso('');
      setPreviouslySent(false);
      setActiveGates([]);
      setCriticalGateRationales({});
      try {
        const { startDate, endDate, endDateExclusive } = evaluationCycleDateKeys(cycleLabel);
        const cycleKeyDate = `${cycleLabel}-01`;
        const pointsPromise = getStaffPointsDashboardV3(selectedId, cycleLabel).catch(() => null);
        const statementPromise = supabase
          .from('employee_monthly_statements')
          .select('points_closing,incentive_amount')
          .eq('staff_id', selectedId)
          .eq('cycle_start', startDate)
          .eq('cycle_end', endDate)
          .maybeSingle();

        const evidenceCacheKey = [
          selectedId,
          startDate,
          endDateExclusive,
          canonicalStaffRole(selected.job_title || selected.role),
          normalizeBranchName(selected.branch || branch),
        ].join(':');
        const cachedEvidence = evidenceCacheRef.current.get(evidenceCacheKey);
        const evidencePromise = cachedEvidence && Date.now() - cachedEvidence.at < 60_000
          ? Promise.resolve(cachedEvidence.value)
          : loadEmployeeMonthlyEvidence({
              staffId: selectedId,
              startDate,
              endDateExclusive,
              role: selected.job_title || selected.role,
              branch: selected.branch || branch,
            }).then((value) => {
              evidenceCacheRef.current.set(evidenceCacheKey, { at: Date.now(), value });
              return value;
            });

        const [savedResult, evidenceSettled] = await Promise.all([
          supabase.rpc('get_staff_monthly_evaluation_v5', {
            p_actor_id: user.id,
            p_staff_id: selectedId,
            p_month: cycleKeyDate,
          }),
          evidencePromise.then(
            (value) => ({ value, error: null as unknown }),
            (error) => ({ value: null as EmployeeMonthlyEvidence | null, error })
          ),
        ]);

        if (savedResult.error) throw savedResult.error;
        if (evaluationRequestRef.current !== requestId) return;

        const saved = savedResult.data as EvaluationRow | null;
        const savedStatus = String(saved?.status || 'draft');
        const savedMetricsSnapshot = saved?.metrics_snapshot as Record<string, unknown> | null;
        const savedFinalSnapshotRaw = savedMetricsSnapshot?.final_approval_snapshot;
        const savedFinalSnapshot =
          savedFinalSnapshotRaw && typeof savedFinalSnapshotRaw === 'object' && !Array.isArray(savedFinalSnapshotRaw)
            ? savedFinalSnapshotRaw as Record<string, unknown>
            : null;
        const hasPublishedSnapshot = ['sent', 'approved'].includes(savedStatus) && Boolean(savedFinalSnapshot);

        if (evidenceSettled.error || !evidenceSettled.value) {
          if (!hasPublishedSnapshot) throw evidenceSettled.error;
          setEvidenceErrors({ liveEvidence: evidenceSettled.error instanceof Error ? evidenceSettled.error.message : String(evidenceSettled.error || 'تعذر تحميل الأدلة الحية') });
          setEmployeeHeader(null);
          setEmployeeHeaderLoading(false);
        }

        const evidenceResult = evidenceSettled.value;
        if (evidenceResult) {
        setMetrics(evidenceResult.metrics);
        setEvidenceHealth(evidenceResult.health);
        setEvidenceErrors(evidenceResult.errors);
        setCoaching(evidenceResult.coaching);
        setTaskEvaluation(evidenceResult.taskEvaluation);

        const headerRequestId = ++employeeHeaderRequestRef.current;
        void loadEmployeeEvaluationHeader({
          staffId: selectedId,
          staffName: selected.name,
          role: selected.job_title || selected.role,
          branch: selected.branch || branch,
          start: startDate,
          end: endDate,
          evidence: evidenceResult,
        }).then((value) => {
          if (employeeHeaderRequestRef.current === headerRequestId) setEmployeeHeader(value);
        }).catch(() => {
          if (employeeHeaderRequestRef.current === headerRequestId) setEmployeeHeader(null);
        }).finally(() => {
          if (employeeHeaderRequestRef.current === headerRequestId) setEmployeeHeaderLoading(false);
        });

        void pointsPromise.then((pointsResult) => {
          if (evaluationRequestRef.current === requestId) setPointsTruth(pointsResult);
        });
        void statementPromise.then((statementResult) => {
          if (evaluationRequestRef.current === requestId) setSettledStatement(statementResult.data || null);
        });

        }
        const freshSections = evaluationProfileForRole(selected.job_title || selected.role).sections;
        if (saved) {
          setEvaluationId(String(saved.id || ''));
          const savedSentAt = String(saved.sent_at || '');
          const metricsSnapshot = savedMetricsSnapshot;
          const finalSnapshotRaw = metricsSnapshot?.final_approval_snapshot;
          const finalSnapshot =
            finalSnapshotRaw && typeof finalSnapshotRaw === 'object' && !Array.isArray(finalSnapshotRaw)
              ? finalSnapshotRaw as Record<string, unknown>
              : null;
          const published = ['sent', 'approved'].includes(savedStatus) && finalSnapshot;
          const content = published || saved;

          setPublishedSnapshot(finalSnapshot);
          setPublishedSnapshotHash(String(metricsSnapshot?.final_approval_hash || ''));
          setSections(normalizeSavedSections(content.sections, freshSections));
          setStrengthsText(Array.isArray(content.strengths) ? content.strengths.map(String).join('\n') : '');
          setDevelopmentText(Array.isArray(content.development_points) ? content.development_points.map(String).join('\n') : '');
          setManagerNotes(String(content.manager_notes || ''));
          setStatus(savedStatus);
          setSentAtIso(savedSentAt);
          setPreviouslySent(
            ['sent', 'approved'].includes(savedStatus)
              && Boolean(savedSentAt)
              && new Date(savedSentAt).getTime() > cycleRange.end.getTime()
          );
          const savedGates = metricsSnapshot && Array.isArray(metricsSnapshot.active_critical_gates) ? (metricsSnapshot.active_critical_gates as string[]) : [];
          const validSavedGates = savedGates.filter((gate): gate is CriticalGateType => gate in CRITICAL_GATE_CAPS);
          setActiveGates(validSavedGates);
          const savedGateRationalesRaw = metricsSnapshot?.critical_gate_rationales;
          const savedGateRationales = savedGateRationalesRaw && typeof savedGateRationalesRaw === 'object' && !Array.isArray(savedGateRationalesRaw)
            ? savedGateRationalesRaw as Record<string, unknown>
            : {};
          setCriticalGateRationales(Object.fromEntries(
            validSavedGates
              .map((gate) => [gate, String(savedGateRationales[gate] || '')])
              .filter(([, rationale]) => rationale.trim())
          ) as Partial<Record<CriticalGateType, string>>);
        } else {
          setEvaluationId(null);
          setPublishedSnapshot(null);
          setPublishedSnapshotHash('');
          setSections(freshSections);
          setStrengthsText('');
          setDevelopmentText('');
          setManagerNotes('');
          setStatus('draft');
          setSentAtIso('');
          setPreviouslySent(false);
          setActiveGates([]);
      setCriticalGateRationales({});
        }
      } catch (cause) {
        if (evaluationRequestRef.current !== requestId) return;
        setEmployeeHeader(null);
        setEmployeeHeaderLoading(false);
        const message = cause instanceof Error ? cause.message : 'تعذر تحميل التقييم';
        setEvaluationLoadError(message);
        toast.error(message);
      } finally {
        if (evaluationRequestRef.current === requestId) setEvaluationLoading(false);
      }
    };
    void loadEvaluation();
  }, [
    cycleLabel,
    selectedId,
    selected?.name,
    selected?.job_title,
    selected?.role,
    selected?.branch,
    branch,
    user?.id,
  ]);

  useEffect(() => {
    let cancelled = false;
    async function loadEmployeeResponse() {
      if (!employeeView || !employeeEvaluationPublished || !selectedId || !user?.id) {
        if (!cancelled) {
          setEmployeeResponse(null);
          setEmployeeCommentDraft('');
        }
        return;
      }

      const { data, error } = await supabase.rpc('get_staff_monthly_evaluation_employee_response_v5', {
        p_actor_id: user.id,