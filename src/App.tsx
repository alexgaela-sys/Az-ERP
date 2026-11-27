import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { erpDb, CLOUD_STORAGE_MODE } from './services/db';
import { getCloudRuntime } from './components/cloud/cloudRuntime';
import { AuthService, AuthSession } from './services/auth';
import { RoleName, User } from './types/erp';
import { PermissionService } from './services/permissions';
import { MasterDataService } from './services/masterData';
import { Sidebar, NavTab } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { LoginView } from './components/auth/LoginView';
import { Skeleton } from './components/ui';

// Module Views
// Fix 4 (speed-fix list): Dashboard and the login path stay eager (shown
// immediately after sign-in / on every visit); every other module screen is
// code-split with React.lazy so only the screen the user actually opens is
// downloaded. Each is a named export, so lazy's dynamic import is mapped to
// the default-export shape it expects.
import { DashboardView } from './components/modules/DashboardView';
import type { ReportType } from './components/modules/ReportsView';
const ProductsMasterView = lazy(() => import('./components/modules/ProductsMasterView').then(m => ({ default: m.ProductsMasterView })));
const SalesView = lazy(() => import('./components/modules/SalesView').then(m => ({ default: m.SalesView })));
const CashierView = lazy(() => import('./components/modules/CashierView').then(m => ({ default: m.CashierView })));
const PurchasingView = lazy(() => import('./components/modules/PurchasingView').then(m => ({ default: m.PurchasingView })));
const InventoryView = lazy(() => import('./components/modules/InventoryView').then(m => ({ default: m.InventoryView })));
const ManufacturingView = lazy(() => import('./components/modules/ManufacturingView').then(m => ({ default: m.ManufacturingView })));
const QualityView = lazy(() => import('./components/modules/QualityView').then(m => ({ default: m.QualityView })));
const CostingView = lazy(() => import('./components/modules/CostingView').then(m => ({ default: m.CostingView })));
const CustomersView = lazy(() => import('./components/modules/CustomersView').then(m => ({ default: m.CustomersView })));
const SuppliersView = lazy(() => import('./components/modules/SuppliersView').then(m => ({ default: m.SuppliersView })));
const RepresentativesView = lazy(() => import('./components/modules/RepresentativesView').then(m => ({ default: m.RepresentativesView })));
const ExportView = lazy(() => import('./components/modules/ExportView').then(m => ({ default: m.ExportView })));
const TreasuryView = lazy(() => import('./components/modules/TreasuryView').then(m => ({ default: m.TreasuryView })));
const BanksView = lazy(() => import('./components/modules/BanksView').then(m => ({ default: m.BanksView })));
const ChequesView = lazy(() => import('./components/modules/ChequesView').then(m => ({ default: m.ChequesView })));
const PayrollView = lazy(() => import('./components/modules/PayrollView').then(m => ({ default: m.PayrollView })));
const ExpensesView = lazy(() => import('./components/modules/ExpensesView').then(m => ({ default: m.ExpensesView })));
const AccountingView = lazy(() => import('./components/modules/AccountingView').then(m => ({ default: m.AccountingView })));
const OpeningBalancesView = lazy(() => import('./components/modules/OpeningBalancesView').then(m => ({ default: m.OpeningBalancesView })));
const ReportsView = lazy(() => import('./components/modules/ReportsView').then(m => ({ default: m.ReportsView })));
const UsersView = lazy(() => import('./components/modules/UsersView').then(m => ({ default: m.UsersView })));
const SettingsView = lazy(() => import('./components/modules/SettingsView').then(m => ({ default: m.SettingsView })));
const AuditLogView = lazy(() => import('./components/modules/AuditLogView').then(m => ({ default: m.AuditLogView })));
import { TestRunnerModal } from './components/modules/TestRunnerModal';

export function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const session = AuthService.getCurrentSession();
    return session ? session.user : null;
  });

  // Persist the last opened module so refreshes keep context (still permission-gated)
  const [activeTab, setActiveTab] = useState<NavTab>(() => {
    const saved = localStorage.getItem('yz_erp_active_tab') as NavTab | null;
    return saved || 'dashboard';
  });

  useEffect(() => {
    localStorage.setItem('yz_erp_active_tab', activeTab);
  }, [activeTab]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  // ITEM 18 — contextual sub-target (e.g. dashboard card → a specific report).
  const [reportsSub, setReportsSub] = useState<ReportType | undefined>(undefined);
  const [isTestRunnerOpen, setIsTestRunnerOpen] = useState(false);
  const [currentRole, setCurrentRole] = useState<RoleName>(() => {
    const session = AuthService.getCurrentSession();
    return session ? session.user.role : 'Super Admin';
  });
  const [, setDbVersion] = useState(0);

  // Re-render when database mutates
  useEffect(() => {
    const unsubscribe = erpDb.subscribe(() => {
      setDbVersion(v => v + 1);
    });
    return unsubscribe;
  }, []);

  const handleLoginSuccess = (user: User) => {
    setCurrentUser(user);
    setCurrentRole(user.role);
  };

  const handleLogout = () => {
    AuthService.logout();
    setCurrentUser(null);
    if (CLOUD_STORAGE_MODE) {
      // The sign-in is the Supabase account, so signing out means leaving it too.
      const rt = getCloudRuntime();
      void (async () => {
        try {
          rt?.sync.stop();
          await rt?.auth.signOut();
        } finally {
          window.location.reload();
        }
      })();
    }
  };

  // People without the "prices" permission get every [data-price] element hidden.
  useEffect(() => {
    const sess = AuthService.getCurrentSession();
    document.documentElement.dataset.hidePrices = PermissionService.canSeePrices(sess?.user) ? 'false' : 'true';
  });

  // One-off repair (idempotent): an export customer saved with an EGP card is flipped to USD and
  // its card balance is restated from the ledger, so the statement and 1106 agree.
  useEffect(() => {
    try { MasterDataService.normalizeCustomerCurrencies(); } catch (e) { console.error('customer currency repair failed', e); }
  }, []);

  // Cloud mode: the admin can change this person's role/permissions or switch them off
  // from another device. Follow that without a re-login. (A Super Admin previewing another
  // role from the header is a local choice, so only a CHANGE of the stored record applies.)
  const lastRecord = useRef<string>('');
  useEffect(() => {
    if (!CLOUD_STORAGE_MODE || !currentUser) return;
    const fresh = erpDb.getSnapshot().users.find(u => u.id === currentUser.id);
    if (!fresh || !fresh.active) {
      handleLogout();
      return;
    }
    const sig = JSON.stringify([fresh.role, fresh.permissions ?? null, fresh.active]);
    if (lastRecord.current === '') {
      lastRecord.current = sig;
      return;
    }
    if (sig !== lastRecord.current) {
      lastRecord.current = sig;
      const session = AuthService.refreshCloudSession(fresh);
      if (session) {
        setCurrentUser({ ...session.user });
        setCurrentRole(session.user.role);
      }
    }
  });

  const handleRoleChange = (role: RoleName) => {
    // Service-level restriction: only a Super Admin session may switch roles.
    // updateSessionRole mutates the user object in place AND persists to
    // localStorage, so we re-read the session afterwards to get a clean object
    // with the new role — relying on the mutated `prev` would carry stale shape.
    const res = AuthService.updateSessionRole(role);
    if (!res.success) {
      alert(res.error || 'غير مصرح بتبديل الدور');
      return;
    }
    const session = AuthService.getCurrentSession();
    if (session) {
      setCurrentUser({ ...session.user });
      setCurrentRole(session.user.role);
    }
    // If the new role cannot view the currently open tab, bounce to the dashboard
    if (!PermissionService.canView(role, activeTab)) {
      setActiveTab('dashboard');
    }
  };

  // Guard persisted tab against roles that cannot view it (e.g. after logout/login as another role)
  useEffect(() => {
    if (currentUser && !PermissionService.canView(currentUser.role, activeTab)) {
      setActiveTab('dashboard');
    }
  }, [currentUser, activeTab]);

  // A deep-link sub-target only applies to the navigation that carried it;
  // moving anywhere else resets the destination to its default entry point.
  useEffect(() => {
    if (activeTab !== 'reports') setReportsSub(undefined);
  }, [activeTab]);

  // If not logged in, show Login Screen
  if (!currentUser) {
    // Cloud mode has no second login: the gate above already signed the person in
    // (or is reloading after sign-out), so there is nothing to show here.
    if (CLOUD_STORAGE_MODE) return null;
    return <LoginView onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="min-h-screen bg-cream-100 text-ink-900 font-sans flex flex-col antialiased" dir="rtl">
      {/* Sidebar */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        currentUser={currentUser}
        onLogout={handleLogout}
      />

      {/* Main Content Area (offset by sidebar width on lg) */}
      <div className="flex-1 lg:mr-72 flex flex-col min-w-0">
        <Header
          onToggleSidebar={() => setIsSidebarOpen(o => !o)}
          currentUser={currentUser}
          currentUserRole={currentRole}
          onRoleChange={handleRoleChange}
          onLogout={handleLogout}
          onUserUpdated={(u) => setCurrentUser(u)}
        />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto animate-fade-in">
          {activeTab === 'dashboard' && (
            <DashboardView
              onNavigateTab={(tab, sub) => {
                setReportsSub(sub as ReportType | undefined);
                setActiveTab(tab as NavTab);
              }}
              openTestRunner={() => setIsTestRunnerOpen(true)}
            />
          )}
          {/* Fix 4 (speed-fix list): every screen below is lazy-loaded, so
              this Suspense boundary covers the brief moment its chunk is
              downloaded the first time a user opens it this session
              (instant on every later visit — the browser caches the chunk). */}
          <Suspense fallback={<Skeleton />}>
            {activeTab === 'items' && <ProductsMasterView />}
            {activeTab === 'sales' && <SalesView />}
            {activeTab === 'cashier' && <CashierView />}
            {activeTab === 'purchasing' && <PurchasingView />}
            {activeTab === 'inventory' && <InventoryView />}
            {activeTab === 'manufacturing' && <ManufacturingView />}
            {activeTab === 'quality' && <QualityView />}
            {activeTab === 'costing' && <CostingView />}
            {activeTab === 'customers' && <CustomersView />}
            {activeTab === 'suppliers' && <SuppliersView />}
            {activeTab === 'representatives' && <RepresentativesView />}
            {activeTab === 'export' && <ExportView />}
            {activeTab === 'treasury' && <TreasuryView />}
            {activeTab === 'banks' && <BanksView />}
            {activeTab === 'cheques' && <ChequesView />}
            {activeTab === 'expenses' && <ExpensesView />}
            {activeTab === 'payroll' && <PayrollView />}
            {activeTab === 'accounting' && <AccountingView />}
            {activeTab === 'opening' && <OpeningBalancesView />}
            {activeTab === 'reports' && (
              <ReportsView
                initialReport={reportsSub}
                onNavigateTab={(tab) => setActiveTab(tab as NavTab)}
              />
            )}
            {activeTab === 'users' && <UsersView />}
            {activeTab === 'settings' && (
              <SettingsView openTestRunner={() => setIsTestRunnerOpen(true)} />
            )}
            {activeTab === 'audit' && <AuditLogView />}
          </Suspense>
        </main>
      </div>

      {/* Test Runner Modal */}
      <TestRunnerModal
        isOpen={isTestRunnerOpen}
        onClose={() => setIsTestRunnerOpen(false)}
      />
    </div>
  );
}

export default App;
