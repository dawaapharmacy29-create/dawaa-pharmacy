-- Migration to create notifications table
-- Date: 2024-05-20

-- Create notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'info', -- info, success, warning, error
  priority TEXT DEFAULT 'normal', -- low, normal, high, urgent
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  action_url TEXT,
  action_label TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ
);

-- Add missing columns if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications' AND column_name = 'priority'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN priority TEXT DEFAULT 'normal';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications' AND column_name = 'action_url'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN action_url TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications' AND column_name = 'action_label'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN action_label TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications' AND column_name = 'metadata'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications' AND column_name = 'expires_at'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN expires_at TIMESTAMPTZ;
  END IF;
END $$;

-- Create indexes
CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS notifications_is_read_idx ON public.notifications(is_read);
CREATE INDEX IF NOT EXISTS notifications_created_at_idx ON public.notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_priority_idx ON public.notifications(priority);

-- Add comments
COMMENT ON TABLE public.notifications IS 'User notifications for alerts, reminders, and system messages';
COMMENT ON COLUMN public.notifications.user_id IS 'ID of the user to notify (staff_accounts.id)';
COMMENT ON COLUMN public.notifications.type IS 'Notification type: info, success, warning, error';
COMMENT ON COLUMN public.notifications.priority IS 'Notification priority: low, normal, high, urgent';
COMMENT ON COLUMN public.notifications.is_read IS 'Whether the notification has been read';
COMMENT ON COLUMN public.notifications.action_url IS 'Optional URL to navigate when notification is clicked';
COMMENT ON COLUMN public.notifications.action_label IS 'Label for the action button';
COMMENT ON COLUMN public.notifications.expires_at IS 'Optional expiration time for the notification';

-- Enable RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Users can read their own notifications
CREATE POLICY "users_read_own_notifications"
ON public.notifications
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR user_id IN (SELECT id FROM public.staff_accounts WHERE auth_user_id = auth.uid()));

-- Users can update their own notifications (mark as read)
CREATE POLICY "users_update_own_notifications"
ON public.notifications
FOR UPDATE
TO authenticated
USING (user_id = auth.uid() OR user_id IN (SELECT id FROM public.staff_accounts WHERE auth_user_id = auth.uid()))
WITH CHECK (user_id = auth.uid() OR user_id IN (SELECT id FROM public.staff_accounts WHERE auth_user_id = auth.uid()));

-- System can insert notifications for users
CREATE POLICY "system_insert_notifications"
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Grant permissions
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT INSERT ON public.notifications TO authenticated;

-- Create function to create notification
CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id UUID,
  p_title TEXT,
  p_message TEXT,
  p_type TEXT DEFAULT 'info',
  p_priority TEXT DEFAULT 'normal',
  p_action_url TEXT DEFAULT NULL,
  p_action_label TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (
    user_id,
    title,
    message,
    type,
    priority,
    action_url,
    action_label,
    metadata,
    expires_at
  )
  VALUES (
    p_user_id,
    p_title,
    p_message,
    p_type,
    p_priority,
    p_action_url,
    p_action_label,
    p_metadata,
    p_expires_at
  )
  RETURNING id;
END;
$$;

-- Grant execute on function
GRANT EXECUTE ON FUNCTION public.create_notification TO authenticated;

-- Create function to mark notification as read
CREATE OR REPLACE FUNCTION public.mark_notification_read(p_notification_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.notifications
  SET is_read = true,
      read_at = now()
  WHERE id = p_notification_id
    AND (user_id = auth.uid() OR user_id IN (SELECT id FROM public.staff_accounts WHERE auth_user_id = auth.uid()));
  
  RETURN FOUND;
END;
$$;

-- Grant execute on function
GRANT EXECUTE ON FUNCTION public.mark_notification_read TO authenticated;

-- Create function to mark all notifications as read for a user
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE public.notifications
  SET is_read = true,
      read_at = now()
  WHERE user_id = p_user_id
    AND is_read = false;
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

-- Grant execute on function
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read TO authenticated;
