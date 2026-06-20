import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type AttendanceLocation = {
  id: string;
  name: string;
  type: 'branch' | 'warehouse';
  branch_name: string | null;
  latitude: number;
  longitude: number;
  allowed_radius_meters: number;
  max_gps_accuracy_meters: number;
};

export type GeoPoint = { latitude: number; longitude: number; accuracy: number };
export type ClockType = 'check_in' | 'check_out';
export type ClockStatus = 'accepted' | 'rejected' | 'manual_review';

export type ClockUser = {
  userId?: string | null;
  staffId?: string | null;
  staffName: string;
  role?: string | null;
  branchName?: string | null;
};

export function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const r = 6371000;
  const rad = (v: number) => (v * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const lat1 = rad(a.latitude);
  const lat2 = rad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

function ensureSupabase() {
  if (!isSupabaseConfigured) throw new Error('Supabase غير مفعّل.');
}

export async function loadAttendanceLocations(): Promise<AttendanceLocation[]> {
  ensureSupabase();
  const { data, error } = await supabase
    .from('attendance_locations')
    .select('id,name,type,branch_name,latitude,longitude,allowed_radius_meters,max_gps_accuracy_meters,is_active')
    .eq('is_active', true)
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map((row: any) => ({
    id: String(row.id),
    name: String(row.name || 'موقع حضور'),
    type: row.type === 'warehouse' ? 'warehouse' : 'branch',
    branch_name: row.branch_name || null,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    allowed_radius_meters: Number(row.allowed_radius_meters || 100),
    max_gps_accuracy_meters: Number(row.max_gps_accuracy_meters || 80),
  }));
}

export function readBrowserLocation(): Promise<GeoPoint> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('المتصفح لا يدعم تحديد الموقع.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      }),
      () => reject(new Error('تعذر الحصول على الموقع. تأكد من السماح للموقع.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

export function nearestLocation(point: GeoPoint, locations: AttendanceLocation[]) {
  let best: { location: AttendanceLocation; distance: number } | null = null;
  for (const location of locations) {
    const distance = distanceMeters(point, location);
    if (!best || distance < best.distance) best = { location, distance };
  }
  return best;
}

export function getAttendanceDeviceId() {
  try {
    const key = 'dawaa_attendance_device_id';
    let value = localStorage.getItem(key);
    if (!value) {
      value = `device-${crypto.randomUUID()}`;
      localStorage.setItem(key, value);
    }
    return value;
  } catch {
    return 'unknown-device';
  }
}

export async function checkDevicePresence() {
  try {
    if (!window.PublicKeyCredential) return { ok: false, method: 'fallback_pin' };
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    return { ok: available, method: available ? 'webauthn' : 'fallback_pin' };
  } catch {
    return { ok: false, method: 'fallback_pin' };
  }
}

export async function insertAttendanceLog(input: {
  user: ClockUser;
  type: ClockType;
  point: GeoPoint | null;
  location: AttendanceLocation | null;
  distance: number | null;
  deviceVerified: boolean;
  method: string | null;
  status: ClockStatus;
  reason?: string | null;
}) {
  ensureSupabase();
  const { error } = await supabase.from('staff_attendance_logs').insert({
    staff_id: input.user.staffId || null,
    staff_name: input.user.staffName,
    role: input.user.role || null,
    branch_name: input.user.branchName || input.location?.branch_name || null,
    location_id: input.location?.id || null,
    attendance_type: input.type,
    shift_date: new Date().toISOString().slice(0, 10),
    latitude: input.point?.latitude || null,
    longitude: input.point?.longitude || null,
    gps_accuracy_meters: input.point?.accuracy || null,
    distance_from_location_meters: input.distance,
    biometric_verified: input.deviceVerified,
    biometric_method: input.method,
    device_id: getAttendanceDeviceId(),
    status: input.status,
    rejection_reason: input.reason || null,
    created_by: input.user.userId || null,
  });
  if (error) throw new Error(error.message);
}

export async function clockAttendance(user: ClockUser, type: ClockType) {
  const locations = await loadAttendanceLocations();
  const point = await readBrowserLocation();
  const nearest = nearestLocation(point, locations);
  if (!nearest) {
    const message = 'لا توجد مواقع حضور مفعّلة.';
    await insertAttendanceLog({ user, type, point, location: null, distance: null, deviceVerified: false, method: null, status: 'rejected', reason: message });
    return { status: 'rejected' as ClockStatus, message, point, location: null, distance: null };
  }
  const { location, distance } = nearest;
  if (point.accuracy > location.max_gps_accuracy_meters) {
    const message = `دقة GPS ضعيفة: ${Math.round(point.accuracy)} متر، المسموح ${location.max_gps_accuracy_meters} متر.`;
    await insertAttendanceLog({ user, type, point, location, distance, deviceVerified: false, method: null, status: 'rejected', reason: message });
    return { status: 'rejected' as ClockStatus, message, point, location, distance };
  }
  if (distance > location.allowed_radius_meters) {
    const message = `أنت خارج نطاق ${location.name}. المسافة ${distance} متر، المسموح ${location.allowed_radius_meters} متر.`;
    await insertAttendanceLog({ user, type, point, location, distance, deviceVerified: false, method: null, status: 'rejected', reason: message });
    return { status: 'rejected' as ClockStatus, message, point, location, distance };
  }
  const device = await checkDevicePresence();
  const status: ClockStatus = device.ok ? 'accepted' : 'manual_review';
  const message = device.ok
    ? type === 'check_in' ? 'تم تسجيل الحضور بنجاح.' : 'تم تسجيل الانصراف بنجاح.'
    : 'الموقع داخل النطاق، لكن تأكيد الجهاز غير متاح. تم تسجيل المحاولة للمراجعة.';
  await insertAttendanceLog({ user, type, point, location, distance, deviceVerified: device.ok, method: device.method, status, reason: device.ok ? null : message });
  return { status, message, point, location, distance };
}

export async function loadMyAttendance(staffId?: string | null, staffName?: string | null) {
  ensureSupabase();
  let query = supabase.from('staff_attendance_logs').select('*').order('recorded_at', { ascending: false }).limit(20);
  if (staffId) query = query.eq('staff_id', staffId);
  else if (staffName) query = query.eq('staff_name', staffName);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}
