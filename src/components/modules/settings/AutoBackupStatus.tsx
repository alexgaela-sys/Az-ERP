// Status card for the automatic backups introduced in services/autoBackup.ts
// (desktop) and the Supabase cron snapshot (cloud) — shown inside Settings →
// البيانات والنسخ الاحتياطي, right next to the existing manual export/import.
import React, { useEffect, useState } from 'react';
import { FolderOpen, RefreshCw, ShieldCheck } from 'lucide-react';
import { CLOUD_STORAGE_MODE } from '../../../services/db';

export const AutoBackupStatus: React.FC = () => {
  const [files, setFiles] = useState<string[] | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    if (!window.electronBackup) return;
    setLoading(true);
    const res = await window.electronBackup.list();
    setLoading(false);
    if (res.ok) {
      setFiles(res.files || []);
      setFolder(res.folder || null);
    }
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
    </div>
  );
};
