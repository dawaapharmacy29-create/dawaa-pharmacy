import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from './useAuth';

export interface DoctorPermissions {
  id: string;
  doctor_id: string;
  doctor_name: string;
  can_view_dashboard: boolean;
  can_view_analytics: boolean;
  can_view_customers: boolean;
  can_view_reviews: boolean;
  can_view_points: boolean;
  can_edit_customers: boolean;
  can_add_reviews: boolean;
  can_view_stagnant_medicines: boolean;
  can_view_incentive_medicines: boolean;
  branch_access: string[];
}

export function useDoctorPermissions() {
  const { user } = useAuth();
  const [permissions, setPermissions] = useState<DoctorPermissions | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setPermissions(null);
      setLoading(false);
      return;
    }

    const fetchPermissions = async () => {
      try {
        const { data, error } = await supabase
          .from('doctor_permissions')
          .select('*')
          .eq('doctor_id', user.id)
          .single();

        if (error) {
          // If no permissions exist, create default permissions for doctors
          if (user.role === 'صيدلاني') {
            const defaultPermissions = {
              doctor_id: user.id,
              doctor_name: user.name,
              can_view_dashboard: true,
              can_view_analytics: true,
              can_view_customers: true,
              can_view_reviews: false,
              can_view_points: true,
              can_edit_customers: false,
              can_add_reviews: false,
              can_view_stagnant_medicines: true,
              can_view_incentive_medicines: true,
              branch_access: [user.branch || 'الكل'],
            };

            const { data: newData, error: insertError } = await supabase
              .from('doctor_permissions')
              .insert(defaultPermissions)
              .select()
              .single();

            if (!insertError && newData) {
              setPermissions(newData as DoctorPermissions);
            }
          } else {
            // For non-doctors, give full access
            setPermissions({
              id: 'default',
              doctor_id: user.id,
              doctor_name: user.name,
              can_view_dashboard: true,
              can_view_analytics: true,
              can_view_customers: true,
              can_view_reviews: true,
              can_view_points: true,
              can_edit_customers: true,
              can_add_reviews: true,
              can_view_stagnant_medicines: true,
              can_view_incentive_medicines: true,
              branch_access: ['الكل'],
            });
          }
        } else {
          setPermissions(data as DoctorPermissions);
        }
      } catch (err) {
        console.error('Error fetching doctor permissions:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchPermissions();
  }, [user]);

  return { permissions, loading };
}
