import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileSpreadsheet } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import FollowupResultsExcelImportModal from '@/components/customerService/FollowupResultsExcelImportModal';

const MOUNT_ID = 'customer-service-results-import-top-mount';

export default function CustomerServiceResultsImportTopAction() {
  const location = useLocation();
  const { user } = useAuth();
  const [mountNode, setMountNode] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);

  const branch = useMemo(() => normalizeBranchName(user?.branch || 'كل الفروع'), [user?.branch]);
  const enabled = location.pathname === '/customer-service';

  useEffect(() => {
    if (!enabled) {
      setMountNode(null);
      return;
    }

    const ensureMount = () => {
      const buttons = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
      const anchor = buttons.find((button) => {
        const label = String(button.textContent || '').replace(/\s+/g, ' ').trim();
        return label.includes('إضافة متابعة استثنائية') && button.offsetParent !== null;
      });
      if (!anchor?.parentElement) return;

      let mount = document.getElementById(MOUNT_ID) as HTMLElement | null;
      if (!mount) {
        mount = document.createElement('span');
        mount.id = MOUNT_ID;
        mount.style.display = 'contents';
      }
      if (mount.parentElement !== anchor.parentElement || anchor.nextElementSibling !== mount) {
        anchor.insertAdjacentElement('afterend', mount);
      }
      setMountNode(mount);
    };

    ensureMount();
    const observer = new MutationObserver(ensureMount);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', ensureMount);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', ensureMount);
      document.getElementById(MOUNT_ID)?.remove();
      setMountNode(null);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <>
      {mountNode &&
        createPortal(
          <button
            type="button"
            data-followup-results-import-visible
            className="btn-secondary flex items-center gap-2"
            onClick={() => setOpen(true)}
            title="رفع ملف نتائج متابعة العملاء أصحاب الفواتير 500 جنيه فأكثر"
          >
            <FileSpreadsheet size={17} />
            رفع نتائج متابعة 500+
          </button>,
          mountNode,
        )}

      <FollowupResultsExcelImportModal
        open={open}
        onClose={() => setOpen(false)}
        onImported={() => {
          setOpen(false);
          window.dispatchEvent(new CustomEvent('dataChanged', { detail: { table: 'daily_followups' } }));
        }}
        branch={branch}
      />
    </>
  );
}
