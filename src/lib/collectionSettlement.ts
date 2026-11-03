import { supabase } from '@/lib/supabase';

// «تسوية التحصيلات» of the Dawaa Bills app (migration 20261103100000): vodafone / insta / visa collected in the
// shifts of the other branches, what is still with the branches, and transfers the accountant has not confirmed.

export type CollectionWallet = 'vodafone' | 'insta' | 'visa';

export interface CollectionTransfer {
  id: string;
  wallet: CollectionWallet;
  amount: number;
  date: string | null;
  recipient: string | null;
  notes: string | null;
  days?: number;
  confirmed_at?: string;
  confirmed_by?: string | null;
  historical?: boolean;
}

export interface CollectionSettlement {
  start_date: string | null;
  synced_at: string | null;
  wallets: Array<{
    wallet: CollectionWallet;
    opening: number;
    collected: number;
    transferred: number;
    balance: number;
  }>;
  pending: CollectionTransfer[];
  confirmed: CollectionTransfer[];
  collected: {
    today: number;
    yesterday: number;
    month: number;
    by_branch: Array<{ branch: string; amount: number }>;
  };
  unknown_events: number;
}

export const WALLET_LABELS: Record<CollectionWallet, string> = {
  vodafone: 'فودافون كاش',
  insta: 'إنستا باي',
  visa: 'فيزا',
};

/** A transfer still unconfirmed after a day is late (the review item turns red). */
export const isLateTransfer = (t: Pick<CollectionTransfer, 'days'>) => Number(t.days ?? 0) > 1;

export async function loadCollectionSettlement() {
  const { data, error } = await supabase.rpc('get_collection_settlement_v1');
  if (error) throw error;
  return data as CollectionSettlement;
}
