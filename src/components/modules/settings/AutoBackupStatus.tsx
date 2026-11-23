// Status card for the automatic backups introduced in services/autoBackup.ts
// (desktop) and the Supabase cron snapshot (cloud) — shown inside Settings →
// البيانات والنسخ الاحتياطي, right next to the existing manual export/import.
import React, { useEffect, useState } from 'react';
import { FolderOpen, RefreshCw, ShieldCheck, Cloud, X } from 'lucide-react';
import { CLOUD_STORAGE_MODE } from '../../../services/db';

export const AutoBackupStatus: React.FC = () => {
  const [files, setFiles] = useState<string[] | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [driveFolder, setDriveFolder] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [driveBusy, setDriveBusy] = useState(false);

  const refresh = async () => {
    if (!window.electronBackup) return;
    setLoading(true);
    const [listRes, driveRes] = await Promise.all([
      window.electronBackup.list(),
      window.electronBackup.getDriveFolder(),
    ]);
    setLoading(false);
    if (listRes.ok) {
      setFiles(listRes.files || []);
      setFolder(listRes.folder || null);
    }
    if (driveRes.ok) setDriveFolder(driveRes.folder);
  };

  const pickDriveFolder = async () => {
    if (!window.electronBackup) return;
    setDriveBusy(true);
    const res = await window.electronBackup.pickDriveFolder();
    setDriveBusy(false);
    if (res.ok && res.folder) setDriveFolder(res.folder);
  };

  const clearDriveFolder = async () => {
    if (!window.electronBackup) return;
    await window.electronBackup.clearDriveFolder();
    setDriveFolder(null);
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (CLOUD_STORAGE_MODE) {
    return (
      <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 space-y-1.5">
        <div className="flex items-center gap-2 font-bold text-xs text-emerald-800">
          <ShieldCheck className="w-4 h-4" />
          <span>نسخة احتياطية تلقائية يومية (سحابية)</span>
        </div>
        <p className="text-[11px] text-emerald-700">
          يتم أخذ نسخة من كامل البيانات تلقائيًا كل يوم على السيرفر، ويُحتفظ بآخر 35 نسخة. في حالة حدوث أي خطأ كبير بالبيانات، تواصل معنا لاستعادة أقرب نسخة سليمة.
        </p>
      </div>
    );
  }

  if (!window.electronBackup) return null; // plain browser dev build — nothing to show

  return (
    <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold text-xs text-emerald-800">
          <ShieldCheck className="w-4 h-4" />
          <span>نسخة احتياطية تلقائية يومية (محلية)</span>
        </div>
        <button
          onClick={refresh}
          className="p-1.5 rounded-lg hover:bg-emerald-100 text-emerald-700 cursor-pointer"
          title="تحديث"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <p className="text-[11px] text-emerald-700">
        يأخذ البرنامج نسخة تلقائيًا كل يوم ويحتفظ بآخر {files ? Math.min(files.length, 60) : '60'} نسخة كحد أقصى
        {files && files.length > 0 ? ` — آخر نسخة: ${files[0].replace('yz_erp_backup_', '').replace('.json', '')}` : ''}.
      </p>
      <button
        onClick={() => window.electronBackup?.openFolder()}
        className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-800 hover:underline cursor-pointer"
      >
        <FolderOpen className="w-3.5 h-3.5" />
        <span>فتح مجلد النسخ الاحتياطية{folder ? '' : ''}</span>
      </button>

      <div className="pt-2 border-t border-emerald-200 space-y-1.5">
        <div className="flex items-center gap-2 font-bold text-xs text-emerald-800">
          <Cloud className="w-4 h-4" />
          <span>نسخة إضافية على Google Drive (أو OneDrive / Dropbox)</span>
        </div>
        {driveFolder ? (
          <div className="flex items-center justify-between gap-2 bg-white/60 rounded-lg px-2.5 py-1.5">
            <span className="text-[11px] text-emerald-800 truncate" dir="ltr" title={driveFolder}>{driveFolder}</span>
            <button
              onClick={clearDriveFolder}
              className="shrink-0 p-1 rounded-lg hover:bg-emerald-100 text-emerald-700 cursor-pointer"
              title="إلغاء الربط"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <p className="text-[11px] text-emerald-700">
            اختر مجلد Google Drive (أو OneDrive / Dropbox) المثبت على هذا الجهاز، وسيتم حفظ نسخة من كل نسخة احتياطية هناك تلقائيًا أيضًا، وبرنامج المزامنة يرفعها لوحده.
          </p>
        )}
        <button
          onClick={pickDriveFolder}
          disabled={driveBusy}
          className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-bold cursor-pointer disabled:opacity-50"
        >
          {driveBusy ? 'جاري الاختيار...' : driveFolder ? 'تغيير المجلد' : 'اختيار مجلد Google Drive'}
        </button>
      </div>
    </div>
  );
};
