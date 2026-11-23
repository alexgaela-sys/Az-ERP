// Action-level authorization: resolves the current actor (browser session or
// trusted system runner) and enforces the PermissionService matrix BEFORE any
// service/engine mutation executes. Navigation filtering alone is not enough.
//
// Script runners (audit/verify/regression under tsx) have no browser session;
// they are treated as trusted system runners and pass explicit userId, so they
// bypass UI-session resolution but still resolve role from the users table.
import { PermissionAction } from '../types/erp';
import { ModuleKey, PermissionService } from './permissions';
import { AuthService } from './auth';
import { erpDb } from './db';

export interface GuardOptions {
  userId?: string;
  userName?: string;
  isTest?: boolean;
}

export interface GuardResult {
  allowed: boolean;
  error?: string;
  userId: string;
  userName: string;
}

const DENIED_SUFFIX = 'ليس لديك صلاحية تنفيذ هذه العملية على هذا النموذج';

export class AuthorizationService {
  /** The user id reserved for trusted system runners (no browser session). */
  public static readonly SYSTEM_USER_ID = 'usr-system';
  public static readonly SUPER_ADMIN_ROLE = 'Super Admin';

  /**
   * Enforce an action on a module for the acting user.
   *
   * Actor resolution (in priority order):
   * 1. Browser session exists → the session user governs (a spoofable userId
   *    parameter can never escalate privileges in the browser).
   * 2. No session + explicit userId that exists in the users table (script
   *    runners like audit/verify passing 'usr-admin') → that user's role governs.
   * 3. No session + unknown/absent userId → trusted system runner (seed/test
   *    scripts) → allowed.
   *
   * Super Admin role is always allowed; everyone else must hold the exact
   * PermissionAction on the module per the PermissionService matrix.
   */
  public static enforce(module: ModuleKey, action: PermissionAction, options?: GuardOptions): GuardResult {
    const session = AuthService.getCurrentSession();
    const db = erpDb.getSnapshot();

    if (session && session.user) {
      // ---- Browser context: the logged-in session user governs ----
      const user = db.users.find(u => u.id === session.user.id);
      if (!user) {
        return { allowed: false, error: `المستخدم المنفذ غير موجود بالنظام - ${DENIED_SUFFIX}`, userId: session.user.id, userName: session.user.name };
      }
      if (!user.active) {
        return { allowed: false, error: `حساب المستخدم (${user.name}) معطل - ${DENIED_SUFFIX}`, userId: user.id, userName: user.name };
      }
      if (user.role === this.SUPER_ADMIN_ROLE) {
        return { allowed: true, userId: user.id, userName: user.name };
      }
      if (!PermissionService.hasPermissionForUser(user, module, action)) {
        return { allowed: false, error: `الدور (${user.role}) ${DENIED_SUFFIX}`, userId: user.id, userName: user.name };
      }
      return { allowed: true, userId: user.id, userName: user.name };
    }

    // ---- Non-browser (script) context ----
    if (options?.userId) {
      const user = db.users.find(u => u.id === options.userId);
      if (user) {
        if (!user.active) {
          return { allowed: false, error: `حساب المستخدم (${user.name}) معطل - ${DENIED_SUFFIX}`, userId: user.id, userName: user.name };
        }
        if (user.role === this.SUPER_ADMIN_ROLE) {
          return { allowed: true, userId: user.id, userName: user.name };
        }
        if (!PermissionService.hasPermissionForUser(user, module, action)) {
          return { allowed: false, error: `الدور (${user.role}) ${DENIED_SUFFIX}`, userId: user.id, userName: user.name };
        }
        return { allowed: true, userId: user.id, userName: user.name };
      }
      // Unknown userId label from a script → trusted system runner
    }

    return { allowed: true, userId: options?.userId || this.SYSTEM_USER_ID, userName: options?.userName || 'System Runner' };
  }

  /**
   * Super-Admin-only gate (document cancellation / opening-balance correction).
   * Browser: the session user must be an active Super Admin. Scripts: an explicit
   * userId must resolve to an active Super Admin, or be an unknown label / absent
   * (trusted system runner, same rule as enforce()).
   */
  public static requireSuperAdmin(options?: GuardOptions): GuardResult {
    const session = AuthService.getCurrentSession();
    const db = erpDb.getSnapshot();
    const denied = 'هذه العملية مقصورة على المشرف العام (Super Admin) فقط';
    const check = (userId: string): GuardResult => {
      const user = db.users.find(u => u.id === userId);
      if (!user) return { allowed: false, error: denied, userId, userName: '' };
      if (!user.active || user.role !== this.SUPER_ADMIN_ROLE) {
        return { allowed: false, error: denied, userId: user.id, userName: user.name };
      }
      return { allowed: true, userId: user.id, userName: user.name };
    };
    if (session && session.user) return check(session.user.id);
    if (options?.userId && db.users.some(u => u.id === options.userId)) return check(options.userId);
    return { allowed: true, userId: options?.userId || this.SYSTEM_USER_ID, userName: options?.userName || 'System Runner' };
  }

  /**
   * Warehouse-scoped guard: first enforces the ordinary module/action
   * permission, then — only for a user explicitly restricted to specific
   * warehouses (User.warehouseIds, set from Settings → أمناء المخازن) —
   * also rejects a warehouseId outside that list. An empty/absent
   * warehouseIds means "no restriction", so every user who predates this
   * feature (and every manager/admin who was never scoped) is unaffected.
   */
  public static enforceWarehouse(
    module: ModuleKey,
    action: PermissionAction,
    warehouseId: string,
    options?: GuardOptions,
  ): GuardResult {
    const base = this.enforce(module, action, options);
    if (!base.allowed) return base;
    const db = erpDb.getSnapshot();
    const user = db.users.find(u => u.id === base.userId);
    if (user && Array.isArray(user.warehouseIds) && user.warehouseIds.length > 0 && !user.warehouseIds.includes(warehouseId)) {
      const whName = db.warehouses.find(w => w.id === warehouseId)?.nameAr || warehouseId;
      return {
        allowed: false,
        error: `لا تملك صلاحية على المستودع (${whName}) — محصور حسابك على مستودعات محددة من إعدادات أمناء المخازن`,
        userId: base.userId,
        userName: base.userName,
      };
    }
    return base;
  }

  /** Convenience: enforce then return the resolved user ids/names for audit logs. */
  public static enforceOrThrow(module: ModuleKey, action: PermissionAction, options?: GuardOptions): GuardResult {
    const res = this.enforce(module, action, options);
    if (!res.allowed) {
      throw new Error(res.error || 'غير مصرح');
    }
    return res;
  }

  /**
   * Role switching is restricted: only an authenticated Super Admin may switch,
   * and the target role must be one of the valid RoleName values.
   */
  public static canSwitchRole(currentSessionRole: string | undefined, targetRole: string): { allowed: boolean; error?: string } {
    const VALID_ROLES = [
      'Super Admin', 'General Manager', 'Chief Accountant', 'Accountant', 'Cost Accountant',
      'Warehouse Manager', 'Warehouse Employee', 'Sales Manager', 'Sales Representative',
      'Purchasing Manager', 'Production Manager', 'Treasury Accountant', 'Viewer',
    ];

    if (currentSessionRole !== this.SUPER_ADMIN_ROLE) {
      return { allowed: false, error: 'فقط المشرف العام يمكنه تبديل الأدوار والصلاحيات' };
    }
    if (!VALID_ROLES.includes(targetRole)) {
      return { allowed: false, error: 'الدور المطلوب غير معرف بالنظام' };
    }
    return { allowed: true };
  }
}
