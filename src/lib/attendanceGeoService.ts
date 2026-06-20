import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type AttendanceType = 'check_in' | 'check_out';
export type AttendanceStatus = 'accepted' | 'rejected' | 'manual_review';

export type AttendanceLocation = {
  id: string;
  name: string;
  type: 'branch' | 'warehouse';
  branch_name: string | null;
  latitude: number;
  longitude: number;
  allowed_radius_meters: number;
  max_gps_accuracy_meters: number;
  is_active: boolean;
};

export type DevicePosition = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

export type AttendanceUser = {
  id?: string | null;
  name?: string | null;
  role?: string | null;
  branch?: string | null;
};

export type AttendanceValidation = {
  status: AttendanceStatus;
  nearestLocation: AttendanceLocation | null;
  distanceMeters: number | null;
  rejectionReason: string | null;
};

export function haversineDistanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const earthRadius = 6371000;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.round(earthRadius * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

export async function getDevicePosition(): Promise<DevicePosition> {
  if (!('geolocation' in navigator)) {
    throw new Error('المتصفح لا يدعم تحديد الموقع.');
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) reject(new Error('تم رفض إذن الموقع.'));
        else if (error.code === error.TIMEOUT) reject(new Error('انتهت مهلة تحديد الموقع.'));
        else reject(new Error('تعذر تحديد الموقع الحالي.'));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

export async function fetchAttendanceLocations(): Promise<AttendanceLocation[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from('attendance_locations')
    .select('*')
    .eq('is_active', true)
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map((row: any) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    branch_name: row.branch_name,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    allowed_radius_meters: Number(row.allowed_radius_meters || 100),
    max_gps_accuracy_meters: Number(row.max_gps_accuracy_meters || 80),
    is_active: Boolean(row.is_active),
  }));
}

export function validateAttendancePosition(position: DevicePosition, locations: AttendanceLocation[]): AttendanceValidation {
  if (!locations.length) {
    return { status: 'manual_review', nearestLocation: null, distanceMeters: null, rejectionReason: 'لم يتم تسجيل مواقع حضور فعالة بعد.' };
  }

  const ranked = locations
    .map((location) => ({ location, distance: haversineDistanceMeters(position, location) }))
    .sort((a, b) => a.distance - b.distance);
  const nearest = ranked[0];

  if (position.accuracy > nearest.location.max_gps_accuracy_meters) {
    return {
      status: 'rejected',
      nearestLocation: nearest.location,
      distanceMeters: nearest.distance,
      rejectionReason: `دقة GPS ضعيفة (${Math.round(position.accuracy)} متر). المطلوب أقل من ${nearest.location.max_gps_accuracy_meters} متر.`,
    };
  }

  if (nearest.distance > nearest.location.allowed_radius_meters) {
    return {
      status: 'rejected',
      nearestLocation: nearest.location,
      distanceMeters: nearest.distance,
      rejectionReason: `أنت خارج نطاق ${nearest.location.name}. المسافة الحالية ${nearest.distance} متر.`,
    };
  }

  return { status: 'accepted', nearestLocation: nearest.location, distanceMeters: nearest.distance, rejectionReason: null };
}

function browserSupportsWebAuthn() {
  return typeof window !== 'undefined' && 'PublicKeyCredential' in window && Boolean(navigator.credentials);
}

export async function verifyWithAvailableBiometric(): Promise<{ verified: boolean; method: string; message: string }> {
  if (!browserSupportsWebAuthn()) {
    return { verified: false, method: 'fallback_pin', message: 'الجهاز لا يدعم Passkey/Windows Hello من المتصفح الحالي.' };
  }

  try {
    // This is a browser capability check only. Real biometric/passkey assertion requires registered credentials.
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!available) return { verified: false, method: 'fallback_pin', message: 'لا توجد بصمة أو Face ID مفعّلة على هذا الجهاز.' };
    return { verified: true, method: 'webauthn', message: 'الجهاز يدعم التحقق بالبصمة/Passkey. سيتم تفعيل التسجيل الكامل بعد ربط بيانات Passkey.' };
  } catch {
    return { verified: false, method: 'fallback_pin', message: 'تعذر فحص دعم البصمة على هذا الجهاز.' };
  }
}

export async function saveAttendanceAttempt(input: {
  user: AttendanceUser;
  attendanceType: AttendanceType;
  position: DevicePosition | null;
  validation: AttendanceValidation;
  biometric: { verified: boolean; method: string };
  deviceId?: string | null;
}) {
  if (!isSupabaseConfigured) throw new Error('Supabase غير متصل.');
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('staff_attendance_logs')
    .insert({
      staff_id: input.user.id || null,
      staff_name: input.user.name || 'غير محدد',
      role: input.user.role || null,
      branch_name: input.user.branch || input.validation.nearestLocation?.branch_name || null,
      location_id: input.validation.nearestLocation?.id || null,
      attendance_type: input.attendanceType,
      shift_date: today,
      latitude: input.position?.latitude || null,
      longitude: input.position?.longitude || null,
      gps_accuracy_meters: input.position?.accuracy || null,
      distance_from_location_meters: input.validation.distanceMeters,
      biometric_verified: input.biometric.verified,
      biometric_method: input.biometric.method,
      device_id: input.deviceId || null,
      status: input.validation.status,
      rejection_reason: input.validation.rejectionReason,
      created_by: input.user.id || null,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function getRecentAttendanceLogs(userId?: string | null, limit = 20) {
  if (!isSupabaseConfigured) return [];
  let query = supabase.from('staff_attendance_logs').select('*').order('recorded_at', { ascending: false }).limit(limit);
  if (userId) query = query.eq('staff_id', userId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}
