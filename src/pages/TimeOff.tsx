import { useMemo, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { supabase } from '@/lib/supabase';
import { TABLES } from '@/lib/supabaseTables';
import { getCurrentCycle } from '@/lib/pharmacy-cycle';
import { persistPointsTransaction } from '@/lib/pointsPersistence';
import { isActiveStaffFilter } from '@/lib/staffActiveFilter';
import { mergeStaffChoices, type StaffChoice } from '@/lib/staffFallback';
import type { EvaluationRuleDef } from '@/lib/evaluationRulesCatalog';
import { getSafeCurrentUserId, useAuth } from '@/hooks/useAuth';

// Restored from main after an aborted refactor attempt. No production merge was made.
